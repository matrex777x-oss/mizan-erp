'use strict';

const express = require('express');

const systemDb = require('../lib/systemDb');
const businessDb = require('../lib/businessDb');
const { ROLES } = require('../lib/constants');
const { audit, AUDIT_ACTIONS } = require('../lib/audit');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { requireString, requireEnum } = require('../lib/validate');

const router = express.Router();

// اسم ملف القاعدة: لاتيني صغير وأرقام وشرطات، ليبقى صالحاً على كل نظام ملفات
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

function publicBusiness(business) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    active: business.active,
    createdAt: business.createdAt,
    users: (business.memberships || []).map((m) => ({
      userId: m.userId,
      name: m.user?.name,
      email: m.user?.email,
      role: m.role,
    })),
  };
}

const withUsers = { memberships: { include: { user: true } } };

router.get('/', async (_req, res, next) => {
  try {
    const businesses = await systemDb.business.findMany({
      include: withUsers,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ businesses: businesses.map(publicBusiness) });
  } catch (err) {
    next(err);
  }
});

/**
 * إنشاء منشأة: صف في قاعدة النظام، وقاعدة بيانات مستقلة لها بشجرة حساباتها،
 * ومنشئها مالكها. بيانات المنشآت لا تلتقي في أي استعلام لأن كل واحدة في ملفها.
 */
router.post('/', async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'اسم المنشأة', { max: 150 });
    const slug = requireString(req.body?.slug, 'المعرّف اللاتيني', { max: 40 }).toLowerCase();

    if (!SLUG_RE.test(slug)) {
      throw badRequest('المعرّف يجب أن يكون أحرفاً لاتينية صغيرة وأرقاماً وشرطات فقط');
    }

    const exists = await systemDb.business.findUnique({ where: { slug } });
    if (exists) throw conflict('المعرّف مستخدم لمنشأة أخرى');

    // ملف قاعدة متبقٍّ من منشأة محذوفة: نرفض بدل أن نخلط بياناتها بالجديدة
    if (businessDb.businessDbExists(slug)) {
      throw conflict('يوجد ملف قاعدة بهذا المعرّف — اختر معرّفاً آخر');
    }

    const business = await systemDb.business.create({ data: { name, slug } });

    try {
      await businessDb.createBusinessDb(slug, { companyName: name });
    } catch (err) {
      // لا نترك صفاً بلا قاعدة: يظهر في القائمة ويفشل عند فتحه
      await systemDb.business.delete({ where: { id: business.id } });
      throw err;
    }

    await systemDb.membership.create({
      data: { userId: req.user.id, businessId: business.id, role: 'OWNER' },
    });

    await audit({
      req,
      businessId: business.id,
      action: AUDIT_ACTIONS.BUSINESS_CREATE,
      target: business.id,
      detail: `${name} (${slug})`,
    });

    const full = await systemDb.business.findUnique({
      where: { id: business.id },
      include: withUsers,
    });

    res.status(201).json({ business: publicBusiness(full) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const business = await systemDb.business.findUnique({ where: { id: req.params.id } });
    if (!business) throw notFound('المنشأة غير موجودة');

    const data = {};
    if (req.body?.name !== undefined) {
      data.name = requireString(req.body.name, 'اسم المنشأة', { max: 150 });
    }
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);

    // المعرّف لا يتغيّر: هو اسم ملف القاعدة
    const updated = await systemDb.business.update({
      where: { id: business.id },
      data,
      include: withUsers,
    });

    await audit({
      req,
      businessId: business.id,
      action: AUDIT_ACTIONS.BUSINESS_UPDATE,
      target: business.id,
      detail: Object.keys(data).join('، ') || null,
    });

    res.json({ business: publicBusiness(updated) });
  } catch (err) {
    next(err);
  }
});

/** منح مستخدم وصولاً إلى منشأة بدور. */
router.put('/:id/users/:userId', async (req, res, next) => {
  try {
    const role = requireEnum(req.body?.role, ROLES, 'الدور');

    const business = await systemDb.business.findUnique({ where: { id: req.params.id } });
    if (!business) throw notFound('المنشأة غير موجودة');

    const user = await systemDb.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound('المستخدم غير موجود');

    await systemDb.membership.upsert({
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

    const full = await systemDb.business.findUnique({
      where: { id: business.id },
      include: withUsers,
    });

    res.json({ business: publicBusiness(full) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
