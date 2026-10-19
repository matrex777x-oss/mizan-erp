'use strict';

const { createEntry } = require('./ledger');
const { NATURAL_SIDE, SYSTEM_ACCOUNTS } = require('../lib/constants');
const { badRequest, notFound } = require('../lib/errors');

/**
 * الإقفال السنوي.
 *
 * يصفّر الإيرادات والمصروفات بقيد مؤرَّخ بآخر يوم في السنة المالية، ويرحّل
 * صافي النتيجة إلى الأرباح المحتجزة. بعده تبدأ السنة التالية من صفر، وتظهر
 * نتيجة ما مضى في حقوق الملكية لا في «نتيجة الفترة».
 *
 * الإقفال يرفع تاريخ إقفال الفترة إلى آخر يوم في السنة المقفلة، فلا يدخل أحد
 * قيداً في سنة أُقفلت — وإعادة الفتح تعيده إلى ما كان.
 */

/** التواريخ كلها مثبَّتة على منتصف النهار UTC كما في lib/validate. */
function utcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** حدود السنة المالية التي يقع فيها هذا التاريخ. */
function fiscalYearOf(date, startMonth) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  // بدء السنة المالية في شهر متأخر يعني أن يناير ينتمي إلى سنة سابقة
  const startYear = month >= startMonth ? year : year - 1;

  const start = utcDay(startYear, startMonth, 1);
  const endExclusive = utcDay(startYear + 1, startMonth, 1);
  const end = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);

  return { start, end };
}

function nextFiscalYear(bounds, startMonth) {
  const after = new Date(bounds.end.getTime() + 24 * 60 * 60 * 1000);
  return fiscalYearOf(after, startMonth);
}

/** اسم السنة المالية كما يُعرض: 2026 أو 2026/2027 حين لا تبدأ في يناير. */
function fiscalYearLabel(bounds) {
  const from = bounds.start.getUTCFullYear();
  const to = bounds.end.getUTCFullYear();
  return from === to ? String(from) : `${from}/${to}`;
}

async function settingsOf(tx) {
  const settings = await tx.settings.findUnique({ where: { id: 1 } });
  return { fiscalYearStart: settings?.fiscalYearStart || 1, lockDate: settings?.lockDate || null };
}

/** أرصدة حسابات النتيجة في فترة: الإيرادات والمصروفات غير التجميعية. */
async function resultBalances(tx, { start, end }) {
  const accounts = await tx.account.findMany({
    where: { isGroup: false, type: { in: ['INCOME', 'EXPENSE'] } },
    orderBy: { code: 'asc' },
  });
  if (!accounts.length) return { lines: [], income: 0n, expense: 0n };

  const grouped = await tx.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      entry: { date: { gte: start, lte: end } },
    },
    _sum: { debit: true, credit: true },
  });
  const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));

  let income = 0n;
  let expense = 0n;
  const lines = [];

  for (const account of accounts) {
    const sum = sums.get(account.id);
    const debit = sum?.debit ?? 0n;
    const credit = sum?.credit ?? 0n;

    // الرصيد بالجانب الطبيعي للحساب: الإيراد دائن والمصروف مدين
    const balance = (debit - credit) * BigInt(NATURAL_SIDE[account.type]);
    if (balance === 0n) continue;

    if (account.type === 'INCOME') income += balance;
    else expense += balance;

    // نصفّره بقيد معاكس لرصيده
    lines.push(
      balance > 0n
        ? { accountId: account.id, [account.type === 'INCOME' ? 'debit' : 'credit']: balance }
        : { accountId: account.id, [account.type === 'INCOME' ? 'credit' : 'debit']: -balance },
    );
  }

  return { lines, income, expense };
}

/** السنوات المالية التي فيها حركة ولم تُقفل بعد، بالترتيب. */
async function closableYears(tx) {
  const { fiscalYearStart } = await settingsOf(tx);

  const first = await tx.journalEntry.findFirst({ orderBy: { date: 'asc' }, select: { date: true } });
  if (!first) return [];

  const lastClose = await tx.fiscalClose.findFirst({ orderBy: { endDate: 'desc' } });

  // نبدأ من السنة التالية لآخر إقفال، أو من سنة أول قيد
  let bounds = lastClose
    ? nextFiscalYear(fiscalYearOf(lastClose.endDate, fiscalYearStart), fiscalYearStart)
    : fiscalYearOf(first.date, fiscalYearStart);

  const today = new Date();
  const years = [];

  // السنة الجارية لا تُقفل قبل أن تنتهي
  while (bounds.end < today && years.length < 50) {
    const { income, expense } = await resultBalances(tx, bounds);
    years.push({
      label: fiscalYearLabel(bounds),
      start: bounds.start,
      end: bounds.end,
      income,
      expense,
      netResult: income - expense,
    });
    bounds = nextFiscalYear(bounds, fiscalYearStart);
  }

  return years;
}

/**
 * يقفل السنة المالية المنتهية في `end`.
 * يُستدعى داخل معاملة.
 */
