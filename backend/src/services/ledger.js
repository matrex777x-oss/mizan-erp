'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { toMinor } = require('../lib/money');
const { ENTRY_SOURCES } = require('../lib/constants');

/** رقم القيد التالي (تسلسلي على مستوى الدفتر كله). */
async function nextEntryNumber(tx) {
  const last = await tx.journalEntry.findFirst({
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

/** يمنع أي حركة في فترة مقفلة. */
async function assertPeriodOpen(tx, date) {
  const settings = await tx.settings.findUnique({ where: { id: 1 } });
  if (settings?.lockDate && date <= settings.lockDate) {
    throw badRequest(
      `الفترة مقفلة حتى ${settings.lockDate.toISOString().slice(0, 10)}؛ لا يمكن التسجيل في تاريخ سابق أو مساوٍ له`,
    );
  }
}

/**
 * ينشئ قيداً متوازناً. يُستدعى دائماً داخل معاملة (transaction).
 * lines: [{ accountId, partyId?, debit?, credit?, memo? }] بالوحدة الصغرى أو كنص عشري.
 */
async function createEntry(tx, { date, memo = null, source = 'MANUAL', sourceId = null, actor = null, lines }) {
  if (!ENTRY_SOURCES.includes(source)) throw badRequest('مصدر القيد غير صالح');
  if (!Array.isArray(lines) || lines.length < 2) {
    throw badRequest('القيد يحتاج سطرين على الأقل');
  }

  await assertPeriodOpen(tx, date);

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let totalDebit = 0n;
  let totalCredit = 0n;
  const prepared = [];

  for (const [index, line] of lines.entries()) {
    const position = index + 1;
    const account = byId.get(line.accountId);
    if (!account) throw notFound(`الحساب في السطر ${position} غير موجود`);
    if (account.isGroup) throw badRequest(`السطر ${position}: «${account.name}» حساب تجميعي ولا يقبل القيود`);
    if (!account.active) throw badRequest(`السطر ${position}: الحساب «${account.name}» غير مفعّل`);

    const debit = toMinor(line.debit ?? 0);
    const credit = toMinor(line.credit ?? 0);

    if (debit < 0n || credit < 0n) throw badRequest(`السطر ${position}: لا تُقبل المبالغ السالبة`);
    if (debit > 0n && credit > 0n) throw badRequest(`السطر ${position}: لا يمكن أن يكون مديناً ودائناً معاً`);
    if (debit === 0n && credit === 0n) throw badRequest(`السطر ${position}: المبلغ صفر`);

    totalDebit += debit;
    totalCredit += credit;

    prepared.push({
      accountId: account.id,
      partyId: line.partyId || null,
      debit,
      credit,
      memo: line.memo ? String(line.memo).slice(0, 255) : null,
    });
  }

  if (totalDebit !== totalCredit) {
    throw badRequest('القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن', {
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
    });
  }

  const number = await nextEntryNumber(tx);

  return tx.journalEntry.create({
    data: {
      number,
      date,
      memo,
      source,
      sourceId,
      createdById: actor ? actor.id : null,
      // لقطة الاسم: المستخدم في قاعدة النظام فلا يمكن ضمّه باستعلام واحد هنا
      createdByName: actor ? actor.name : null,
      lines: { create: prepared },
    },
    include: { lines: true },
  });
}

/** يحذف القيد المرتبط بمستند (عند إلغاء فاتورة أو سند). */
async function deleteEntriesFor(tx, source, sourceId) {
  const entries = await tx.journalEntry.findMany({
    where: { source, sourceId },
    select: { id: true, date: true },
  });
  for (const entry of entries) {
    await assertPeriodOpen(tx, entry.date);
  }
  if (entries.length) {
    await tx.journalEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  }
  return entries.length;
}

module.exports = { nextEntryNumber, assertPeriodOpen, createEntry, deleteEntriesFor };
