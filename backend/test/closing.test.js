'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

/** يسجّل إيراداً ومصروفاً في تاريخ معيّن بقيد يدوي متوازن. */
async function postResult(api, { date, income, expense }) {
  const cash = await api.accountByCode('1101');
  const sales = await api.accountByCode('4101');
  const misc = await api.accountByCode('5299');

  if (Number(income) > 0) {
    const res = await api.post('/api/journal', {
      date,
      memo: 'إيراد',
      lines: [
        { accountId: cash.id, debit: income },
        { accountId: sales.id, credit: income },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  if (Number(expense) > 0) {
    const res = await api.post('/api/journal', {
      date,
      memo: 'مصروف',
      lines: [
        { accountId: misc.id, debit: expense },
        { accountId: cash.id, credit: expense },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
}

async function balanceSheet(api, to) {
  const res = await api.get(`/api/reports/balance-sheet${to ? `?to=${to}` : ''}`);
  assert.equal(res.status, 200);
  return res.body;
}

/** رصيد الأرباح المحتجزة من ميزان المراجعة: دائن موجب ومدين سالب. */
async function retainedBalance(api) {
  const res = await api.get('/api/reports/trial-balance');
  assert.equal(res.status, 200);

  const row = res.body.rows.find((r) => r.code === '3201');
  if (!row) return '0.00';

  const credit = Number(row.balanceCredit);
  const debit = Number(row.balanceDebit);
  return (credit - debit).toFixed(2);
}

test('الإقفال السنوي يرحّل النتيجة إلى الأرباح المحتجزة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await postResult(api, { date: '2024-03-01', income: '10000.00', expense: '4000.00' });

  await t.test('السنة تظهر قابلة للإقفال بنتيجتها', async () => {
    const res = await api.get('/api/closing');
    assert.equal(res.status, 200);

    const year = res.body.closable.find((y) => y.label === '2024');
    assert.ok(year, 'سنة 2024 قابلة للإقفال');
    assert.equal(year.income, '10000.00');
    assert.equal(year.expense, '4000.00');
    assert.equal(year.netResult, '6000.00');
    assert.equal(year.endDate, '2024-12-31');
  });

  await t.test('المعاينة تُظهر ما سيُصفَّر', async () => {
    const res = await api.get('/api/closing/preview?end=2024-12-31');
    assert.equal(res.status, 200);
    assert.equal(res.body.netResult, '6000.00');
    assert.equal(res.body.lines.length, 2, 'حساب إيراد وحساب مصروف');
  });

  await t.test('قبل الإقفال: النتيجة في «نتيجة الفترة» لا في حقوق الملكية', async () => {
    const sheet = await balanceSheet(api);
    assert.equal(sheet.totals.netProfit, '6000.00');
    assert.equal(sheet.totals.balanced, true);
    assert.equal(await retainedBalance(api), '0.00');
  });

  await t.test('الإقفال يُنشئ قيداً ويرحّل النتيجة', async () => {
    const res = await api.post('/api/closing', { end: '2024-12-31' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.close.netResult, '6000.00');
    assert.equal(res.body.close.endDate, '2024-12-31');
    assert.ok(res.body.close.entryNumber, 'للإقفال قيد مرقَّم');
  });

  await t.test('بعد الإقفال: الأرباح المحتجزة 6000 والنتيجة صفر', async () => {
    assert.equal(await retainedBalance(api), '6000.00');

    const sheet = await balanceSheet(api);
    assert.equal(sheet.totals.netProfit, '0.00', 'الإيرادات والمصروفات صُفّرت');
    assert.equal(sheet.totals.balanced, true, 'المركز المالي ما زال متوازناً');
  });

  await t.test('ميزان المراجعة ما زال متوازناً', async () => {
    const res = await api.get('/api/reports/trial-balance');
    assert.equal(res.body.totals.balanced, true);
  });

  await t.test('قائمة دخل السنة المقفلة ما زالت تقرأ تاريخها', async () => {
    // الإقفال لا يمحو الحركة، إنما يضيف قيداً يصفّر الأرصدة في آخر يوم
    const res = await api.get('/api/reports/income-statement?from=2024-01-01&to=2024-12-30');
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.netProfit, '6000.00');
  });

  await t.test('الفترة صارت مقفلة فلا يُقبل قيد فيها', async () => {
    const cash = await api.accountByCode('1101');
    const sales = await api.accountByCode('4101');

    const res = await api.post('/api/journal', {
      date: '2024-06-01',
      lines: [
        { accountId: cash.id, debit: '100.00' },
        { accountId: sales.id, credit: '100.00' },
      ],
    });
    assert.equal(res.status, 400);
  });

  await t.test('لا يُقفل ما أُقفل', async () => {
    const res = await api.post('/api/closing', { end: '2024-12-31' });
    assert.equal(res.status, 400);
  });
});

test('إعادة الفتح تعيد الحال كما كان', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await postResult(api, { date: '2024-05-01', income: '8000.00', expense: '3000.00' });

  assert.equal((await api.post('/api/closing', { end: '2024-12-31' })).status, 201);
  assert.equal(await retainedBalance(api), '5000.00');

  await t.test('الفتح يحذف القيد ويعيد الأرباح المحتجزة إلى صفر', async () => {
    const res = await api.del('/api/closing/2024-12-31');
    assert.equal(res.status, 200);
    assert.equal(await retainedBalance(api), '0.00');

    const sheet = await balanceSheet(api);
    assert.equal(sheet.totals.netProfit, '5000.00', 'النتيجة عادت إلى الفترة');
    assert.equal(sheet.totals.balanced, true);
  });

  await t.test('القفل رُفع فيُقبل القيد في السنة ثانية', async () => {
    const cash = await api.accountByCode('1101');
    const sales = await api.accountByCode('4101');

    const res = await api.post('/api/journal', {
      date: '2024-06-01',
      lines: [
        { accountId: cash.id, debit: '100.00' },
        { accountId: sales.id, credit: '100.00' },
      ],
    });
    assert.equal(res.status, 201);
  });

  await t.test('إعادة الإقفال تحسب النتيجة من جديد', async () => {
    const res = await api.post('/api/closing', { end: '2024-12-31' });
    assert.equal(res.status, 201);
    assert.equal(res.body.close.netResult, '5100.00', 'القيد الجديد دخل في النتيجة');
  });
});

test('الإقفال يجري بالترتيب لا بالقفز', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await postResult(api, { date: '2023-04-01', income: '1000.00', expense: '400.00' });
  await postResult(api, { date: '2024-04-01', income: '2000.00', expense: '500.00' });

  await t.test('لا يُقفل 2024 قبل 2023', async () => {
    const res = await api.post('/api/closing', { end: '2024-12-31' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /2023/);
  });

  await t.test('الإقفال بالترتيب يتراكم في الأرباح المحتجزة', async () => {
    assert.equal((await api.post('/api/closing', { end: '2023-12-31' })).status, 201);
    assert.equal(await retainedBalance(api), '600.00');

    assert.equal((await api.post('/api/closing', { end: '2024-12-31' })).status, 201);
    assert.equal(await retainedBalance(api), '2100.00', '600 + 1500');
  });

  await t.test('لا يُعاد فتح الأقدم قبل الأحدث', async () => {
    const res = await api.del('/api/closing/2023-12-31');
    assert.equal(res.status, 400);
  });

  await t.test('الفتح بالعكس يعمل', async () => {
    assert.equal((await api.del('/api/closing/2024-12-31')).status, 200);
    assert.equal(await retainedBalance(api), '600.00');
    assert.equal((await api.del('/api/closing/2023-12-31')).status, 200);
    assert.equal(await retainedBalance(api), '0.00');
  });
});

test('حدود الإقفال', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await postResult(api, { date: '2024-04-01', income: '1000.00', expense: '0' });

  await t.test('تاريخ ليس نهاية سنة مالية مرفوض', async () => {
    const res = await api.post('/api/closing', { end: '2024-06-30' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /2024-12-31/);
  });

  await t.test('سنة لم تنتهِ بعد مرفوضة', async () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    const res = await api.post('/api/closing', { end: `${nextYear}-12-31` });
    assert.equal(res.status, 400);
  });

  await t.test('سنة بلا حركة مرفوضة', async () => {
    const res = await api.post('/api/closing', { end: '2019-12-31' });
    assert.equal(res.status, 400);
  });

  await t.test('الخسارة تُرحَّل مدينة', async () => {
    await postResult(api, { date: '2024-04-02', income: '0', expense: '2500.00' });

    const res = await api.post('/api/closing', { end: '2024-12-31' });
    assert.equal(res.status, 201);
    assert.equal(res.body.close.netResult, '-1500.00');
    assert.equal(await retainedBalance(api), '-1500.00');

    const sheet = await balanceSheet(api);
    assert.equal(sheet.totals.balanced, true, 'الخسارة لا تخلّ بالتوازن');
  });
});

test('السنة المالية غير الميلادية تُقفل بحدودها', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  // سنة مالية تبدأ في يوليو: 2024-07-01 إلى 2025-06-30
  assert.equal((await api.patch('/api/settings', { fiscalYearStart: 7 })).status, 200);

  await postResult(api, { date: '2024-08-01', income: '5000.00', expense: '1000.00' });
  await postResult(api, { date: '2025-03-01', income: '3000.00', expense: '0' });

  await t.test('حدود السنة من يوليو إلى يونيو', async () => {
    const res = await api.get('/api/closing');
    const year = res.body.closable.find((y) => y.label === '2024/2025');
    assert.ok(year, 'السنة المالية تمتد على عامين ميلاديين');
    assert.equal(year.startDate, '2024-07-01');
    assert.equal(year.endDate, '2025-06-30');
    assert.equal(year.netResult, '7000.00');
  });

  await t.test('الإقفال على 2025-06-30', async () => {
    assert.equal((await api.post('/api/closing', { end: '2025-06-30' })).status, 201);
    assert.equal(await retainedBalance(api), '7000.00');

    const sheet = await balanceSheet(api);
    assert.equal(sheet.totals.netProfit, '0.00');
    assert.equal(sheet.totals.balanced, true);
  });

  await t.test('31 ديسمبر ليس نهاية سنة هنا', async () => {
    const res = await api.post('/api/closing', { end: '2025-12-31' });
    assert.equal(res.status, 400);
  });
});

test('الصلاحية: المُطّلع يقرأ الإقفال ولا ينفّذه', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await postResult(api, { date: '2024-04-01', income: '1000.00', expense: '0' });

  const { user, password } = await api.createUser({
    email: 'viewer3@mizan.local',
    businessId: api.seeded.business.id,
    role: 'VIEWER',
  });
  await api.login(user.email, password);

  assert.equal((await api.get('/api/closing')).status, 200);
  assert.equal((await api.post('/api/closing', { end: '2024-12-31' })).status, 403);
  assert.equal((await api.del('/api/closing/2024-12-31')).status, 403);
});
