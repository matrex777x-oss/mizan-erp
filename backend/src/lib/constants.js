'use strict';

const ROLES = ['OWNER', 'ACCOUNTANT', 'SALES', 'INVENTORY', 'VIEWER'];
const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'BOTH'];
const ENTRY_SOURCES = ['MANUAL', 'INVOICE', 'PAYMENT', 'ADJUSTMENT', 'OPENING', 'CLOSING'];
const INVOICE_KINDS = ['SALES', 'PURCHASE'];
const DOC_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const PAYMENT_KINDS = ['RECEIPT', 'PAYMENT'];
const ITEM_KINDS = ['STOCK', 'SERVICE'];
const MOVE_KINDS = ['IN', 'OUT'];
const MOVE_DIRECTIONS = ['IN', 'OUT'];

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
  INVENTORY: 'INVENTORY', // مخزون البضاعة
  COGS: 'COGS', // تكلفة البضاعة المباعة
  STOCK_ADJUST: 'STOCK_ADJUST', // فروق وتسويات المخزون
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
  ITEM_KINDS,
  MOVE_KINDS,
  MOVE_DIRECTIONS,
  NATURAL_SIDE,
  SYSTEM_ACCOUNTS,
  ACCOUNT_TYPE_LABELS,
};
