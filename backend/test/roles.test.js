'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');
const { ROLE_CAPABILITIES, CAPABILITIES } = require('../src/lib/capabilities');

/** يدخل بدور معيّن في منشأة الاختبار ويعيد الـapi نفسه. */
async function asRole(api, role, email) {
  const { user, password } = await api.createUser({
    email,
    name: `مستخدم ${role}`,
    businessId: api.seeded.business.id,
    role,
  });
  await api.login(user.email, password);
  return user;
}

test('خريطة القدرات متماسكة', () => {
  for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
    assert.ok(caps.length > 0, `${role} بلا قدرات`);
    for (const cap of caps) {
      assert.ok(CAPABILITIES[cap], `${role} يملك قدرة غير معرَّفة: ${cap}`);
    }
    assert.equal(new Set(caps).size, caps.length, `${role} فيه قدرة مكرَّرة`);
  }

  // المُطّلع لا يملك أي قدرة كتابة أو ترحيل
  for (const cap of ROLE_CAPABILITIES.VIEWER) {
    assert.ok(!cap.endsWith('.write'), `المُطّلع يملك قدرة كتابة: ${cap}`);
    assert.ok(!cap.endsWith('.post'), `المُطّلع يملك قدرة ترحيل: ${cap}`);
  }

  // المالك وحده يغيّر إعدادات المنشأة
  for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
    if (role === 'OWNER') continue;
    assert.ok(!caps.includes('settings.write'), `${role} يغيّر الإعدادات`);
  }
});

test('دور المبيعات: مبيعاته وقبضه وعملاؤه لا غير', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const party = await api.post('/api/parties', { kind: 'BOTH', name: 'شركة النور' });
  const salesAccount = await api.accountByCode('4101');
  const cashbox = await api.accountByCode('1101');

  await asRole(api, 'SALES', 'sales@mizan.local');

  await t.test('ينشئ فاتورة مبيعات ويرحّلها', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-05-01',
      partyId: party.body.party.id,
      post: true,
      lines: [{ description: 'استشارة', quantity: '1', unitPrice: '1000.00', accountId: salesAccount.id }],
    });
    assert.equal(res.status, 201);
  });

  await t.test('لا ينشئ فاتورة مشتريات', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'PURCHASE',
      date: '2026-05-01',
      partyId: party.body.party.id,
      lines: [{ description: 'قرطاسية', quantity: '1', unitPrice: '50.00', accountId: salesAccount.id }],
    });
    assert.equal(res.status, 403);
  });

  await t.test('قائمة الفواتير تُظهر مبيعاته وتُخفي المشتريات', async () => {
    const all = await api.get('/api/invoices');
    assert.equal(all.status, 200);
    assert.ok(all.body.invoices.every((i) => i.kind === 'SALES'), 'لا تظهر فاتورة شراء واحدة');

    const purchases = await api.get('/api/invoices?kind=PURCHASE');
    assert.equal(purchases.status, 403);
  });

  await t.test('ينشئ سند قبض ولا ينشئ سند صرف', async () => {
    const receipt = await api.post('/api/payments', {
      kind: 'RECEIPT',
      date: '2026-05-02',
      partyId: party.body.party.id,
      cashAccountId: cashbox.id,
      amount: '500.00',
    });
    assert.equal(receipt.status, 201);

    const outgoing = await api.post('/api/payments', {
      kind: 'PAYMENT',
      date: '2026-05-02',
      partyId: party.body.party.id,
      cashAccountId: cashbox.id,
      amount: '500.00',
    });
    assert.equal(outgoing.status, 403);
  });

  await t.test('لا قيود يدوية ولا تعديل شجرة حسابات', async () => {
    assert.equal((await api.get('/api/journal')).status, 403);
    assert.equal(
      (await api.post('/api/journal', {
        date: '2026-05-03',
        lines: [
          { accountId: cashbox.id, debit: '10.00' },
          { accountId: salesAccount.id, credit: '10.00' },
        ],
      })).status,
      403,
    );
    assert.equal(
      (await api.post('/api/accounts', { code: '9999', name: 'حساب', type: 'ASSET' })).status,
      403,
    );
  });

  await t.test('لا تقارير مالية، والتشغيلية متاحة', async () => {
    assert.equal((await api.get('/api/reports/trial-balance')).status, 403);
    assert.equal((await api.get('/api/reports/income-statement')).status, 403);
    assert.equal((await api.get('/api/reports/balance-sheet')).status, 403);
    assert.equal((await api.get('/api/reports/aging')).status, 200);
    assert.equal((await api.get('/api/reports/stock')).status, 200);
  });

  await t.test('لوحة المؤشرات تُفتح بلا أرقام الدفتر', async () => {
    const res = await api.get('/api/reports/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.body.cash, undefined, 'لا يرى النقدية');
    assert.equal(res.body.monthProfit, undefined, 'لا يرى الربح');
    assert.ok(res.body.postedSalesInvoices !== undefined, 'يرى عدد فواتير مبيعاته');
  });

  await t.test('يعدّل الأصناف؟ لا — يقرؤها فقط', async () => {
    assert.equal((await api.get('/api/items')).status, 200);
    assert.equal(
      (await api.post('/api/items', { code: 'X1', name: 'صنف', salesAccountId: salesAccount.id })).status,
      403,
    );
  });

  await t.test('لا يغيّر إعدادات المنشأة', async () => {
    assert.equal((await api.get('/api/settings')).status, 200);
    assert.equal((await api.patch('/api/settings', { companyName: 'تغيير' })).status, 403);
  });
});

