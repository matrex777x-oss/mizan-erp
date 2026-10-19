'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

test('بيانات المنشأة الموسّعة تُحفظ وتُقرأ', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const res = await api.patch('/api/settings', {
    companyName: 'مؤسسة الاختبار التجارية',
    taxNumber: '300000000000003',
    address: 'الرياض — طريق الملك فهد',
    phone: '0551234567',
    email: 'info@test.local',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.taxNumber, '300000000000003');
  assert.equal(res.body.settings.phone, '0551234567');

  const read = await api.get('/api/settings');
  assert.equal(read.body.settings.address, 'الرياض — طريق الملك فهد');
  assert.equal(read.body.settings.email, 'info@test.local');
});

test('ترقيم المستندات يتبع الإعدادات', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const party = await api.post('/api/parties', { kind: 'BOTH', name: 'طرف' });
  const sales = await api.accountByCode('4101');

  async function newInvoice(date = '2026-06-01') {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date,
      partyId: party.body.party.id,
      lines: [{ description: 'بند', quantity: '1', unitPrice: '100.00', accountId: sales.id }],
    });
    assert.equal(res.status, 201);
    return res.body.invoice.number;
  }

  await t.test('الافتراضي INV-السنة-0001', async () => {
    assert.equal(await newInvoice(), 'INV-2026-0001');
    assert.equal(await newInvoice(), 'INV-2026-0002');
  });

  await t.test('تغيير البادئة يبدأ تسلسلاً جديداً ولا يمسّ القديم', async () => {
    const changed = await api.patch('/api/settings', { prefixSales: 'SAL' });
    assert.equal(changed.status, 200);

    assert.equal(await newInvoice(), 'SAL-2026-0001');

    // الأرقام القديمة باقية كما هي
    const list = await api.get('/api/invoices?kind=SALES');
    const numbers = list.body.invoices.map((i) => i.number).sort();
    assert.deepEqual(numbers, ['INV-2026-0001', 'INV-2026-0002', 'SAL-2026-0001']);
  });

  await t.test('عدد الخانات يُضبط', async () => {
    await api.patch('/api/settings', { prefixSales: 'A', numberPadding: 6 });
    assert.equal(await newInvoice(), 'A-2026-000001');
  });

  await t.test('إسقاط العام من الرقم', async () => {
    await api.patch('/api/settings', { prefixSales: 'B', numberIncludeYear: false });
    assert.equal(await newInvoice(), 'B-000001');
  });

  await t.test('بادئة مكرّرة مرفوضة', async () => {
    const res = await api.patch('/api/settings', { prefixSales: 'PUR' });
    assert.equal(res.status, 400);
  });

  await t.test('بادئة غير صالحة مرفوضة', async () => {
    assert.equal((await api.patch('/api/settings', { prefixSales: 'بادئة' })).status, 400);
    assert.equal((await api.patch('/api/settings', { prefixSales: 'TOOLONGPREFIX' })).status, 400);
    assert.equal((await api.patch('/api/settings', { numberPadding: 0 })).status, 400);
    assert.equal((await api.patch('/api/settings', { numberPadding: 99 })).status, 400);
  });
});

test('وحدة المخزون تُعطَّل قبل أي حركة لا بعدها', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const sales = await api.accountByCode('4101');
  const capital = await api.accountByCode('3101');

  await t.test('التعطيل جائز والمنشأة نظيفة', async () => {
    const res = await api.patch('/api/settings', { inventoryEnabled: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.inventoryEnabled, false);
  });

  await t.test('الصنف المخزني مرفوض والخدمي مقبول', async () => {
    const stock = await api.post('/api/items', {
      code: 'S-1',
      name: 'بضاعة',
      kind: 'STOCK',
      salesAccountId: sales.id,
    });
    assert.equal(stock.status, 400);

    const service = await api.post('/api/items', {
      code: 'SRV-1',
      name: 'خدمة',
      kind: 'SERVICE',
      salesAccountId: sales.id,
    });
    assert.equal(service.status, 201);
  });

  await t.test('تسوية المخزون مرفوضة', async () => {
    const res = await api.post('/api/stock-adjustments', {
      date: '2026-06-01',
      counterAccountId: capital.id,
      lines: [],
    });
    assert.equal(res.status, 400);
  });

  await t.test('بعد إعادة التفعيل وحركة مخزون لا يُقبل التعطيل', async () => {
    assert.equal((await api.patch('/api/settings', { inventoryEnabled: true })).status, 200);

    const item = await api.post('/api/items', {
      code: 'S-2',
      name: 'بضاعة',
      kind: 'STOCK',
      salesAccountId: sales.id,
    });
    assert.equal(item.status, 201);

    const adjustment = await api.post('/api/stock-adjustments', {
      date: '2026-06-01',
      counterAccountId: capital.id,
      post: true,
      lines: [{ itemId: item.body.item.id, direction: 'IN', quantity: '10', unitCost: '5.00' }],
    });
    assert.equal(adjustment.status, 201);

    const res = await api.patch('/api/settings', { inventoryEnabled: false });
    assert.equal(res.status, 400, 'التعطيل بعد الحركة يترك مخزوناً في الدفتر بلا شاشة');
  });
});

test('لوحة النظام: الحالة والنسخة الاحتياطية', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  await t.test('حالة النظام', async () => {
    const res = await api.get('/api/admin/system');
    assert.equal(res.status, 200);
    assert.ok(res.body.dataDir, 'يذكر أين تقع البيانات');
    assert.equal(res.body.counts.businesses, 1);
    assert.equal(res.body.counts.activeUsers, 1);
    assert.equal(res.body.businesses[0].slug, api.seeded.business.slug);
    assert.ok(res.body.businesses[0].size > 0, 'حجم قاعدة المنشأة معروف');
  });

  await t.test('تنزيل نسخة احتياطية يعطي قاعدة سليمة', async () => {
    const token = api.getToken();
    const response = await fetch(`${api.base}/api/admin/system/backup/${api.seeded.business.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);

    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 1000, 'الملف ليس فارغاً');
    // ملف SQLite يبدأ دائماً بهذه الترويسة
    assert.equal(buffer.subarray(0, 15).toString('utf8'), 'SQLite format 3');
  });

  await t.test('منشأة غير موجودة', async () => {
    const res = await api.get('/api/admin/system/backup/not-a-business');
    assert.equal(res.status, 404);
  });

  await t.test('غير الآدمن لا يصل إلى لوحة النظام', async () => {
    const { user, password } = await api.createUser({
      email: 'plain@mizan.local',
      businessId: api.seeded.business.id,
      role: 'ACCOUNTANT',
    });
    await api.login(user.email, password);

    assert.equal((await api.get('/api/admin/system')).status, 403);
    assert.equal(
      (await api.get(`/api/admin/system/backup/${api.seeded.business.id}`)).status,
      403,
    );
  });
});
