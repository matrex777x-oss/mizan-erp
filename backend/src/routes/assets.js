'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { requireCapability } = require('../lib/auth');
const { badRequest, notFound } = require('../lib/errors');
const { requireString, optionalString, requireDate, requireEnum } = require('../lib/validate');
const { toMinor, toRate } = require('../lib/money');
const serialize = require('../lib/serialize');
const {
  METHODS,
  accumulatedOf,
  depreciableBase,
  monthlyAmount,
  dueFor,
  runDepreciation,
  disposeAsset,
  endOfMonth,
  WITH_DEPRECIATIONS,
} = require('../services/assets');

const router = express.Router();

/** أكواد الحسابات المقترحة من شجرة الحسابات العربية الافتراضية. */
const DEFAULT_CODES = { asset: '1401', accumulated: '1409', expense: '5210' };

function publicAsset(row) {
  const accumulated = accumulatedOf(row);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    acquiredAt: serialize.day(row.acquiredAt),
    cost: serialize.money(row.cost),
    salvageValue: serialize.money(row.salvageValue),
    method: row.method,
    usefulLifeMonths: row.usefulLifeMonths,
    decliningRate: row.decliningRate,
    assetAccountId: row.assetAccountId,
    accumulatedAccountId: row.accumulatedAccountId,
    expenseAccountId: row.expenseAccountId,
    status: row.status,
    disposedAt: serialize.day(row.disposedAt),
    disposalProceeds: serialize.money(row.disposalProceeds),
    notes: row.notes,
    accumulated: serialize.money(accumulated),
    bookValue: serialize.money(row.cost - accumulated),
    monthly: serialize.money(monthlyAmount(row)),
    fullyDepreciated: accumulated >= depreciableBase(row),
    depreciations: (row.depreciations || [])
      .slice()
      .sort((a, b) => b.periodEnd - a.periodEnd)
      .map((d) => ({
        id: d.id,
        periodEnd: serialize.day(d.periodEnd),
        months: d.months,
        amount: serialize.money(d.amount),
        bookValueAfter: serialize.money(d.bookValueAfter),
        entryId: d.entryId,
      })),
  };
}

/** يقرأ حساباً بالمعرّف، أو يقترح واحداً بالكود الافتراضي. */
async function resolveAccount(id, fallbackCode, label) {
  if (id) {
    const account = await prisma.account.findUnique({ where: { id: String(id) } });
    if (!account) throw notFound(`حساب ${label} غير موجود`);
    if (account.isGroup) throw badRequest(`حساب ${label} تجميعي ولا يقبل القيود`);
    return account.id;
  }

  const fallback = await prisma.account.findUnique({ where: { code: fallbackCode } });
  if (!fallback) throw badRequest(`حدّد حساب ${label} — لا يوجد حساب ${fallbackCode} في شجرتك`);
  return fallback.id;
}

async function readPayload(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body?.name !== undefined) {
    data.name = requireString(body?.name, 'اسم الأصل', { max: 150 });
  }
  if (body?.description !== undefined) {
    data.description = optionalString(body.description, 'الوصف', { max: 300 });
  }
  if (body?.notes !== undefined) data.notes = optionalString(body.notes, 'ملاحظات', { max: 500 });

  if (!partial || body?.acquiredAt !== undefined) {
    data.acquiredAt = requireDate(body?.acquiredAt, 'تاريخ الاقتناء');
  }
  if (!partial || body?.cost !== undefined) {
    const cost = toMinor(body?.cost ?? 0);
    if (cost <= 0n) throw badRequest('تكلفة الأصل يجب أن تكون أكبر من صفر');
    data.cost = cost;
  }
  if (body?.salvageValue !== undefined) {
    const salvage = toMinor(body.salvageValue ?? 0);
    if (salvage < 0n) throw badRequest('القيمة التخريدية لا تكون سالبة');
    data.salvageValue = salvage;
  }

  if (!partial || body?.method !== undefined) {
    data.method = requireEnum(body?.method ?? 'STRAIGHT_LINE', METHODS, 'طريقة الإهلاك');
  }
  if (!partial || body?.usefulLifeMonths !== undefined) {
    const months = Number(body?.usefulLifeMonths ?? 60);
    if (!Number.isInteger(months) || months < 1 || months > 1200) {
      throw badRequest('العمر الإنتاجي بالأشهر بين 1 و 1200');
    }
    data.usefulLifeMonths = months;
  }
  if (body?.decliningRate !== undefined) {
    const rate = toRate(body.decliningRate);
    if (rate < 0 || rate > 10000) throw badRequest('نسبة القسط المتناقص غير منطقية');
    data.decliningRate = rate;
  }

  const salvage = data.salvageValue ?? 0n;
  if (data.cost !== undefined && salvage >= data.cost) {
    throw badRequest('القيمة التخريدية يجب أن تكون أقل من التكلفة');
  }

  return data;
}

