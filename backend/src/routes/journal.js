'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireWrite } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { optionalString, requireDate, optionalDate, requireArray } = require('../lib/validate');
const { createEntry, assertPeriodOpen } = require('../services/ledger');
const serialize = require('../lib/serialize');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.offset) || 0, 0);

    const where = {};
    const from = optionalDate(req.query.from, 'من تاريخ');
    const to = optionalDate(req.query.to, 'إلى تاريخ');
    if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.accountId) where.lines = { some: { accountId: String(req.query.accountId) } };
    if (req.query.q) where.memo = { contains: String(req.query.q) };

    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        take,
        skip,
        include: {
          createdBy: { select: { id: true, name: true } },
          lines: { include: { account: true, party: true } },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({ entries: rows.map(serialize.journalEntry), total, limit: take, offset: skip });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        lines: { include: { account: true, party: true } },
      },
    });
    if (!row) throw notFound('القيد غير موجود');
    res.json({ entry: serialize.journalEntry(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const date = requireDate(req.body?.date, 'التاريخ');
    const memo = optionalString(req.body?.memo, 'البيان', { max: 500 });
    const lines = requireArray(req.body?.lines, 'سطور القيد', { min: 2 });

    const entry = await prisma.$transaction((tx) =>
      createEntry(tx, { date, memo, source: 'MANUAL', userId: req.user.id, lines }),
    );

    const full = await prisma.journalEntry.findUnique({
      where: { id: entry.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        lines: { include: { account: true, party: true } },
      },
    });
    res.status(201).json({ entry: serialize.journalEntry(full) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('القيد غير موجود');
    if (current.source !== 'MANUAL') {
      throw badRequest('هذا القيد مولَّد من مستند — ألغِ المستند نفسه');
    }

    await prisma.$transaction(async (tx) => {
      await assertPeriodOpen(tx, current.date);
      await tx.journalEntry.delete({ where: { id: current.id } });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
