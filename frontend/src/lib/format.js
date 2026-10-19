/** تنسيق المبالغ النصية القادمة من الخادم للعرض. */
export function formatMoney(value, symbol = '') {
  const number = Number(value ?? 0);
  const text = new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  }).format(number);
  return symbol ? `${text} ${symbol}` : text;
}

export function formatQuantity(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('ar-EG', {
    maximumFractionDigits: 3,
    numberingSystem: 'latn',
  }).format(number);
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    numberingSystem: 'latn',
  }).format(new Date(value));
}

export const today = () => new Date().toISOString().slice(0, 10);

export const ACCOUNT_TYPE_LABELS = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  INCOME: 'إيرادات',
  EXPENSE: 'مصروفات',
};

export const STATUS_LABELS = {
  DRAFT: 'مسودة',
  POSTED: 'مُرحَّلة',
  CANCELLED: 'ملغاة',
};

export const PARTY_KIND_LABELS = {
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  BOTH: 'عميل ومورد',
};

export const SOURCE_LABELS = {
  MANUAL: 'يدوي',
  INVOICE: 'فاتورة',
  PAYMENT: 'سند',
  OPENING: 'افتتاحي',
};
