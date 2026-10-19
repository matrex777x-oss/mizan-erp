'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { SYSTEM_ACCOUNTS } = require('../src/lib/constants');

/** شجرة حسابات افتراضية لمنشأة خدمية/تجارية صغيرة. */
const CHART = [
  ['1', 'الأصول', 'ASSET', true, null],
  ['11', 'النقدية والبنوك', 'ASSET', true, null],
  ['1101', 'الصندوق', 'ASSET', false, null],
  ['1102', 'الحساب البنكي', 'ASSET', false, null],
  ['12', 'الذمم المدينة والمدفوعات المقدمة', 'ASSET', true, null],
  ['1201', 'ذمم العملاء', 'ASSET', false, SYSTEM_ACCOUNTS.RECEIVABLE],
  ['1202', 'ضريبة القيمة المضافة — مدخلات', 'ASSET', false, SYSTEM_ACCOUNTS.TAX_INPUT],
  ['1203', 'مصروفات مدفوعة مقدماً', 'ASSET', false, null],
  ['13', 'المخزون', 'ASSET', true, null],
  ['1301', 'مخزون البضاعة', 'ASSET', false, SYSTEM_ACCOUNTS.INVENTORY],
  ['14', 'الأصول الثابتة', 'ASSET', true, null],
  ['1401', 'أثاث ومعدات', 'ASSET', false, null],
  ['1402', 'أجهزة حاسب', 'ASSET', false, null],
  ['1409', 'مجمع الإهلاك', 'ASSET', false, null],

  ['2', 'الالتزامات', 'LIABILITY', true, null],
  ['21', 'الذمم الدائنة', 'LIABILITY', true, null],
  ['2101', 'ذمم الموردين', 'LIABILITY', false, SYSTEM_ACCOUNTS.PAYABLE],
  ['2102', 'ضريبة القيمة المضافة — مخرجات', 'LIABILITY', false, SYSTEM_ACCOUNTS.TAX_OUTPUT],
  ['2103', 'مصروفات مستحقة', 'LIABILITY', false, null],
  ['2104', 'رواتب مستحقة', 'LIABILITY', false, null],
  ['22', 'القروض', 'LIABILITY', true, null],
  ['2201', 'قروض قصيرة الأجل', 'LIABILITY', false, null],

  ['3', 'حقوق الملكية', 'EQUITY', true, null],
  ['3101', 'رأس المال', 'EQUITY', false, null],
  ['3201', 'الأرباح المحتجزة', 'EQUITY', false, SYSTEM_ACCOUNTS.RETAINED],
  ['3301', 'مسحوبات الملاك', 'EQUITY', false, null],

  ['4', 'الإيرادات', 'INCOME', true, null],
  ['4101', 'إيرادات المبيعات', 'INCOME', false, null],
  ['4102', 'إيرادات الخدمات', 'INCOME', false, null],
  ['4201', 'إيرادات أخرى', 'INCOME', false, null],

  ['5', 'المصروفات', 'EXPENSE', true, null],
  ['51', 'تكلفة الإيرادات', 'EXPENSE', true, null],
  ['5101', 'تكلفة البضاعة المباعة', 'EXPENSE', false, SYSTEM_ACCOUNTS.COGS],
  ['5102', 'فروق وتسويات المخزون', 'EXPENSE', false, SYSTEM_ACCOUNTS.STOCK_ADJUST],
  ['52', 'المصروفات التشغيلية', 'EXPENSE', true, null],
  ['5201', 'الرواتب والأجور', 'EXPENSE', false, null],
  ['5202', 'الإيجار', 'EXPENSE', false, null],
  ['5203', 'الكهرباء والماء', 'EXPENSE', false, null],
  ['5204', 'الاتصالات والإنترنت', 'EXPENSE', false, null],
  ['5205', 'القرطاسية واللوازم', 'EXPENSE', false, null],
  ['5206', 'الرسوم والمصروفات البنكية', 'EXPENSE', false, null],
  ['5207', 'الصيانة والنظافة', 'EXPENSE', false, null],
  ['5208', 'الدعاية والتسويق', 'EXPENSE', false, null],
  ['5209', 'النقل والشحن', 'EXPENSE', false, null],
  ['5210', 'الإهلاك', 'EXPENSE', false, null],
  ['5299', 'مصروفات متنوعة', 'EXPENSE', false, null],
];

/** الأب هو أطول رمز سابق يكون بادئة لرمز الحساب. */
function parentCodeOf(code, codes) {
  for (let length = code.length - 1; length >= 1; length -= 1) {
    const candidate = code.slice(0, length);
    if (codes.has(candidate)) return candidate;
  }
  return null;
}

async function seedChart() {
  const codes = new Set(CHART.map(([code]) => code));
  const idByCode = new Map();

  for (const [code, name, type, isGroup, systemKey] of CHART) {
    const parentCode = parentCodeOf(code, codes);
    const parentId = parentCode ? idByCode.get(parentCode) : null;

    const row = await prisma.account.upsert({
      where: { code },
      update: { name, type, isGroup, parentId, systemKey },
      create: { code, name, type, isGroup, parentId, systemKey },
    });
    idByCode.set(code, row.id);
  }

  return idByCode.size;
}

async function seedOwner() {
  const email = (process.env.SEED_EMAIL || 'admin@mizan.local').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'Mizan@12345';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: process.env.SEED_NAME || 'المدير',
      password: await bcrypt.hash(password, 10),
      role: 'OWNER',
    },
  });

  return { email: user.email, password };
}

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const accounts = await seedChart();
  const owner = await seedOwner();

  console.log(`✓ شجرة الحسابات: ${accounts} حساباً`);
  console.log(`✓ المستخدم: ${owner.email} / ${owner.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
