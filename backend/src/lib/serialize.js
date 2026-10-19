'use strict';

const { fromMinor, fromQuantity, fromRate } = require('./money');

const money = (value) => fromMinor(value ?? 0n);
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

function account(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    isGroup: row.isGroup,
    systemKey: row.systemKey,
    active: row.active,
  };
}

function party(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxNumber: row.taxNumber,
    notes: row.notes,
    active: row.active,
  };
}

function journalLine(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    account: row.account ? account(row.account) : undefined,
    partyId: row.partyId,
    party: row.party ? party(row.party) : undefined,
    debit: money(row.debit),
    credit: money(row.credit),
    memo: row.memo,
  };
}

function journalEntry(row) {
  return {
    id: row.id,
    number: row.number,
    date: day(row.date),
    memo: row.memo,
    source: row.source,
    sourceId: row.sourceId,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : undefined,
    createdAt: row.createdAt,
    lines: (row.lines || []).map(journalLine),
    totalDebit: money((row.lines || []).reduce((sum, l) => sum + l.debit, 0n)),
    totalCredit: money((row.lines || []).reduce((sum, l) => sum + l.credit, 0n)),
  };
}

function invoiceLine(row) {
  return {
    id: row.id,
    description: row.description,
    quantity: fromQuantity(row.quantity),
    unitPrice: money(row.unitPrice),
    taxRate: fromRate(row.taxRate),
    accountId: row.accountId,
    account: row.account ? account(row.account) : undefined,
    lineSubtotal: money(row.lineSubtotal),
    lineTax: money(row.lineTax),
    lineTotal: money(row.lineTotal),
    sortOrder: row.sortOrder,
  };
}

function invoice(row, extra = {}) {
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    date: day(row.date),
    dueDate: day(row.dueDate),
    partyId: row.partyId,
    party: row.party ? party(row.party) : undefined,
    status: row.status,
    notes: row.notes,
    subtotal: money(row.subtotal),
    taxTotal: money(row.taxTotal),
    total: money(row.total),
    lines: row.lines ? row.lines.map(invoiceLine) : undefined,
    ...extra,
  };
}

function payment(row, extra = {}) {
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    date: day(row.date),
    partyId: row.partyId,
    party: row.party ? party(row.party) : undefined,
    cashAccountId: row.cashAccountId,
    cashAccount: row.cashAccount ? account(row.cashAccount) : undefined,
    amount: money(row.amount),
    status: row.status,
    reference: row.reference,
    notes: row.notes,
    allocations: row.allocations
      ? row.allocations.map((a) => ({
          id: a.id,
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoice?.number,
          invoiceTotal: a.invoice ? money(a.invoice.total) : undefined,
          amount: money(a.amount),
        }))
      : undefined,
    ...extra,
  };
}

function settings(row) {
  return {
    companyName: row.companyName,
    currencyCode: row.currencyCode,
    currencySymbol: row.currencySymbol,
    decimalPlaces: row.decimalPlaces,
    fiscalYearStart: row.fiscalYearStart,
    defaultTaxRate: fromRate(row.defaultTaxRate),
    lockDate: day(row.lockDate),
  };
}

module.exports = {
  money,
  day,
  account,
  party,
  journalLine,
  journalEntry,
  invoiceLine,
  invoice,
  payment,
  settings,
};
