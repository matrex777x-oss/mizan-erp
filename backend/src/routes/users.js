'use strict';

const express = require('express');

const systemDb = require('../lib/systemDb');
const password = require('../lib/password');
const { ROLES } = require('../lib/constants');
const { audit, AUDIT_ACTIONS } = require('../lib/audit');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { requireString, requireEnum } = require('../lib/validate');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEmail(value) {
  const email = requireString(value, 'البريد الإلكتروني', { max: 150 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest('البريد الإلكتروني غير صالح');
  return email;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    access: (user.memberships || []).map((m) => ({
      businessId: m.businessId,
      businessName: m.business?.name,
      role: m.role,
    })),
  };
}

const withAccess = { memberships: { include: { business: true } } };

router.get('/', async (_req, res, next) => {
  try {
    const users = await systemDb.user.findMany({
      include: withAccess,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users: users.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

/**
 * إنشاء مستخدم. الآدمن لا يرى كلمة المرور بعد هذه اللحظة أبداً:
 * تُعرض مرة واحدة في الرد ليسلّمها لصاحبها، ويُلزَم هو بتغييرها عند أول دخول.
 */
router.post('/', async (req, res, next) => {
  try {
    const email = requireEmail(req.body?.email);
    const name = requireString(req.body?.name, 'الاسم', { max: 100 });
    const isAdmin = Boolean(req.body?.isAdmin);

    // كلمة مرور مؤقتة مولَّدة، أو واحدة يحدّدها الآدمن إن أراد
    const plain = req.body?.password ? password.requireStrong(req.body.password) : password.temporary();

    const exists = await systemDb.user.findUnique({ where: { email } });
    if (exists) throw conflict('البريد الإلكتروني مستخدم من قبل');

    const user = await systemDb.user.create({
      data: {
        email,
        name,
        isAdmin,
        password: await password.hash(plain),
        mustChangePassword: true,
      },
      include: withAccess,
    });

    await audit({
      req,
      businessId: null,
      action: AUDIT_ACTIONS.USER_CREATE,
      target: user.id,
      detail: `${email}${isAdmin ? ' (آدمن نظام)' : ''}`,
    });

    res.status(201).json({ user: publicUser(user), temporaryPassword: plain });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const user = await systemDb.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('المستخدم غير موجود');

    const data = {};
    if (req.body?.name !== undefined) data.name = requireString(req.body.name, 'الاسم', { max: 100 });
    if (req.body?.email !== undefined) data.email = requireEmail(req.body.email);
    if (req.body?.isAdmin !== undefined) data.isAdmin = Boolean(req.body.isAdmin);
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);

    // لا يُسقط الآدمن صفة الإدارة عن نفسه ولا يوقف حسابه، فلا يبقى النظام بلا آدمن
    if (user.id === req.user.id) {
      if (data.isAdmin === false) throw badRequest('لا يمكنك إسقاط صفة الإدارة عن نفسك');
      if (data.active === false) throw badRequest('لا يمكنك إيقاف حسابك');
    }

    if (data.isAdmin === false || data.active === false) {
      const otherAdmins = await systemDb.user.count({
        where: { isAdmin: true, active: true, id: { not: user.id } },
      });
      if (otherAdmins === 0 && user.isAdmin) {
        throw badRequest('هذا آدمن النظام الوحيد — عيّن آدمن غيره أولاً');
      }
    }

    const updated = await systemDb.user.update({
      where: { id: user.id },
      data,
      include: withAccess,
    });

    await audit({
      req,
      businessId: null,
      action: data.active === false ? AUDIT_ACTIONS.USER_DEACTIVATE : AUDIT_ACTIONS.USER_UPDATE,
      target: user.id,
      detail: Object.keys(data).join('، ') || null,
    });

    res.json({ user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

/**
 * إعادة تعيين كلمة المرور.
 * لا عرض لكلمة المرور القديمة — bcrypt تجزئة لا تُفك. تُولَّد كلمة مؤقتة
 * تُعرض مرة واحدة، ويُلزَم صاحبها بتغييرها عند أول دخول.
 */
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const user = await systemDb.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('المستخدم غير موجود');

    const plain = req.body?.password ? password.requireStrong(req.body.password) : password.temporary();

    await systemDb.user.update({
      where: { id: user.id },
      data: { password: await password.hash(plain), mustChangePassword: true },
    });

    await audit({
      req,
      businessId: null,
      action: AUDIT_ACTIONS.PASSWORD_RESET,
      target: user.id,
      detail: user.email,
    });

    res.json({ temporaryPassword: plain, mustChangePassword: true });
  } catch (err) {
    next(err);
  }
});

/** منح وصول إلى منشأة بدور، أو تغيير الدور. */
router.put('/:id/access/:businessId', async (req, res, next) => {
  try {
    const role = requireEnum(req.body?.role, ROLES, 'الدور');

    const user = await systemDb.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('المستخدم غير موجود');

    const business = await systemDb.business.findUnique({ where: { id: req.params.businessId } });
    if (!business) throw notFound('المنشأة غير موجودة');

    const membership = await systemDb.membership.upsert({
      where: { userId_businessId: { userId: user.id, businessId: business.id } },
      update: { role },
      create: { userId: user.id, businessId: business.id, role },
    });

    await audit({
      req,
      businessId: business.id,
      action: AUDIT_ACTIONS.ACCESS_GRANT,
      target: user.id,
      detail: `${business.name}: ${role}`,
    });

    res.json({ access: { businessId: business.id, businessName: business.name, role: membership.role } });
  } catch (err) {
    next(err);
  }
});

/** سحب الوصول من منشأة. */
router.delete('/:id/access/:businessId', async (req, res, next) => {
  try {
    const { id, businessId } = req.params;

    const membership = await systemDb.membership.findUnique({
      where: { userId_businessId: { userId: id, businessId } },
      include: { business: true },
    });
    if (!membership) throw notFound('لا وصول مسجّل لهذه المنشأة');

    // لا تُترك منشأة بلا مالك: يبقى من يستطيع إدارة حساباتها
    if (membership.role === 'OWNER') {
      const otherOwners = await systemDb.membership.count({
        where: { businessId, role: 'OWNER', userId: { not: id } },
      });
      if (otherOwners === 0) throw badRequest('هذا مالك المنشأة الوحيد — عيّن مالكاً غيره أولاً');
    }

    await systemDb.membership.delete({
      where: { userId_businessId: { userId: id, businessId } },
    });

    await audit({
      req,
      businessId,
      action: AUDIT_ACTIONS.ACCESS_REVOKE,
      target: id,
      detail: membership.business.name,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** سجل التدقيق — من فعل ماذا ومتى. */
router.get('/audit/log', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 100, 500);
    const skip = Number(req.query.offset) || 0;

    const [rows, total] = await Promise.all([
      systemDb.auditLog.findMany({
        include: { business: { select: { name: true } } },
        orderBy: { at: 'desc' },
        take,
        skip,
      }),
      systemDb.auditLog.count(),
    ]);

    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        at: row.at,
        userName: row.userName,
        businessName: row.business?.name ?? null,
        action: row.action,
        target: row.target,
        detail: row.detail,
        ip: row.ip,
      })),
      total,
      limit: take,
      offset: skip,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ملاحظة: لا مسار لعرض كلمة مرور — عرضها مستحيل تقنياً، انظر lib/password.js.
