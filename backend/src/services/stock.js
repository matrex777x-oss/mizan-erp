'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { divRound, fromQuantity, QTY_SCALE } = require('../lib/money');

/**
 * تقييم المخزون بالمتوسط المرجّح المتحرك — لكل مستودع على حدة.
 *
 * تكلفة كل إخراج تُحسب لحظة الترحيل من متوسط تكلفة الصنف **في مستودعه**،
 * وتُثبَّت في القيد المحاسبي. فالبضاعة نفسها المشتراة بتكلفتين في مكانين لا
 * يختلط متوسطها، وتخرج كل كمية بتكلفة مكانها.
 *
 * ولأن المتوسط يعتمد على الترتيب، لا يُسمح بترحيل حركة بتاريخ أسبق من آخر حركة
 * للصنف في ذلك المستودع، ولا بإلغاء ترحيل حركة تلتها حركات أخرى فيه — وإلا
 * لأصبحت التكاليف المسجَّلة في الدفتر مخالفة للواقع.
 *
 * رصيد الصنف في بطاقته (`Item.onHand/stockValue`) هو مجموع مستودعاته، ويبقى
 * محدَّثاً مع كل حركة ليُقرأ في التقارير دون جمع عبر الجداول.
 */

/** آخر حركة مسجَّلة للصنف في مستودع، حسب الترتيب الزمني ثم ترتيب الإدخال. */
function lastMove(tx, itemId, warehouseId) {
  return tx.stockMove.findFirst({
    where: { itemId, ...(warehouseId ? { warehouseId } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

/** يمنع إدراج حركة في وسط تاريخ الصنف داخل مستودعه. */
async function assertChronological(tx, item, date, warehouseId) {
  const last = await lastMove(tx, item.id, warehouseId);
  if (last && date < last.date) {
    throw badRequest(
      `الصنف «${item.name}»: لا يمكن الترحيل بتاريخ ${date.toISOString().slice(0, 10)} ` +
        `لأن له حركة مخزون أحدث بتاريخ ${last.date.toISOString().slice(0, 10)} في المستودع نفسه`,
    );
  }
}

async function loadItem(tx, itemId) {
  const item = await tx.item.findUnique({ where: { id: itemId } });
  if (!item) throw notFound('الصنف غير موجود');
  return item;
}

/** المستودع الافتراضي — تُنسب إليه الحركات التي لا تحدّد مستودعاً. */
async function defaultWarehouse(tx) {
  const preferred = await tx.warehouse.findFirst({ where: { isDefault: true, active: true } });
  if (preferred) return preferred;

  const any = await tx.warehouse.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  if (!any) throw badRequest('لا يوجد مستودع — أنشئ مستودعاً واحداً على الأقل');
  return any;
}

async function resolveWarehouse(tx, warehouseId) {
  if (!warehouseId) return defaultWarehouse(tx);

  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw notFound('المستودع غير موجود');
  if (!warehouse.active) throw badRequest(`المستودع «${warehouse.name}» موقوف`);
  return warehouse;
}

/** رصيد الصنف في مستودع، صفراً إن لم تكن له حركة فيه بعد. */
async function stockOf(tx, itemId, warehouseId) {
  const row = await tx.itemStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });
  return { onHand: row?.onHand ?? 0n, stockValue: row?.stockValue ?? 0n };
}

async function writeStock(tx, itemId, warehouseId, { onHand, stockValue }) {
  await tx.itemStock.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    update: { onHand, stockValue },
    create: { itemId, warehouseId, onHand, stockValue },
  });
}

/** يعيد حساب رصيد البطاقة من مجموع مستودعاتها. */
async function refreshItemTotals(tx, itemId) {
  const totals = await tx.itemStock.aggregate({
    where: { itemId },
    _sum: { onHand: true, stockValue: true },
  });

  await tx.item.update({
    where: { id: itemId },
    data: {
      onHand: totals._sum.onHand ?? 0n,
      stockValue: totals._sum.stockValue ?? 0n,
    },
  });
}

/** يسجّل وارداً بتكلفة معلومة ويحدّث رصيد الصنف في مستودعه. */
async function recordIn(tx, { itemId, warehouseId, date, quantity, totalCost, sourceType, sourceId, memo }) {
  const item = await loadItem(tx, itemId);
  if (item.kind !== 'STOCK') throw badRequest(`«${item.name}» ليس صنفاً مخزنياً`);
  if (quantity <= 0n) throw badRequest(`الصنف «${item.name}»: الكمية يجب أن تكون أكبر من صفر`);
  if (totalCost < 0n) throw badRequest(`الصنف «${item.name}»: التكلفة لا تكون سالبة`);

  const warehouse = await resolveWarehouse(tx, warehouseId);
  await assertChronological(tx, item, date, warehouse.id);

  const current = await stockOf(tx, itemId, warehouse.id);
  const balanceQty = current.onHand + quantity;
  const balanceValue = current.stockValue + totalCost;

  const move = await tx.stockMove.create({
    data: {
      itemId,
      warehouseId: warehouse.id,
      date,
      kind: 'IN',
      quantity,
      unitCost: divRound(totalCost * QTY_SCALE, quantity),
      totalCost,
      balanceQty,
      balanceValue,
      sourceType,
      sourceId,
      memo,
    },
  });

  await writeStock(tx, itemId, warehouse.id, { onHand: balanceQty, stockValue: balanceValue });
  await refreshItemTotals(tx, itemId);
  return move;
}

/** يسجّل منصرفاً بالمتوسط المرجّح الجاري في مستودعه ويعيد تكلفته. */
async function recordOut(tx, { itemId, warehouseId, date, quantity, sourceType, sourceId, memo }) {
  const item = await loadItem(tx, itemId);
  if (item.kind !== 'STOCK') throw badRequest(`«${item.name}» ليس صنفاً مخزنياً`);
  if (quantity <= 0n) throw badRequest(`الصنف «${item.name}»: الكمية يجب أن تكون أكبر من صفر`);

  const warehouse = await resolveWarehouse(tx, warehouseId);
  await assertChronological(tx, item, date, warehouse.id);

  const current = await stockOf(tx, itemId, warehouse.id);

  if (quantity > current.onHand) {
    throw badRequest(
      `الصنف «${item.name}»: الكمية المطلوبة ${fromQuantity(quantity)} ` +
        `تتجاوز الرصيد المتاح ${fromQuantity(current.onHand)} في المستودع «${warehouse.name}»`,
    );
  }

  // سحب الكمية كاملةً يصفّر القيمة تماماً فلا تتبقى كسور عالقة
  const totalCost =
    quantity === current.onHand
      ? current.stockValue
      : divRound(current.stockValue * quantity, current.onHand);

  const balanceQty = current.onHand - quantity;
  const balanceValue = current.stockValue - totalCost;

  const move = await tx.stockMove.create({
    data: {
      itemId,
      warehouseId: warehouse.id,
      date,
      kind: 'OUT',
      quantity,
      unitCost: divRound(totalCost * QTY_SCALE, quantity),
      totalCost,
      balanceQty,
      balanceValue,
      sourceType,
      sourceId,
      memo,
    },
  });

  await writeStock(tx, itemId, warehouse.id, { onHand: balanceQty, stockValue: balanceValue });
  await refreshItemTotals(tx, itemId);
  return move;
}

/**
 * يحذف حركات مستند عند إلغاء ترحيله.
 * مسموح فقط إن كانت حركاته هي الأخيرة لكل صنف **في مستودعه**، وإلا فالتكاليف
 * اللاحقة مبنية عليها.
 */
async function removeMovesFor(tx, sourceType, sourceId) {
  const moves = await tx.stockMove.findMany({
    where: { sourceType, sourceId },
    include: { item: { select: { id: true, name: true } }, warehouse: { select: { name: true } } },
  });
  if (!moves.length) return 0;

  const ours = new Set(moves.map((m) => m.id));
  const pairs = [...new Map(moves.map((m) => [`${m.itemId}:${m.warehouseId}`, m])).values()];

  for (const move of pairs) {
    const last = await lastMove(tx, move.itemId, move.warehouseId);
    if (last && !ours.has(last.id)) {
      throw badRequest(
        `الصنف «${move.item.name}» له حركات مخزون أحدث من هذا المستند في المستودع ` +
          `«${move.warehouse?.name ?? '—'}» — ألغِ ترحيلها أولاً حتى تبقى تكاليف المخزون صحيحة`,
      );
    }
  }

  await tx.stockMove.deleteMany({ where: { id: { in: moves.map((m) => m.id) } } });

  // الرصيد يعود إلى ما كان عليه قبل أول حركة محذوفة: رصيد آخر حركة متبقية
  for (const move of pairs) {
    const remaining = await lastMove(tx, move.itemId, move.warehouseId);
    await writeStock(tx, move.itemId, move.warehouseId, {
      onHand: remaining?.balanceQty ?? 0n,
      stockValue: remaining?.balanceValue ?? 0n,
    });
  }

  for (const itemId of [...new Set(moves.map((m) => m.itemId))]) {
    await refreshItemTotals(tx, itemId);
  }

  return moves.length;
}

/** متوسط تكلفة الوحدة (بالوحدة الصغرى لكل وحدة واحدة) من رصيد وقيمة. */
function averageCost(stock) {
  if (!stock?.onHand) return 0n;
  return divRound(stock.stockValue * QTY_SCALE, stock.onHand);
}

module.exports = {
  recordIn,
  recordOut,
  removeMovesFor,
  averageCost,
  assertChronological,
  lastMove,
  defaultWarehouse,
  resolveWarehouse,
  stockOf,
  refreshItemTotals,
};