async function nextCode() {
  const last = await prisma.fixedAsset.findFirst({
    where: { code: { startsWith: 'FA-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const seq = last ? Number.parseInt(last.code.slice(3), 10) : 0;
  return `FA-${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(4, '0')}`;
}

router.get('/', requireCapability('assets.read'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = requireEnum(req.query.status, ['ACTIVE', 'DISPOSED'], 'الحالة');
    if (req.query.q) {
      where.OR = [{ name: { contains: String(req.query.q) } }, { code: { contains: String(req.query.q) } }];
    }

    const rows = await prisma.fixedAsset.findMany({
      where,
      include: WITH_DEPRECIATIONS,
      orderBy: { code: 'asc' },
    });

    const assets = rows.map(publicAsset);
    const active = rows.filter((row) => row.status === 'ACTIVE');

    res.json({
      assets,
      totals: {
        cost: serialize.money(active.reduce((sum, row) => sum + row.cost, 0n)),
        accumulated: serialize.money(active.reduce((sum, row) => sum + accumulatedOf(row), 0n)),
        bookValue: serialize.money(
          active.reduce((sum, row) => sum + (row.cost - accumulatedOf(row)), 0n),
        ),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireCapability('assets.read'), async (req, res, next) => {
  try {
    const row = await prisma.fixedAsset.findUnique({
      where: { id: req.params.id },
      include: WITH_DEPRECIATIONS,
    });
    if (!row) throw notFound('الأصل غير موجود');
    res.json({ asset: publicAsset(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const data = await readPayload(req.body);

    data.code = optionalString(req.body?.code, 'كود الأصل', { max: 40 }) || (await nextCode());
    data.assetAccountId = await resolveAccount(req.body?.assetAccountId, DEFAULT_CODES.asset, 'الأصل');
    data.accumulatedAccountId = await resolveAccount(
      req.body?.accumulatedAccountId,
      DEFAULT_CODES.accumulated,
      'مجمّع الإهلاك',
    );
    data.expenseAccountId = await resolveAccount(
      req.body?.expenseAccountId,
      DEFAULT_CODES.expense,
      'مصروف الإهلاك',
    );

    if (data.method === 'DECLINING_BALANCE' && !(data.decliningRate > 0)) {
      throw badRequest('القسط المتناقص يحتاج نسبة سنوية أكبر من صفر');
    }

    const created = await prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.create({ data });

      // قيد الاقتناء اختياري: الأصل قد يكون دخل الدفتر بفاتورة شراء من قبل
      if (req.body?.postAcquisition === true) {
        const creditAccountId = requireString(req.body?.creditAccountId, 'الحساب الدائن');
        const { createEntry } = require('../services/ledger');

        await createEntry(tx, {
          date: asset.acquiredAt,
          memo: `اقتناء الأصل ${asset.code} — ${asset.name}`,
          source: 'ADJUSTMENT',
          actor: req.user,
          lines: [
            { accountId: asset.assetAccountId, debit: asset.cost },
            { accountId: creditAccountId, credit: asset.cost },
          ],
        });
      }

      return asset;
    });

    const row = await prisma.fixedAsset.findUnique({
      where: { id: created.id },
      include: WITH_DEPRECIATIONS,
    });
    res.status(201).json({ asset: publicAsset(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const current = await prisma.fixedAsset.findUnique({
      where: { id: req.params.id },
      include: WITH_DEPRECIATIONS,
    });
    if (!current) throw notFound('الأصل غير موجود');
    if (current.status === 'DISPOSED') throw badRequest('الأصل مستبعَد فلا يُعدَّل');

    const data = await readPayload(req.body, { partial: true });

    // تغيير التكلفة أو العمر بعد إهلاك مرحَّل يجعل ما في الدفتر مخالفاً للبطاقة
    if (current.depreciations.length) {
      for (const field of ['cost', 'salvageValue', 'method', 'usefulLifeMonths', 'decliningRate', 'acquiredAt']) {
        if (data[field] !== undefined && String(data[field]) !== String(current[field])) {
          throw badRequest(
            `لا يمكن تغيير «${field}» بعد ترحيل إهلاك — ألغِ قيود الإهلاك أولاً أو أنشئ أصلاً جديداً`,
          );
        }
      }
    }

    if (req.body?.assetAccountId !== undefined) {
      data.assetAccountId = await resolveAccount(req.body.assetAccountId, DEFAULT_CODES.asset, 'الأصل');
    }
    if (req.body?.accumulatedAccountId !== undefined) {
      data.accumulatedAccountId = await resolveAccount(
        req.body.accumulatedAccountId,
        DEFAULT_CODES.accumulated,
        'مجمّع الإهلاك',
      );
    }
    if (req.body?.expenseAccountId !== undefined) {
      data.expenseAccountId = await resolveAccount(
        req.body.expenseAccountId,
        DEFAULT_CODES.expense,
        'مصروف الإهلاك',
      );
    }

    const updated = await prisma.fixedAsset.update({
      where: { id: current.id },
      data,
      include: WITH_DEPRECIATIONS,
    });
    res.json({ asset: publicAsset(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const current = await prisma.fixedAsset.findUnique({
      where: { id: req.params.id },
      include: WITH_DEPRECIATIONS,
    });
    if (!current) throw notFound('الأصل غير موجود');
    if (current.depreciations.length) {
      throw badRequest('للأصل إهلاك مرحَّل في الدفتر — استبعده بدل حذفه');
    }

    await prisma.fixedAsset.delete({ where: { id: current.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** معاينة إهلاك الفترة قبل ترحيله. */
router.get('/depreciation/due', requireCapability('assets.read'), async (req, res, next) => {
  try {
    const periodEnd = requireDate(req.query.periodEnd, 'نهاية الفترة');
    const target = endOfMonth(periodEnd);

    const assets = await prisma.fixedAsset.findMany({
      where: { status: 'ACTIVE', acquiredAt: { lte: target } },
      include: WITH_DEPRECIATIONS,
      orderBy: { code: 'asc' },
    });

    const due = [];
    let total = 0n;

    for (const asset of assets) {
      const amount = dueFor(asset, periodEnd);
      if (!amount) continue;

      total += amount.amount;
      due.push({
        id: asset.id,
        code: asset.code,
        name: asset.name,
        method: asset.method,
        months: amount.months,
        amount: serialize.money(amount.amount),
        bookValueAfter: serialize.money(amount.bookValueAfter),
      });
    }

    res.json({ periodEnd: serialize.day(target), assets: due, total: serialize.money(total) });
  } catch (err) {
    next(err);
  }
});

router.post('/depreciation', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const periodEnd = requireDate(req.body?.periodEnd, 'نهاية الفترة');

    const result = await prisma.$transaction(async (tx) =>
      runDepreciation(tx, { periodEnd, actor: req.user }),
    );

    res.status(201).json({
      periodEnd: serialize.day(result.periodEnd),
      entryNumber: result.entry.number,
      total: serialize.money(result.total),
      assets: result.assets.map((row) => ({
        ...row,
        amount: serialize.money(row.amount),
        bookValueAfter: serialize.money(row.bookValueAfter),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * التراجع عن دفعة إهلاك: يحذف قيدها، وصفوف الإهلاك تسقط معه (Cascade).
 * يُستعمل حين تُرحَّل دفعة بتاريخ خاطئ أو على أصل بُنيت بطاقته غلطاً.
 */
router.delete('/depreciation/:entryId', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.entryId },
      include: { depreciations: true },
    });
    if (!entry) throw notFound('القيد غير موجود');
    if (!entry.depreciations.length) throw badRequest('هذا القيد ليس قيد إهلاك');

    // الفترة المقفلة لا يُحذف منها شيء، كما لا يُضاف إليها
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.lockDate && entry.date <= settings.lockDate) {
      throw badRequest(
        `الفترة مقفلة حتى ${settings.lockDate.toISOString().slice(0, 10)}؛ لا يمكن حذف قيد فيها`,
      );
    }

    // دفعة أحدث على الأصل نفسه تعني أن رصيدها الدفتري محسوب على هذه، فتُحذف أولاً
    for (const row of entry.depreciations) {
      const later = await prisma.depreciation.findFirst({
        where: { assetId: row.assetId, periodEnd: { gt: row.periodEnd } },
        orderBy: { periodEnd: 'asc' },
      });
      if (later) {
        throw badRequest('توجد دفعة إهلاك أحدث على الأصل نفسه — احذف الأحدث أولاً');
      }
    }

    await prisma.journalEntry.delete({ where: { id: entry.id } });
    res.json({ ok: true, reversed: entry.depreciations.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dispose', requireCapability('assets.write'), async (req, res, next) => {
  try {
    const date = requireDate(req.body?.date, 'تاريخ الاستبعاد');
    const proceeds = toMinor(req.body?.proceeds ?? 0);
    if (proceeds < 0n) throw badRequest('حصيلة البيع لا تكون سالبة');

    const gainLossAccountId = requireString(req.body?.gainLossAccountId, 'حساب الربح أو الخسارة');
    const cashAccountId = req.body?.cashAccountId ? String(req.body.cashAccountId) : null;

    const result = await prisma.$transaction(async (tx) =>
      disposeAsset(tx, {
        assetId: req.params.id,
        date,
        proceeds,
        cashAccountId,
        gainLossAccountId,
        actor: req.user,
      }),
    );

    const row = await prisma.fixedAsset.findUnique({
      where: { id: req.params.id },
      include: WITH_DEPRECIATIONS,
    });

    res.json({
      asset: publicAsset(row),
      bookValue: serialize.money(result.bookValue),
      result: serialize.money(result.result),
      entryNumber: result.entry.number,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
