'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { optionalDate, requireString } = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { NATURAL_SIDE, SYSTEM_ACCOUNTS } = require('../lib/constants');
const serialize = require('../lib/serialize');

const router = express.Router();

/** مجاميع المدين والدائن لكل حساب ضمن نطاق تاريخي. */
async function sumsByAccount({ from, to } = {}) {
  const where = {};
  if (from || to) where.entry = { date: { ...(from && { gte: from }), ...(to && { lte: to }) } };

  const grouped = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where,
    _sum: { debit: true, credit: true },
  });

  return new Map(
    grouped.map((g) => [g.accountId, { debit: g._sum.debit ?? 0n, credit: g._sum.credit ?? 0n }]),
  );
}

/** يجمع أرصدة الأبناء في الآباء لعرض الشجرة. */
function rollUp(accounts, leafBalances) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map(accounts.map((a) => [a.id, 0n]));

  for (const account of accounts) {
    const own = leafBalances.get(account.id) ?? 0n;
    if (own === 0n) continue;
    let cursor = account.id;
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      totals.set(cursor, (totals.get(cursor) ?? 0n) + own);
      cursor = byId.get(cursor)?.parentId || null;
    }
  }
  return totals;
}

// ───────────────────────── ميزان المراجعة ─────────────────────────

