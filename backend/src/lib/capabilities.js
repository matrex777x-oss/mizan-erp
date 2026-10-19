'use strict';

const { ROLES } = require('./constants');

/**
 * خريطة القدرات — المصدر الوحيد لما يستطيعه كل دور.
 *
 * قبل هذا كان الفحص متناثراً: `requireWrite` في كل مسار و`requireRole('OWNER')`
 * في الإعدادات، فلا يُعرف ما يستطيعه دور إلا بقراءة كل الملفات، وإضافة دور
 * جديد تعني مرور على كل مسار. هنا تُعرَّف القدرات مرة، وتُقرأ في مكان واحد،
 * وتُعرض كما هي في شاشة الأدوار — فما يراه المستخدم هو ما يفرضه الخادم نفسه.
 *
 * التسمية: <المجال>.<الفعل> — و`post` هي الترحيل إلى دفتر الأستاذ، منفصلة عن
 * `write` لأن إنشاء مسودة شيء وإثبات قيد في الدفتر شيء آخر.
 */

const CAPABILITIES = {
  'sales.read': 'عرض فواتير المبيعات',
  'sales.write': 'إنشاء وتعديل فواتير المبيعات',
  'sales.post': 'ترحيل فواتير المبيعات وإلغاؤها',

  'purchase.read': 'عرض فواتير المشتريات',
  'purchase.write': 'إنشاء وتعديل فواتير المشتريات',
  'purchase.post': 'ترحيل فواتير المشتريات وإلغاؤها',

  'receipt.read': 'عرض سندات القبض',
  'receipt.write': 'إنشاء وتعديل سندات القبض',
  'receipt.post': 'ترحيل سندات القبض وإلغاؤها',

  'expense.read': 'عرض سندات الصرف',
  'expense.write': 'إنشاء وتعديل سندات الصرف',
  'expense.post': 'ترحيل سندات الصرف وإلغاؤها',

  'parties.read': 'عرض العملاء والموردين',
  'parties.write': 'إضافة وتعديل العملاء والموردين',

  'items.read': 'عرض الأصناف والخدمات',
  'items.write': 'إضافة وتعديل الأصناف والخدمات',

  'stock.read': 'عرض أرصدة المخزون وحركته',
  'stock.write': 'تسويات المخزون وترحيلها',

  'assets.read': 'عرض الأصول الثابتة وإهلاكها',
  'assets.write': 'إضافة الأصول وترحيل الإهلاك واستبعادها',

  'accounts.read': 'عرض شجرة الحسابات',
  'accounts.write': 'تعديل شجرة الحسابات',

  'closing.read': 'عرض الإقفالات السنوية',
  'closing.manage': 'تنفيذ الإقفال السنوي وإعادة الفتح',

  'journal.read': 'عرض القيود اليومية',
  'journal.write': 'إنشاء وحذف القيود اليدوية',

  'reports.financial': 'التقارير المالية: ميزان المراجعة، قائمة الدخل، المركز المالي',
  'reports.operational': 'التقارير التشغيلية: المخزون، أعمار الديون، كشوف الحسابات',

  'settings.read': 'عرض إعدادات المنشأة',
  'settings.write': 'تعديل إعدادات المنشأة وإقفال الفترات',
};

const ALL = Object.keys(CAPABILITIES);

const READ_ONLY = ALL.filter((cap) => cap.endsWith('.read') || cap.startsWith('reports.'));

/** قدرات كل دور. المالك يملك كل شيء، والمُطّلع يقرأ ولا يكتب. */
const ROLE_CAPABILITIES = {
  OWNER: ALL,

  // المحاسب يدير الدفتر كله، وتبقى إعدادات المنشأة وإقفال الفترات بيد المالك
  ACCOUNTANT: ALL.filter((cap) => cap !== 'settings.write'),

  SALES: [
    'sales.read',
    'sales.write',
    'sales.post',
    'receipt.read',
    'receipt.write',
    'receipt.post',
    'parties.read',
    'parties.write',
    // يرى الأصناف وأرصدتها ليبيع، ولا يعدّلها ولا يسوّي المخزون
    'items.read',
    'stock.read',
    'reports.operational',
    'settings.read',
  ],

  INVENTORY: [
    'items.read',
    'items.write',
    'stock.read',
    'stock.write',
    // يرى فواتير الشراء ليطابق الوارد، ولا ينشئها ولا يرحّلها
    'purchase.read',
    'parties.read',
    'reports.operational',
    'settings.read',
  ],

  VIEWER: READ_ONLY,
};

const ROLE_LABELS = {
  OWNER: 'مالك',
  ACCOUNTANT: 'محاسب',
  SALES: 'مبيعات',
  INVENTORY: 'مخزن',
  VIEWER: 'مُطّلع',
};

const ROLE_DESCRIPTIONS = {
  OWNER: 'كل شيء، ومنه إعدادات المنشأة وإقفال الفترات',
  ACCOUNTANT: 'الدفتر كله: الفواتير والسندات والقيود والتقارير — عدا إعدادات المنشأة',
  SALES: 'المبيعات وسندات القبض والعملاء، مع عرض الأصناف وأرصدتها',
  INVENTORY: 'الأصناف وتسويات المخزون وتقاريره، مع عرض فواتير الشراء',
  VIEWER: 'عرض كل شيء دون أي تعديل',
};

function capabilitiesOf(role) {
  return ROLE_CAPABILITIES[role] || [];
}

function roleCan(role, capability) {
  return capabilitiesOf(role).includes(capability);
}

/** بادئة القدرة لنوع المستند: فواتير المبيعات غير المشتريات، والقبض غير الصرف. */
const INVOICE_CAPABILITY = { SALES: 'sales', PURCHASE: 'purchase' };
const PAYMENT_CAPABILITY = { RECEIPT: 'receipt', PAYMENT: 'expense' };

/** أنواع المستندات التي يصل إليها الدور — تُضيَّق بها القوائم. */
function allowedInvoiceKinds(role) {
  return Object.entries(INVOICE_CAPABILITY)
    .filter(([, prefix]) => roleCan(role, `${prefix}.read`))
    .map(([kind]) => kind);
}

function allowedPaymentKinds(role) {
  return Object.entries(PAYMENT_CAPABILITY)
    .filter(([, prefix]) => roleCan(role, `${prefix}.read`))
    .map(([kind]) => kind);
}

// حارس: كل دور معرَّف، وكل قدرة ممنوحة موجودة في الخريطة
for (const role of ROLES) {
  if (!ROLE_CAPABILITIES[role]) throw new Error(`دور بلا قدرات معرَّفة: ${role}`);
  for (const cap of ROLE_CAPABILITIES[role]) {
    if (!CAPABILITIES[cap]) throw new Error(`قدرة غير معروفة في دور ${role}: ${cap}`);
  }
}

module.exports = {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  INVOICE_CAPABILITY,
  PAYMENT_CAPABILITY,
  capabilitiesOf,
  roleCan,
  allowedInvoiceKinds,
  allowedPaymentKinds,
};
