'use strict';

const { ensureEnvFile, resolveDatabaseUrl, ensureFrontendBuilt, prepareDatabase } = require('./bootstrap');

ensureEnvFile();
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
resolveDatabaseUrl();

const { createApp } = require('./app');

// المشغّلات الخارجية (تطبيقات الأنفاق، المنصات، الحاويات) تمرّر المنفذ بيئياً
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

async function start() {
  ensureFrontendBuilt();
  const credentials = await prepareDatabase();

  createApp().listen(port, host, () => {
    console.log('');
    console.log(`  ميزان — نظام محاسبي`);
    console.log(`  يعمل على http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (credentials) {
      console.log('');
      console.log('  أول تشغيل — بيانات الدخول:');
      console.log(`    ${credentials.email}`);
      console.log(`    ${credentials.password}`);
      console.log('  غيّرها فوراً قبل أي استخدام حقيقي.');
    }
    console.log('');
  });
}

start().catch((err) => {
  console.error('تعذّر إقلاع الخادم:', err);
  process.exit(1);
});
