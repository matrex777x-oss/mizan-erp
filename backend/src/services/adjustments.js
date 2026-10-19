'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { toQuantity, toMinor, lineAmount } = require('../lib/money');
const { optionalString } = require('../lib/validate');
const { MOVE_DIRECTIONS, SYSTEM_ACCOUNTS } = require('../lib/constants');
const { createEntry, deleteEntriesFor } = require('./ledger');
const { recordIn, recordOut, removeMovesFor, resolveWarehouse, defaultWarehouse } = require('./stock');
const { systemAccount } = require('./invoices');

/** يقرأ سطور التسوية ويتحقق من الأصناف. */
async function readLines(tx, rawLines) {
  const itemIds = [...new Set(rawLines.map((l) => l.itemId))];
  const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
  const byId = new Map(items.map((i) => [i.id, i]));

  const fallback = await defaultWarehouse(tx);
  const lines = [];

  for (const [index, raw] of rawLines.entries()) {
    const position = index + 1;
    const item = byId.get(raw.itemId);
    if (!item) throw notFound(`صنف السطر ${position} غير موجود`);
    if (item.kind !== 'STOCK') throw badRequest(`السطر ${position}: «${item.name}» ليس صنفاً مخزنياً`);
    if (!item.active) throw badRequest(`السطر ${position}: الصنف «${item.name}» غير مفعّل`);

    const direction = raw.direction;
    if (!MOVE_DIRECTIONS.includes(direction)) throw badRequest(`السطر ${position}: اتجاه الحركة غير صالح`);

    const quantity = toQuantity(raw.quantity ?? 0);
    if (quantity <= 0n) throw badRequest(`السطر ${position}: الكمية يجب أن تكون أكبر من صفر`);

    const unitCost = direction === 'IN' ? toMinor(raw.unitCost ?? 0) : 0n;
    if (unitCost < 0n) throw badRequest(`السطر ${position}: التكلفة لا تكون سالبة`);

    const warehouseId = raw.warehouseId
      ? (await resolveWarehouse(tx, String(raw.warehouseId))).id
      : fallback.id;

    lines.push({
      itemId: item.id,
      warehouseId,
      direction,
      quantity,
      unitCost,
      memo: optionalString(raw.memo, `بيان السطر ${position}`, { max: 255 }),
      sortOrder: index,
    });
  }

  return lines;
}

/**
 * يرحّل التسوية: يحرّك المخزون ثم يقيّد الفرق مقابل الحساب المقابل المختار
 * (رأس المال للأرصدة الافتتاحية، أو حساب فروق الجرد للتالف والعجز).
 */
async function postAdjustment(tx, adjustment, actor) {
  if (adjustment.status === 'POSTED') throw badRequest('التسوية مُرحَّلة مسبقاً');
  if (adjustment.status === 'CANCELLED') throw badRequest('التسوية ملغاة');

  const full = await tx.stockAdjustment.findUnique({
    where: { id: adjustment.id },
    include: { lines: { include: { item: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!full.lines.length) throw badRequest('التسوية بلا سطور');

  const inventoryDefault = await systemAccount(tx, SYSTEM_ACCOUNTS.INVENTORY);
  const memo = `تسوية مخزون ${full.number}${full.reason ? ` — ${full.reason}` : ''}`;

  // صافي أثر التسوية على كل حساب مخزون
  const netByAccount = new Map();

  for (const line of full.lines) {
    const inventoryId = line.item.inventoryAccountId || inventoryDefault.id;

    if (line.direction === 'IN') {
      const totalCost = lineAmount(line.quantity, line.unitCost);
      await recordIn(tx, {
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        date: full.date,
        quantity: line.quantity,
        totalCost,
        sourceType: 'ADJUSTMENT',
        sourceId: full.id,
        memo: line.memo || memo,
      });
      netByAccount.set(inventoryId, (netByAccount.get(inventoryId) ?? 0n) + totalCost);
    } else {
      const move = await recordOut(tx, {
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        date: full.date,
        quantity: line.quantity,
        sourceType: 'ADJUSTMENT',
        sourceId: full.id,
        memo: line.memo || memo,
      });
      netByAccount.set(inventoryId, (netByAccount.get(inventoryId) ?? 0n) - move.totalCost);
    }
  }

  const lines = [];
  let counterNet = 0n;
  for (const [inventoryId, net] of netByAccount) {
    if (net === 0n) continue;
    lines.push(
      net > 0n
        ? { accountId: inventoryId, debit: net, memo }
        : { accountId: inventoryId, credit: -net, memo },
    );
    counterNet += net;
  }

  // تسوية بقيمة صفرية (إخراج ثم إدخال بنفس التكلفة) لا تحتاج قيداً
  if (lines.length && counterNet !== 0n) {
    lines.push(
      counterNet > 0n
        ? { accountId: full.counterAccountId, credit: counterNet, memo }
        : { accountId: full.counterAccountId, debit: -counterNet, memo },
    );
    await createEntry(tx, {
      date: full.date,
      memo,
      source: 'ADJUSTMENT',
      sourceId: full.id,
      actor,
      lines,
    });
  }

  return tx.stockAdjustment.update({ where: { id: full.id }, data: { status: 'POSTED' } });
}

async function unpostAdjustment(tx, adjustment) {
  if (adjustment.status !== 'POSTED') throw badRequest('التسوية ليست مُرحَّلة');
  await removeMovesFor(tx, 'ADJUSTMENT', adjustment.id);
  await deleteEntriesFor(tx, 'ADJUSTMENT', adjustment.id);
  return tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { status: 'DRAFT' } });
}

module.exports = { readLines, postAdjustment, unpostAdjustment };
