'use strict';

const { badRequest } = require('./errors');

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية/الفارسية إلى لاتينية ويزيل الفواصل الألفية. */
function normalizeNumeric(input) {
  let out = '';
  for (const ch of String(input)) {
    const ai = ARABIC_DIGITS.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) { out += String(pi); continue; }
    if (ch === ',' || ch === '٬' || ch === ' ' || ch === ' ') continue;
    out += ch === '٫' ? '.' : ch;
  }
  return out.trim();
}

/**
 * يحوّل قيمة عشرية إلى عدد صحيح بالوحدة الصغرى.
 * toMinor('12.345', 2) => 1235n (تقريب نصف لأعلى)
 */
function toMinor(value, places = 2) {
  if (value === null || value === undefined || value === '') return 0n;
  if (typeof value === 'bigint') return value;

  const text = normalizeNumeric(value);
  if (!/^-?\d*(\.\d*)?$/.test(text) || text === '' || text === '-' || text === '.') {
    throw badRequest(`قيمة رقمية غير صالحة: ${value}`);
  }

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const parts = unsigned.split('.');
  const whole = parts[0] || '0';
  const fraction = parts[1] || '';

  const kept = fraction.slice(0, places).padEnd(places, '0');
  const nextDigit = fraction.charCodeAt(places) - 48;

  let result = BigInt(whole + kept);
  if (nextDigit >= 5) result += 1n;

  return negative ? -result : result;
}

/** يحوّل عدداً صحيحاً بالوحدة الصغرى إلى نص عشري: fromMinor(1235n, 2) => '12.35' */
function fromMinor(value, places = 2) {
  const v = BigInt(value ?? 0n);
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? '.' + digits.slice(digits.length - places) : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** قسمة بتقريب نصف لأعلى (بعيداً عن الصفر). المقام موجب. */
function divRound(numerator, denominator) {
  if (denominator <= 0n) throw badRequest('مقام غير صالح');
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const q = (n * 2n + denominator) / (denominator * 2n);
  return negative ? -q : q;
}

/** الكمية مخزَّنة بثلاث منازل (1.5 => 1500n). */
const QTY_SCALE = 1000n;
/** نسبة الضريبة بالعُشر من المئة (15% => 1500). */
const RATE_SCALE = 10000n;

/** إجمالي السطر = الكمية × سعر الوحدة. */
function lineAmount(quantityMilli, unitPriceMinor) {
  return divRound(BigInt(quantityMilli) * BigInt(unitPriceMinor), QTY_SCALE);
}

/** مبلغ الضريبة على أساس خاضع. */
function taxAmount(baseMinor, rateTenthPercent) {
  if (!rateTenthPercent) return 0n;
  return divRound(BigInt(baseMinor) * BigInt(rateTenthPercent), RATE_SCALE);
}

/** يحوّل نص كمية إلى وحدة داخلية (ثلاث منازل). */
const toQuantity = (value) => toMinor(value, 3);
const fromQuantity = (value) => fromMinor(value, 3);

/** يحوّل نسبة مئوية نصية ('15' أو '15.5') إلى عُشر من المئة. */
function toRate(value) {
  const r = Number(toMinor(value, 2));
  return Math.round(r); // '15.5' => 1550
}
const fromRate = (value) => fromMinor(BigInt(value ?? 0), 2);

module.exports = {
  normalizeNumeric,
  toMinor,
  fromMinor,
  divRound,
  lineAmount,
  taxAmount,
  toQuantity,
  fromQuantity,
  toRate,
  fromRate,
  QTY_SCALE,
  RATE_SCALE,
};
