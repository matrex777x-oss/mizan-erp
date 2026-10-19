'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { nextAdjustmentNumber } = require('../services/numbering');
const { requireInventory } = require('../lib/modules');
const { badRequest, notFound } = require('../lib/errors');
const {
  requireString,
  optionalString,
  requireEnum,
  requireDate,
  optionalDate,
  requireArray,
} = require('../lib/validate');
const { DOC_STATUSES } = require('../lib/constants');
const { readLines, postAdjustment, unpostAdjustment } = require('../services/adjustments');
const serialize = require('../lib/serialize');

const router = express.Router();

const WITH_DETAILS = {
  counterAccount: true,
  lines: { include: { item: true }, orderBy: { sortOrder: 'asc' } },
};

router.get('/', requireCapability('stock.read'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = requireEnum(req.query.status, DOC_STATUSES, 'الحالة');
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');
    if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };

    const rows = await prisma.stockAdjustment.findMany({
      where,
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: Math.min(Number(req.query.limit) || 50, 200),
      include: { counterAccount: true, lines: { select: { id: true } } },
    });

    res.json({
      adjustments: rows.map((row) => serialize.adjustment(row, { lineCount: row.lines.length, lines: undefined })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireCapability('stock.read'), async (req, res, next) => {
  try {
    const row = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    if (!row) throw notFound('التسوية غير موجودة');
    const entry = await prisma.journalEntry.findFirst({
      where: { source: 'ADJUSTMENT', sourceId: row.id },
      select: { id: true, number: true },
    });
    res.json({ adjustment: serialize.adjustment(row, { journalEntry: entry }) });
  } catch (err) {
    next(err);
  }
});

async function readPayload(body) {
  const date = requireDate(body?.date, 'التاريخ');

  const counterAccountId = requireString(body?.counterAccountId, 'الحساب المقابل', { max: 40 });
  const counter = await prisma.account.findUnique({ where: { id: counterAccountId } });
  if (!counter) throw notFound('الحساب المقابل غير موجود');
  if (counter.isGroup) throw badRequest('الحساب المقابل لا يكون حساباً تجميعياً');
  if (counter.type === 'INCOME') throw badRequest('لا يصلح حساب إيراد كطرف مقابل لتسوية مخزون');

  return {
    date,
    counterAccountId,
    reason: optionalString(body?.reason, 'السبب', { max: 200 }),
    notes: optionalString(body?.notes, 'ملاحظات', { max: 1000 }),
    rawLines: requireArray(body?.lines, 'سطور التسوية'),
  };
}

router.post('/', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const payload = await readPayload(req.body);
    const shouldPost = req.body?.post === true;

    const id = await prisma.$transaction(async (tx) => {
      const lines = await readLines(tx, payload.rawLines);
      const adjustment = await tx.stockAdjustment.create({
        data: {
          number: optionalString(req.body?.number, 'الرقم', { max: 40 }) || (await nextAdjustmentNumber(tx, payload.date)),
          date: payload.date,
          counterAccountId: payload.counterAccountId,
          reason: payload.reason,
          notes: payload.notes,
          lines: { create: lines },
        },
      });
      if (shouldPost) await postAdjustment(tx, adjustment, req.user);
      return adjustment.id;
    });

    const row = await prisma.stockAdjustment.findUnique({ where: { id }, include: WITH_DETAILS });
    res.status(201).json({ adjustment: serialize.adjustment(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const current = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('التسوية غير موجودة');
    if (current.status !== 'DRAFT') throw badRequest('لا يمكن تعديل تسوية مُرحَّلة أو ملغاة');

    const payload = await readPayload(req.body);

    await prisma.$transaction(async (tx) => {
      const lines = await readLines(tx, payload.rawLines);
      await tx.stockAdjustmentLine.deleteMany({ where: { adjustmentId: current.id } });
      await tx.stockAdjustment.update({
        where: { id: current.id },
        data: {
          date: payload.date,
          counterAccountId: payload.counterAccountId,
          reason: payload.reason,
          notes: payload.notes,
          lines: { create: lines },
        },
      });
    });

    const row = await prisma.stockAdjustment.findUnique({ where: { id: current.id }, include: WITH_DETAILS });
    res.json({ adjustment: serialize.adjustment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/post', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id: req.params.id } });
      if (!adjustment) throw notFound('التسوية غير موجودة');
      await postAdjustment(tx, adjustment, req.user);
    });
    const row = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ adjustment: serialize.adjustment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unpost', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id: req.params.id } });
      if (!adjustment) throw notFound('التسوية غير موجودة');
      await unpostAdjustment(tx, adjustment);
    });
    const row = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ adjustment: serialize.adjustment(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id: req.params.id } });
      if (!adjustment) throw notFound('التسوية غير موجودة');
      if (adjustment.status === 'CANCELLED') throw badRequest('التسوية ملغاة مسبقاً');
      if (adjustment.status === 'POSTED') await unpostAdjustment(tx, adjustment);
      await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { status: 'CANCELLED' } });
    });
    const row = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id }, include: WITH_DETAILS });
    res.json({ adjustment: serialize.adjustment(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const current = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('التسوية غير موجودة');
    if (current.status === 'POSTED') throw badRequest('ألغِ ترحيل التسوية قبل حذفها');
    await prisma.stockAdjustment.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
