'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');
const { runDataMigrations } = require('../src/lib/dataMigrations');
const { getBusinessDb } = require('../src/lib/businessDb');
const { runWithDb } = require('../src/lib/dbContext');
const { FIRST } = require('./helpers');

/**
 * ترحيل قاعدة فيها مخزون من حالة ما قبل المستودعات.
 *
 * القواعد القائمة عند المستخدم فيها حركات وأرصدة بلا مستودع. نُعيد القاعدة إلى
 * تلك الحالة صناعياً (نفرّغ المستودع من الحركات ونحذف أرصدة المستودعات) ثم
 * نشغّل الترحيل ونتحقق أن كل رصيد عاد إلى مكانه.
 */
test('ترحيل قاعدة فيها بضاعة إلى المستودعات', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const sales = await api.accountByCode('4101');
  const capital = await api.accountByCode('3101');

  const first = await api.post('/api/items', {
    code: 'OLD-1',
    name: 'بضاعة قديمة',
    kind: 'STOCK',
    salesAccountId: sales.id,
  });
  const second = await api.post('/api/items', {
    code: 'OLD-2',
    name: 'بضاعة أخرى',
    kind: 'STOCK',
    salesAccountId: sales.id,
  });

  await api.post('/api/stock-adjustments', {
    date: '2026-01-05',
    counterAccountId: capital.id,
    post: true,
    lines: [
      { itemId: first.body.item.id, direction: 'IN', quantity: '40', unitCost: '12.50' },
      { itemId: second.body.item.id, direction: 'IN', quantity: '10', unitCost: '100.00' },
    ],
  });

  const before = await api.get('/api/reports/stock');
  assert.equal(before.body.totals.value, '1500.00', '40×12.5 + 10×100');

  const db = getBusinessDb(FIRST.slug);

  await t.test('نعيدها إلى حالة ما قبل المستودعات', async () => {
    await runWithDb(db, async () => {
      await db.$executeRawUnsafe('UPDATE "StockMove" SET "warehouseId" = NULL');
      await db.$executeRawUnsafe('UPDATE "StockAdjustmentLine" SET "warehouseId" = NULL');
      await db.$executeRawUnsafe('UPDATE "InvoiceLine" SET "warehouseId" = NULL');
      await db.itemStock.deleteMany({});
      await db.warehouse.deleteMany({});
      await db.dataMigration.deleteMany({});
    });

    const warehouses = await api.get('/api/warehouses');
    assert.equal(warehouses.body.warehouses.length, 0, 'لا مستودعات كما كانت القاعدة');
  });

  await t.test('الترحيل يُنشئ المستودع ويُسند إليه كل شيء', async () => {
    const applied = await runWithDb(db, () => runDataMigrations(db));
    assert.equal(applied.length, 1, 'ترحيل واحد نُفِّذ');

    const warehouses = await api.get('/api/warehouses');
    assert.equal(warehouses.body.warehouses.length, 1);
    assert.equal(warehouses.body.warehouses[0].isDefault, true);
    assert.equal(warehouses.body.warehouses[0].stockValue, '1500.00', 'كل البضاعة صارت فيه');
  });

  await t.test('أرصدة الأصناف كما كانت', async () => {
    const after = await api.get('/api/reports/stock');
    assert.equal(after.body.totals.value, before.body.totals.value);

    assert.deepEqual(
      after.body.rows.map((row) => `${row.code}:${row.onHand}:${row.value}`),
      before.body.rows.map((row) => `${row.code}:${row.onHand}:${row.value}`),
    );
  });

  await t.test('كل حركة صارت لها مستودع', async () => {
    const orphans = await runWithDb(db, () => db.stockMove.count({ where: { warehouseId: null } }));
    assert.equal(orphans, 0);
  });

  await t.test('الترحيل لا يُعاد تنفيذه', async () => {
    const applied = await runWithDb(db, () => runDataMigrations(db));
    assert.equal(applied.length, 0);
  });

  await t.test('البيع بعد الترحيل يخرج بالتكلفة الصحيحة', async () => {
    const party = await api.post('/api/parties', { kind: 'CUSTOMER', name: 'عميل بعد الترحيل' });

    const invoice = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-03-01',
      partyId: party.body.party.id,
      post: true,
      lines: [{ itemId: first.body.item.id, quantity: '4', unitPrice: '20.00', accountId: sales.id }],
    });
    assert.equal(invoice.status, 201, JSON.stringify(invoice.body));

    const tb = await api.get('/api/reports/trial-balance');
    const cogs = tb.body.rows.find((r) => r.code === '5101');
    assert.equal(cogs.balanceDebit, '50.00', '4 × 12.50');
    assert.equal(tb.body.totals.balanced, true);
  });
});