test('دور المخزن: الأصناف والتسويات لا الفواتير', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const salesAccount = await api.accountByCode('4101');
  const capital = await api.accountByCode('3101');
  const party = await api.post('/api/parties', { kind: 'SUPPLIER', name: 'مورد' });

  await asRole(api, 'INVENTORY', 'store@mizan.local');

  await t.test('ينشئ صنفاً', async () => {
    const res = await api.post('/api/items', {
      code: 'IT-1',
      name: 'بضاعة',
      kind: 'STOCK',
      salesAccountId: salesAccount.id,
    });
    assert.equal(res.status, 201);
  });

  await t.test('يسوّي المخزون ويرحّل التسوية', async () => {
    const items = await api.get('/api/items');
    const item = items.body.items.find((i) => i.code === 'IT-1');

    const res = await api.post('/api/stock-adjustments', {
      date: '2026-05-01',
      counterAccountId: capital.id,
      reason: 'رصيد افتتاحي',
      post: true,
      lines: [{ itemId: item.id, direction: 'IN', quantity: '100', unitCost: '5.00' }],
    });
    assert.equal(res.status, 201);
  });

  await t.test('لا ينشئ فواتير ولا سندات', async () => {
    assert.equal(
      (await api.post('/api/invoices', {
        kind: 'PURCHASE',
        date: '2026-05-01',
        partyId: party.body.party.id,
        lines: [{ description: 'شراء', quantity: '1', unitPrice: '10.00', accountId: salesAccount.id }],
      })).status,
      403,
    );
    assert.equal(
      (await api.post('/api/payments', {
        kind: 'PAYMENT',
        date: '2026-05-01',
        partyId: party.body.party.id,
        cashAccountId: capital.id,
        amount: '10.00',
      })).status,
      403,
    );
  });

  await t.test('يرى فواتير الشراء ولا يرى المبيعات', async () => {
    const list = await api.get('/api/invoices');
    assert.equal(list.status, 200);
    assert.ok(list.body.invoices.every((i) => i.kind === 'PURCHASE'));
    assert.equal((await api.get('/api/invoices?kind=SALES')).status, 403);
  });

  await t.test('لا سندات أصلاً', async () => {
    assert.equal((await api.get('/api/payments')).status, 403);
  });

  await t.test('تقرير المخزون متاح والتقارير المالية لا', async () => {
    assert.equal((await api.get('/api/reports/stock')).status, 200);
    assert.equal((await api.get('/api/reports/trial-balance')).status, 403);
  });
});

test('دور المُطّلع: يقرأ ولا يكتب شيئاً', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const salesAccount = await api.accountByCode('4101');

  await asRole(api, 'VIEWER', 'viewer2@mizan.local');

  await t.test('يقرأ كل شيء', async () => {
    for (const route of [
      '/api/accounts',
      '/api/parties',
      '/api/items',
      '/api/invoices',
      '/api/payments',
      '/api/journal',
      '/api/stock-adjustments',
      '/api/reports/trial-balance',
      '/api/reports/stock',
      '/api/settings',
    ]) {
      assert.equal((await api.get(route)).status, 200, `يُفترض أن يقرأ ${route}`);
    }
  });

  await t.test('لا يكتب شيئاً', async () => {
    assert.equal((await api.post('/api/parties', { kind: 'CUSTOMER', name: 'ممنوع' })).status, 403);
    assert.equal(
      (await api.post('/api/items', { code: 'Z', name: 'ممنوع', salesAccountId: salesAccount.id })).status,
      403,
    );
    assert.equal(
      (await api.post('/api/accounts', { code: '9998', name: 'ممنوع', type: 'ASSET' })).status,
      403,
    );
    assert.equal((await api.patch('/api/settings', { companyName: 'ممنوع' })).status, 403);
  });
});

test('المحاسب يملك الدفتر كله عدا إعدادات المنشأة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  const party = await api.post('/api/parties', { kind: 'BOTH', name: 'طرف' });
  const salesAccount = await api.accountByCode('4101');

  await asRole(api, 'ACCOUNTANT', 'acc2@mizan.local');

  // لكل نوع حسابه: المبيعات على إيراد والمشتريات على مصروف
  const expenseAccount = await api.accountByCode('5299');

  await t.test('ينشئ النوعين ويرحّل', async () => {
    for (const [kind, accountId] of [
      ['SALES', salesAccount.id],
      ['PURCHASE', expenseAccount.id],
    ]) {
      const res = await api.post('/api/invoices', {
        kind,
        date: '2026-05-01',
        partyId: party.body.party.id,
        post: true,
        lines: [{ description: 'بند', quantity: '1', unitPrice: '100.00', accountId }],
      });
      assert.equal(res.status, 201, `يُفترض أن ينشئ ${kind}`);
    }
  });

  await t.test('يرى التقارير المالية', async () => {
    const res = await api.get('/api/reports/trial-balance');
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.balanced, true);
  });

  await t.test('لا يغيّر إعدادات المنشأة', async () => {
    assert.equal((await api.patch('/api/settings', { companyName: 'تغيير' })).status, 403);
  });
});

test('مرجع الأدوار يطابق ما يفرضه الخادم', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const res = await api.get('/api/auth/roles');
  assert.equal(res.status, 200);
  assert.equal(res.body.roles.length, Object.keys(ROLE_CAPABILITIES).length);

  for (const row of res.body.roles) {
    assert.deepEqual(
      row.capabilities,
      ROLE_CAPABILITIES[row.role],
      `قدرات ${row.role} المعروضة تخالف المفروضة`,
    );
    assert.ok(row.label, `${row.role} بلا اسم عربي`);
  }

  const me = await api.get('/api/auth/me');
  assert.deepEqual(me.body.capabilities, ROLE_CAPABILITIES.OWNER);
});
