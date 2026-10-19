'use strict';

const PREFIXES = {
  SALES: 'INV',
  PURCHASE: 'PUR',
  RECEIPT: 'RCT',
  PAYMENT: 'PMT',
};

/**
 * يولّد رقم مستند متسلسل ضمن السنة: INV-2026-0001
 * يُستدعى داخل معاملة ليبقى التسلسل متماسكاً.
 */
async function nextDocumentNumber(tx, model, kind, date) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`نوع مستند غير معروف: ${kind}`);

  const year = date.getUTCFullYear();
  const stem = `${prefix}-${year}-`;

  const last = await tx[model].findFirst({
    where: { kind, number: { startsWith: stem } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const lastSeq = last ? Number.parseInt(last.number.slice(stem.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${stem}${String(next).padStart(4, '0')}`;
}

module.exports = { nextDocumentNumber, PREFIXES };
