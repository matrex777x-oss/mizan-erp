'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { toMinor, toQuantity, toRate, lineAmount, taxAmount } = require('../lib/money');
const { requireString } = require('../lib/validate');
const { SYSTEM_ACCOUNTS } = require('../lib/constants');
const { createEntry, deleteEntriesFor } = require('./ledger');

/** الأنواع المسموح بها لحسابات سطور الفاتورة. */
const LINE_ACCOUNT_TYPES = {
  SALES: ['INCOME'],
  PURCHASE: ['EXPENSE', 'ASSET'],
};

/** يحسب سطور الفاتورة ومجاميعها بالوحدة الصغرى. */
function computeLines(kind, rawLines, accountsById) {
  const lines = [];
  let subtotal = 0n;
  let taxTotal = 0n;

  rawLines.forEach((raw, index) => {
    const position = index + 1;
    const account = accountsById.get(raw.accountId);
    if (!account) throw notFound(`حساب السطر ${position} غير موجود`);
    if (account.isGroup) throw badRequest(`السطر ${position}: «${account.name}» حساب تجميعي`);
    if (!LINE_ACCOUNT_TYPES[kind].includes(account.type)) {
      throw badRequest(
        `السطر ${position}: نوع الحساب «${account.name}» لا يصلح لفاتورة ${kind === 'SALES' ? 'مبيعات' : 'مشتريات'}`,
      );
    }

    const quantity = toQuantity(raw.quantity ?? '1');
    const unitPrice = toMinor(raw.unitPrice ?? 0);
    const taxRate = toRate(raw.taxRate ?? 0);

    if (quantity <= 0n) throw badRequest(`السطر ${position}: الكمية يجب أن تكون أكبر من صفر`);
    if (unitPrice < 0n) throw badRequest(`السطر ${position}: السعر لا يكون سالباً`);
    if (taxRate < 0 || taxRate > 10000) throw badRequest(`السطر ${position}: نسبة ضريبة غير منطقية`);

    const lineSubtotal = lineAmount(quantity, unitPrice);
    const lineTax = taxAmount(lineSubtotal, taxRate);

    subtotal += lineSubtotal;
    taxTotal += lineTax;

    lines.push({
      description: requireString(raw.description, `وصف السطر ${position}`, { max: 500 }),
      quantity,
      unitPrice,
      taxRate,
      accountId: account.id,
      lineSubtotal,
      lineTax,
      lineTotal: lineSubtotal + lineTax,
      sortOrder: index,
    });
  });

  if (subtotal + taxTotal <= 0n) throw badRequest('إجمالي الفاتورة يجب أن يكون أكبر من صفر');

  return { lines, subtotal, taxTotal, total: subtotal + taxTotal };
}

async function systemAccount(tx, key) {
  const account = await tx.account.findUnique({ where: { systemKey: key } });
  if (!account) throw badRequest(`الحساب النظامي «${key}» غير معرَّف — راجع شجرة الحسابات`);
  return account;
}

/** يرحّل الفاتورة: ينشئ القيد المحاسبي ويغيّر الحالة إلى مُرحَّلة. */
async function postInvoice(tx, invoice, userId) {
  if (invoice.status === 'POSTED') throw badRequest('الفاتورة مُرحَّلة مسبقاً');
  if (invoice.status === 'CANCELLED') throw badRequest('الفاتورة ملغاة');

  const isSales = invoice.kind === 'SALES';
  const control = await systemAccount(tx, isSales ? SYSTEM_ACCOUNTS.RECEIVABLE : SYSTEM_ACCOUNTS.PAYABLE);
  const memo = `${isSales ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} ${invoice.number}`;

  const lines = [];

  if (isSales) {
    lines.push({ accountId: control.id, partyId: invoice.partyId, debit: invoice.total, memo });
    for (const line of invoice.lines) {
      if (line.lineSubtotal > 0n) {
        lines.push({ accountId: line.accountId, credit: line.lineSubtotal, memo: line.description });
      }
    }
    if (invoice.taxTotal > 0n) {
      const tax = await systemAccount(tx, SYSTEM_ACCOUNTS.TAX_OUTPUT);
      lines.push({ accountId: tax.id, credit: invoice.taxTotal, memo: 'ضريبة مخرجات' });
    }
  } else {
    for (const line of invoice.lines) {
      if (line.lineSubtotal > 0n) {
        lines.push({ accountId: line.accountId, debit: line.lineSubtotal, memo: line.description });
      }
    }
    if (invoice.taxTotal > 0n) {
      const tax = await systemAccount(tx, SYSTEM_ACCOUNTS.TAX_INPUT);
      lines.push({ accountId: tax.id, debit: invoice.taxTotal, memo: 'ضريبة مدخلات' });
    }
    lines.push({ accountId: control.id, partyId: invoice.partyId, credit: invoice.total, memo });
  }

  await createEntry(tx, {
    date: invoice.date,
    memo,
    source: 'INVOICE',
    sourceId: invoice.id,
    userId,
    lines,
  });

  return tx.invoice.update({ where: { id: invoice.id }, data: { status: 'POSTED' } });
}

/** يلغي الترحيل: يحذف القيد ويعيد الفاتورة مسودة. */
async function unpostInvoice(tx, invoice) {
  if (invoice.status !== 'POSTED') throw badRequest('الفاتورة ليست مُرحَّلة');

  const allocated = await tx.paymentAllocation.count({ where: { invoiceId: invoice.id } });
  if (allocated) throw badRequest('لا يمكن إلغاء ترحيل فاتورة مرتبطة بسندات — ألغِ السندات أولاً');

  await deleteEntriesFor(tx, 'INVOICE', invoice.id);
  return tx.invoice.update({ where: { id: invoice.id }, data: { status: 'DRAFT' } });
}

/** المبلغ المسدَّد من كل فاتورة (من السندات المُرحَّلة فقط). */
async function paidAmounts(prisma, invoiceIds) {
  if (!invoiceIds.length) return new Map();
  const rows = await prisma.paymentAllocation.groupBy({
    by: ['invoiceId'],
    where: { invoiceId: { in: invoiceIds }, payment: { status: 'POSTED' } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.invoiceId, r._sum.amount ?? 0n]));
}

module.exports = { computeLines, postInvoice, unpostInvoice, paidAmounts, systemAccount, LINE_ACCOUNT_TYPES };
