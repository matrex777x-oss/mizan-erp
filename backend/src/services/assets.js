'use strict';

const { createEntry } = require('./ledger');
const { divRound } = require('../lib/money');
const { badRequest, notFound } = require('../lib/errors');

/**
 * الأصول الثابتة وإهلاكها.
 *
 * الإهلاك شهري: كل دفعة قيد واحد يحمل كل الأصول المُهلَكة في الفترة
 * (من مصروف الإهلاك / إلى مجمّع الإهلاك)، وصفّ لكل أصل يربطه بالقيد.
 *
 * حسابات كل أصل في بطاقته لا في مفاتيح نظامية، فتعمل الوحدة على شجرة حسابات
 * أي منشأة قائمة دون إضافة حسابات جديدة إليها.
 */

const METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE'];

/** آخر يوم في شهر التاريخ، مثبَّتاً على منتصف النهار UTC. */
function endOfMonth(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 0, 12));
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

/** عدد الأشهر التقويمية الكاملة بين شهرين، شاملاً الطرفين. */
function monthsBetween(from, to) {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  return years * 12 + months + 1;
}

/** مجموع ما أُهلك للأصل حتى الآن. */
function accumulatedOf(asset) {
  return (asset.depreciations || []).reduce((sum, row) => sum + row.amount, 0n);
}

function bookValueOf(asset) {
  return asset.cost - accumulatedOf(asset);
}

/** أقصى ما يجوز إهلاكه: التكلفة ناقص القيمة التخريدية. */
function depreciableBase(asset) {
  const base = asset.cost - asset.salvageValue;
  return base > 0n ? base : 0n;
}

/**
 * قسط شهر واحد.
 * القسط الثابت: الأساس على عدد الأشهر. المتناقص: نسبة سنوية على الرصيد الدفتري.
 */
function monthlyAmount(asset) {
  if (asset.method === 'DECLINING_BALANCE') {
    const rate = BigInt(asset.decliningRate || 0); // عُشر من المئة
    if (rate <= 0n) return 0n;
    const bookValue = bookValueOf(asset);
    // الرصيد × النسبة السنوية ÷ 12
    return divRound(bookValue * rate, 10000n * 12n);
  }

  const months = BigInt(asset.usefulLifeMonths || 0);
  if (months <= 0n) return 0n;
  return divRound(depreciableBase(asset), months);
}

/**
 * يحسب ما يُهلَك لهذا الأصل حتى نهاية الفترة المطلوبة.
 * يعيد null إن لم يكن هناك ما يُهلَك.
 */
function dueFor(asset, periodEnd) {
  if (asset.status !== 'ACTIVE') return null;

  const base = depreciableBase(asset);
  if (base <= 0n) return null;

  const accumulated = accumulatedOf(asset);
  const remaining = base - accumulated;
  if (remaining <= 0n) return null;

  // آخر فترة مُهلَكة، أو شهر الاقتناء إن لم يُهلَك بعد
  const last = (asset.depreciations || [])
    .map((row) => row.periodEnd)
    .sort((a, b) => b - a)[0];

  const firstMonth = last
    ? startOfMonth(new Date(last.getTime() + 24 * 60 * 60 * 1000))
    : startOfMonth(asset.acquiredAt);

  const target = endOfMonth(periodEnd);
  if (target < firstMonth) return null;

  const months = monthsBetween(firstMonth, target);
  if (months <= 0) return null;

  let amount = 0n;

  if (asset.method === 'DECLINING_BALANCE') {
    // المتناقص يتغيّر بتغيّر الرصيد، فنحسبه شهراً شهراً
    let accumulatedNow = accumulated;
    for (let i = 0; i < months; i += 1) {
      const bookValue = asset.cost - accumulatedNow;
      const rate = BigInt(asset.decliningRate || 0);
      let step = rate > 0n ? divRound(bookValue * rate, 10000n * 12n) : 0n;
      if (accumulatedNow + step > base) step = base - accumulatedNow;
      if (step <= 0n) break;
      accumulatedNow += step;
      amount += step;
    }
  } else {
    amount = monthlyAmount(asset) * BigInt(months);
  }

  // القسط الأخير يُقصّ حتى لا يتجاوز المجمّع الأساس القابل للإهلاك
  if (amount > remaining) amount = remaining;
  if (amount <= 0n) return null;

  return { amount, months, periodEnd: target, bookValueAfter: asset.cost - accumulated - amount };
}

const WITH_DEPRECIATIONS = { depreciations: true };

/**
 * يرحّل إهلاك الفترة لكل الأصول المستحقّة في قيد واحد.
 * يُستدعى داخل معاملة.
 */
