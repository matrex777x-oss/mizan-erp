'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { toMinor } = require('../lib/money');
const { SYSTEM_ACCOUNTS } = require('../lib/constants');
const { createEntry, deleteEntriesFor } = require('./ledger');
const { systemAccount } = require('./invoices');

/** نوع الفاتورة التي يسدّدها كل نوع سند. */
const MATCHING_INVOICE_KIND = { RECEIPT: 'SALES', PAYMENT: 'PURCHASE' };

/**
 * يتحقق من توزيع السند على الفواتير ويعيد السطور الجاهزة.
 * يتجاهل السند الحالي عند حساب المسدَّد حتى يعمل التعديل بشكل صحيح.
 */
async function validateAllocations(tx, { kind, partyId, amount, rawAllocations, ignorePaymentId = null }) {
  if (!rawAllocations?.length) return [];

  const wantedKind = MATCHING_INVOICE_KIND[kind];
  const invoiceIds = [...new Set(rawAllocations.map((a) => a.invoiceId))];
  if (invoiceIds.length !== rawAllocations.length) {
    throw badRequest('لا يمكن تكرار الفاتورة نفسها في التوزيع');
  }

  const invoices = await tx.invoice.findMany({ where: { id: { in: invoiceIds } } });
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const settled = await tx.paymentAllocation.groupBy({
    by: ['invoiceId'],
    where: {
      invoiceId: { in: invoiceIds },
      payment: { status: 'POSTED', ...(ignorePaymentId && { id: { not: ignorePaymentId } }) },
    },
    _sum: { amount: true },
  });
  const paidById = new Map(settled.map((s) => [s.invoiceId, s._sum.amount ?? 0n]));

  const result = [];
  let allocated = 0n;

  for (const raw of rawAllocations) {
    const invoice = byId.get(raw.invoiceId);
    if (!invoice) throw notFound('إحدى الفواتير المحدّدة غير موجودة');
    if (invoice.partyId !== partyId) throw badRequest(`الفاتورة ${invoice.number} تخص طرفاً آخر`);
    if (invoice.kind !== wantedKind) throw badRequest(`الفاتورة ${invoice.number} لا تناسب نوع السند`);
    if (invoice.status !== 'POSTED') throw badRequest(`الفاتورة ${invoice.number} غير مُرحَّلة`);

    const value = toMinor(raw.amount ?? 0);
    if (value <= 0n) throw badRequest(`مبلغ التوزيع على الفاتورة ${invoice.number} يجب أن يكون موجباً`);

    const remaining = invoice.total - (paidById.get(invoice.id) ?? 0n);
    if (value > remaining) {
      throw badRequest(`المبلغ الموزَّع على الفاتورة ${invoice.number} يتجاوز المتبقي عليها`);
    }

    allocated += value;
    result.push({ invoiceId: invoice.id, amount: value });
  }

  if (allocated > amount) throw badRequest('مجموع التوزيع يتجاوز مبلغ السند');
  return result;
}

/** يرحّل السند: Dr نقدية / Cr ذمم مدينة — أو العكس للصرف. */
async function postPayment(tx, payment, userId) {
  if (payment.status === 'POSTED') throw badRequest('السند مُرحَّل مسبقاً');
  if (payment.status === 'CANCELLED') throw badRequest('السند ملغى');
  if (payment.amount <= 0n) throw badRequest('مبلغ السند يجب أن يكون أكبر من صفر');

  const isReceipt = payment.kind === 'RECEIPT';
  const control = await systemAccount(tx, isReceipt ? SYSTEM_ACCOUNTS.RECEIVABLE : SYSTEM_ACCOUNTS.PAYABLE);
  const cash = await tx.account.findUnique({ where: { id: payment.cashAccountId } });
  if (!cash) throw notFound('الحساب النقدي غير موجود');
  if (cash.type !== 'ASSET' || cash.isGroup) throw badRequest('الحساب النقدي يجب أن يكون حساب أصول غير تجميعي');

  const memo = `${isReceipt ? 'سند قبض' : 'سند صرف'} ${payment.number}`;
  const lines = isReceipt
    ? [
        { accountId: cash.id, debit: payment.amount, memo },
        { accountId: control.id, partyId: payment.partyId, credit: payment.amount, memo },
      ]
    : [
        { accountId: control.id, partyId: payment.partyId, debit: payment.amount, memo },
        { accountId: cash.id, credit: payment.amount, memo },
      ];

  await createEntry(tx, {
    date: payment.date,
    memo,
    source: 'PAYMENT',
    sourceId: payment.id,
    userId,
    lines,
  });

  return tx.payment.update({ where: { id: payment.id }, data: { status: 'POSTED' } });
}

async function unpostPayment(tx, payment) {
  if (payment.status !== 'POSTED') throw badRequest('السند ليس مُرحَّلاً');
  await deleteEntriesFor(tx, 'PAYMENT', payment.id);
  return tx.payment.update({ where: { id: payment.id }, data: { status: 'DRAFT' } });
}

module.exports = { validateAllocations, postPayment, unpostPayment, MATCHING_INVOICE_KIND };
