'use strict';

/** البادئة الافتراضية لكل نوع، حين لا تكون الإعدادات مضبوطة بعد. */
const PREFIXES = {
  SALES: 'INV',
  PURCHASE: 'PUR',
  RECEIPT: 'RCT',
  PAYMENT: 'PMT',
  ADJUSTMENT: 'ADJ',
};

/** حقل الإعدادات الذي يحمل بادئة كل نوع. */
const PREFIX_FIELD = {
  SALES: 'prefixSales',
  PURCHASE: 'prefixPurchase',
  RECEIPT: 'prefixReceipt',
  PAYMENT: 'prefixPayment',
  ADJUSTMENT: 'prefixAdjustment',
};

/**
 * يقرأ إعدادات الترقيم من قاعدة المنشأة.
 * يُنادى داخل المعاملة نفسها، فتُقرأ الإعدادات كما هي لحظة الترقيم.
 */
async function numberingSettings(tx) {
  const row = await tx.settings.findUnique({ where: { id: 1 } });
  return {
    includeYear: row ? row.numberIncludeYear : true,
    padding: row && row.numberPadding > 0 ? row.numberPadding : 4,
    prefixes: {
      SALES: row?.prefixSales || PREFIXES.SALES,
      PURCHASE: row?.prefixPurchase || PREFIXES.PURCHASE,
      RECEIPT: row?.prefixReceipt || PREFIXES.RECEIPT,
      PAYMENT: row?.prefixPayment || PREFIXES.PAYMENT,
      ADJUSTMENT: row?.prefixAdjustment || PREFIXES.ADJUSTMENT,
    },
  };
}

/** جذع الرقم الذي يُحسب التسلسل داخله: INV-2026- أو INV- بلا عام. */
function stemFor(prefix, date, includeYear) {
  return includeYear ? `${prefix}-${date.getUTCFullYear()}-` : `${prefix}-`;
}

/**
 * يولّد رقم مستند متسلسل: INV-2026-0001
 *
 * البادئة وعدد الخانات ودخول العام من إعدادات المنشأة، والتسلسل يُحسب داخل
 * الجذع نفسه — فتغيير البادئة يبدأ تسلسلاً جديداً ولا يمسّ ما رُقّم من قبل.
 * يُستدعى داخل معاملة ليبقى التسلسل متماسكاً.
 */
async function nextDocumentNumber(tx, model, kind, date) {
  const settings = await numberingSettings(tx);
  const prefix = settings.prefixes[kind];
  if (!prefix) throw new Error(`نوع مستند غير معروف: ${kind}`);

  const stem = stemFor(prefix, date, settings.includeYear);

  const last = await tx[model].findFirst({
    where: { kind, number: { startsWith: stem } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const lastSeq = last ? Number.parseInt(last.number.slice(stem.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${stem}${String(next).padStart(settings.padding, '0')}`;
}

/** تسويات المخزون: جدول واحد بلا حقل نوع، فترقيمها على حدة. */
async function nextAdjustmentNumber(tx, date) {
  const settings = await numberingSettings(tx);
  const stem = stemFor(settings.prefixes.ADJUSTMENT, date, settings.includeYear);

  const last = await tx.stockAdjustment.findFirst({
    where: { number: { startsWith: stem } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const lastSeq = last ? Number.parseInt(last.number.slice(stem.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${stem}${String(next).padStart(settings.padding, '0')}`;
}

module.exports = { nextDocumentNumber, nextAdjustmentNumber, numberingSettings, PREFIXES, PREFIX_FIELD };
