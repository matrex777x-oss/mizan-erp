'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

async function setup(api) {
  await api.login();

  const sales = await api.accountByCode('4101');
  const capital = await api.accountByCode('3101');

  const item = await api.post('/api/items', {
    code: 'IT-1',
    name: 'بضاعة',
    kind: 'STOCK',
    salesAccountId: sales.id,
  });
  assert.equal(item.status, 201);

  return { itemId: item.body.item.id, sales, capital };
}

/** يُدخل كمية بتكلفة إلى مستودع عبر تسوية مرحَّلة. */
async function stockIn(api, { itemId, warehouseId, capital, quantity, unitCost, date = '2026-01-10' }) {
  const res = await api.post('/api/stock-adjustments', {
    date,
    counterAccountId: capital.id,
    post: true,
    lines: [{ itemId, warehouseId, direction: 'IN', quantity, unitCost }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function warehouses(api) {
  const res = await api.get('/api/warehouses');
  assert.equal(res.status, 200);
  return res.body.warehouses;
}

test('المنشأة الجديدة لها مستودع افتراضي', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const list = await warehouses(api);
  assert.equal(list.length, 1);
  assert.equal(list[0].isDefault, true);
  assert.equal(list[0].code, 'MAIN');
});

test('المتوسط المرجّح لكل مستودع على حدة', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const { itemId, capital, sales } = await setup(api);

  const main = (await warehouses(api))[0];
  const branch = await api.post('/api/warehouses', { code: 'BR1', name: 'مستودع الفرع' });
  assert.equal(branch.status, 201);
  const branchId = branch.body.warehouse.id;

  await t.test('نفس الصنف بتكلفتين في مكانين', async () => {
    await stockIn(api, { itemId, warehouseId: main.id, capital, quantity: '100', unitCost: '10.00' });
    await stockIn(api, { itemId, warehouseId: branchId, capital, quantity: '100', unitCost: '20.00' });

    const mainStock = await api.get(`/api/warehouses/${main.id}/stock`);
    assert.equal(mainStock.body.rows[0].averageCost, '10.00');
    assert.equal(mainStock.body.total, '1000.00');

    const branchStock = await api.get(`/api/warehouses/${branchId}/stock`);
    assert.equal(branchStock.body.rows[0].averageCost, '20.00');
    assert.equal(branchStock.body.total, '2000.00');
  });

  await t.test('بطاقة الصنف تجمع المستودعين', async () => {
    const items = await api.get('/api/items');
    const card = items.body.items.find((i) => i.id === itemId);
    assert.equal(card.onHand, '200.000');
    // 3000 ÷ 200 = 15 — متوسط كلي، والمتوسط الحقيقي لكل مستودع كما هو
    assert.equal(card.stockValue, '3000.00');
  });

  await t.test('البيع من الفرع يخرج بتكلفة الفرع لا بالمتوسط الكلي', async () => {
    const party = await api.post('/api/parties', { kind: 'CUSTOMER', name: 'عميل' });

    const invoice = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-02-01',
      partyId: party.body.party.id,
      post: true,
      lines: [
        {
          itemId,
          warehouseId: branchId,
          quantity: '10',
          unitPrice: '30.00',
          accountId: sales.id,
        },
      ],
    });
    assert.equal(invoice.status, 201, JSON.stringify(invoice.body));

    // 10 × 20 = 200 تكلفة بضاعة مباعة
    const tb = await api.get('/api/reports/trial-balance');
    const cogs = tb.body.rows.find((r) => r.code === '5101');
    assert.equal(cogs.balanceDebit, '200.00', 'التكلفة من الفرع لا من المتوسط الكلي (150)');
    assert.equal(tb.body.totals.balanced, true);
  });

  await t.test('رصيد المستودعين بعد البيع', async () => {
    const mainStock = await api.get(`/api/warehouses/${main.id}/stock`);
    assert.equal(mainStock.body.rows[0].onHand, '100.000');

    const branchStock = await api.get(`/api/warehouses/${branchId}/stock`);
    assert.equal(branchStock.body.rows[0].onHand, '90.000');
    assert.equal(branchStock.body.total, '1800.00');
  });

  await t.test('البيع بأكثر من رصيد المستودع مرفوض ولو كفى الرصيد الكلي', async () => {
    const party = await api.post('/api/parties', { kind: 'CUSTOMER', name: 'عميل آخر' });

    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-03-01',
      partyId: party.body.party.id,
      post: true,
      lines: [
        { itemId, warehouseId: branchId, quantity: '150', unitPrice: '30.00', accountId: sales.id },
      ],
    });
    assert.equal(res.status, 400, 'الرصيد الكلي 190 لكن رصيد الفرع 90');
    assert.match(res.body.error, /مستودع الفرع/);
  });
});

