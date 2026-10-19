'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireWrite } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { requireString, optionalString, requireEnum, requireDate, optionalDate } = require('../lib/validate');
const { PAYMENT_KINDS, DOC_STATUSES } = require('../lib/constants');
const { toMinor } = require('../lib/money');
const { nextDocumentNumber } = require('../services/numbering');
const { validateAllocations, postPayment, unpostPayment } = require('../services/payments');
const serialize = require('../lib/serialize');

const router = express.Router();

const WITH_DETAILS = {
  party: true,
  cashAccount: true,
  allocations: { include: { invoice: { select: { number: true, total: true } } } },
};

router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.offset) || 0, 0);

    const where = {};
    if (req.query.kind) where.kind = requireEnum(req.query.kind, PAYMENT_KINDS, 'النوع');
    if (req.query.status) where.status = requireEnum(req.query.status, DOC_STATUSES, 'الحالة');
    if (req.query.partyId) where.partyId = String(req.query.partyId);
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');
    if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };

    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        take,
        skip,
        include: { party: true, cashAccount: true },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({ payments: rows.map((row) => serialize.payment(row)), total, limit: take, offset: skip });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.payment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    if (!row) throw notFound('السند غير موجود');
    const entry = await prisma.journalEntry.findFirst({
      where: { source: 'PAYMENT', sourceId: row.id },
      select: { id: true, number: true },
    });
    res.json({ payment: serialize.payment(row, { journalEntry: entry }) });
  } catch (err) {
    next(err);
  }
});

async function readPayload(body, kind) {
  const date = requireDate(body?.date, 'التاريخ');
  const partyId = requireString(body?.partyId, 'العميل/المورد', { max: 40 });
  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) throw notFound('العميل/المورد غير موجود');

  const expected = kind === 'RECEIPT' ? 'CUSTOMER' : 'SUPPLIER';
  if (party.kind !== 'BOTH' && party.kind !== expected) {
    throw badRequest(kind === 'RECEIPT' ? 'الطرف المختار ليس عميلاً' : 'الطرف المختار ليس مورداً');
  }

  const cashAccountId = requireString(body?.cashAccountId, 'الحساب النقدي', { max: 40 });
  const cash = await prisma.account.findUnique({ where: { id: cashAccountId } });
  if (!cash) throw notFound('الحساب النقدي غير موجود');
  if (cash.type !== 'ASSET' || cash.isGroup) throw badRequest('الحساب النقدي يجب أن يكون حساب أصول غير تجميعي');

  const amount = toMinor(body?.amount ?? 0);
  if (amount <= 0n) throw badRequest('مبلغ السند يجب أن يكون أكبر من صفر');

  return {
    date,
    partyId,
    cashAccountId,
    amount,
    reference: optionalString(body?.reference, 'المرجع', { max: 100 }),
    notes: optionalString(body?.notes, 'ملاحظات', { max: 1000 }),
    rawAllocations: Array.isArray(body?.allocations) ? body.allocations : [],
  };
}

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const kind = requireEnum(req.body?.kind, PAYMENT_KINDS, 'النوع');
    const payload = await readPayload(req.body, kind);
    const shouldPost = req.body?.post === true;

    const id = await prisma.$transaction(async (tx) => {
      const allocations = await validateAllocations(tx, { kind, ...payload });
      const number =
        optionalString(req.body?.number, 'رقم السند', { max: 40 }) ||
        (await nextDocumentNumber(tx, 'payment', kind, payload.date));

      const payment = await tx.payment.create({
        data: {
          kind,
          number,
          date: payload.date,
          partyId: payload.partyId,
          cashAccountId: payload.cashAccountId,
          amount: payload.amount,
          reference: payload.reference,
          notes: payload.notes,
          allocations: { create: allocations },
        },
      });

      if (shouldPost) await postPayment(tx, payment, req.user);
      return payment.id;
    });

    const row = await prisma.payment.findUnique({ where: { id }, include: WITH_DETAILS });
    res.status(201).json({ payment: serialize.payment(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('السند غير موجود');
    if (current.status !== 'DRAFT') throw badRequest('لا يمكن تعديل سند مُرحَّل أو ملغى');

    const payload = await readPayload(req.body, current.kind);

    await prisma.$transaction(async (tx) => {
      const allocations = await validateAllocations(tx, {
        kind: current.kind,
        ...payload,
        ignorePaymentId: current.id,
      });
      await tx.paymentAllocation.deleteMany({ where: { paymentId: current.id } });
      await tx.payment.update({
        where: { id: current.id },
        data: {
          date: payload.date,
          partyId: payload.partyId,
          cashAccountId: payload.cashAccountId,
          amount: payload.amount,
          reference: payload.reference,
          notes: payload.notes,
          ...(req.body?.number !== undefined && {
            number: requireString(req.body.number, 'رقم السند', { max: 40 }),
          }),
          allocations: { create: allocations },
        },
      });
    });

    const row = await prisma.payment.findUnique({ where: { id: current.id }, include: WITH_DETAILS });
    res.json({ payment: serialize.payment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/post', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw notFound('السند غير موجود');
      await postPayment(tx, payment, req.user);
    });
    const row = await prisma.payment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ payment: serialize.payment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unpost', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw notFound('السند غير موجود');
      await unpostPayment(tx, payment);
    });
    const row = await prisma.payment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ payment: serialize.payment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireWrite, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw notFound('السند غير موجود');
      if (payment.status === 'CANCELLED') throw badRequest('السند ملغى مسبقاً');
      if (payment.status === 'POSTED') await unpostPayment(tx, payment);
      await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
    });
    const row = await prisma.payment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ payment: serialize.payment(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('السند غير موجود');
    if (current.status === 'POSTED') throw badRequest('ألغِ ترحيل السند قبل حذفه');
    await prisma.payment.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
