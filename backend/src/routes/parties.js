'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireWrite } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { requireString, optionalString, requireEnum } = require('../lib/validate');
const { PARTY_KINDS, SYSTEM_ACCOUNTS } = require('../lib/constants');
const serialize = require('../lib/serialize');

const router = express.Router();

/** رصيد الطرف = مدين − دائن على حسابي الذمم. */
async function balancesFor(partyIds) {
  if (!partyIds.length) return new Map();
  const controls = await prisma.account.findMany({
    where: { systemKey: { in: [SYSTEM_ACCOUNTS.RECEIVABLE, SYSTEM_ACCOUNTS.PAYABLE] } },
    select: { id: true },
  });
  const grouped = await prisma.journalLine.groupBy({
    by: ['partyId'],
    where: { partyId: { in: partyIds }, accountId: { in: controls.map((c) => c.id) } },
    _sum: { debit: true, credit: true },
  });
  return new Map(
    grouped.map((g) => [g.partyId, (g._sum.debit ?? 0n) - (g._sum.credit ?? 0n)]),
  );
}

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.kind) {
      const kind = requireEnum(req.query.kind, PARTY_KINDS, 'النوع');
      where.kind = kind === 'BOTH' ? 'BOTH' : { in: [kind, 'BOTH'] };
    }
    if (req.query.active === 'true') where.active = true;
    if (req.query.q) {
      where.OR = [
        { name: { contains: req.query.q } },
        { code: { contains: req.query.q } },
        { phone: { contains: req.query.q } },
      ];
    }

    const rows = await prisma.party.findMany({ where, orderBy: { name: 'asc' } });
    const balances = await balancesFor(rows.map((r) => r.id));

    res.json({
      parties: rows.map((row) => ({
        ...serialize.party(row),
        balance: serialize.money(balances.get(row.id) ?? 0n),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('الطرف غير موجود');
    const balances = await balancesFor([row.id]);
    res.json({ party: { ...serialize.party(row), balance: serialize.money(balances.get(row.id) ?? 0n) } });
  } catch (err) {
    next(err);
  }
});

/** رمز تلقائي: C-0001 للعملاء و S-0001 للموردين. */
async function nextPartyCode(kind) {
  const prefix = kind === 'SUPPLIER' ? 'S-' : 'C-';
  const last = await prisma.party.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const seq = last ? Number.parseInt(last.code.slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(4, '0')}`;
}

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const kind = requireEnum(req.body?.kind, PARTY_KINDS, 'النوع');
    const data = {
      kind,
      name: requireString(req.body?.name, 'الاسم'),
      code: optionalString(req.body?.code, 'الرمز', { max: 20 }) || (await nextPartyCode(kind)),
      phone: optionalString(req.body?.phone, 'الهاتف', { max: 40 }),
      email: optionalString(req.body?.email, 'البريد'),
      address: optionalString(req.body?.address, 'العنوان', { max: 500 }),
      taxNumber: optionalString(req.body?.taxNumber, 'الرقم الضريبي', { max: 50 }),
      notes: optionalString(req.body?.notes, 'ملاحظات', { max: 1000 }),
    };

    const row = await prisma.party.create({ data });
    res.status(201).json({ party: { ...serialize.party(row), balance: '0.00' } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الطرف غير موجود');

    const data = {};
    if (req.body?.kind !== undefined) data.kind = requireEnum(req.body.kind, PARTY_KINDS, 'النوع');
    if (req.body?.name !== undefined) data.name = requireString(req.body.name, 'الاسم');
    if (req.body?.code !== undefined) data.code = requireString(req.body.code, 'الرمز', { max: 20 });
    if (req.body?.phone !== undefined) data.phone = optionalString(req.body.phone, 'الهاتف', { max: 40 });
    if (req.body?.email !== undefined) data.email = optionalString(req.body.email, 'البريد');
    if (req.body?.address !== undefined) data.address = optionalString(req.body.address, 'العنوان', { max: 500 });
    if (req.body?.taxNumber !== undefined) data.taxNumber = optionalString(req.body.taxNumber, 'الرقم الضريبي', { max: 50 });
    if (req.body?.notes !== undefined) data.notes = optionalString(req.body.notes, 'ملاحظات', { max: 1000 });
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);

    const row = await prisma.party.update({ where: { id: current.id }, data });
    const balances = await balancesFor([row.id]);
    res.json({ party: { ...serialize.party(row), balance: serialize.money(balances.get(row.id) ?? 0n) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الطرف غير موجود');

    const [invoices, payments, lines] = await Promise.all([
      prisma.invoice.count({ where: { partyId: current.id } }),
      prisma.payment.count({ where: { partyId: current.id } }),
      prisma.journalLine.count({ where: { partyId: current.id } }),
    ]);
    if (invoices || payments || lines) {
      throw badRequest('لا يمكن حذف طرف له حركات — عطّله بدلاً من ذلك');
    }

    await prisma.party.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
