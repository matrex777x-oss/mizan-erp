'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

test('دورة محاسبية كاملة: فاتورة مبيعات ثم سند قبض', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const sales = await api.accountByCode('4101');
  const cashbox = await api.accountByCode('1101');
  const receivable = await api.accountByCode('1201');

  await t.test('إنشاء عميل', async () => {
    const res = await api.post('/api/parties', { kind: 'CUSTOMER', name: 'شركة النور' });
    assert.equal(res.status, 201);
    assert.equal(res.body.party.balance, '0.00');
    assert.match(res.body.party.code, /^C-\d{4}$/);
    t.customerId = res.body.party.id;
  });

  await t.test('فاتورة مبيعات مُرحَّلة بمجاميع صحيحة', async () => {
    const res = await api.post('/api/invoices', {
      kind: 'SALES',
      date: '2026-03-10',
      dueDate: '2026-04-10',
      partyId: t.customerId,
      post: true,
      lines: [
        { description: 'استشارة', quantity: '2.5', unitPrice: '10.33', taxRate: '15', accountId: sales.id },
        { description: 'تدريب', quantity: '1', unitPrice: '500', taxRate: '15', accountId: sales.id },
      ],
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const invoice = res.body.invoice;
    assert.equal(invoice.subtotal, '525.83'); // 25.83 + 500.00
    assert.equal(invoice.taxTotal, '78.87'); // 3.87 + 75.00
    assert.equal(invoice.total, '604.70');
    assert.equal(invoice.status, 'POSTED');
    assert.match(invoice.number, /^INV-2026-\d{4}$/);
    t.invoiceId = invoice.id;
    t.invoiceTotal = invoice.total;
  });

  await t.test('القيد المولَّد متوازن ويمسّ الحسابات الصحيحة', async () => {
    const res = await api.get('/api/journal?source=INVOICE');
    assert.equal(res.status, 200);
    const entry = res.body.entries[0];
    assert.equal(entry.totalDebit, entry.totalCredit);
    assert.equal(entry.totalDebit, '604.70');

    const debitLine = entry.lines.find((l) => l.debit !== '0.00');
    assert.equal(debitLine.accountId, receivable.id);
    assert.equal(debitLine.partyId, t.customerId);

    const taxLine = entry.lines.find((l) => l.memo === 'ضريبة مخرجات');
    assert.equal(taxLine.credit, '78.87');
  });

  await t.test('رصيد العميل يساوي إجمالي الفاتورة', async () => {
    const res = await api.get(`/api/parties/${t.customerId}`);
    assert.equal(res.body.party.balance, '604.70');
  });

  await t.test('سند قبض جزئي يخفّض المتبقي', async () => {
    const res = await api.post('/api/payments', {
      kind: 'RECEIPT',
      date: '2026-03-20',
      partyId: t.customerId,
      cashAccountId: cashbox.id,
      amount: '300.00',
      post: true,
      allocations: [{ invoiceId: t.invoiceId, amount: '300.00' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.payment.status, 'POSTED');

    const invoice = await api.get(`/api/invoices/${t.invoiceId}`);
    assert.equal(invoice.body.invoice.paid, '300.00');
    assert.equal(invoice.body.invoice.due, '304.70');
    assert.equal(invoice.body.invoice.settled, false);

    const party = await api.get(`/api/parties/${t.customerId}`);
    assert.equal(party.body.party.balance, '304.70');
  });

  await t.test('التوزيع لا يتجاوز المتبقي على الفاتورة', async () => {
    const res = await api.post('/api/payments', {
      kind: 'RECEIPT',
      date: '2026-03-21',
      partyId: t.customerId,
      cashAccountId: cashbox.id,
      amount: '1000.00',
      allocations: [{ invoiceId: t.invoiceId, amount: '400.00' }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /يتجاوز المتبقي/);
  });

  await t.test('ميزان المراجعة متوازن', async () => {
    const res = await api.get('/api/reports/trial-balance');
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.balanced, true);
    assert.equal(res.body.totals.debit, res.body.totals.credit);
  });

  await t.test('المركز المالي متوازن وقائمة الدخل صحيحة', async () => {
    const income = await api.get('/api/reports/income-statement');
    assert.equal(income.body.totals.income, '525.83');
    assert.equal(income.body.totals.expenses, '0.00');
    assert.equal(income.body.totals.netProfit, '525.83');

    const sheet = await api.get('/api/reports/balance-sheet');
    assert.equal(sheet.body.totals.balanced, true);
    assert.equal(sheet.body.totals.assets, '604.70'); // 304.70 ذمم + 300.00 صندوق
  });

  await t.test('أعمار الديون تضع المتبقي في الفترة الصحيحة', async () => {
    const res = await api.get('/api/reports/aging?kind=SALES&asOf=2026-05-15');
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.grandTotal, '304.70');
    assert.equal(res.body.rows[0].buckets.d31_60, '304.70'); // 35 يوماً بعد الاستحقاق
  });

  await t.test('إلغاء ترحيل فاتورة مرتبطة بسند مرفوض', async () => {
    const res = await api.post(`/api/invoices/${t.invoiceId}/unpost`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /مرتبطة بسندات/);
  });
});

test('القيود اليدوية تُرفض إن لم تتوازن', async (t) => {
  const api = await startServer();
  t.after(() => api.close());
  await api.login();

  const cashbox = await api.accountByCode('1101');
  const capital = await api.accountByCode('3101');
  const group = await api.accountByCode('11');

  await t.test('قيد غير متوازن', async () => {
    const res = await api.post('/api/journal', {
      date: '2026-01-01',
      memo: 'رأس المال',
      lines: [
        { accountId: cashbox.id, debit: '1000' },
        { accountId: capital.id, credit: '900' },
      ],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /غير متوازن/);
  });

  await t.test('لا يُقبل القيد على حساب تجميعي', async () => {
    const res = await api.post('/api/journal', {
      date: '2026-01-01',
      lines: [
        { accountId: group.id, debit: '1000' },
        { accountId: capital.id, credit: '1000' },
      ],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /تجميعي/);
  });

  await t.test('قيد متوازن يُقبل ويأخذ رقماً تسلسلياً', async () => {
    const res = await api.post('/api/journal', {
      date: '2026-01-01',
      memo: 'إيداع رأس المال',
      lines: [
        { accountId: cashbox.id, debit: '1000' },
        { accountId: capital.id, credit: '1000' },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.entry.number, 1);
    assert.equal(res.body.entry.totalDebit, '1000.00');
  });

  await t.test('الفترة المقفلة تمنع التسجيل', async () => {
    const lock = await api.patch('/api/settings', { lockDate: '2026-01-31' });
    assert.equal(lock.status, 200);

    const res = await api.post('/api/journal', {
      date: '2026-01-15',
      lines: [
        { accountId: cashbox.id, debit: '50' },
        { accountId: capital.id, credit: '50' },
      ],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /الفترة مقفلة/);
  });
});

test('الصلاحيات: المُطّلع لا يكتب', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const bcrypt = require('bcryptjs');
  const prisma = require('../src/lib/prisma');
  await prisma.user.create({
    data: {
      email: 'viewer@mizan.local',
      name: 'مُطّلع',
      password: await bcrypt.hash('Viewer@12345', 10),
      role: 'VIEWER',
    },
  });

  await api.login('viewer@mizan.local', 'Viewer@12345');

  const read = await api.get('/api/accounts');
  assert.equal(read.status, 200);

  const write = await api.post('/api/parties', { kind: 'CUSTOMER', name: 'ممنوع' });
  assert.equal(write.status, 403);
});

test('بدون رمز وصول لا شيء يُقرأ', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const res = await api.get('/api/accounts');
  assert.equal(res.status, 401);
});