async function closeFiscalYear(tx, { end, actor = null }) {
  const { fiscalYearStart, lockDate } = await settingsOf(tx);
  const bounds = fiscalYearOf(end, fiscalYearStart);

  if (bounds.end.getTime() !== end.getTime()) {
    throw badRequest(
      `${end.toISOString().slice(0, 10)} ليس آخر يوم في سنة مالية. ` +
        `آخر يوم في سنتها هو ${bounds.end.toISOString().slice(0, 10)}`,
    );
  }
  if (bounds.end >= new Date()) throw badRequest('لا تُقفل سنة مالية لم تنتهِ بعد');

  const existing = await tx.fiscalClose.findUnique({ where: { endDate: bounds.end } });
  if (existing) throw badRequest(`السنة المالية ${fiscalYearLabel(bounds)} مقفلة مسبقاً`);

  // الترتيب شرط: نتيجة سنة تُرحَّل بعد ما قبلها، وإلا اختلّ رصيد الأرباح المحتجزة
  const laterClose = await tx.fiscalClose.findFirst({ where: { endDate: { gt: bounds.end } } });
  if (laterClose) throw badRequest('لا يصح إقفال سنة بعد إقفال سنة تالية لها — أعد فتح الأحدث أولاً');

  const unclosedBefore = await tx.journalEntry.findFirst({
    where: { date: { lt: bounds.start } },
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  if (unclosedBefore) {
    const previous = fiscalYearOf(unclosedBefore.date, fiscalYearStart);
    const previousClose = await tx.fiscalClose.findUnique({ where: { endDate: previous.end } });
    if (!previousClose) {
      throw badRequest(`أقفل السنة ${fiscalYearLabel(previous)} أولاً — الإقفال يجري بالترتيب`);
    }
  }

  // إقفال يدوي بعد نهاية السنة يعني أن الإقفال سيخفض القفل، فنرفض بدل أن نخفضه
  if (lockDate && lockDate > bounds.end) {
    throw badRequest(
      `إقفال الفترة مضبوط يدوياً على ${lockDate.toISOString().slice(0, 10)} وهو بعد نهاية هذه السنة`,
    );
  }

  const { lines, income, expense } = await resultBalances(tx, bounds);
  if (!lines.length) throw badRequest(`لا حركة في السنة المالية ${fiscalYearLabel(bounds)}`);

  const retained = await tx.account.findUnique({ where: { systemKey: SYSTEM_ACCOUNTS.RETAINED } });
  if (!retained) throw notFound('حساب الأرباح المحتجزة غير موجود');

  const netResult = income - expense;
  // الربح يزيد الأرباح المحتجزة (دائن) والخسارة تنقصها (مدين)
  const retainedLine =
    netResult >= 0n
      ? { accountId: retained.id, credit: netResult }
      : { accountId: retained.id, debit: -netResult };

  // القيد مؤرَّخ بآخر يوم في السنة، وقد يكون القفل عليه، فنرفعه مؤقتاً داخل
  // المعاملة نفسها ثم نضعه على نهاية السنة المقفلة
  await tx.settings.update({ where: { id: 1 }, data: { lockDate: null } });

  const entry = await createEntry(tx, {
    date: bounds.end,
    memo: `إقفال السنة المالية ${fiscalYearLabel(bounds)}`,
    source: 'CLOSING',
    actor,
    lines: [...lines, retainedLine],
  });

  const close = await tx.fiscalClose.create({
    data: {
      startDate: bounds.start,
      endDate: bounds.end,
      netResult,
      entryId: entry.id,
      createdById: actor ? actor.id : null,
      createdByName: actor ? actor.name : null,
    },
  });

  await tx.settings.update({ where: { id: 1 }, data: { lockDate: bounds.end } });

  return { close, entry, income, expense, netResult, label: fiscalYearLabel(bounds) };
}

/** يعيد فتح آخر سنة مقفلة: يحذف قيدها ويعيد القفل إلى ما قبلها. */
async function reopenFiscalYear(tx, { endDate }) {
  const close = await tx.fiscalClose.findUnique({ where: { endDate } });
  if (!close) throw notFound('لا يوجد إقفال لهذه السنة');

  const later = await tx.fiscalClose.findFirst({ where: { endDate: { gt: endDate } } });
  if (later) throw badRequest('أعد فتح السنة الأحدث أولاً — الفتح يجري بالعكس من الإقفال');

  // أي حركة بعد نهاية السنة تعني أن قفلها رُفع يدوياً وسُجّل بعدها؛ إعادة الفتح
  // ما زالت صحيحة، لكن القفل يعود إلى الإقفال السابق لا إلى هذه السنة
  const previous = await tx.fiscalClose.findFirst({
    where: { endDate: { lt: endDate } },
    orderBy: { endDate: 'desc' },
  });

  // الحذف يسقط صف الإقفال معه (onDelete: Cascade)
  await tx.journalEntry.delete({ where: { id: close.entryId } });
  await tx.settings.update({ where: { id: 1 }, data: { lockDate: previous ? previous.endDate : null } });

  return { reopened: close };
}

module.exports = {
  fiscalYearOf,
  nextFiscalYear,
  fiscalYearLabel,
  resultBalances,
  closableYears,
  closeFiscalYear,
  reopenFiscalYear,
};
