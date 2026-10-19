'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { PrismaClient } = require('@prisma/client');

const { BACKEND_ROOT, businessDbPath, fileUrl } = require('./paths');
const { runWithDb } = require('./dbContext');

const BUSINESS_SCHEMA = path.join(BACKEND_ROOT, 'prisma', 'schema.prisma');

/** عميل لكل منشأة، يُعاد استخدامه بين الطلبات. */
const clients = new Map();

function getBusinessDb(slug) {
  if (!clients.has(slug)) {
    clients.set(
      slug,
      new PrismaClient({ datasources: { db: { url: fileUrl(businessDbPath(slug)) } } }),
    );
  }
  return clients.get(slug);
}

async function disconnectAll() {
  const open = [...clients.values()];
  clients.clear();
  await Promise.all(open.map((client) => client.$disconnect()));
}

/**
 * ينشئ أو يحدّث جداول قاعدة منشأة.
 * `prisma db push` أداة سطر أوامر، فتُنفَّذ في عملية مستقلة بعنوان القاعدة المقصودة.
 */
function pushSchema(dbPath) {
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      '--accept-data-loss',
      '--schema',
      BUSINESS_SCHEMA,
    ],
    {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: fileUrl(dbPath) },
      stdio: 'pipe',
    },
  );
}

// بصمة المخطط المطبَّق على كل قاعدة، محفوظة بجانبها. بها نعرف أن تحديث الكود
// غيّر المخطط فنحدّث القواعد مرة واحدة، بدل تشغيل db push في كل إقلاع.
function schemaFingerprint() {
  return crypto.createHash('sha256').update(fs.readFileSync(BUSINESS_SCHEMA)).digest('hex').slice(0, 16);
}

function markerPath(slug) {
  return `${businessDbPath(slug)}.schema`;
}

function appliedFingerprint(slug) {
  try {
    return fs.readFileSync(markerPath(slug), 'utf8').trim();
  } catch {
    return null;
  }
}

function writeFingerprint(slug) {
  fs.writeFileSync(markerPath(slug), schemaFingerprint());
}

/** يوائم جداول منشأة قائمة مع المخطط الحالي عند الحاجة فقط. */
function syncSchema(slug) {
  if (appliedFingerprint(slug) === schemaFingerprint()) return false;
  pushSchema(businessDbPath(slug));
  writeFingerprint(slug);
  return true;
}

/** يجهّز قاعدة منشأة جديدة: جداول، إعدادات، وشجرة الحسابات العربية. */
async function createBusinessDb(slug, { companyName } = {}) {
  const dbPath = businessDbPath(slug);
  if (fs.existsSync(dbPath)) throw new Error(`قاعدة المنشأة موجودة مسبقاً: ${dbPath}`);

  pushSchema(dbPath);
  writeFingerprint(slug);

  const { seedChart } = require('../../prisma/seed');
  const db = getBusinessDb(slug);

  await runWithDb(db, async () => {
    await db.settings.upsert({
      where: { id: 1 },
      update: {},
      create: companyName ? { id: 1, companyName } : { id: 1 },
    });
    await seedChart();
  });

  return dbPath;
}

function businessDbExists(slug) {
  return fs.existsSync(businessDbPath(slug));
}

module.exports = {
  getBusinessDb,
  createBusinessDb,
  businessDbExists,
  syncSchema,
  disconnectAll,
  schemaFingerprint,
  writeFingerprint,
};
