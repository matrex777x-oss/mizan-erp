'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { divRound, fromQuantity, QTY_SCALE } = require('../lib/money');

/**
 * تقييم المخزون بالمتوسط المرجّح المتحرك.
 *
 * تكلفة كل إخراج تُحسب لحظة الترحيل من متوسط التكلفة الجاري، وتُثبَّت في القيد
 * المحاسبي. ولأن المتوسط يعتمد على الترتيب، لا يُسمح بترحيل حركة بتاريخ أسبق من
 * آخر حركة للصنف، ولا بإلغاء ترحيل حركة تلتها حركات أخرى — وإلا لأصبحت التكاليف
 * المسجَّلة في الدفتر مخالفة للواقع.
 */

/** آخر حركة مسجَّلة للصنف حسب الترتيب الزمني ثم ترتيب الإدخال. */
function lastMove(tx, itemId) {
  return tx.stockMove.findFirst({
    where: { itemId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

/** يمنع إدراج حركة في وسط تاريخ الصنف. */
async function assertChronological(tx, item, date) {
  const last = await lastMove(tx, item.id);
  if (last && date < last.date) {
    throw badRequest(
      `الصنف «${item.name}»: لا يمكن الترحيل بتاريخ ${date.toISOString().slice(0, 10)} ` +
        `لأن له حركة مخزون أحدث بتاريخ ${last.date.toISOString().slice(0, 10)}`,
    );
  }
}

async function loadItem(tx, itemId) {
  const item = await tx.item.findUnique({ where: { id: itemId } });
  if (!item) throw notFound('الصنف غير موجود');
  return item;
}

/** يسجّل وارداً بتكلفة معلومة ويحدّث رصيد الصنف. */
async function recordIn(tx, { itemId, date, quantity, totalCost, sourceType, sourceId, memo }) {
  const item = await loadItem(tx, itemId);
  if (item.kind !== 'STOCK') throw badRequest(`«${item.name}» ليس صنفاً مخزنياً`);
  if (quantity <= 0n) throw badRequest(`الصنف «${item.name}»: الكمية يجب أن تكون أكبر من صفر`);
  if (totalCost < 0n) throw badRequest(`الصنف «${item.name}»: التكلفة لا تكون سالبة`);

  await assertChronological(tx, item, date);

  const balanceQty = item.onHand + quantity;
  const balanceValue = item.stockValue + totalCost;

  const move = await tx.stockMove.create({
    data: {
      itemId,
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

  await tx.item.update({ where: { id: itemId }, data: { onHand: balanceQty, stockValue: balanceValue } });
  return move;
}

/**
 * يسجّل منصرفاً بالمتوسط المرجّح الجاري ويعيد تكلفته.
 * unitCost اختياري: تستخدمه التسويات التي تحدّد تكلفة الإخراج صراحةً.
 */
async function recordOut(tx, { itemId, date, quantity, sourceType, sourceId, memo }) {
  const item = await loadItem(tx, itemId);
  if (item.kind !== 'STOCK') throw badRequest(`«${item.name}» ليس صنفاً مخزنياً`);
  if (quantity <= 0n) throw badRequest(`الصنف «${item.name}»: الكمية يجب أن تكون أكبر من صفر`);

  await assertChronological(tx, item, date);

  if (quantity > item.onHand) {
    throw badRequest(
      `الصنف «${item.name}»: الكمية المطلوبة ${fromQuantity(quantity)} ` +
        `تتجاوز الرصيد المتاح ${fromQuantity(item.onHand)}`,
    );
  }

  // سحب الكمية كاملةً يصفّر القيمة تماماً فلا تتبقى كسور عالقة
  const totalCost =
    quantity === item.onHand ? item.stockValue : divRound(item.stockValue * quantity, item.onHand);

  const balanceQty = item.onHand - quantity;
  const balanceValue = item.stockValue - totalCost;

  const move = await tx.stockMove.create({
    data: {
      itemId,
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

  await tx.item.update({ where: { id: itemId }, data: { onHand: balanceQty, stockValue: balanceValue } });
  return move;
}

/**
 * يحذف حركات مستند عند إلغاء ترحيله.
 * مسموح فقط إن كانت حركاته هي الأخيرة لكل صنف، وإلا فالتكاليف اللاحقة مبنية عليها.
 */
async function removeMovesFor(tx, sourceType, sourceId) {
  const moves = await tx.stockMove.findMany({
    where: { sourceType, sourceId },
    include: { item: { select: { id: true, name: true } } },
  });
  if (!moves.length) return 0;

  const affected = [...new Set(moves.map((m) => m.itemId))];
  const ours = new Set(moves.map((m) => m.id));

  for (const itemId of affected) {
    const last = await lastMove(tx, itemId);
    if (last && !ours.has(last.id)) {
      const name = moves.find((m) => m.itemId === itemId).item.name;
      throw badRequest(
        `الصنف «${name}» له حركات مخزون أحدث من هذا المستند — ألغِ ترحيلها أولاً ` +
          'حتى تبقى تكاليف المخزون صحيحة',
      );
    }
  }

  await tx.stockMove.deleteMany({ where: { id: { in: moves.map((m) => m.id) } } });

  // الرصيد يعود إلى ما كان عليه قبل أول حركة محذوفة: رصيد آخر حركة متبقية
  for (const itemId of affected) {
    const remaining = await lastMove(tx, itemId);
    await tx.item.update({
      where: { id: itemId },
      data: {
        onHand: remaining?.balanceQty ?? 0n,
        stockValue: remaining?.balanceValue ?? 0n,
      },
    });
  }

  return moves.length;
}

/** متوسط تكلفة الوحدة الحالي للصنف (بالوحدة الصغرى لكل وحدة واحدة). */
function averageCost(item) {
  if (!item.onHand) return 0n;
  return divRound(item.stockValue * QTY_SCALE, item.onHand);
}

module.exports = { recordIn, recordOut, removeMovesFor, averageCost, assertChronological, lastMove };