async function runDepreciation(tx, { periodEnd, actor = null, assetIds = null }) {
  const assets = await tx.fixedAsset.findMany({
    where: {
      status: 'ACTIVE',
      acquiredAt: { lte: endOfMonth(periodEnd) },
      ...(assetIds ? { id: { in: assetIds } } : {}),
    },
    include: WITH_DEPRECIATIONS,
    orderBy: { code: 'asc' },
  });

  const due = [];
  for (const asset of assets) {
    const amount = dueFor(asset, periodEnd);
    if (amount) due.push({ asset, ...amount });
  }

  if (!due.length) throw badRequest('لا يوجد أصل مستحقّ للإهلاك في هذه الفترة');

  const target = endOfMonth(periodEnd);
  const lines = [];
  for (const row of due) {
    lines.push({
      accountId: row.asset.expenseAccountId,
      debit: row.amount,
      memo: `إهلاك ${row.asset.code} — ${row.asset.name}`,
    });
    lines.push({
      accountId: row.asset.accumulatedAccountId,
      credit: row.amount,
      memo: `إهلاك ${row.asset.code} — ${row.asset.name}`,
    });
  }

  const entry = await createEntry(tx, {
    date: target,
    memo: `إهلاك الفترة المنتهية في ${target.toISOString().slice(0, 10)}`,
    source: 'ADJUSTMENT',
    actor,
    lines,
  });

  for (const row of due) {
    await tx.depreciation.create({
      data: {
        assetId: row.asset.id,
        periodEnd: target,
        months: row.months,
        amount: row.amount,
        bookValueAfter: row.bookValueAfter,
        entryId: entry.id,
      },
    });
  }

  return {
    entry,
    periodEnd: target,
    total: due.reduce((sum, row) => sum + row.amount, 0n),
    assets: due.map((row) => ({
      id: row.asset.id,
      code: row.asset.code,
      name: row.asset.name,
      amount: row.amount,
      months: row.months,
      bookValueAfter: row.bookValueAfter,
    })),
  };
}

/**
 * استبعاد أصل: يُخرج تكلفته ومجمّع إهلاكه من الدفتر، ويقيّد الفرق ربحاً أو خسارة.
 * يُستدعى داخل معاملة.
 */
async function disposeAsset(tx, { assetId, date, proceeds = 0n, cashAccountId = null, gainLossAccountId, actor = null }) {
  const asset = await tx.fixedAsset.findUnique({ where: { id: assetId }, include: WITH_DEPRECIATIONS });
  if (!asset) throw notFound('الأصل غير موجود');
  if (asset.status === 'DISPOSED') throw badRequest('الأصل مستبعَد مسبقاً');
  if (date < asset.acquiredAt) throw badRequest('تاريخ الاستبعاد قبل تاريخ الاقتناء');

  if (proceeds > 0n && !cashAccountId) {
    throw badRequest('حدّد الحساب النقدي الذي دخلت فيه حصيلة البيع');
  }

  const accumulated = accumulatedOf(asset);
  const bookValue = asset.cost - accumulated;
  const result = proceeds - bookValue; // موجب ربح وسالب خسارة

  const lines = [];

  // إخراج مجمّع الإهلاك (رصيده دائن، فنُقفله بالمدين)
  if (accumulated > 0n) {
    lines.push({ accountId: asset.accumulatedAccountId, debit: accumulated, memo: 'إقفال مجمّع الإهلاك' });
  }
  // حصيلة البيع
  if (proceeds > 0n) {
    lines.push({ accountId: cashAccountId, debit: proceeds, memo: 'حصيلة بيع أصل' });
  }
  // إخراج تكلفة الأصل
  lines.push({ accountId: asset.assetAccountId, credit: asset.cost, memo: `استبعاد ${asset.code}` });

  if (result !== 0n) {
    lines.push(
      result > 0n
        ? { accountId: gainLossAccountId, credit: result, memo: 'ربح استبعاد أصل' }
        : { accountId: gainLossAccountId, debit: -result, memo: 'خسارة استبعاد أصل' },
    );
  }

  const entry = await createEntry(tx, {
    date,
    memo: `استبعاد الأصل ${asset.code} — ${asset.name}`,
    source: 'ADJUSTMENT',
    actor,
    lines,
  });

  await tx.fixedAsset.update({
    where: { id: asset.id },
    data: { status: 'DISPOSED', disposedAt: date, disposalProceeds: proceeds },
  });

  return { entry, bookValue, result, accumulated };
}

module.exports = {
  METHODS,

  endOfMonth,
  startOfMonth,
  monthsBetween,
  accumulatedOf,
  bookValueOf,
  depreciableBase,
  monthlyAmount,
  dueFor,
  runDepreciation,
  disposeAsset,
  WITH_DEPRECIATIONS,
};
