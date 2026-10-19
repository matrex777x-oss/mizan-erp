'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { badRequest } = require('../lib/errors');
const { requireString, optionalString, optionalDate } = require('../lib/validate');
const { toRate } = require('../lib/money');
const serialize = require('../lib/serialize');

const router = express.Router();

const DEFAULTS = { id: 1 };

async function load() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: DEFAULTS });
}

// بادئة الترقيم: لاتيني وأرقام وشرطة، قصيرة لتبقى أرقام المستندات مقروءة
const PREFIX_RE = /^[A-Za-z0-9-]{1,8}$/;

function requirePrefix(value, field) {
  const prefix = requireString(value, field, { max: 8 }).toUpperCase();
  if (!PREFIX_RE.test(prefix)) {
    throw badRequest(`«${field}» يجب أن تكون أحرفاً لاتينية وأرقاماً وشرطات، حتى 8 خانات`);
  }
  return prefix;
}

router.get('/', requireCapability('settings.read'), async (_req, res, next) => {
  try {
    res.json({ settings: serialize.settings(await load()) });
  } catch (err) {
    next(err);
  }
});

router.patch('/', requireCapability('settings.write'), async (req, res, next) => {
  try {
    const current = await load();
    const data = {};

    // ───── بيانات المنشأة ─────
    if (req.body?.companyName !== undefined) {
      data.companyName = requireString(req.body.companyName, 'اسم المنشأة', { max: 150 });
    }
    if (req.body?.taxNumber !== undefined) {
      data.taxNumber = optionalString(req.body.taxNumber, 'الرقم الضريبي', { max: 40 });
    }
    if (req.body?.address !== undefined) {
      data.address = optionalString(req.body.address, 'العنوان', { max: 300 });
    }
    if (req.body?.phone !== undefined) {
      data.phone = optionalString(req.body.phone, 'الهاتف', { max: 40 });
    }
    if (req.body?.email !== undefined) {
      data.email = optionalString(req.body.email, 'البريد الإلكتروني', { max: 150 });
    }

    // ───── العملة والسياسات ─────
    if (req.body?.currencyCode !== undefined) {
      data.currencyCode = requireString(req.body.currencyCode, 'رمز العملة', { max: 10 });
    }
    if (req.body?.currencySymbol !== undefined) {
      data.currencySymbol = requireString(req.body.currencySymbol, 'رمز العرض', { max: 10 });
    }
    if (req.body?.fiscalYearStart !== undefined) {
      const month = Number(req.body.fiscalYearStart);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw badRequest('شهر بداية السنة المالية يجب أن يكون بين 1 و 12');
      }
      data.fiscalYearStart = month;
    }
    if (req.body?.defaultTaxRate !== undefined) {
      const rate = toRate(req.body.defaultTaxRate);
      if (rate < 0 || rate > 10000) throw badRequest('نسبة الضريبة غير منطقية');
      data.defaultTaxRate = rate;
    }
    if (req.body?.lockDate !== undefined) {
      data.lockDate = optionalDate(req.body.lockDate, 'تاريخ الإقفال');
    }

    // ───── ترقيم المستندات ─────
    const prefixFields = [
      ['prefixSales', 'بادئة فواتير المبيعات'],
      ['prefixPurchase', 'بادئة فواتير المشتريات'],
      ['prefixReceipt', 'بادئة سندات القبض'],
      ['prefixPayment', 'بادئة سندات الصرف'],
      ['prefixAdjustment', 'بادئة تسويات المخزون'],
    ];
    for (const [field, label] of prefixFields) {
      if (req.body?.[field] !== undefined) data[field] = requirePrefix(req.body[field], label);
    }

    // بادئتان متطابقتان تخلطان تسلسلين في جذع واحد، فيتكرّر الرقم بين نوعين
    const nextPrefixes = prefixFields.map(([field]) => data[field] ?? current[field]);
    if (new Set(nextPrefixes).size !== nextPrefixes.length) {
      throw badRequest('لا يصح تكرار البادئة بين نوعين من المستندات');
    }

    if (req.body?.numberIncludeYear !== undefined) {
      data.numberIncludeYear = Boolean(req.body.numberIncludeYear);
    }
    if (req.body?.numberPadding !== undefined) {
      const padding = Number(req.body.numberPadding);
      if (!Number.isInteger(padding) || padding < 1 || padding > 10) {
        throw badRequest('عدد خانات الترقيم يجب أن يكون بين 1 و 10');
      }
      data.numberPadding = padding;
    }

    // ───── الوحدات ─────
    if (req.body?.inventoryEnabled !== undefined) {
      const enabled = Boolean(req.body.inventoryEnabled);

      // لا تُعطَّل وحدة فيها حركة: الأرصدة والتكاليف في الدفتر، وإخفاؤها يجعل
      // المركز المالي يعرض مخزوناً لا شاشة له
      if (!enabled && current.inventoryEnabled) {
        const moves = await prisma.stockMove.count();
        if (moves > 0) {
          throw badRequest(
            `لا يمكن تعطيل وحدة المخزون بعد ${moves} حركة مخزون مسجَّلة — بياناتها في الدفتر`,
          );
        }
      }
      data.inventoryEnabled = enabled;
    }

    const row = await prisma.settings.update({ where: { id: 1 }, data });
    res.json({ settings: serialize.settings(row) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
