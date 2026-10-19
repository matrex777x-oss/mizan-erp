'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { badRequest } = require('../lib/errors');
const { requireString, optionalDate } = require('../lib/validate');
const { toRate } = require('../lib/money');
const serialize = require('../lib/serialize');

const router = express.Router();

const DEFAULTS = { id: 1 };

async function load() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: DEFAULTS });
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
    await load();
    const data = {};

    if (req.body?.companyName !== undefined) {
      data.companyName = requireString(req.body.companyName, 'اسم المنشأة', { max: 150 });
    }
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

    const row = await prisma.settings.update({ where: { id: 1 }, data });
    res.json({ settings: serialize.settings(row) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
