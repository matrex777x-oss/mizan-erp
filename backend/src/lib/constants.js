'use strict';

const ROLES = ['OWNER', 'ACCOUNTANT', 'VIEWER'];
const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'BOTH'];
const ENTRY_SOURCES = ['MANUAL', 'INVOICE', 'PAYMENT', 'OPENING'];
const INVOICE_KINDS = ['SALES', 'PURCHASE'];
const DOC_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const PAYMENT_KINDS = ['RECEIPT', 'PAYMENT'];

// الجانب الطبيعي لكل نوع حساب: 1 مدين، -1 دائن
const NATURAL_SIDE = {
  ASSET: 1,
  EXPENSE: 1,
  LIABILITY: -1,
  EQUITY: -1,
  INCOME: -1,
};

// الحسابات النظامية التي يعتمد عليها البرنامج في ترحيل المستندات
const SYSTEM_ACCOUNTS = {
  RECEIVABLE: 'RECEIVABLE', // ذمم مدينة (العملاء)
  PAYABLE: 'PAYABLE', // ذمم دائنة (الموردون)
  TAX_OUTPUT: 'TAX_OUTPUT', // ضريبة المخرجات (مستحقة للدولة)
  TAX_INPUT: 'TAX_INPUT', // ضريبة المدخلات (قابلة للخصم)
  RETAINED: 'RETAINED', // الأرباح المحتجزة
};

const ACCOUNT_TYPE_LABELS = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  INCOME: 'إيرادات',
  EXPENSE: 'مصروفات',
};

module.exports = {
  ROLES,
  ACCOUNT_TYPES,
  PARTY_KINDS,
  ENTRY_SOURCES,
  INVOICE_KINDS,
  DOC_STATUSES,
  PAYMENT_KINDS,
  NATURAL_SIDE,
  SYSTEM_ACCOUNTS,
  ACCOUNT_TYPE_LABELS,
};
