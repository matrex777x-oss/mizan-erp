'use strict';

const { badRequest, notFound } = require('../lib/errors');
const { toMinor, toQuantity, toRate, lineAmount, taxAmount } = require('../lib/money');
const { requireString, optionalString } = require('../lib/validate');
const { SYSTEM_ACCOUNTS } = require('../lib/constants');
const { createEntry, deleteEntriesFor } = require('./ledger');
const { recordIn, recordOut, removeMovesFor } = require('./stock');

/** الأنواع المسموح بها لحسابات سطور الفاتورة الحرّة (بلا صنف). */
const LINE_ACCOUNT_TYPES = {
  SALES: ['INCOME'],
  PURCHASE: ['EXPENSE', 'ASSET'],
};

async function systemAccount(tx, key) {
  const account = await tx.account.findUnique({ where: { systemKey: key } });
  if (!account) throw badRequest(`الحساب النظامي «${key}» غير معرَّف — راجع شجرة الحسابات`);
  return account;
}

/** الحساب الذي يُقيَّد عليه سطر مرتبط بصنف. */
async function accountForItem(tx, kind, item) {
  if (kind === 'SALES') return item.salesAccountId;
  if (item.kind === 'STOCK') {
    return item.inventoryAccountId || (await systemAccount(tx, SYSTEM_ACCOUNTS.INVENTORY)).id;
  }
  if (!item.expenseAccountId) {
    throw badRequest(`الصنف الخدمي «${item.name}» بلا حساب مصروف — عيّنه في بطاقة الصنف`);
  }
  return item.expenseAccountId;
}

/**
 * يحسب سطور الفاتورة ومجاميعها بالوحدة الصغرى.
 * السطر إمّا مرتبط بصنف (فيأخذ حساباته منه) أو حرّ بحساب يختاره المستخدم.
 */
async function computeLines(tx, kind, rawLines) {
  const itemIds = [...new Set(rawLines.map((l) => l.itemId).filter(Boolean))];
  const accountIds = [...new Set(rawLines.filter((l) => !l.itemId).map((l) => l.accountId).filter(Boolean))];

  const [items, accounts] = await Promise.all([
    itemIds.length ? tx.item.findMany({ where: { id: { in: itemIds } } }) : [],
    accountIds.length ? tx.account.findMany({ where: { id: { in: accountIds } } }) : [],
  ]);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const lines = [];
  let subtotal = 0n;
  let taxTotal = 0n;

  for (const [index, raw] of rawLines.entries()) {
    const position = index + 1;
    let accountId;
    let description;

    if (raw.itemId) {
      const item = itemsById.get(raw.itemId);
      if (!item) throw notFound(`صنف السطر ${position} غير موجود`);
      if (!item.active) throw badRequest(`السطر ${position}: الصنف «${item.name}» غير مفعّل`);
      accountId = await accountForItem(tx, kind, item);
      description = optionalString(raw.description, `وصف السطر ${position}`, { max: 500 }) || item.name;
    } else {
      const account = accountsById.get(raw.accountId);
      if (!account) throw notFound(`حساب السطر ${position} غير موجود`);
      if (account.isGroup) throw badRequest(`السطر ${position}: «${account.name}» حساب تجميعي`);
      if (!LINE_ACCOUNT_TYPES[kind].includes(account.type)) {
        throw badRequest(
          `السطر ${position}: نوع الحساب «${account.name}» لا يصلح لفاتورة ${kind === 'SALES' ? 'مبيعات' : 'مشتريات'}`,
        );
      }
      accountId = account.id;
      description = requireString(raw.description, `وصف السطر ${position}`, { max: 500 });
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
      itemId: raw.itemId || null,
      description,
      quantity,
      unitPrice,
      taxRate,
      accountId,
      lineSubtotal,
      lineTax,
      lineTotal: lineSubtotal + lineTax,
      sortOrder: index,
    });
  }

  if (subtotal + taxTotal <= 0n) throw badRequest('إجمالي الفاتورة يجب أن يكون أكبر من صفر');

  return { lines, subtotal, taxTotal, total: subtotal + taxTotal };
}

/**
 * يسجّل حركة المخزون للفاتورة ويعيد سطور تكلفة البضاعة المباعة.
 * الشراء يُدخل البضاعة بتكلفتها، والبيع يُخرجها بالمتوسط المرجّح.
 */
