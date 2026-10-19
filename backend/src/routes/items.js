'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireWrite } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { requireString, optionalString, requireEnum } = require('../lib/validate');
const { ITEM_KINDS, SYSTEM_ACCOUNTS } = require('../lib/constants');
const { toMinor, toQuantity, toRate } = require('../lib/money');
const serialize = require('../lib/serialize');

const router = express.Router();

/** يتحقق أن الحساب موجود، غير تجميعي، ومن النوع المطلوب. */
async function pickAccount(id, field, types) {
  if (!id) return null;
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) throw notFound(`${field}: الحساب غير موجود`);
  if (account.isGroup) throw badRequest(`${field}: لا يصلح حساب تجميعي`);
  if (!types.includes(account.type)) throw badRequest(`${field}: نوع الحساب غير مناسب`);
  return account.id;
}

async function nextItemCode() {
  const last = await prisma.item.findFirst({
    where: { code: { startsWith: 'IT-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const seq = last ? Number.parseInt(last.code.slice(3), 10) : 0;
  return `IT-${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(4, '0')}`;
}

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.kind) where.kind = requireEnum(req.query.kind, ITEM_KINDS, 'النوع');
    if (req.query.active === 'true') where.active = true;
    if (req.query.q) {
      where.OR = [{ name: { contains: req.query.q } }, { code: { contains: req.query.q } }];
    }

    const rows = await prisma.item.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ items: rows.map(serialize.item) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.item.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('الصنف غير موجود');
    res.json({ item: serialize.item(row) });
  } catch (err) {
    next(err);
  }
});

/** يقرأ حقول البطاقة المشتركة بين الإنشاء والتعديل. */
async function readPayload(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body?.kind !== undefined) {
    data.kind = requireEnum(body?.kind, ITEM_KINDS, 'النوع');
  }
  if (!partial || body?.name !== undefined) data.name = requireString(body?.name, 'الاسم');
  if (!partial || body?.unit !== undefined) data.unit = requireString(body?.unit ?? 'حبة', 'الوحدة', { max: 20 });
  if (body?.code !== undefined) data.code = requireString(body.code, 'الرمز', { max: 20 });

  if (!partial || body?.salePrice !== undefined) data.salePrice = toMinor(body?.salePrice ?? 0);
  if (!partial || body?.purchasePrice !== undefined) data.purchasePrice = toMinor(body?.purchasePrice ?? 0);
  if (!partial || body?.taxRate !== undefined) data.taxRate = toRate(body?.taxRate ?? 0);
  if (body?.reorderLevel !== undefined) data.reorderLevel = toQuantity(body.reorderLevel);
  if (body?.notes !== undefined) data.notes = optionalString(body.notes, 'ملاحظات', { max: 1000 });
  if (body?.active !== undefined) data.active = Boolean(body.active);

  if (data.salePrice !== undefined && data.salePrice < 0n) throw badRequest('سعر البيع لا يكون سالباً');
  if (data.purchasePrice !== undefined && data.purchasePrice < 0n) throw badRequest('سعر الشراء لا يكون سالباً');

  if (!partial || body?.salesAccountId !== undefined) {
    data.salesAccountId = await pickAccount(
      requireString(body?.salesAccountId, 'حساب الإيراد', { max: 40 }),
      'حساب الإيراد',
      ['INCOME'],
    );
  }
  if (body?.expenseAccountId !== undefined) {
    data.expenseAccountId = await pickAccount(body.expenseAccountId || null, 'حساب المصروف', ['EXPENSE', 'ASSET']);
  }
  if (body?.inventoryAccountId !== undefined) {
    data.inventoryAccountId = await pickAccount(body.inventoryAccountId || null, 'حساب المخزون', ['ASSET']);
  }
  if (body?.cogsAccountId !== undefined) {
    data.cogsAccountId = await pickAccount(body.cogsAccountId || null, 'حساب تكلفة المبيعات', ['EXPENSE']);
  }

  return data;
}

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const data = await readPayload(req.body);
    if (data.kind === 'SERVICE' && !data.expenseAccountId) {
      // الخدمة بلا حساب مصروف لا يمكن شراؤها، لكن بيعها جائز — ننبّه فقط عند الشراء
      data.expenseAccountId = null;
    }
    data.code = data.code || (await nextItemCode());

    const row = await prisma.item.create({ data });
    res.status(201).json({ item: serialize.item(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.item.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الصنف غير موجود');

    const data = await readPayload(req.body, { partial: true });

    if (data.kind && data.kind !== current.kind) {
      const moves = await prisma.stockMove.count({ where: { itemId: current.id } });
      if (moves) throw badRequest('لا يمكن تغيير نوع صنف له حركة مخزون');
    }

    const row = await prisma.item.update({ where: { id: current.id }, data });
    res.json({ item: serialize.item(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const current = await prisma.item.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('الصنف غير موجود');

    const [moves, lines, adjustments] = await Promise.all([
      prisma.stockMove.count({ where: { itemId: current.id } }),
      prisma.invoiceLine.count({ where: { itemId: current.id } }),
      prisma.stockAdjustmentLine.count({ where: { itemId: current.id } }),
    ]);
    if (moves || lines || adjustments) {
      throw badRequest('لا يمكن حذف صنف له حركات — عطّله بدلاً من ذلك');
    }

    await prisma.item.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** الحسابات الافتراضية المقترحة عند إنشاء صنف جديد. */
router.get('/meta/defaults', async (_req, res, next) => {
  try {
    const keys = [SYSTEM_ACCOUNTS.INVENTORY, SYSTEM_ACCOUNTS.COGS];
    const accounts = await prisma.account.findMany({ where: { systemKey: { in: keys } } });
    const bySystemKey = Object.fromEntries(accounts.map((a) => [a.systemKey, serialize.account(a)]));
    res.json({ defaults: bySystemKey });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
