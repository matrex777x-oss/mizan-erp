/**
 * حساب مجاميع الفاتورة في المتصفح بنفس منطق الخادم تماماً:
 * أعداد صحيحة بالوحدة الصغرى وتقريب نصف لأعلى.
 */

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalize(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    const index = ARABIC_DIGITS.indexOf(ch);
    if (index >= 0) { out += String(index); continue; }
    if (ch === ',' || ch === '٬' || ch === ' ') continue;
    out += ch === '٫' ? '.' : ch;
  }
  return out.trim();
}

/** نص عشري → عدد صحيح بعدد منازل محدّد. يعيد 0n عند الإدخال غير الصالح. */
export function toMinor(value, places = 2) {
  const text = normalize(value);
  if (!/^-?\d*(\.\d*)?$/.test(text) || text === '' || text === '-' || text === '.') return 0n;

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  const kept = fraction.slice(0, places).padEnd(places, '0');
  let result = BigInt((whole || '0') + kept);
  if (fraction.charCodeAt(places) - 48 >= 5) result += 1n;

  return negative ? -result : result;
}

export function fromMinor(value, places = 2) {
  const v = BigInt(value ?? 0n);
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? `.${digits.slice(digits.length - places)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function divRound(numerator, denominator) {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const q = (n * 2n + denominator) / (denominator * 2n);
  return negative ? -q : q;
}

/** يحسب سطور الفاتورة ومجاميعها كنصوص جاهزة للعرض. */
export function computeInvoice(lines) {
  let subtotal = 0n;
  let taxTotal = 0n;

  const computed = lines.map((line) => {
    const quantity = toMinor(line.quantity, 3);
    const unitPrice = toMinor(line.unitPrice, 2);
    const rate = toMinor(line.taxRate, 2); // 15 => 1500 (عُشر من المئة)

    const lineSubtotal = divRound(quantity * unitPrice, 1000n);
    const lineTax = rate ? divRound(lineSubtotal * rate, 10000n) : 0n;

    subtotal += lineSubtotal;
    taxTotal += lineTax;

    return {
      lineSubtotal: fromMinor(lineSubtotal),
      lineTax: fromMinor(lineTax),
      lineTotal: fromMinor(lineSubtotal + lineTax),
    };
  });

  return {
    lines: computed,
    subtotal: fromMinor(subtotal),
    taxTotal: fromMinor(taxTotal),
    total: fromMinor(subtotal + taxTotal),
    isEmpty: subtotal + taxTotal <= 0n,
  };
}

/** مجموع قائمة مبالغ نصية. */
export function sumMoney(values) {
  return fromMinor(values.reduce((acc, value) => acc + toMinor(value), 0n));
}

export const compareMoney = (a, b) => {
  const x = toMinor(a);
  const y = toMinor(b);
  return x === y ? 0 : x > y ? 1 : -1;
};