router.get('/trial-balance', async (req, res, next) => {
  try {
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');
    const hideZero = req.query.hideZero !== 'false';

    const [accounts, sums] = await Promise.all([
      prisma.account.findMany({ where: { isGroup: false }, orderBy: { code: 'asc' } }),
      sumsByAccount({ from, to }),
    ]);

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows = [];

    for (const account of accounts) {
      const { debit = 0n, credit = 0n } = sums.get(account.id) || {};
      if (hideZero && debit === 0n && credit === 0n) continue;

      const net = debit - credit;
      totalDebit += debit;
      totalCredit += credit;

      rows.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: serialize.money(debit),
        credit: serialize.money(credit),
        balanceDebit: serialize.money(net > 0n ? net : 0n),
        balanceCredit: serialize.money(net < 0n ? -net : 0n),
      });
    }

    res.json({
      from: serialize.day(from),
      to: serialize.day(to),
      rows,
      totals: {
        debit: serialize.money(totalDebit),
        credit: serialize.money(totalCredit),
        balanced: totalDebit === totalCredit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── قائمة الدخل ─────────────────────────

router.get('/income-statement', async (req, res, next) => {
  try {
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');

    const [accounts, sums] = await Promise.all([
      prisma.account.findMany({ where: { type: { in: ['INCOME', 'EXPENSE'] } }, orderBy: { code: 'asc' } }),
      sumsByAccount({ from, to }),
    ]);

    const leaf = new Map();
    for (const account of accounts) {
      const { debit = 0n, credit = 0n } = sums.get(account.id) || {};
      // نعرض الإيراد والمصروف بإشارة موجبة حسب طبيعته
      leaf.set(account.id, (debit - credit) * BigInt(NATURAL_SIDE[account.type]));
    }
    const totals = rollUp(accounts, leaf);

    const section = (type) =>
      accounts
        .filter((a) => a.type === type)
        .map((a) => ({
          accountId: a.id,
          code: a.code,
          name: a.name,
          isGroup: a.isGroup,
          parentId: a.parentId,
          amount: serialize.money(totals.get(a.id) ?? 0n),
        }))
        .filter((r) => r.amount !== '0.00');

    const sumOf = (type) =>
      accounts
        .filter((a) => a.type === type && !a.isGroup)
        .reduce((acc, a) => acc + (leaf.get(a.id) ?? 0n), 0n);

    const income = sumOf('INCOME');
    const expense = sumOf('EXPENSE');

    res.json({
      from: serialize.day(from),
      to: serialize.day(to),
      income: section('INCOME'),
      expenses: section('EXPENSE'),
      totals: {
        income: serialize.money(income),
        expenses: serialize.money(expense),
        netProfit: serialize.money(income - expense),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── المركز المالي ─────────────────────────

router.get('/balance-sheet', async (req, res, next) => {
  try {
    const to = optionalDate(req.query.to, 'إلى تاريخ');

    const [accounts, sums] = await Promise.all([
      prisma.account.findMany({ orderBy: { code: 'asc' } }),
      sumsByAccount({ to }),
    ]);

    const leaf = new Map();
    for (const account of accounts) {
      const { debit = 0n, credit = 0n } = sums.get(account.id) || {};
      leaf.set(account.id, (debit - credit) * BigInt(NATURAL_SIDE[account.type]));
    }
    const totals = rollUp(accounts, leaf);

    const sumOf = (type) =>
      accounts.filter((a) => a.type === type && !a.isGroup).reduce((acc, a) => acc + (leaf.get(a.id) ?? 0n), 0n);

    const assets = sumOf('ASSET');
    const liabilities = sumOf('LIABILITY');
    const equity = sumOf('EQUITY');
    const netProfit = sumOf('INCOME') - sumOf('EXPENSE');

    const section = (type) =>
      accounts
        .filter((a) => a.type === type)
        .map((a) => ({
          accountId: a.id,
          code: a.code,
          name: a.name,
          isGroup: a.isGroup,
          parentId: a.parentId,
          amount: serialize.money(totals.get(a.id) ?? 0n),
        }))
        .filter((r) => r.amount !== '0.00');

    res.json({
      to: serialize.day(to),
      assets: section('ASSET'),
      liabilities: section('LIABILITY'),
      equity: section('EQUITY'),
      totals: {
        assets: serialize.money(assets),
        liabilities: serialize.money(liabilities),
        equity: serialize.money(equity),
        netProfit: serialize.money(netProfit),
        // الأصول = الالتزامات + حقوق الملكية + نتيجة الفترة
        equityWithProfit: serialize.money(equity + netProfit),
        balanced: assets === liabilities + equity + netProfit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── كشف حساب (دفتر الأستاذ) ─────────────────────────

router.get('/ledger/:accountId', async (req, res, next) => {
  try {
    const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
    if (!account) throw notFound('الحساب غير موجود');

    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');

    let opening = 0n;
    if (from) {
      const before = await prisma.journalLine.aggregate({
        where: { accountId: account.id, entry: { date: { lt: from } } },
        _sum: { debit: true, credit: true },
      });
      opening = (before._sum.debit ?? 0n) - (before._sum.credit ?? 0n);
    }

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: account.id,
        ...((from || to) && { entry: { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } }),
      },
      include: { entry: true, party: true },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });

    let running = opening;
    const rows = lines.map((line) => {
      running += line.debit - line.credit;
      return {
        lineId: line.id,
        entryId: line.entryId,
        entryNumber: line.entry.number,
        date: serialize.day(line.entry.date),
        source: line.entry.source,
        memo: line.memo || line.entry.memo,
        party: line.party ? { id: line.party.id, name: line.party.name } : null,
        debit: serialize.money(line.debit),
        credit: serialize.money(line.credit),
        balance: serialize.money(running),
      };
    });

    res.json({
      account: serialize.account(account),
      from: serialize.day(from),
      to: serialize.day(to),
      opening: serialize.money(opening),
      closing: serialize.money(running),
      rows,
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── كشف حساب طرف ─────────────────────────

router.get('/party-statement/:partyId', async (req, res, next) => {
  try {
    const party = await prisma.party.findUnique({ where: { id: req.params.partyId } });
    if (!party) throw notFound('الطرف غير موجود');

    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');

    const controls = await prisma.account.findMany({
      where: { systemKey: { in: [SYSTEM_ACCOUNTS.RECEIVABLE, SYSTEM_ACCOUNTS.PAYABLE] } },
      select: { id: true },
    });
    const accountIds = controls.map((c) => c.id);

    let opening = 0n;
    if (from) {
      const before = await prisma.journalLine.aggregate({
        where: { partyId: party.id, accountId: { in: accountIds }, entry: { date: { lt: from } } },
        _sum: { debit: true, credit: true },
      });
      opening = (before._sum.debit ?? 0n) - (before._sum.credit ?? 0n);
    }

    const lines = await prisma.journalLine.findMany({
      where: {
        partyId: party.id,
        accountId: { in: accountIds },
        ...((from || to) && { entry: { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } }),
      },
      include: { entry: true },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });

    let running = opening;
    const rows = lines.map((line) => {
      running += line.debit - line.credit;
      return {
        entryId: line.entryId,
        entryNumber: line.entry.number,
        date: serialize.day(line.entry.date),
        source: line.entry.source,
        memo: line.memo || line.entry.memo,
        debit: serialize.money(line.debit),
        credit: serialize.money(line.credit),
        balance: serialize.money(running),
      };
    });

    res.json({
      party: serialize.party(party),
      from: serialize.day(from),
      to: serialize.day(to),
      opening: serialize.money(opening),
      closing: serialize.money(running),
      rows,
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── أعمار الديون ─────────────────────────

const BUCKETS = [
  { key: 'current', label: 'غير مستحق', max: 0 },
  { key: 'd1_30', label: '1 – 30 يوماً', max: 30 },
  { key: 'd31_60', label: '31 – 60 يوماً', max: 60 },
  { key: 'd61_90', label: '61 – 90 يوماً', max: 90 },
  { key: 'over90', label: 'أكثر من 90 يوماً', max: Infinity },
];

router.get('/aging', async (req, res, next) => {
  try {
    const kind = requireString(req.query.kind || 'SALES', 'النوع');
    const asOf = optionalDate(req.query.asOf, 'حتى تاريخ') || new Date();

    const invoices = await prisma.invoice.findMany({
      where: { kind, status: 'POSTED', date: { lte: asOf } },
      include: { party: true, allocations: { include: { payment: { select: { status: true } } } } },
      orderBy: { date: 'asc' },
    });

    const byParty = new Map();
    const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0n]));
    let grandTotal = 0n;

    for (const invoice of invoices) {
      const paid = invoice.allocations
        .filter((a) => a.payment.status === 'POSTED')
        .reduce((sum, a) => sum + a.amount, 0n);
      const due = invoice.total - paid;
      if (due <= 0n) continue;

      const reference = invoice.dueDate || invoice.date;
      const days = Math.floor((asOf - reference) / 86400000);
      const bucket = BUCKETS.find((b) => days <= b.max) || BUCKETS[BUCKETS.length - 1];

      if (!byParty.has(invoice.partyId)) {
        byParty.set(invoice.partyId, {
          partyId: invoice.partyId,
          partyName: invoice.party.name,
          buckets: Object.fromEntries(BUCKETS.map((b) => [b.key, 0n])),
          total: 0n,
        });
      }
      const row = byParty.get(invoice.partyId);
      row.buckets[bucket.key] += due;
      row.total += due;
      totals[bucket.key] += due;
      grandTotal += due;
    }

    res.json({
      kind,
      asOf: serialize.day(asOf),
      buckets: BUCKETS.map(({ key, label }) => ({ key, label })),
      rows: [...byParty.values()]
        .sort((a, b) => (b.total > a.total ? 1 : -1))
        .map((row) => ({
          partyId: row.partyId,
          partyName: row.partyName,
          buckets: Object.fromEntries(Object.entries(row.buckets).map(([k, v]) => [k, serialize.money(v)])),
          total: serialize.money(row.total),
        })),
      totals: {
        ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, serialize.money(v)])),
        grandTotal: serialize.money(grandTotal),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────── لوحة المؤشرات ─────────────────────────

router.get('/dashboard', async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));

    const [accounts, sumsAll, sumsMonth, openSales, openPurchases] = await Promise.all([
      prisma.account.findMany({ where: { isGroup: false } }),
      sumsByAccount({}),
      sumsByAccount({ from: monthStart }),
      prisma.invoice.count({ where: { kind: 'SALES', status: 'POSTED' } }),
      prisma.invoice.count({ where: { kind: 'PURCHASE', status: 'POSTED' } }),
    ]);

    const total = (sums, predicate) =>
      accounts.filter(predicate).reduce((acc, a) => {
        const { debit = 0n, credit = 0n } = sums.get(a.id) || {};
        return acc + (debit - credit) * BigInt(NATURAL_SIDE[a.type]);
      }, 0n);

    const cash = total(sumsAll, (a) => a.type === 'ASSET' && /^1[01]/.test(a.code));
    const receivable = total(sumsAll, (a) => a.systemKey === SYSTEM_ACCOUNTS.RECEIVABLE);
    const payable = total(sumsAll, (a) => a.systemKey === SYSTEM_ACCOUNTS.PAYABLE);
    const monthIncome = total(sumsMonth, (a) => a.type === 'INCOME');
    const monthExpense = total(sumsMonth, (a) => a.type === 'EXPENSE');

    res.json({
      cash: serialize.money(cash),
      receivable: serialize.money(receivable),
      payable: serialize.money(payable),
      monthIncome: serialize.money(monthIncome),
      monthExpense: serialize.money(monthExpense),
      monthProfit: serialize.money(monthIncome - monthExpense),
      postedSalesInvoices: openSales,
      postedPurchaseInvoices: openPurchases,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