test('التحويل بين المستودعات ينقل التكلفة كما هي', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const { itemId, capital } = await setup(api);

  const main = (await warehouses(api))[0];
  const branch = (await api.post('/api/warehouses', { code: 'BR2', name: 'فرع ثانٍ' })).body.warehouse;

  await stockIn(api, { itemId, warehouseId: main.id, capital, quantity: '60', unitCost: '25.00' });

  await t.test('التحويل يُرحَّل ويحرّك الرصيدين', async () => {
    const res = await api.post('/api/warehouses/transfers', {
      date: '2026-02-01',
      fromWarehouseId: main.id,
      toWarehouseId: branch.id,
      post: true,
      lines: [{ itemId, quantity: '20' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.transfer.number.startsWith('TRF-'), 'رقم بالبادئة من الإعدادات');

    const mainStock = await api.get(`/api/warehouses/${main.id}/stock`);
    assert.equal(mainStock.body.rows[0].onHand, '40.000');
    assert.equal(mainStock.body.total, '1000.00');

    const branchStock = await api.get(`/api/warehouses/${branch.id}/stock`);
    assert.equal(branchStock.body.rows[0].onHand, '20.000');
    assert.equal(branchStock.body.total, '500.00', 'انتقلت بتكلفتها 25');
    assert.equal(branchStock.body.rows[0].averageCost, '25.00');
  });

  await t.test('لا أثر للتحويل في الدفتر', async () => {
    const tb = await api.get('/api/reports/trial-balance');
    // الرصيد الافتتاحي 1500 وحده: التحويل لا يُنشئ قيداً
    const inventory = tb.body.rows.find((r) => r.code === '1301');
    assert.equal(inventory.balanceDebit, '1500.00');
    assert.equal(tb.body.totals.balanced, true);
  });

  await t.test('قيمة المخزون الكلية لم تتغيّر', async () => {
    const stock = await api.get('/api/reports/stock');
    assert.equal(stock.body.totals.value, '1500.00');
  });

  await t.test('إلغاء الترحيل يعيد البضاعة', async () => {
    const list = await api.get('/api/warehouses/transfers/list');
    const transfer = list.body.transfers[0];

    const res = await api.post(`/api/warehouses/transfers/${transfer.id}/unpost`);
    assert.equal(res.status, 200);

    const mainStock = await api.get(`/api/warehouses/${main.id}/stock`);
    assert.equal(mainStock.body.rows[0].onHand, '60.000');

    const branchStock = await api.get(`/api/warehouses/${branch.id}/stock`);
    assert.equal(branchStock.body.rows.length, 0, 'لم يبقَ للفرع رصيد');
  });

  await t.test('التحويل إلى المستودع نفسه مرفوض', async () => {
    const res = await api.post('/api/warehouses/transfers', {
      date: '2026-02-01',
      fromWarehouseId: main.id,
      toWarehouseId: main.id,
      lines: [{ itemId, quantity: '1' }],
    });
    assert.equal(res.status, 400);
  });

  await t.test('التحويل بأكثر من الرصيد مرفوض', async () => {
    const res = await api.post('/api/warehouses/transfers', {
      date: '2026-02-02',
      fromWarehouseId: main.id,
      toWarehouseId: branch.id,
      post: true,
      lines: [{ itemId, quantity: '1000' }],
    });
    assert.equal(res.status, 400);
  });
});

test('حماية المستودعات', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const { itemId, capital } = await setup(api);
  const main = (await warehouses(api))[0];
  const branch = (await api.post('/api/warehouses', { code: 'BR3', name: 'فرع ثالث' })).body.warehouse;

  await t.test('المستودع الافتراضي لا يُحذف', async () => {
    assert.equal((await api.del(`/api/warehouses/${main.id}`)).status, 400);
  });

  await t.test('مستودع فيه بضاعة لا يُوقف', async () => {
    await stockIn(api, { itemId, warehouseId: branch.id, capital, quantity: '5', unitCost: '10.00' });

    const res = await api.patch(`/api/warehouses/${branch.id}`, { active: false });
    assert.equal(res.status, 400);
  });

  await t.test('مستودع له حركة لا يُحذف', async () => {
    assert.equal((await api.del(`/api/warehouses/${branch.id}`)).status, 400);
  });

  await t.test('رمز مكرّر مرفوض', async () => {
    const res = await api.post('/api/warehouses', { code: 'BR3', name: 'مكرّر' });
    assert.equal(res.status, 409);
  });

  await t.test('افتراضي واحد لا غير', async () => {
    const res = await api.patch(`/api/warehouses/${branch.id}`, { isDefault: true });
    assert.equal(res.status, 200);

    const list = await warehouses(api);
    assert.equal(list.filter((w) => w.isDefault).length, 1);
    assert.equal(list.find((w) => w.isDefault).id, branch.id);
  });
});

test('بلا تحديد مستودع تمضي الحركة إلى الافتراضي', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const { itemId, capital } = await setup(api);
  const main = (await warehouses(api))[0];

  // تسوية بلا warehouseId — كما كانت المستندات قبل المستودعات
  await stockIn(api, { itemId, warehouseId: undefined, capital, quantity: '30', unitCost: '7.00' });

  const stock = await api.get(`/api/warehouses/${main.id}/stock`);
  assert.equal(stock.body.rows[0].onHand, '30.000');
  assert.equal(stock.body.total, '210.00');
});

test('صلاحية المستودعات', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const { user, password } = await api.createUser({
    email: 'sales7@mizan.local',
    businessId: api.seeded.business.id,
    role: 'SALES',
  });
  await api.login(user.email, password);

  // المبيعات يقرأ المخزون ولا يعدّله
  assert.equal((await api.get('/api/warehouses')).status, 200);
  assert.equal((await api.post('/api/warehouses', { code: 'X1', name: 'ممنوع' })).status, 403);
});
