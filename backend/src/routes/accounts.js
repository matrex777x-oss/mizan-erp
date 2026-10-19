'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { requireString, optionalString, requireEnum } = require('../lib/validate');
const { ACCOUNT_TYPES } = require('../lib/constants');
const serialize = require('../lib/serialize');

const router = express.Router();

/** قائمة الحسابات مرتبة بالرمز، مع شكل شجري اختياري. */
router.get('/', requireCapability('accounts.read'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.type) where.type = requireEnum(req.query.type, ACCOUNT_TYPES, 'النوع');
    if (req.query.active === 'true') where.active = true;
    if (req.query.postable === 'true') where.isGroup = false;
    if (req.query.q) where.OR = [{ name: { contains: req.query.q } }, { code: { contains: req.query.q } }];

    const rows = await prisma.account.findMany({ where, orderBy: { code: 'asc' } });
    const accounts = rows.map(serialize.account);

    if (req.query.tree !== 'true') return res.json({ accounts });

    const byId = new Map(accounts.map((a) => [a.id, { ...a, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    res.json({ accounts: roots });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireCapability('accounts.read'), async (req, res, next) => {
  try {
    const row = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('الحساب غير موجود');
    res.json({ account: serialize.account(row) });
  } catch (err) {
    next(err);
  }
});

/** يمنع جعل حساب ابناً لنفسه أو لأحد أبنائه. */
async function assertNoCycle(accountId, parentId) {
  let cursor = parentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === accountId) throw badRequest('لا يمكن جعل الحساب تابعاً لنفسه أو لأحد فروعه');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = await prisma.account.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = parent?.parentId || null;
  }
}

router.post('/', requireCapability('accounts.write'), async (req, res, next) => {
  try {
    const code = requireString(req.body?.code, 'الرمز', { max: 20 });
    const name = requireString(req.body?.name, 'الاسم');
    const type = requireEnum(req.body?.type, ACCOUNT_TYPES, 'النوع');
    const isGroup = Boolean(req.body?.isGroup);
    const parentId = optionalString(req.body?.parentId, 'الحساب الأب', { max: 40 });

    if (parentId) {
      const parent = await prisma.account.findUnique({ where: { id: parentId } });
      if (!parent) throw notFound('الحساب الأب غير موجود');
      if (!parent.isGroup) throw badRequest('الحساب الأب يجب أن يكون حساباً تجميعياً');
      if (parent.type !== type) throw badRequest('نوع الحساب يجب أن يطابق نوع الحساب الأب');
    }

    const row = await prisma.account.create({ data: { code, name, type, isGroup, parentId } });
    res.status(201).json({ account: serialize.account(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireCapability('accounts.write'), async (req, res, next) => {
  try {
    const current = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الحساب غير موجود');

    const data = {};
    if (req.body?.code !== undefined) data.code = requireString(req.body.code, 'الرمز', { max: 20 });
    if (req.body?.name !== undefined) data.name = requireString(req.body.name, 'الاسم');
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);

    if (req.body?.type !== undefined && req.body.type !== current.type) {
      if (current.systemKey) throw badRequest('لا يمكن تغيير نوع حساب نظامي');
      const used = await prisma.journalLine.count({ where: { accountId: current.id } });
      if (used) throw badRequest('لا يمكن تغيير نوع حساب عليه قيود');
      data.type = requireEnum(req.body.type, ACCOUNT_TYPES, 'النوع');
    }

    if (req.body?.parentId !== undefined) {
      const parentId = optionalString(req.body.parentId, 'الحساب الأب', { max: 40 });
      if (parentId) {
        await assertNoCycle(current.id, parentId);
        const parent = await prisma.account.findUnique({ where: { id: parentId } });
        if (!parent) throw notFound('الحساب الأب غير موجود');
        if (!parent.isGroup) throw badRequest('الحساب الأب يجب أن يكون حساباً تجميعياً');
        if (parent.type !== (data.type || current.type)) throw badRequest('نوع الحساب يجب أن يطابق نوع الحساب الأب');
      }
      data.parentId = parentId;
    }

    if (req.body?.isGroup !== undefined && Boolean(req.body.isGroup) !== current.isGroup) {
      const used = await prisma.journalLine.count({ where: { accountId: current.id } });
      if (used) throw badRequest('لا يمكن تحويل حساب عليه قيود إلى حساب تجميعي');
      data.isGroup = Boolean(req.body.isGroup);
    }

    const row = await prisma.account.update({ where: { id: current.id }, data });
    res.json({ account: serialize.account(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireCapability('accounts.write'), async (req, res, next) => {
  try {
    const current = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الحساب غير موجود');
    if (current.systemKey) throw badRequest('لا يمكن حذف حساب نظامي');

    const [lines, children] = await Promise.all([
      prisma.journalLine.count({ where: { accountId: current.id } }),
      prisma.account.count({ where: { parentId: current.id } }),
    ]);
    if (lines) throw badRequest('لا يمكن حذف حساب عليه قيود — عطّله بدلاً من ذلك');
    if (children) throw badRequest('لا يمكن حذف حساب له حسابات فرعية');

    await prisma.account.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
