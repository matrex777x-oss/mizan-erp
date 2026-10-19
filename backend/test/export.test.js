'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');
const { findBrowser } = require('../src/services/exporters');

const SAMPLE = {
  title: 'ميزان المراجعة',
  subtitle: 'حتى 2026-12-31',
  columns: [
    { label: 'الحساب' },
    { label: 'مدين', numeric: true },
    { label: 'دائن', numeric: true },
  ],
  rows: [
    ['1101 — الصندوق', '12000.00', '0.00'],
    ['4101 — إيرادات المبيعات', '0.00', '12000.00'],
  ],
  totals: ['الإجمالي', '12000.00', '12000.00'],
};

/** ينزّل ملفاً ثنائياً من مسار التصدير. */
async function download(api, path, body) {
  const response = await fetch(api.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.getToken()}` },
    body: JSON.stringify(body),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buffer, headers: response.headers };
}

test('تصدير Excel', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await api.patch('/api/settings', { companyName: 'مؤسسة التصدير', taxNumber: '300000000000003' });

  await t.test('الملف xlsx سليم', async () => {
    const res = await download(api, '/api/export/xlsx', SAMPLE);
    assert.equal(res.status, 200);

    // xlsx أرشيف zip، وترويسته PK
    assert.equal(res.buffer.subarray(0, 2).toString('latin1'), 'PK');
    assert.ok(res.buffer.length > 2000, 'الملف ليس فارغاً');
    assert.match(
      res.headers.get('content-type'),
      /spreadsheetml\.sheet/,
      'نوع المحتوى xlsx',
    );
  });

  await t.test('المحتوى فيه ترويسة المنشأة والأرقام أعداد', async () => {
    const res = await download(api, '/api/export/xlsx', SAMPLE);

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.buffer);

    const sheet = workbook.worksheets[0];
    assert.equal(sheet.views[0].rightToLeft, true, 'الورقة من اليمين لليسار');

    const text = [];
    sheet.eachRow((row) => row.eachCell((cell) => text.push(String(cell.value))));
    const joined = text.join(' | ');

    assert.match(joined, /مؤسسة التصدير/, 'اسم المنشأة في الترويسة');
    assert.match(joined, /300000000000003/, 'الرقم الضريبي');
    assert.match(joined, /ميزان المراجعة/, 'عنوان التقرير');

    // العمود الرقمي عدد لا نص، وإلا لم يُجمع في Excel
    let numericFound = false;
    sheet.eachRow((row) => {
      const cell = row.getCell(2);
      if (typeof cell.value === 'number' && cell.value === 12000) numericFound = true;
    });
    assert.ok(numericFound, 'المبالغ دخلت أعداداً');
  });

  await t.test('يرفض ما لا عنوان له ولا أعمدة', async () => {
    assert.equal((await download(api, '/api/export/xlsx', { columns: [], rows: [] })).status, 400);
    assert.equal(
      (await download(api, '/api/export/xlsx', { title: 'بلا أعمدة', columns: [] })).status,
      400,
    );
  });

  await t.test('يرفض ما يتجاوز الحد', async () => {
    const rows = Array.from({ length: 20001 }, () => ['x', '1.00', '0.00']);
    const res = await download(api, '/api/export/xlsx', { ...SAMPLE, rows });
    assert.equal(res.status, 400);
  });
});

test('قدرات التصدير معلنة للواجهة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const res = await api.get('/api/export/capabilities');
  assert.equal(res.status, 200);
  assert.equal(res.body.xlsx, true);
  assert.equal(res.body.pdf, Boolean(findBrowser()), 'PDF متاح بقدر ما يوجد متصفّح');
});

test('المُطّلع يصدّر ما يراه', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const { user, password } = await api.createUser({
    email: 'viewer6@mizan.local',
    businessId: api.seeded.business.id,
    role: 'VIEWER',
  });
  await api.login(user.email, password);

  const res = await download(api, '/api/export/xlsx', SAMPLE);
  assert.equal(res.status, 200, 'التصدير ليس كتابةً في الدفتر');
});

test('التصدير يحتاج جلسة ومنشأة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const response = await fetch(`${api.base}/api/export/xlsx`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SAMPLE),
  });
  assert.equal(response.status, 401);
});

// توليد PDF يشغّل متصفّحاً حقيقياً، فيُتخطّى حين لا يوجد واحد على الجهاز
test('تصدير PDF', { skip: findBrowser() ? false : 'لا متصفّح على هذا الجهاز' }, async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await api.patch('/api/settings', { companyName: 'مؤسسة التصدير' });

  const res = await download(api, '/api/export/pdf', SAMPLE);
  assert.equal(res.status, 200);
  assert.equal(res.buffer.subarray(0, 5).toString('latin1'), '%PDF-', 'ملف PDF حقيقي');
  assert.ok(res.buffer.length > 5000, 'الملف ليس صفحة فارغة');
  assert.match(res.headers.get('content-type'), /application\/pdf/);
});