async function applyStock(tx, invoice) {
  const stockLines = invoice.lines.filter((line) => line.item?.kind === 'STOCK');
  if (!stockLines.length) return [];

  if (invoice.kind === 'PURCHASE') {
    for (const line of stockLines) {
      await recordIn(tx, {
        itemId: line.itemId,
        date: invoice.date,
        quantity: line.quantity,
        totalCost: line.lineSubtotal,
        sourceType: 'INVOICE',
        sourceId: invoice.id,
        memo: `فاتورة مشتريات ${invoice.number}`,
      });
    }
    return [];
  }

  // مبيعات: نُخرج البضاعة ونجمّع التكلفة حسب زوج (تكلفة المبيعات، المخزون)
  const inventoryDefault = await systemAccount(tx, SYSTEM_ACCOUNTS.INVENTORY);
  const cogsDefault = await systemAccount(tx, SYSTEM_ACCOUNTS.COGS);
  const buckets = new Map();

  for (const line of stockLines) {
    const move = await recordOut(tx, {
      itemId: line.itemId,
      date: invoice.date,
      quantity: line.quantity,
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      memo: `فاتورة مبيعات ${invoice.number}`,
    });
    if (move.totalCost === 0n) continue;

    const cogsId = line.item.cogsAccountId || cogsDefault.id;
    const inventoryId = line.item.inventoryAccountId || inventoryDefault.id;
    const key = `${cogsId}|${inventoryId}`;
    buckets.set(key, (buckets.get(key) ?? 0n) + move.totalCost);
  }

  const entryLines = [];
  for (const [key, cost] of buckets) {
    const [cogsId, inventoryId] = key.split('|');
    entryLines.push({ accountId: cogsId, debit: cost, memo: 'تكلفة البضاعة المباعة' });
    entryLines.push({ accountId: inventoryId, credit: cost, memo: 'إخراج من المخزون' });
  }
  return entryLines;
}

/** يرحّل الفاتورة: يحرّك المخزون وينشئ القيد المحاسبي ويغيّر الحالة. */
async function postInvoice(tx, invoice, actor) {
  if (invoice.status === 'POSTED') throw badRequest('الفاتورة مُرحَّلة مسبقاً');
  if (invoice.status === 'CANCELLED') throw badRequest('الفاتورة ملغاة');

  // نحتاج بيانات الأصناف لتحديد ما يدخل المخزون
  const full = await tx.invoice.findUnique({
    where: { id: invoice.id },
    include: { lines: { include: { item: true }, orderBy: { sortOrder: 'asc' } } },
  });

  const isSales = full.kind === 'SALES';
  const control = await systemAccount(tx, isSales ? SYSTEM_ACCOUNTS.RECEIVABLE : SYSTEM_ACCOUNTS.PAYABLE);
  const memo = `${isSales ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} ${full.number}`;

  const stockEntryLines = await applyStock(tx, full);
  const lines = [];

  if (isSales) {
    lines.push({ accountId: control.id, partyId: full.partyId, debit: full.total, memo });
    for (const line of full.lines) {
      if (line.lineSubtotal > 0n) {
        lines.push({ accountId: line.accountId, credit: line.lineSubtotal, memo: line.description });
      }
    }
    if (full.taxTotal > 0n) {
      const tax = await systemAccount(tx, SYSTEM_ACCOUNTS.TAX_OUTPUT);
      lines.push({ accountId: tax.id, credit: full.taxTotal, memo: 'ضريبة مخرجات' });
    }
  } else {
    for (const line of full.lines) {
      if (line.lineSubtotal > 0n) {
        lines.push({ accountId: line.accountId, debit: line.lineSubtotal, memo: line.description });
      }
    }
    if (full.taxTotal > 0n) {
      const tax = await systemAccount(tx, SYSTEM_ACCOUNTS.TAX_INPUT);
      lines.push({ accountId: tax.id, debit: full.taxTotal, memo: 'ضريبة مدخلات' });
    }
    lines.push({ accountId: control.id, partyId: full.partyId, credit: full.total, memo });
  }

  await createEntry(tx, {
    date: full.date,
    memo,
    source: 'INVOICE',
    sourceId: full.id,
    actor,
    lines: [...lines, ...stockEntryLines],
  });

  return tx.invoice.update({ where: { id: full.id }, data: { status: 'POSTED' } });
}

/** يلغي الترحيل: يحذف القيد وحركة المخزون ويعيد الفاتورة مسودة. */
async function unpostInvoice(tx, invoice) {
  if (invoice.status !== 'POSTED') throw badRequest('الفاتورة ليست مُرحَّلة');

  const allocated = await tx.paymentAllocation.count({ where: { invoiceId: invoice.id } });
  if (allocated) throw badRequest('لا يمكن إلغاء ترحيل فاتورة مرتبطة بسندات — ألغِ السندات أولاً');

  await removeMovesFor(tx, 'INVOICE', invoice.id);
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
