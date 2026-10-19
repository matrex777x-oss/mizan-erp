'use strict';

/**
 * سكربت الطوارئ — إعادة تعيين كلمة مرور من جهاز الخادم.
 *
 * هذا هو المخرج الوحيد حين ينسى آدمن النظام الوحيد كلمته: لا يوجد بريد استعادة،
 * ولا سبيل لقراءة كلمة مرور قائمة (bcrypt تجزئة لا تُفك). يشترط الوصول إلى
 * الجهاز نفسه — وهذا هو ما يجعله آمناً: من يملك الملفات يملك البيانات أصلاً.
 *
 *   node scripts/reset-password.js --list
 *   node scripts/reset-password.js admin@mizan.local
 *   node scripts/reset-password.js admin@mizan.local 'كلمة-جديدة123'
 *   node scripts/reset-password.js admin@mizan.local --make-admin
 */

const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { ensureEnvFile, resolveDatabaseUrl } = require('../src/bootstrap');
const password = require('../src/lib/password');

ensureEnvFile();
resolveDatabaseUrl();

const systemDb = require('../src/lib/systemDb');
const { ensureSystemSchema } = require('../src/lib/systemBootstrap');
const { audit, AUDIT_ACTIONS } = require('../src/lib/audit');

function usage() {
  console.log(`
إعادة تعيين كلمة المرور (طوارئ)

  node scripts/reset-password.js --list
  node scripts/reset-password.js <البريد> [كلمة المرور الجديدة] [--make-admin]

بلا كلمة مرور تُولَّد واحدة مؤقتة ويُلزَم صاحبها بتغييرها عند أول دخول.
`);
}

async function list() {
  const users = await systemDb.user.findMany({
    include: { memberships: { include: { business: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!users.length) {
    console.log('لا مستخدمين بعد — شغّل التطبيق مرة ليُنشأ أول آدمن.');
    return;
  }

  console.log(`\n${users.length} مستخدماً:\n`);
  for (const user of users) {
    const flags = [
      user.isAdmin ? 'آدمن نظام' : null,
      user.active ? null : 'موقوف',
      user.mustChangePassword ? 'مُلزَم بتغيير كلمته' : null,
    ].filter(Boolean);

    const access = user.memberships.map((m) => `${m.business.name}:${m.role}`).join('، ') || 'لا منشآت';
    console.log(`  ${user.email}`);
    console.log(`    ${user.name}${flags.length ? ` — ${flags.join(' · ')}` : ''}`);
    console.log(`    ${access}\n`);
  }
}

async function reset(email, plain, makeAdmin) {
  const user = await systemDb.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`لا مستخدم بالبريد ${email}. اعرض المستخدمين بـ --list`);
    process.exitCode = 1;
    return;
  }

  // كلمة من سطر الأوامر تُفحَص كما تُفحَص من الواجهة، فلا يُضعَّف الحساب من هنا
  const value = plain ? password.requireStrong(plain) : password.temporary();

  await systemDb.user.update({
    where: { id: user.id },
    data: {
      password: await password.hash(value),
      mustChangePassword: true,
      // الحساب الموقوف يُعاد تفعيله، وإلا لم تنفع الكلمة الجديدة
      active: true,
      ...(makeAdmin ? { isAdmin: true } : {}),
    },
  });

  await audit({
    actor: { id: null, name: `سطر الأوامر (${process.env.USERNAME || process.env.USER || 'محلي'})` },
    businessId: null,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    target: user.id,
    detail: `${user.email} — سكربت الطوارئ${makeAdmin ? ' + ترقية إلى آدمن نظام' : ''}`,
  });

  console.log(`\n✓ أُعيد تعيين كلمة مرور ${user.email}`);
  console.log(`\n  كلمة المرور: ${value}\n`);
  console.log('  تُطلب منه كلمة جديدة عند أول دخول. غيّرها ولا تتركها في سجلّ الأوامر.\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) return usage();

  ensureSystemSchema();

  if (args[0] === '--list') return list();

  const email = args[0].toLowerCase();
  const makeAdmin = args.includes('--make-admin');
  const plain = args.slice(1).find((arg) => !arg.startsWith('--')) || null;

  return reset(email, plain, makeAdmin);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => systemDb.disconnect());
