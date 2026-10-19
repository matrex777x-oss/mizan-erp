'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { requireInventory } = require('../lib/modules');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { requireString, optionalString, requireDate, requireArray } = require('../lib/validate');
const { toQuantity, fromQuantity } = require('../lib/money');
const serialize = require('../lib/serialize');
const { nextTransferNumber } = require('../services/numbering');
const { recordIn, recordOut, removeMovesFor, stockOf, averageCost, resolveWarehouse } = require('../services/stock');

const router = express.Router();

function publicWarehouse(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.isDefault,
    active: row.active,
    notes: row.notes,
    itemCount: row._count?.stocks ?? undefined,
  };
}

router.get('/', requireCapability('stock.read'), async (_req, res, next) => {
  try {
    const rows = await prisma.warehouse.findMany({
      include: { _count: { select: { stocks: true } } },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });

    // قيمة ما في كل مستودع، لتُعرض بجانبه
    const totals = await prisma.itemStock.groupBy({
      by: ['warehouseId'],
      _sum: { stockValue: true },
    });
    const valueById = new Map(totals.map((row) => [row.warehouseId, row._sum.stockValue ?? 0n]));

    res.json({
      warehouses: rows.map((row) => ({
        ...publicWarehouse(row),
        stockValue: serialize.money(valueById.get(row.id) ?? 0n),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'اسم المستودع', { max: 120 });
    const code = requireString(req.body?.code, 'رمز المستودع', { max: 20 }).toUpperCase();

    if (!/^[A-Z0-9-]+$/.test(code)) {
      throw badRequest('رمز المستودع: أحرف لاتينية وأرقام وشرطات فقط');
    }
    if (await prisma.warehouse.findUnique({ where: { code } })) {
      throw conflict('رمز المستودع مستخدم من قبل');
    }

    const isFirst = (await prisma.warehouse.count()) === 0;
    const row = await prisma.warehouse.create({
      data: {
        code,
        name,
        notes: optionalString(req.body?.notes, 'ملاحظات', { max: 500 }),
        isDefault: isFirst || Boolean(req.body?.isDefault),
      },
    });

    // مستودع افتراضي واحد لا غير
    if (row.isDefault) {
      await prisma.warehouse.updateMany({
        where: { id: { not: row.id } },
        data: { isDefault: false },
      });
    }

    res.status(201).json({ warehouse: publicWarehouse(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const current = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('المستودع غير موجود');

    const data = {};
    if (req.body?.name !== undefined) data.name = requireString(req.body.name, 'الاسم', { max: 120 });
    if (req.body?.notes !== undefined) data.notes = optionalString(req.body.notes, 'ملاحظات', { max: 500 });

    if (req.body?.active !== undefined) {
      const active = Boolean(req.body.active);
      if (!active) {
        // مستودع فيه بضاعة لا يُوقف: رصيده في الدفتر وشاشاته تختفي
        const held = await prisma.itemStock.findFirst({
          where: { warehouseId: current.id, onHand: { gt: 0n } },
        });
        if (held) throw badRequest('المستودع فيه بضاعة — حوّلها إلى مستودع آخر قبل إيقافه');
        if (current.isDefault) throw badRequest('لا يُوقف المستودع الافتراضي — عيّن غيره افتراضياً أولاً');
      }
      data.active = active;
    }

    if (req.body?.isDefault === true) {
      if (!current.active) throw badRequest('المستودع الموقوف لا يكون افتراضياً');
      data.isDefault = true;
    }

    const row = await prisma.warehouse.update({ where: { id: current.id }, data });

    if (row.isDefault) {
      await prisma.warehouse.updateMany({ where: { id: { not: row.id } }, data: { isDefault: false } });
    }

    res.json({ warehouse: publicWarehouse(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const current = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('المستودع غير موجود');
    if (current.isDefault) throw badRequest('لا يُحذف المستودع الافتراضي');

    const moves = await prisma.stockMove.count({ where: { warehouseId: current.id } });
    if (moves) throw badRequest(`للمستودع ${moves} حركة مخزون — أوقفه بدل حذفه`);

    await prisma.itemStock.deleteMany({ where: { warehouseId: current.id } });
    await prisma.warehouse.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** أرصدة الأصناف في مستودع واحد. */
router.get('/:id/stock', requireCapability('stock.read'), async (req, res, next) => {
  try {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!warehouse) throw notFound('المستودع غير موجود');

    const rows = await prisma.itemStock.findMany({
      where: { warehouseId: warehouse.id },
      include: { item: true },
      orderBy: { item: { code: 'asc' } },
    });

    res.json({
      warehouse: publicWarehouse(warehouse),
      rows: rows
        .filter((row) => row.onHand !== 0n || row.stockValue !== 0n)
        .map((row) => ({
          itemId: row.itemId,
          code: row.item.code,
          name: row.item.name,
          unit: row.item.unit,
          onHand: fromQuantity(row.onHand),
          averageCost: serialize.money(averageCost(row)),
          value: serialize.money(row.stockValue),
        })),
      total: serialize.money(rows.reduce((sum, row) => sum + row.stockValue, 0n)),
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── التحويل بين المستودعات ─────────────────────────

const TRANSFER_DETAILS = {
  fromWarehouse: true,
  toWarehouse: true,
  lines: { include: { item: true }, orderBy: { sortOrder: 'asc' } },
};

function publicTransfer(row) {
  return {
    id: row.id,
    number: row.number,
    date: serialize.day(row.date),
    status: row.status,
    notes: row.notes,
    from: row.fromWarehouse ? { id: row.fromWarehouse.id, name: row.fromWarehouse.name } : null,
    to: row.toWarehouse ? { id: row.toWarehouse.id, name: row.toWarehouse.name } : null,
    createdByName: row.createdByName,
    lines: (row.lines || []).map((line) => ({
      id: line.id,
      itemId: line.itemId,
      code: line.item?.code,
      name: line.item?.name,
      unit: line.item?.unit,
      quantity: fromQuantity(line.quantity),
      memo: line.memo,
    })),
  };
}

/**
 * يرحّل التحويل: يُخرج البضاعة من مستودع بالمتوسط المرجّح فيه، ويُدخلها الآخر
 * **بالتكلفة نفسها**. لا قيد محاسبي: حساب المخزون واحد، فالقيد يكون من المخزون
 * إلى المخزون ولا أثر له في الدفتر.
 */
async function postTransfer(tx, transfer, actor) {
  if (transfer.status === 'POSTED') throw badRequest('التحويل مُرحَّل مسبقاً');
  if (transfer.status === 'CANCELLED') throw badRequest('التحويل ملغى');
  if (!transfer.lines.length) throw badRequest('لا سطور في التحويل');

  for (const line of transfer.lines) {
    const out = await recordOut(tx, {
      itemId: line.itemId,
      warehouseId: transfer.fromWarehouseId,
      date: transfer.date,
      quantity: line.quantity,
      sourceType: 'TRANSFER',
      sourceId: transfer.id,
      memo: `تحويل ${transfer.number}`,
    });

    await recordIn(tx, {
      itemId: line.itemId,
      warehouseId: transfer.toWarehouseId,
      date: transfer.date,
      quantity: line.quantity,
      totalCost: out.totalCost,
      sourceType: 'TRANSFER',
      sourceId: transfer.id,
      memo: `تحويل ${transfer.number}`,
    });
  }

  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: {
      status: 'POSTED',
      createdById: actor ? actor.id : null,
      createdByName: actor ? actor.name : null,
    },
  });
}

router.get('/transfers/list', requireCapability('stock.read'), async (req, res, next) => {
  try {
    const rows = await prisma.stockTransfer.findMany({
      include: TRANSFER_DETAILS,
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: Math.min(Number(req.query.limit) || 100, 200),
    });
    res.json({ transfers: rows.map(publicTransfer) });
  } catch (err) {
    next(err);
  }
});

router.post('/transfers', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const date = requireDate(req.body?.date, 'التاريخ');
    const rawLines = requireArray(req.body?.lines, 'سطور التحويل');

    const from = await resolveWarehouse(prisma, requireString(req.body?.fromWarehouseId, 'المستودع المصدر'));
    const to = await resolveWarehouse(prisma, requireString(req.body?.toWarehouseId, 'المستودع الوجهة'));
    if (from.id === to.id) throw badRequest('المستودع المصدر والوجهة واحد');

    const shouldPost = req.body?.post === true;

    const created = await prisma.$transaction(async (tx) => {
      const items = await tx.item.findMany({
        where: { id: { in: [...new Set(rawLines.map((l) => l.itemId))] } },
      });
      const byId = new Map(items.map((item) => [item.id, item]));

      const lines = rawLines.map((raw, index) => {
        const position = index + 1;
        const item = byId.get(raw.itemId);
        if (!item) throw notFound(`صنف السطر ${position} غير موجود`);
        if (item.kind !== 'STOCK') throw badRequest(`السطر ${position}: «${item.name}» ليس صنفاً مخزنياً`);

        const quantity = toQuantity(raw.quantity ?? 0);
        if (quantity <= 0n) throw badRequest(`السطر ${position}: الكمية يجب أن تكون أكبر من صفر`);

        return {
          itemId: item.id,
          quantity,
          memo: optionalString(raw.memo, `بيان السطر ${position}`, { max: 255 }),
          sortOrder: index,
        };
      });

      const transfer = await tx.stockTransfer.create({
        data: {
          number:
            optionalString(req.body?.number, 'الرقم', { max: 40 }) ||
            (await nextTransferNumber(tx, date)),
          date,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          notes: optionalString(req.body?.notes, 'ملاحظات', { max: 1000 }),
          lines: { create: lines },
        },
        include: TRANSFER_DETAILS,
      });

      if (shouldPost) await postTransfer(tx, transfer, req.user);
      return transfer.id;
    });

    const row = await prisma.stockTransfer.findUnique({ where: { id: created }, include: TRANSFER_DETAILS });
    res.status(201).json({ transfer: publicTransfer(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/transfers/:id/post', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: req.params.id },
        include: TRANSFER_DETAILS,
      });
      if (!transfer) throw notFound('التحويل غير موجود');
      await postTransfer(tx, transfer, req.user);
    });

    const row = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_DETAILS,
    });
    res.json({ transfer: publicTransfer(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/transfers/:id/unpost', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id: req.params.id } });
      if (!transfer) throw notFound('التحويل غير موجود');
      if (transfer.status !== 'POSTED') throw badRequest('التحويل غير مُرحَّل');

      await removeMovesFor(tx, 'TRANSFER', transfer.id);
      await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: 'DRAFT' } });
    });

    const row = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_DETAILS,
    });
    res.json({ transfer: publicTransfer(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/transfers/:id', requireCapability('stock.write'), requireInventory, async (req, res, next) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) throw notFound('التحويل غير موجود');
    if (transfer.status === 'POSTED') throw badRequest('ألغِ ترحيل التحويل قبل حذفه');

    await prisma.stockTransfer.delete({ where: { id: transfer.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
