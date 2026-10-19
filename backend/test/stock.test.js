'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

/** ينشئ صنفاً مخزنياً جاهزاً للاختبار. */
async function makeStockItem(api, name, overrides = {}) {
  const sales = await api.accountByCode('4101');
  const res = await api.post('/api/items', {
    kind: 'STOCK',
    name,
    unit: 'كرتون',
    salesAccountId: sales.id,
    ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item;
}

test('المتوسط المرجّح: شراء دفعتين بسعرين ثم بيع', async (t) => {
  const api = await startServer();
  t.after(() => api.close());
  await api.login();

  const item = await makeStockItem(api, 'زيت زيتون');
  const supplier = (await api.post('/api/parties', { kind: 'SUPPLIER', name: 'مزارع الشام' })).body.party;
  const customer = (await api.post('/api/parties', { kind: 'CUSTOMER', name: 'بقالة الحي' })).body.party;

  await t.test('الشراء الأول: 100 بسعر 10', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'PURCHASE',
      date: '2026-01-05',
      partyId: supplier.id,
      post: true,
      lines: [{ itemId: item.id, quantity: '100', unitPrice: '10' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '100.000');
    assert.equal(card.stockValue, '1000.00');
    assert.equal(card.averageCost, '10.00');
  });

  await t.test('الشراء الثاني: 100 بسعر 20 ← المتوسط 15', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'PURCHASE',
      date: '2026-01-10',
      partyId: supplier.id,
      post: true,
      lines: [{ itemId: item.id, quantity: '100', unitPrice: '20' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '200.000');
    assert.equal(card.stockValue, '3000.00');
    assert.equal(card.averageCost, '15.00');
  });

  await t.test('بيع 50 بسعر 30: التكلفة 750 بالمتوسط لا بسعر الشراء الأخير', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-01-15',
      partyId: customer.id,
      post: true,
      lines: [{ itemId: item.id, quantity: '50', unitPrice: '30' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    t.salesInvoiceId = res.body.invoice.id;

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '150.000');
    assert.equal(card.stockValue, '2250.00');
    assert.equal(card.averageCost, '15.00');
  });

  await t.test('قيد البيع يحمل الإيراد وتكلفة البضاعة المباعة معاً', async () => {
    const entries = (await api.get('/api/journal?source=INVOICE')).body.entries;
    const entry = entries[0]; // الأحدث
    assert.equal(entry.totalDebit, entry.totalCredit);

    const cogs = entry.lines.find((l) => l.memo === 'تكلفة البضاعة المباعة');
    assert.ok(cogs, 'سطر تكلفة البضاعة المباعة مفقود');
    assert.equal(cogs.debit, '750.00');
    assert.equal(cogs.account.code, '5101');

    const out = entry.lines.find((l) => l.memo === 'إخراج من المخزون');
    assert.equal(out.credit, '750.00');
    assert.equal(out.account.code, '1301');

    const revenue = entry.lines.find((l) => l.account.code === '4101');
    assert.equal(revenue.credit, '1500.00');
  });

  await t.test('مجمل الربح في قائمة الدخل = 1500 − 750', async () => {
    const income = (await api.get('/api/reports/income-statement')).body;
    assert.equal(income.totals.income, '1500.00');
    assert.equal(income.totals.expenses, '750.00');
    assert.equal(income.totals.netProfit, '750.00');
  });

  await t.test('تقرير المخزون يطابق بطاقة الصنف', async () => {
    const stock = (await api.get('/api/reports/stock')).body;
    const row = stock.rows.find((r) => r.itemId === item.id);
    assert.equal(row.onHand, '150.000');
    assert.equal(row.value, '2250.00');
    assert.equal(stock.totals.value, '2250.00');
  });

  await t.test('ميزان المراجعة والمركز المالي ما زالا متوازنين', async () => {
    assert.equal((await api.get('/api/reports/trial-balance')).body.totals.balanced, true);
    assert.equal((await api.get('/api/reports/balance-sheet')).body.totals.balanced, true);
  });

  await t.test('البيع بأكثر من الرصيد مرفوض', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-01-20',
      partyId: customer.id,
      post: true,
      lines: [{ itemId: item.id, quantity: '500', unitPrice: '30' }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /تتجاوز الرصيد المتاح/);

    // الرفض لا يترك أثراً
    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '150.000');
  });

  await t.test('الترحيل بتاريخ أسبق من آخر حركة مرفوض', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-01-08',
      partyId: customer.id,
      post: true,
      lines: [{ itemId: item.id, quantity: '1', unitPrice: '30' }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /حركة مخزون أحدث/);
  });

  await t.test('إلغاء ترحيل آخر فاتورة يعيد المخزون والقيد', async () => {
    const res = await api.post(`/api/invoices/${t.salesInvoiceId}/unpost`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '200.000');
    assert.equal(card.stockValue, '3000.00');

    const entries = (await api.get('/api/journal')).body.entries;
    assert.equal(entries.filter((e) => e.sourceId === t.salesInvoiceId).length, 0);
  });
});

