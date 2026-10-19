'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/**
 * تهيئة التشغيل بأمر واحد: ملف إعدادات بمفتاح عشوائي، قاعدة بيانات جاهزة،
 * وشجرة حسابات ومستخدم أول عند أول إقلاع. مصمَّمة ليعمل التطبيق داخل أي
 * مشغّل خارجي (تطبيق نفق، خدمة نظام، حاوية) دون خطوات يدوية.
 */

/** يضمن وجود .env بمفتاح توقيع عشوائي لا يُولَّد مرتين. */
function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) return envPath;

  const secret = crypto.randomBytes(32).toString('hex');
  const content = [
    '# أُنشئ تلقائياً عند أول تشغيل',
    'DATABASE_URL="file:./dev.db"',
    `JWT_SECRET="${secret}"`,
    '',
  ].join('\n');

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  console.log('✓ أُنشئ ملف الإعدادات backend/.env بمفتاح توقيع عشوائي');
  return envPath;
}

/** يسمح بوضع قاعدة البيانات خارج مجلد المشروع عبر DATA_DIR. */
function resolveDatabaseUrl() {
  if (process.env.DATA_DIR) {
    const dir = path.resolve(process.env.DATA_DIR);
    fs.mkdirSync(dir, { recursive: true });
    process.env.DATABASE_URL = `file:${path.join(dir, 'mizan.db')}`;
  }
  return process.env.DATABASE_URL;
}

const PROJECT = path.join(ROOT, '..');

/** يشغّل أمراً في مجلد ويُظهر مخرجاته للمستخدم. */
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
}

/**
 * شبكة أمان: بعض المشغّلات تكتفي بـ `node index.js` دون خطوة بناء.
 * إن كانت الواجهة غير مبنيّة نبنيها مرة واحدة عند الإقلاع.
 */
function ensureFrontendBuilt() {
  const web = path.join(PROJECT, 'frontend');
  if (!fs.existsSync(web)) return;
  if (fs.existsSync(path.join(web, 'dist', 'index.html'))) return;

  try {
    if (!fs.existsSync(path.join(web, 'node_modules'))) {
      console.log('… تثبيت حزم الواجهة (مرة واحدة)');
      run('npm', ['install', '--no-audit', '--no-fund'], web);
    }
    console.log('… بناء الواجهة (مرة واحدة)');
    run('npm', ['run', 'build'], web);
  } catch {
    console.warn('تعذّر بناء الواجهة تلقائياً — شغّل: npm run setup');
  }
}

/** ينشئ الجداول إن لم تكن موجودة. */
function pushSchema() {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'pipe',
  });
}

/**
 * يجهّز قاعدة البيانات عند الحاجة فقط.
 * يعيد بيانات الدخول الأولى إن كانت هذه أول مرة.
 */
async function prepareDatabase() {
  const prisma = require('./lib/prisma');
  let fresh = false;

  try {
    await prisma.user.count();
  } catch {
    console.log('… تجهيز قاعدة البيانات لأول مرة');
    pushSchema();
    fresh = true;
  }

  // قاعدة موجودة لكنها فارغة (مثلاً حُذف ملفها) — نبذرها أيضاً
  if (!fresh && (await prisma.user.count()) === 0) fresh = true;

  if (!fresh) return null;

  const { main: seed } = require('../prisma/seed');
  const credentials = await seed();
  return credentials;
}

module.exports = { ensureEnvFile, resolveDatabaseUrl, ensureFrontendBuilt, prepareDatabase, ROOT };
