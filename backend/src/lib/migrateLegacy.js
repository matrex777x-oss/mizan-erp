'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { PrismaClient } = require('@prisma/client');

const { legacyDbPath, businessDbPath, businessesDir, fileUrl } = require('./paths');
const businessDb = require('./businessDb');
const systemDb = require('./systemDb');
const { ensureSystemSchema, FIRST_BUSINESS } = require('./systemBootstrap');

/**
 * ترحيل قاعدة ما قبل تعدّد المنشآت.
 *
 * قبل هذه المرحلة كان التطبيق قاعدة واحدة (backend/prisma/dev.db) فيها
 * المستخدمون والبيانات المحاسبية معاً. الترحيل يفصلهما:
 *   المستخدمون ← قاعدة النظام،  البيانات المحاسبية ← قاعدة المنشأة الأولى.
 *
 * يُنفَّذ مرة واحدة، بعد نسخة احتياطية، ولا يحذف القاعدة القديمة بل يعيد تسميتها.
 */

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** عميل خام على ملف قاعدة معيّن — للقراءة والكتابة بـ SQL قبل مواءمة المخطط. */
function rawClient(dbPath) {
  return new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } });
}

async function tableExists(client, table) {
  const rows = await client.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    table,
  );
  return rows.length > 0;
}

async function columnExists(client, table, column) {
  const rows = await client.$queryRawUnsafe(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

/** القاعدة القديمة تحتاج ترحيلاً إن كانت موجودة وفيها جدول مستخدمين. */
async function needsMigration() {
  const legacy = legacyDbPath();
  if (!fs.existsSync(legacy)) return false;

  // رُحِّلت مسبقاً: المنشأة الأولى موجودة ولها قاعدتها
  if (businessDb.businessDbExists(FIRST_BUSINESS.slug)) return false;

  const client = rawClient(legacy);
  try {
    return await tableExists(client, 'User');
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

async function migrate() {
  const legacy = legacyDbPath();
  const stamp = timestamp();

  // 1) نسخة احتياطية قبل أي لمسة
  const backup = `${legacy}.backup-${stamp}`;
  fs.copyFileSync(legacy, backup);
  console.log(`✓ نسخة احتياطية من القاعدة القديمة: ${path.basename(backup)}`);

  // 2) القاعدة المحاسبية تصبح قاعدة المنشأة الأولى. القاعدة القديمة تُقرأ ولا تُمسّ.
  fs.mkdirSync(businessesDir(), { recursive: true });
  const target = businessDbPath(FIRST_BUSINESS.slug);
  fs.copyFileSync(legacy, target);

  // 3) المستخدمون من النسخة الجديدة قبل أن يسقط جدولهم منها
  const targetClient = rawClient(target);
  let users = [];
  try {
    users = await targetClient.$queryRawUnsafe(
      'SELECT "id", "email", "name", "password", "role", "active" FROM "User"',
    );
  } finally {
    await targetClient.$disconnect();
  }

  // 4) مواءمة الجداول مع المخطط الجديد: يسقط جدول المستخدمين وتزول العلاقة الأجنبية
  businessDb.syncSchema(FIRST_BUSINESS.slug);

  // 5) لقطة أسماء منشئي القيود — بعد المواءمة لا قبلها: مواءمة المخطط تعيد بناء
  //    جدول القيود، فأي قيمة نكتبها قبلها تُفقد في إعادة البناء.
  const snapshotClient = rawClient(target);
  try {
    if (await columnExists(snapshotClient, 'JournalEntry', 'createdByName')) {
      for (const user of users) {
        await snapshotClient.$executeRawUnsafe(
          'UPDATE "JournalEntry" SET "createdByName" = ? WHERE "createdById" = ?',
          user.name,
          user.id,
        );
      }
    }
  } finally {
    await snapshotClient.$disconnect();
  }

  // 6) المستخدمون إلى قاعدة النظام، بكلمات مرورهم كما هي (تجزئة bcrypt تُنقل كما هي)
  ensureSystemSchema();

  const business = await systemDb.business.upsert({
    where: { slug: FIRST_BUSINESS.slug },
    update: {},
    create: FIRST_BUSINESS,
  });

  let moved = 0;
  for (const user of users) {
    const email = String(user.email).toLowerCase();
    const exists = await systemDb.user.findUnique({ where: { email } });
    if (exists) continue;

    // دور المالك في القاعدة القديمة يصبح آدمن نظام أيضاً: هو من كان يدير كل شيء
    const isOwner = user.role === 'OWNER';

    const created = await systemDb.user.create({
      data: {
        email,
        name: user.name,
        password: user.password,
        isAdmin: isOwner,
        // حساب قائم يعمل بكلمة مرور يعرفها صاحبه، فلا نُلزمه بتغييرها
        mustChangePassword: false,
        active: user.active === null || user.active === undefined ? true : Boolean(user.active),
      },
    });

    await systemDb.membership.create({
      data: {
        userId: created.id,
        businessId: business.id,
        role: ['OWNER', 'ACCOUNTANT', 'VIEWER'].includes(user.role) ? user.role : 'ACCOUNTANT',
      },
    });
    moved += 1;
  }

  // 7) القاعدة القديمة تُنحّى لا تُحذف، فيمكن الرجوع إليها
  const retired = `${legacy}.migrated-${stamp}`;
  fs.renameSync(legacy, retired);

  console.log(`✓ رُحّلت القاعدة القديمة: ${moved} مستخدماً إلى قاعدة النظام`);
  console.log(`  بياناتها المحاسبية الآن منشأة «${FIRST_BUSINESS.name}»`);
  console.log(`  القاعدة القديمة محفوظة باسم ${path.basename(retired)}`);

  return { users: moved, businessId: business.id, backup, retired };
}

async function migrateLegacyIfNeeded() {
  if (!(await needsMigration())) return null;
  console.log('… ترحيل قاعدة ما قبل تعدّد المنشآت');
  return migrate();
}

module.exports = { needsMigration, migrate, migrateLegacyIfNeeded };
