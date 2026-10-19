'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { requireDate } = require('../lib/validate');
const serialize = require('../lib/serialize');
const {
  closableYears,
  closeFiscalYear,
  reopenFiscalYear,
  fiscalYearOf,
  fiscalYearLabel,
} = require('../services/closing');

const router = express.Router();

function publicClose(row) {
  return {
    id: row.id,
    label: fiscalYearLabel({ start: row.startDate, end: row.endDate }),
    startDate: serialize.day(row.startDate),
    endDate: serialize.day(row.endDate),
    netResult: serialize.money(row.netResult),
    entryId: row.entryId,
    entryNumber: row.entry?.number ?? null,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  };
}

/** السنوات المقفلة، والسنوات التي يمكن إقفالها الآن. */
router.get('/', requireCapability('closing.read'), async (_req, res, next) => {
  try {
    const [closes, settings] = await Promise.all([
      prisma.fiscalClose.findMany({
        include: { entry: { select: { number: true } } },
        orderBy: { endDate: 'desc' },
      }),
      prisma.settings.findUnique({ where: { id: 1 } }),
    ]);

    const closable = await closableYears(prisma);

    res.json({
      fiscalYearStart: settings?.fiscalYearStart || 1,
      lockDate: serialize.day(settings?.lockDate),
      closes: closes.map(publicClose),
      closable: closable.map((year) => ({
        label: year.label,
        startDate: serialize.day(year.start),
        endDate: serialize.day(year.end),
        income: serialize.money(year.income),
        expense: serialize.money(year.expense),
        netResult: serialize.money(year.netResult),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** معاينة قبل التنفيذ: ما الذي سيُصفَّر وكم سيُرحَّل. */
router.get('/preview', requireCapability('closing.read'), async (req, res, next) => {
  try {
    const end = requireDate(req.query.end, 'نهاية السنة المالية');
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const bounds = fiscalYearOf(end, settings?.fiscalYearStart || 1);

    const { resultBalances } = require('../services/closing');
    const { lines, income, expense } = await resultBalances(prisma, bounds);

    const accounts = await prisma.account.findMany({
      where: { id: { in: lines.map((l) => l.accountId) } },
      select: { id: true, code: true, name: true, type: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    res.json({
      label: fiscalYearLabel(bounds),
      startDate: serialize.day(bounds.start),
      endDate: serialize.day(bounds.end),
      income: serialize.money(income),
      expense: serialize.money(expense),
      netResult: serialize.money(income - expense),
      lines: lines.map((line) => ({
        accountId: line.accountId,
        code: byId.get(line.accountId)?.code,
        name: byId.get(line.accountId)?.name,
        type: byId.get(line.accountId)?.type,
        amount: serialize.money(line.debit ?? line.credit ?? 0n),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireCapability('closing.manage'), async (req, res, next) => {
  try {
    const end = requireDate(req.body?.end, 'نهاية السنة المالية');

    const result = await prisma.$transaction(async (tx) => closeFiscalYear(tx, { end, actor: req.user }));

    const row = await prisma.fiscalClose.findUnique({
      where: { id: result.close.id },
      include: { entry: { select: { number: true } } },
    });

    res.status(201).json({ close: publicClose(row), label: result.label });
  } catch (err) {
    next(err);
  }
});

/** إعادة الفتح: تحذف قيد الإقفال وتعيد تاريخ القفل إلى الإقفال السابق. */
router.delete('/:endDate', requireCapability('closing.manage'), async (req, res, next) => {
  try {
    const endDate = requireDate(req.params.endDate, 'نهاية السنة المالية');
    await prisma.$transaction(async (tx) => reopenFiscalYear(tx, { endDate }));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
