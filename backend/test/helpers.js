'use strict';

// مجلد بيانات مستقل لكل ملف اختبار — node --test يشغّل الملفات بالتوازي،
// فلكل ملف قاعدة نظامه وقواعد منشآته وحده.
const nodePath = require('node:path');

const suite = nodePath.basename(process.argv[1] || 'suite', '.js');

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'prisma', 'test-data', suite);

// تُضبط قبل تحميل أي وحدة تقرأ المسارات أو تتصل بقاعدة
process.env.DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = 'test-secret';
process.env.SEED_EMAIL = 'tester@mizan.local';
process.env.SEED_PASSWORD = 'Test@12345';
// حتى لا يُلتقط dev.db الحقيقي فيُرحَّل أثناء الاختبارات
process.env.LEGACY_DB_PATH = path.join(DATA_DIR, 'no-legacy.db');

const password = require('../src/lib/password');
const systemDb = require('../src/lib/systemDb');
const businessDb = require('../src/lib/businessDb');
const { ensureSystemSchema } = require('../src/lib/systemBootstrap');

const FIRST = { name: 'منشأة الاختبار', slug: 'test-main' };

/**
 * يعيد بناء بيانات الاختبار من الصفر: قاعدة نظام بمستخدم مالك، ومنشأة واحدة
 * بقاعدتها وشجرة حساباتها.
 */
async function resetDatabase() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  ensureSystemSchema();

  const user = await systemDb.user.create({
    data: {
      email: process.env.SEED_EMAIL,
      name: 'مستخدم الاختبار',
      password: await password.hash(process.env.SEED_PASSWORD),
      isAdmin: true,
      // الاختبارات تدخل مباشرة، فلا إلزام بتغيير كلمة المرور هنا
      mustChangePassword: false,
    },
  });

  const business = await systemDb.business.create({ data: FIRST });
  await businessDb.createBusinessDb(FIRST.slug, { companyName: FIRST.name });
  await systemDb.membership.create({
    data: { userId: user.id, businessId: business.id, role: 'OWNER' },
  });

  return { user, business };
}

/** ينشئ منشأة إضافية ويعيدها — لاختبار العزل بين المنشآت. */
async function createBusiness(name, slug, { ownerId, role = 'OWNER' } = {}) {
  const business = await systemDb.business.create({ data: { name, slug } });
  await businessDb.createBusinessDb(slug, { companyName: name });
  if (ownerId) {
    await systemDb.membership.create({ data: { userId: ownerId, businessId: business.id, role } });
  }
  return business;
}

/** ينشئ مستخدماً بدور في منشأة، جاهزاً للدخول (بلا إلزام تغيير). */
async function createUser({ email, name = 'موظف', isAdmin = false, businessId, role = 'ACCOUNTANT', pass = 'Test@12345' }) {
  const user = await systemDb.user.create({
    data: {
      email,
      name,
      isAdmin,
      password: await password.hash(pass),
      mustChangePassword: false,
    },
  });
  if (businessId) {
    await systemDb.membership.create({ data: { userId: user.id, businessId, role } });
  }
  return { user, password: pass };
}

/** يشغّل الخادم على منفذ عشوائي ويعيد أدوات مناداة الواجهة. */
async function startServer() {
  const seeded = await resetDatabase();

  const { createApp } = require('../src/app');
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  let token = null;

  async function call(method, route, body) {
    const response = await fetch(base + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return { status: response.status, body: payload };
  }

  const api = {
    get: (route) => call('GET', route),
    post: (route, body) => call('POST', route, body),
    patch: (route, body) => call('PATCH', route, body),
    put: (route, body) => call('PUT', route, body),
    del: (route) => call('DELETE', route),
    setToken: (value) => {
      token = value;
    },
    getToken: () => token,
    // لتنزيل ملف ثنائي خارج مساعد call الذي يفكّ JSON
    base,
    seeded,
    createBusiness,
    createUser,
    async login(email = process.env.SEED_EMAIL, pass = process.env.SEED_PASSWORD) {
      const res = await call('POST', '/api/auth/login', { email, password: pass });
      if (res.status !== 200) throw new Error(`فشل تسجيل الدخول: ${JSON.stringify(res.body)}`);
      token = res.body.token;
      return res.body;
    },
    /** يبدّل المنشأة الجارية لهذه الجلسة. */
    async selectBusiness(businessId) {
      const res = await call('POST', '/api/auth/select-business', { businessId });
      if (res.status === 200) token = res.body.token;
      return res;
    },
    async accountByCode(code) {
      const res = await call('GET', `/api/accounts?q=${encodeURIComponent(code)}`);
      const found = res.body.accounts.find((a) => a.code === code);
      if (!found) throw new Error(`حساب غير موجود: ${code}`);
      return found;
    },
    async close() {
      await businessDb.disconnectAll();
      await systemDb.disconnect();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  return api;
}

module.exports = { startServer, resetDatabase, createBusiness, createUser, DATA_DIR, FIRST };
