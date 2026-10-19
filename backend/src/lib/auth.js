'use strict';

const jwt = require('jsonwebtoken');

const systemDb = require('./systemDb');
const { getBusinessDb } = require('./businessDb');
const { runWithDb } = require('./dbContext');
const { unauthorized, forbidden, badRequest } = require('./errors');
const {
  CAPABILITIES,
  INVOICE_CAPABILITY,
  PAYMENT_CAPABILITY,
  roleCan,
} = require('./capabilities');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';

/** الرمز يحمل المستخدم والمنشأة المختارة معاً، فكل طلب يعرف قاعدته. */
function signToken(user, businessId = null) {
  return jwt.sign({ sub: user.id, biz: businessId }, SECRET, { expiresIn: TOKEN_TTL });
}

/** يقرأ المستخدم من ترويسة Authorization ويضعه في req.user. */
async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch {
      throw unauthorized('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
    }

    const user = await systemDb.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw unauthorized('الحساب غير مفعّل');

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
    };
    req.businessId = payload.biz || null;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * يمنع كل شيء حتى يضع المستخدم كلمة مرور جديدة.
 * يُطبَّق بعد authenticate وقبل أي مسار يعمل على بيانات.
 */
function requirePasswordChanged(req, _res, next) {
  if (req.user?.mustChangePassword) {
    return next(forbidden('يجب تعيين كلمة مرور جديدة قبل المتابعة'));
  }
  next();
}

/**
 * يحدّد منشأة الطلب ويصل بقيّته بقاعدتها.
 *
 * من هنا وحتى نهاية الطلب يعمل `lib/prisma` على قاعدة هذه المنشأة وحدها،
 * فلا يصل أي استعلام إلى بيانات منشأة أخرى.
 */
async function withBusiness(req, _res, next) {
  try {
    if (!req.businessId) {
      throw badRequest('لم تُحدَّد المنشأة — اختر منشأة أولاً');
    }

    const membership = await systemDb.membership.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId: req.businessId } },
      include: { business: true },
    });

    // آدمن النظام ليس له وصول ضمني إلى بيانات المنشآت: يمنح نفسه عضوية صريحة
    // إن احتاج، فيبقى الوصول مسجّلاً ومرئياً في شاشة الصلاحيات.
    if (!membership) throw forbidden('لا تملك وصولاً إلى هذه المنشأة');
    if (!membership.business.active) throw forbidden('هذه المنشأة موقوفة');

    req.role = membership.role;
    req.business = {
      id: membership.business.id,
      name: membership.business.name,
      slug: membership.business.slug,
    };

    runWithDb(getBusinessDb(membership.business.slug), () => next());
  } catch (err) {
    next(err);
  }
}

/** يمنع الأدوار غير المسموح لها داخل المنشأة الجارية. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!req.role) return next(badRequest('لم تُحدَّد المنشأة'));
    if (!roles.includes(req.role)) return next(forbidden());
    next();
  };
}

/**
 * يفرض قدرة على المسار. الفحص الوحيد في النظام: ما تقوله خريطة القدرات
 * (lib/capabilities.js) هو ما يُفرض هنا، وهو نفسه ما تعرضه شاشة الأدوار.
 */
function requireCapability(capability) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!req.role) return next(badRequest('لم تُحدَّد المنشأة'));
    if (!roleCan(req.role, capability)) {
      return next(forbidden(`لا تملك صلاحية: ${CAPABILITIES[capability] || capability}`));
    }
    next();
  };
}

/**
 * فحص قدرة داخل المعالج، حين لا تُعرف إلا بعد قراءة نوع المستند:
 * فواتير المبيعات غير المشتريات، وسندات القبض غير الصرف، والنوع يأتي في
 * جسم الطلب أو من المستند المحفوظ.
 */
function assertCapability(req, capability) {
  if (!roleCan(req.role, capability)) {
    throw forbidden(`لا تملك صلاحية: ${CAPABILITIES[capability] || capability}`);
  }
}

/** يفحص قدرة نوع فاتورة (SALES/PURCHASE) بفعل معيّن. */
function assertInvoiceCapability(req, kind, action) {
  assertCapability(req, `${INVOICE_CAPABILITY[kind]}.${action}`);
}

/** يفحص قدرة نوع سند (RECEIPT/PAYMENT) بفعل معيّن. */
function assertPaymentCapability(req, kind, action) {
  assertCapability(req, `${PAYMENT_CAPABILITY[kind]}.${action}`);
}

/** إدارة المنشآت والمستخدمين — لآدمن النظام وحده. */
function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.isAdmin) return next(forbidden('هذه الصفحة لآدمن النظام وحده'));
  next();
}

module.exports = {
  signToken,
  authenticate,
  requirePasswordChanged,
  withBusiness,
  requireRole,
  requireCapability,
  assertCapability,
  assertInvoiceCapability,
  assertPaymentCapability,
  requireAdmin,
  SECRET,
};
