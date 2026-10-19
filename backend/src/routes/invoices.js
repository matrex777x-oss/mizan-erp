'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireWrite } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const {
  requireString,
  optionalString,
  requireEnum,
  requireDate,
  optionalDate,
  requireArray,
} = require('../lib/validate');
const { INVOICE_KINDS, DOC_STATUSES } = require('../lib/constants');
const { nextDocumentNumber } = require('../services/numbering');
const { computeLines, postInvoice, unpostInvoice, paidAmounts } = require('../services/invoices');
const serialize = require('../lib/serialize');

const router = express.Router();

const WITH_DETAILS = {
  party: true,
  lines: { include: { account: true, item: true }, orderBy: { sortOrder: 'asc' } },
};

function withBalance(row, paid) {
  const due = row.total - paid;
  return serialize.invoice(row, {
    paid: serialize.money(paid),
    due: serialize.money(due),
    settled: row.status === 'POSTED' && due <= 0n,
  });
}

router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.offset) || 0, 0);

    const where = {};
    if (req.query.kind) where.kind = requireEnum(req.query.kind, INVOICE_KINDS, 'النوع');
    if (req.query.status) where.status = requireEnum(req.query.status, DOC_STATUSES, 'الحالة');
    if (req.query.partyId) where.partyId = String(req.query.partyId);
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');
    if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
    if (req.query.q) {
      where.OR = [{ number: { contains: String(req.query.q) } }, { party: { name: { contains: String(req.query.q) } } }];
    }

    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        take,
        skip,
        include: { party: true },
      }),
      prisma.invoice.count({ where }),
    ]);

    const paid = await paidAmounts(prisma, rows.map((r) => r.id));
    res.json({
      invoices: rows.map((row) => withBalance(row, paid.get(row.id) ?? 0n)),
      total,
      limit: take,
      offset: skip,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    if (!row) throw notFound('الفاتورة غير موجودة');
    const paid = await paidAmounts(prisma, [row.id]);
    const entry = await prisma.journalEntry.findFirst({
      where: { source: 'INVOICE', sourceId: row.id },
      select: { id: true, number: true },
    });
    res.json({ invoice: { ...withBalance(row, paid.get(row.id) ?? 0n), journalEntry: entry } });
  } catch (err) {
    next(err);
  }
});

/** يقرأ ويتحقق من جسم الطلب المشترك بين الإنشاء والتعديل. */
async function readPayload(body, kind) {
  const date = requireDate(body?.date, 'التاريخ');
  const dueDate = optionalDate(body?.dueDate, 'تاريخ الاستحقاق');
  if (dueDate && dueDate < date) throw badRequest('تاريخ الاستحقاق قبل تاريخ الفاتورة');

  const partyId = requireString(body?.partyId, 'العميل/المورد', { max: 40 });
  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) throw notFound('العميل/المورد غير موجود');
  if (!party.active) throw badRequest('العميل/المورد غير مفعّل');

  const expected = kind === 'SALES' ? 'CUSTOMER' : 'SUPPLIER';
  if (party.kind !== 'BOTH' && party.kind !== expected) {
    throw badRequest(kind === 'SALES' ? 'الطرف المختار ليس عميلاً' : 'الطرف المختار ليس مورداً');
  }

  const rawLines = requireArray(body?.lines, 'سطور الفاتورة');
  const computed = await computeLines(prisma, kind, rawLines);

  return {
    date,
    dueDate,
    partyId,
    notes: optionalString(body?.notes, 'ملاحظات', { max: 1000 }),
    ...computed,
  };
}

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const kind = requireEnum(req.body?.kind, INVOICE_KINDS, 'النوع');
    const payload = await readPayload(req.body, kind);
    const shouldPost = req.body?.post === true;

    const created = await prisma.$transaction(async (tx) => {
      const number =
        optionalString(req.body?.number, 'رقم الفاتورة', { max: 40 }) ||
        (await nextDocumentNumber(tx, 'invoice', kind, payload.date));

      const invoice = await tx.invoice.create({
        data: {
          kind,
          number,
          date: payload.date,
          dueDate: payload.dueDate,
          partyId: payload.partyId,
          notes: payload.notes,
          subtotal: payload.subtotal,
          taxTotal: payload.taxTotal,
          total: payload.total,
          lines: { create: payload.lines },
        },
        include: { lines: true },
      });

      if (shouldPost) await postInvoice(tx, invoice, req.user.id);
      return invoice.id;
    });

    const row = await prisma.invoice.findUnique({ where: { id: created }, include: WITH_DETAILS });
    res.status(201).json({ invoice: withBalance(row, 0n) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الفاتورة غير موجودة');
    if (current.status !== 'DRAFT') throw badRequest('لا يمكن تعديل فاتورة مُرحَّلة أو ملغاة');

    const payload = await readPayload({ ...req.body, kind: current.kind }, current.kind);

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: current.id } });
      await tx.invoice.update({
        where: { id: current.id },
        data: {
          date: payload.date,
          dueDate: payload.dueDate,
          partyId: payload.partyId,
          notes: payload.notes,
          subtotal: payload.subtotal,
          taxTotal: payload.taxTotal,
          total: payload.total,
          ...(req.body?.number !== undefined && {
            number: requireString(req.body.number, 'رقم الفاتورة', { max: 40 }),
          }),
          lines: { create: payload.lines },
        },
      });
    });

    const row = await prisma.invoice.findUnique({ where: { id: current.id }, include: WITH_DETAILS });
    res.json({ invoice: withBalance(row, 0n) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/post', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: req.params.id }, include: { lines: true } });
      if (!invoice) throw notFound('الفاتورة غير موجودة');
      await postInvoice(tx, invoice, req.user.id);
    });

    const row = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    const paid = await paidAmounts(prisma, [row.id]);
    res.json({ invoice: withBalance(row, paid.get(row.id) ?? 0n) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unpost', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: req.params.id } });
      if (!invoice) throw notFound('الفاتورة غير موجودة');
      await unpostInvoice(tx, invoice);
    });

    const row = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ invoice: withBalance(row, 0n) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: req.params.id } });
      if (!invoice) throw notFound('الفاتورة غير موجودة');
      if (invoice.status === 'CANCELLED') throw badRequest('الفاتورة ملغاة مسبقاً');
      if (invoice.status === 'POSTED') await unpostInvoice(tx, invoice);
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
    });

    const row = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ invoice: withBalance(row, 0n) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الفاتورة غير موجودة');
    if (current.status === 'POSTED') throw badRequest('ألغِ ترحيل الفاتورة قبل حذفها');

    await prisma.invoice.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
