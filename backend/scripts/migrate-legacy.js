'use strict';

/**
 * ترحيل قاعدة ما قبل تعدّد المنشآت يدوياً.
 *
 * الإقلاع يفعل هذا تلقائياً بعد نسخة احتياطية، وهذا السكربت لمن أراد تنفيذه
 * بنفسه ورؤية ما يجري قبل تشغيل التطبيق.
 *
 *   node scripts/migrate-legacy.js
 */

const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { ensureEnvFile, resolveDatabaseUrl, ensurePrismaClient } = require('../src/bootstrap');

ensureEnvFile();
resolveDatabaseUrl();
ensurePrismaClient();

const { needsMigration, migrate } = require('../src/lib/migrateLegacy');
const systemDb = require('../src/lib/systemDb');
const { disconnectAll } = require('../src/lib/businessDb');

async function main() {
  if (!(await needsMigration())) {
    console.log('لا شيء يُرحَّل: لا توجد قاعدة قديمة، أو الترحيل نُفِّذ مسبقاً.');
    return;
  }

  const result = await migrate();
  console.log(`\nتمّ. المستخدمون المنقولون: ${result.users}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
    await systemDb.disconnect();
  });
