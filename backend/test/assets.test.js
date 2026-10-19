'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

async function createAsset(api, overrides = {}) {
  const res = await api.post('/api/fixed-assets', {
    name: 'سيارة توصيل',
    acquiredAt: '2025-01-15',
    cost: '60000.00',
    salvageValue: '0',
    method: 'STRAIGHT_LINE',
    usefulLifeMonths: 60,
    ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.asset;
}

async function trialBalance(api) {
  const res = await api.get('/api/reports/trial-balance');
  assert.equal(res.status, 200);
  return res.body;
}

function rowOf(tb, code) {
  return tb.rows.find((r) => r.code === code);
}

test('القسط الثابت: الإهلاك الشهري والمجمّع', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const asset = await createAsset(api);

  await t.test('القسط الشهري 60000 ÷ 60 = 1000', async () => {
    assert.equal(asset.monthly, '1000.00');
    assert.equal(asset.bookValue, '60000.00');
    assert.equal(asset.accumulated, '0.00');
    assert.ok(asset.code.startsWith('FA-'), 'كود تلقائي');
  });

  await t.test('المعاينة تحسب الأشهر من الاقتناء', async () => {
    // من يناير إلى مارس = 3 أشهر
    const res = await api.get('/api/fixed-assets/depreciation/due?periodEnd=2025-03-31');
    assert.equal(res.status, 200);
    assert.equal(res.body.assets.length, 1);
    assert.equal(res.body.assets[0].months, 3);
    assert.equal(res.body.total, '3000.00');
  });

  await t.test('الترحيل ينشئ قيداً ويحرّك الحسابات', async () => {
    const res = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-03-31' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.total, '3000.00');
    assert.ok(res.body.entryNumber);

    const tb = await trialBalance(api);
    assert.equal(rowOf(tb, '5210').balanceDebit, '3000.00', 'مصروف الإهلاك مدين');
    assert.equal(rowOf(tb, '1409').balanceCredit, '3000.00', 'مجمّع الإهلاك دائن');
    assert.equal(tb.totals.balanced, true);
  });

  await t.test('البطاقة تعكس المجمّع والرصيد الدفتري', async () => {
    const res = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(res.body.asset.accumulated, '3000.00');
    assert.equal(res.body.asset.bookValue, '57000.00');
    assert.equal(res.body.asset.depreciations.length, 1);
    assert.equal(res.body.asset.depreciations[0].months, 3);
  });

  await t.test('الترحيل التالي يكمل من حيث انتهى', async () => {
    const res = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-05-31' });
    assert.equal(res.status, 201);
    assert.equal(res.body.total, '2000.00', 'أبريل ومايو');

    const card = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(card.body.asset.accumulated, '5000.00');
    assert.equal(card.body.asset.bookValue, '55000.00');
  });

  await t.test('لا إهلاك مكرّر لنفس الفترة', async () => {
    const res = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-05-31' });
    assert.equal(res.status, 400);
  });

  await t.test('التراجع عن دفعة إهلاك', async () => {
    const journal = await api.get('/api/journal');
    const latest = journal.body.entries[0];

    // لا يُحذف قيد الإهلاك من شاشة القيود: مصدره مستند
    assert.equal((await api.del(`/api/journal/${latest.id}`)).status, 400);

    const res = await api.del(`/api/fixed-assets/depreciation/${latest.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const card = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(card.body.asset.accumulated, '3000.00', 'عاد المجمّع إلى ما قبل الدفعة');

    const tb = await trialBalance(api);
    assert.equal(rowOf(tb, '1409').balanceCredit, '3000.00');
    assert.equal(tb.totals.balanced, true);
  });

  await t.test('لا تُحذف دفعة قبل أحدث منها', async () => {
    await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-05-31' });
    await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-07-31' });

    const journal = await api.get('/api/journal');
    // الأقدم من الدفعتين
    const older = journal.body.entries.find((e) => e.date === '2025-05-31');
    const res = await api.del(`/api/fixed-assets/depreciation/${older.id}`);
    assert.equal(res.status, 400);
  });
});

test('القسط الثابت لا يتجاوز الأساس القابل للإهلاك', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  // عمر قصير: 3 أشهر، وقيمة تخريدية
  const asset = await createAsset(api, {
    cost: '10000.00',
    salvageValue: '1000.00',
    usefulLifeMonths: 3,
    acquiredAt: '2025-01-10',
  });
  assert.equal(asset.monthly, '3000.00', '9000 ÷ 3');

  await t.test('بعد انقضاء العمر يقف الإهلاك عند 9000', async () => {
    const res = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-12-31' });
    assert.equal(res.status, 201);
    assert.equal(res.body.total, '9000.00', 'لا يتجاوز التكلفة ناقص التخريدية');

    const card = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(card.body.asset.accumulated, '9000.00');
    assert.equal(card.body.asset.bookValue, '1000.00', 'يبقى بالقيمة التخريدية');
    assert.equal(card.body.asset.fullyDepreciated, true);
  });

  await t.test('لا إهلاك بعد اكتماله', async () => {
    const due = await api.get('/api/fixed-assets/depreciation/due?periodEnd=2026-06-30');
    assert.equal(due.body.assets.length, 0);

    const res = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2026-06-30' });
    assert.equal(res.status, 400);
  });
});

test('القسط المتناقص يتناقص مع الرصيد', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const asset = await createAsset(api, {
    name: 'أجهزة حاسب',
    cost: '12000.00',
    method: 'DECLINING_BALANCE',
    decliningRate: '24',
    acquiredAt: '2025-01-05',
  });

  await t.test('الشهر الأول 12000 × 24% ÷ 12 = 240', async () => {
    assert.equal(asset.monthly, '240.00');
  });

  await t.test('الشهر الثاني أقل من الأول', async () => {
    const first = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-01-31' });
    assert.equal(first.body.total, '240.00');

    const second = await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-02-28' });
    // (12000 - 240) × 24% ÷ 12 = 235.20
    assert.equal(second.body.total, '235.20');

    const card = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(card.body.asset.accumulated, '475.20');
  });

  await t.test('المتناقص بلا نسبة مرفوض', async () => {
    const res = await api.post('/api/fixed-assets', {
      name: 'بلا نسبة',
      acquiredAt: '2025-01-01',
      cost: '1000.00',
      method: 'DECLINING_BALANCE',
      decliningRate: '0',
    });
    assert.equal(res.status, 400);
  });
});

test('استبعاد الأصل: ربح وخسارة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const cash = await api.accountByCode('1101');
  const otherIncome = await api.accountByCode('4201');
  const misc = await api.accountByCode('5299');

  await t.test('بيع بأكثر من القيمة الدفترية = ربح', async () => {
    const asset = await createAsset(api, { cost: '60000.00', usefulLifeMonths: 60, acquiredAt: '2025-01-15' });
    await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-12-31' });

    // 12 شهراً × 1000 = 12000، فالقيمة الدفترية 48000
    const card = await api.get(`/api/fixed-assets/${asset.id}`);
    assert.equal(card.body.asset.bookValue, '48000.00');

    const res = await api.post(`/api/fixed-assets/${asset.id}/dispose`, {
      date: '2026-01-15',
      proceeds: '50000.00',
      cashAccountId: cash.id,
      gainLossAccountId: otherIncome.id,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bookValue, '48000.00');
    assert.equal(res.body.result, '2000.00', 'ربح 2000');
    assert.equal(res.body.asset.status, 'DISPOSED');

    const tb = await trialBalance(api);
    assert.equal(tb.totals.balanced, true);
    assert.equal(rowOf(tb, '4201').balanceCredit, '2000.00');
    // الحساب يبقى في الميزان بحركته، ورصيده صفر: دخل وخرج
    assert.equal(rowOf(tb, '1409').balanceCredit, '0.00', 'مجمّع الإهلاك أُقفل');
    assert.equal(rowOf(tb, '1409').balanceDebit, '0.00');
    assert.equal(rowOf(tb, '1401').balanceDebit, '0.00', 'تكلفة الأصل خرجت من الدفتر');
  });

  await t.test('بيع بأقل من القيمة الدفترية = خسارة', async () => {
    const asset = await createAsset(api, {
      name: 'أثاث',
      cost: '20000.00',
      usefulLifeMonths: 40,
      acquiredAt: '2025-06-01',
    });

    const res = await api.post(`/api/fixed-assets/${asset.id}/dispose`, {
      date: '2026-02-01',
      proceeds: '15000.00',
      cashAccountId: cash.id,
      gainLossAccountId: misc.id,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result, '-5000.00', 'خسارة 5000 بلا إهلاك مرحَّل');

    const tb = await trialBalance(api);
    assert.equal(tb.totals.balanced, true);
  });

  await t.test('الاستبعاد بلا حصيلة يقيّد الخسارة كاملة', async () => {
    const asset = await createAsset(api, { name: 'تالف', cost: '3000.00', acquiredAt: '2026-01-01' });

    const res = await api.post(`/api/fixed-assets/${asset.id}/dispose`, {
      date: '2026-03-01',
      proceeds: '0',
      gainLossAccountId: misc.id,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result, '-3000.00');
  });

  await t.test('لا استبعاد مرتين', async () => {
    const list = await api.get('/api/fixed-assets?status=DISPOSED');
    const disposed = list.body.assets[0];

    const res = await api.post(`/api/fixed-assets/${disposed.id}/dispose`, {
      date: '2026-04-01',
      proceeds: '0',
      gainLossAccountId: misc.id,
    });
    assert.equal(res.status, 400);
  });

  await t.test('الأصل المستبعَد لا يُهلَك', async () => {
    const due = await api.get('/api/fixed-assets/depreciation/due?periodEnd=2026-06-30');
    const ids = due.body.assets.map((a) => a.code);
    const list = await api.get('/api/fixed-assets?status=DISPOSED');
    for (const asset of list.body.assets) {
      assert.ok(!ids.includes(asset.code), `${asset.code} مستبعَد ولا يُهلَك`);
    }
  });
});

test('قيد الاقتناء الاختياري', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const cash = await api.accountByCode('1101');

  await t.test('بلا قيد: الدفتر لا يتحرّك', async () => {
    await createAsset(api, { cost: '5000.00' });
    const tb = await trialBalance(api);
    assert.equal(tb.totals.debit, '0.00', 'البطاقة وحدها لا تقيّد شيئاً');
  });

  await t.test('مع قيد: من الأصل إلى النقدية', async () => {
    await createAsset(api, {
      name: 'طابعة',
      cost: '2500.00',
      postAcquisition: true,
      creditAccountId: cash.id,
    });

    const tb = await trialBalance(api);
    assert.equal(rowOf(tb, '1401').balanceDebit, '2500.00');
    assert.equal(rowOf(tb, '1101').balanceCredit, '2500.00');
    assert.equal(tb.totals.balanced, true);
  });
});

test('حماية البطاقة بعد ترحيل الإهلاك', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const asset = await createAsset(api);

  await t.test('التعديل قبل الإهلاك جائز', async () => {
    const res = await api.patch(`/api/fixed-assets/${asset.id}`, { cost: '72000.00' });
    assert.equal(res.status, 200);
    assert.equal(res.body.asset.monthly, '1200.00');
  });

  await t.test('الحذف قبل الإهلاك جائز', async () => {
    const temp = await createAsset(api, { name: 'مؤقت', code: 'FA-TEMP' });
    assert.equal((await api.del(`/api/fixed-assets/${temp.id}`)).status, 200);
  });

  await t.test('بعد الإهلاك: لا تعديل للتكلفة ولا حذف', async () => {
    await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-03-31' });

    assert.equal((await api.patch(`/api/fixed-assets/${asset.id}`, { cost: '80000.00' })).status, 400);
    assert.equal((await api.patch(`/api/fixed-assets/${asset.id}`, { usefulLifeMonths: 24 })).status, 400);
    assert.equal((await api.del(`/api/fixed-assets/${asset.id}`)).status, 400);

    // الاسم والملاحظات تبقى قابلة للتعديل
    assert.equal((await api.patch(`/api/fixed-assets/${asset.id}`, { name: 'اسم جديد' })).status, 200);
  });
});

test('صلاحية الأصول', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await createAsset(api);

  const { user, password } = await api.createUser({
    email: 'sales4@mizan.local',
    businessId: api.seeded.business.id,
    role: 'SALES',
  });
  await api.login(user.email, password);

  assert.equal((await api.get('/api/fixed-assets')).status, 403, 'المبيعات لا شأن لها بالأصول');

  const viewer = await api.createUser({
    email: 'viewer5@mizan.local',
    businessId: api.seeded.business.id,
    role: 'VIEWER',
  });
  await api.login(viewer.user.email, viewer.password);

  assert.equal((await api.get('/api/fixed-assets')).status, 200);
  assert.equal(
    (await api.post('/api/fixed-assets/depreciation', { periodEnd: '2025-03-31' })).status,
    403,
  );
});