test('تسوية المخزون: رصيد افتتاحي ثم عجز جرد', async (t) => {
  const api = await startServer();
  t.after(() => api.close());
  await api.login();

  const item = await makeStockItem(api, 'أكياس تغليف');
  const capital = await api.accountByCode('3101');
  const shrinkage = await api.accountByCode('5102');

  await t.test('رصيد افتتاحي 200 بتكلفة 5 مقابل رأس المال', async () => {
    const res = await api.post('/api/stock-adjustments', {
      date: '2026-01-01',
      reason: 'أرصدة افتتاحية',
      counterAccountId: capital.id,
      post: true,
      lines: [{ itemId: item.id, direction: 'IN', quantity: '200', unitCost: '5' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.adjustment.status, 'POSTED');
    assert.match(res.body.adjustment.number, /^ADJ-2026-\d{4}$/);

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '200.000');
    assert.equal(card.stockValue, '1000.00');
  });

  await t.test('القيد: من المخزون إلى رأس المال', async () => {
    const entry = (await api.get('/api/journal?source=ADJUSTMENT')).body.entries[0];
    assert.equal(entry.totalDebit, '1000.00');
    assert.equal(entry.lines.find((l) => l.account.code === '1301').debit, '1000.00');
    assert.equal(entry.lines.find((l) => l.account.code === '3101').credit, '1000.00');
  });

  await t.test('عجز جرد 20 وحدة يُحمَّل على فروق المخزون', async () => {
    const res = await api.post('/api/stock-adjustments', {
      date: '2026-02-01',
      reason: 'عجز جرد',
      counterAccountId: shrinkage.id,
      post: true,
      lines: [{ itemId: item.id, direction: 'OUT', quantity: '20' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const card = (await api.get(`/api/items/${item.id}`)).body.item;
    assert.equal(card.onHand, '180.000');
    assert.equal(card.stockValue, '900.00');

    const entry = (await api.get('/api/journal?source=ADJUSTMENT')).body.entries[0];
    assert.equal(entry.lines.find((l) => l.account.code === '5102').debit, '100.00');
    assert.equal(entry.lines.find((l) => l.account.code === '1301').credit, '100.00');
  });

  await t.test('ميزان المراجعة متوازن بعد التسويات', async () => {
    assert.equal((await api.get('/api/reports/trial-balance')).body.totals.balanced, true);
  });
});

test('حماية ترتيب حركة المخزون عند إلغاء الترحيل', async (t) => {
  const api = await startServer();
  t.after(() => api.close());
  await api.login();

  const item = await makeStockItem(api, 'ورق طباعة');
  const supplier = (await api.post('/api/parties', { kind: 'SUPPLIER', name: 'مكتبة الوفاء' })).body.party;

  const first = await api.post('/api/invoices', {
    kind: 'PURCHASE',
    date: '2026-03-01',
    partyId: supplier.id,
    post: true,
    lines: [{ itemId: item.id, quantity: '10', unitPrice: '12' }],
  });
  await api.post('/api/invoices', {
    kind: 'PURCHASE',
    date: '2026-03-05',
    partyId: supplier.id,
    post: true,
    lines: [{ itemId: item.id, quantity: '10', unitPrice: '18' }],
  });

  const res = await api.post(`/api/invoices/${first.body.invoice.id}/unpost`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /حركات مخزون أحدث/);

  const card = (await api.get(`/api/items/${item.id}`)).body.item;
  assert.equal(card.onHand, '20.000');
  assert.equal(card.averageCost, '15.00');
});

test('الأصناف الخدمية لا تحرّك المخزون', async (t) => {
  const api = await startServer();
  t.after(() => api.close());
  await api.login();

  const sales = await api.accountByCode('4102');
  const expense = await api.accountByCode('5204');
  const created = await api.post('/api/items', {
    kind: 'SERVICE',
    name: 'اشتراك إنترنت',
    unit: 'شهر',
    salesAccountId: sales.id,
    expenseAccountId: expense.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const item = created.body.item;

  const customer = (await api.post('/api/parties', { kind: 'CUSTOMER', name: 'مكتب المحاماة' })).body.party;
  const res = await api.post('/api/invoices', {
    kind: 'SALES',
    date: '2026-04-01',
    partyId: customer.id,
    post: true,
    lines: [{ itemId: item.id, quantity: '1', unitPrice: '300' }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const entry = (await api.get('/api/journal?source=INVOICE')).body.entries[0];
  assert.equal(entry.lines.some((l) => l.memo === 'تكلفة البضاعة المباعة'), false);
  assert.equal(entry.lines.find((l) => l.account.code === '4102').credit, '300.00');

  const moves = (await api.get(`/api/reports/stock/${item.id}`)).body;
  assert.equal(moves.rows.length, 0);
});
