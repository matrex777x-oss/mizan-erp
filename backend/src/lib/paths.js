'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

/**
 * مجلد البيانات: `DATA_DIR` إن ضُبط، وإلا `backend/prisma`.
 *
 * استخدم `DATA_DIR` في التشغيل الحقيقي حتى تبقى قواعد المنشآت خارج المشروع
 * فلا تُفقد عند تحديث الكود.
 */
function dataDir() {
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(BACKEND_ROOT, 'prisma');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** قاعدة النظام: المستخدمون والمنشآت والصلاحيات. */
function systemDbPath() {
  return path.join(dataDir(), 'system.db');
}

/** مجلد قواعد المنشآت — ملف لكل منشأة. */
function businessesDir() {
  const dir = path.join(dataDir(), 'businesses');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function businessDbPath(slug) {
  return path.join(businessesDir(), `${slug}.db`);
}

/**
 * قاعدة ما قبل تعدّد المنشآت — وجودها يعني أن الترحيل لم يُنفَّذ بعد.
 * `LEGACY_DB_PATH` لمن كانت قاعدته القديمة في مكان آخر، وللاختبارات.
 */
function legacyDbPath() {
  return process.env.LEGACY_DB_PATH
    ? path.resolve(process.env.LEGACY_DB_PATH)
    : path.join(BACKEND_ROOT, 'prisma', 'dev.db');
}

/** صيغة عنوان SQLite التي يفهمها Prisma. المسار مطلق دائماً فلا يعتمد على مجلد العمل. */
function fileUrl(absolutePath) {
  return `file:${absolutePath}`;
}

module.exports = {
  BACKEND_ROOT,
  dataDir,
  systemDbPath,
  businessesDir,
  businessDbPath,
  legacyDbPath,
  fileUrl,
};
