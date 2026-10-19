'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const bcrypt = require('bcryptjs');

const { BACKEND_ROOT, systemDbPath, fileUrl } = require('./paths');
const systemDb = require('./systemDb');
const businessDb = require('./businessDb');

const SYSTEM_SCHEMA = path.join(BACKEND_ROOT, 'prisma', 'system.prisma');

const FIRST_BUSINESS = { name: 'منشأتي', slug: 'main' };

function pushSystemSchema() {
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      '--accept-data-loss',
      '--schema',
      SYSTEM_SCHEMA,
    ],
    {
      cwd: BACKEND_ROOT,
      env: { ...process.env, SYSTEM_DATABASE_URL: fileUrl(systemDbPath()) },
      stdio: 'pipe',
    },
  );
}

function fingerprint() {
  // المحتوى لا البايتات — انظر businessDb.schemaFingerprint
  const content = fs.readFileSync(SYSTEM_SCHEMA, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** يبني جداول قاعدة النظام أو يوائمها مع المخطط بعد تحديث الكود. */
function ensureSystemSchema() {
  const marker = `${systemDbPath()}.schema`;
  let applied = null;
  try {
    applied = fs.readFileSync(marker, 'utf8').trim();
  } catch {
    applied = null;
  }
  if (applied === fingerprint()) return false;

  pushSystemSchema();
  fs.writeFileSync(marker, fingerprint());
  return true;
}

/** كلمة مرور أولى عشوائية حين لا يحدّدها المشغّل. */
function randomPassword() {
  return `Mizan@${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * أول آدمن. يُلزَم بتغيير كلمة المرور عند أول دخول لأنها تُطبع في سجل الإقلاع
 * ويقرأها كل من يرى شاشة المشغّل.
 */
async function ensureFirstAdmin() {
  if ((await systemDb.user.count()) > 0) return null;

  const email = (process.env.SEED_EMAIL || 'admin@mizan.local').toLowerCase();
  const password = process.env.SEED_PASSWORD || randomPassword();

  const user = await systemDb.user.create({
    data: {
      email,
      name: process.env.SEED_NAME || 'المدير',
      password: await bcrypt.hash(password, 10),
      isAdmin: true,
      mustChangePassword: true,
    },
  });

  return { email: user.email, password, userId: user.id };
}

/** أول منشأة بقاعدتها وشجرة حساباتها، ومالكها أول آدمن. */
async function ensureFirstBusiness() {
  if ((await systemDb.business.count()) > 0) return null;

  const business = await systemDb.business.create({ data: FIRST_BUSINESS });

  if (!businessDb.businessDbExists(FIRST_BUSINESS.slug)) {
    await businessDb.createBusinessDb(FIRST_BUSINESS.slug, { companyName: FIRST_BUSINESS.name });
  } else {
    businessDb.writeFingerprint(FIRST_BUSINESS.slug);
  }

  const admin = await systemDb.user.findFirst({
    where: { isAdmin: true, active: true },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) {
    await systemDb.membership.create({
      data: { userId: admin.id, businessId: business.id, role: 'OWNER' },
    });
  }

  return business;
}

/**
 * يوائم قواعد المنشآت القائمة مع المخطط الحالي بعد تحديث الكود، ثم يشغّل
 * ترحيلات البيانات: مواءمة الجداول لا تملأ صفوفاً، وبعض التغييرات تحتاج ذلك.
 */
async function syncBusinessSchemas() {
  const { runDataMigrations } = require('./dataMigrations');
  const { runWithDb } = require('./dbContext');

  const businesses = await systemDb.business.findMany({ select: { slug: true, name: true } });
  const updated = [];

  for (const { slug, name } of businesses) {
    if (!businessDb.businessDbExists(slug)) continue;
    if (businessDb.syncSchema(slug)) updated.push(slug);

    const db = businessDb.getBusinessDb(slug);
    const applied = await runWithDb(db, () => runDataMigrations(db));
    for (const migration of applied) {
      console.log(`✓ ترحيل بيانات «${name}»: ${migration}`);
    }
  }

  return updated;
}

/**
 * تهيئة النظام عند كل إقلاع. تعيد بيانات الدخول الأولى إن كانت هذه أول مرة.
 */
async function prepareSystem() {
  ensureSystemSchema();

  const credentials = await ensureFirstAdmin();
  await ensureFirstBusiness();

  const updated = await syncBusinessSchemas();
  if (updated.length) {
    console.log(`✓ وُئمت قواعد المنشآت مع المخطط: ${updated.join('، ')}`);
  }

  return credentials;
}

module.exports = {
  prepareSystem,
  ensureSystemSchema,
  ensureFirstAdmin,
  ensureFirstBusiness,
  syncBusinessSchemas,
  randomPassword,
  FIRST_BUSINESS,
};
