'use strict';

// قاعدة بيانات مستقلة لكل ملف اختبار — node --test يشغّل الملفات بالتوازي
const nodePath = require('node:path');
const suite = nodePath.basename(process.argv[1] || 'suite', '.js');

// تُضبط قبل تحميل عميل Prisma
process.env.DATABASE_URL = `file:./test-${suite}.db`;
process.env.JWT_SECRET = 'test-secret';
process.env.SEED_EMAIL = 'tester@mizan.local';
process.env.SEED_PASSWORD = 'Test@12345';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** يعيد بناء قاعدة بيانات الاختبار من الصفر. */
function resetDatabase() {
  for (const suffix of ['', '-journal']) {
    fs.rmSync(path.join(ROOT, 'prisma', `test-${suite}.db${suffix}`), { force: true });
  }
  const options = { cwd: ROOT, env: process.env, stdio: 'pipe' };
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], options);
  execFileSync('node', ['prisma/seed.js'], options);
}

/** يشغّل الخادم على منفذ عشوائي ويعيد أدوات مناداة الواجهة. */
async function startServer() {
  resetDatabase();

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
    del: (route) => call('DELETE', route),
    setToken: (value) => { token = value; },
    async login(email = process.env.SEED_EMAIL, password = process.env.SEED_PASSWORD) {
      const res = await call('POST', '/api/auth/login', { email, password });
      if (res.status !== 200) throw new Error(`فشل تسجيل الدخول: ${JSON.stringify(res.body)}`);
      token = res.body.token;
      return res.body.user;
    },
    async accountByCode(code) {
      const res = await call('GET', `/api/accounts?q=${encodeURIComponent(code)}`);
      const found = res.body.accounts.find((a) => a.code === code);
      if (!found) throw new Error(`حساب غير موجود: ${code}`);
      return found;
    },
    async close() {
      const prisma = require('../src/lib/prisma');
      await prisma.$disconnect();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  return api;
}

module.exports = { startServer, resetDatabase };
