'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const systemDb = require('../lib/systemDb');
const password = require('../lib/password');
const { signToken, authenticate, requirePasswordChanged } = require('../lib/auth');
const { audit, AUDIT_ACTIONS } = require('../lib/audit');
const { unauthorized, badRequest, forbidden } = require('../lib/errors');
const { requireString } = require('../lib/validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول بعد قليل' },
});

/** المنشآت التي يصل إليها المستخدم، بدوره في كل منها. */
async function businessesOf(userId) {
  const memberships = await systemDb.membership.findMany({
    where: { userId, business: { active: true } },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => ({
    id: m.business.id,
    name: m.business.name,
    role: m.role,
  }));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
  };
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = requireString(req.body?.email, 'البريد الإلكتروني').toLowerCase();
    const plain = requireString(req.body?.password, 'كلمة المرور', { max: 200 });

    const user = await systemDb.user.findUnique({ where: { email } });
    // نقارن دائماً، حتى على بريد غير موجود، فلا يُستدل على الحسابات من زمن الرد
    const ok = await password.compare(plain, user ? user.password : password.DUMMY_HASH);

    if (!user || !ok || !user.active) {
      await audit({
        req,
        actor: { id: user?.id ?? null, name: email },
        businessId: null,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        detail: user ? (user.active ? 'كلمة مرور خاطئة' : 'حساب موقوف') : 'بريد غير مسجّل',
      });
      throw unauthorized('بيانات الدخول غير صحيحة');
    }

    const businesses = await businessesOf(user.id);
    // منشأة واحدة: ندخلها مباشرة. أكثر من واحدة: يختار المستخدم بنفسه.
    const businessId = businesses.length === 1 ? businesses[0].id : null;

    await systemDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ req, actor: user, businessId, action: AUDIT_ACTIONS.LOGIN });

    res.json({
      token: signToken(user, businessId),
      user: publicUser(user),
      businesses,
      businessId,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const businesses = await businessesOf(req.user.id);
    const current = businesses.find((b) => b.id === req.businessId) || null;

    res.json({
      user: req.user,
      businesses,
      businessId: current ? current.id : null,
      role: current ? current.role : null,
    });
  } catch (err) {
    next(err);
  }
});

/** تبديل المنشأة: رمز جديد يحمل المنشأة المختارة. */
router.post('/select-business', authenticate, requirePasswordChanged, async (req, res, next) => {
  try {
    const businessId = requireString(req.body?.businessId, 'المنشأة');

    const membership = await systemDb.membership.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId } },
      include: { business: true },
    });
    if (!membership) throw forbidden('لا تملك وصولاً إلى هذه المنشأة');
    if (!membership.business.active) throw forbidden('هذه المنشأة موقوفة');

    res.json({
      token: signToken(req.user, businessId),
      businessId,
      role: membership.role,
      business: { id: membership.business.id, name: membership.business.name },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * تغيير كلمة المرور للمستخدم نفسه.
 * متاح حتى لمن أُلزم بالتغيير — وهو الطريق الوحيد المفتوح له.
 */
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const current = requireString(req.body?.currentPassword, 'كلمة المرور الحالية', { max: 200 });
    const next_ = password.requireStrong(req.body?.newPassword, 'كلمة المرور الجديدة');

    const user = await systemDb.user.findUnique({ where: { id: req.user.id } });
    if (!(await password.compare(current, user.password))) {
      throw badRequest('كلمة المرور الحالية غير صحيحة');
    }
    if (await password.compare(next_, user.password)) {
      throw badRequest('كلمة المرور الجديدة مطابقة للحالية');
    }

    const updated = await systemDb.user.update({
      where: { id: user.id },
      data: { password: await password.hash(next_), mustChangePassword: false },
    });

    await audit({ req, action: AUDIT_ACTIONS.PASSWORD_CHANGE, target: user.id });

    // رمز جديد: القديم صدر قبل رفع إلزام التغيير
    res.json({ token: signToken(updated, req.businessId), user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
