'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');

test('عزل المنشآت: لا ترى منشأة بيانات أخرى', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const login = await api.login();
  const first = api.seeded.business;
  const second = await api.createBusiness('المنشأة الثانية', 'test-second', {
    ownerId: api.seeded.user.id,
  });

  assert.equal(login.businesses.length, 1, 'الدخول يرى المنشآت الموجودة لحظته');

  await t.test('عميل في المنشأة الأولى', async () => {
    const res = await api.post('/api/parties', {
      code: 'C-001',
      kind: 'CUSTOMER',
      name: 'عميل الأولى',
    });
    assert.equal(res.status, 201);
  });

  await t.test('المنشأة الثانية فارغة تماماً', async () => {
    const switched = await api.selectBusiness(second.id);
    assert.equal(switched.status, 200);

    const parties = await api.get('/api/parties');
    assert.equal(parties.status, 200);
    assert.equal(parties.body.parties.length, 0);
  });

  await t.test('نفس كود العميل يُقبل في منشأة أخرى', async () => {
    // الكود متفرّد داخل القاعدة، ولكل منشأة قاعدتها، فلا تعارض بين المنشآت
    const res = await api.post('/api/parties', {
      code: 'C-001',
      kind: 'CUSTOMER',
      name: 'عميل الثانية',
    });
    assert.equal(res.status, 201);
  });

  await t.test('لكل منشأة شجرة حساباتها', async () => {
    const accounts = await api.get('/api/accounts');
    assert.ok(accounts.body.accounts.length > 40, 'المنشأة الجديدة تُبذر بشجرة حسابات كاملة');
  });

  await t.test('قيد في الثانية لا يظهر في الأولى', async () => {
    const cash = await api.accountByCode('1101');
    const capital = await api.accountByCode('3101');

    const entry = await api.post('/api/journal', {
      date: '2026-05-01',
      memo: 'رأس مال المنشأة الثانية',
      lines: [
        { accountId: cash.id, debit: '1000.00' },
        { accountId: capital.id, credit: '1000.00' },
      ],
    });
    assert.equal(entry.status, 201);

    const inSecond = await api.get('/api/journal');
    assert.equal(inSecond.body.entries.length, 1);

    await api.selectBusiness(first.id);
    const inFirst = await api.get('/api/journal');
    assert.equal(inFirst.body.entries.length, 0, 'قيد الثانية لا يُرى في الأولى');

    const parties = await api.get('/api/parties');
    assert.deepEqual(
      parties.body.parties.map((p) => p.name),
      ['عميل الأولى'],
      'الأولى ترى عميلها وحده',
    );
  });

  await t.test('ميزان كل منشأة متوازن ومستقل', async () => {
    const firstBalance = await api.get('/api/reports/trial-balance');
    assert.equal(firstBalance.body.totals.balanced, true);
    assert.equal(firstBalance.body.totals.debit, '0.00');

    await api.selectBusiness(second.id);
    const secondBalance = await api.get('/api/reports/trial-balance');
    assert.equal(secondBalance.body.totals.balanced, true);
    assert.equal(secondBalance.body.totals.debit, '1000.00');
  });
});

test('لا وصول إلى منشأة بلا عضوية', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  const other = await api.createBusiness('منشأة الغير', 'test-foreign');
  const { user, password } = await api.createUser({
    email: 'limited@mizan.local',
    name: 'محاسب محدود',
    businessId: api.seeded.business.id,
    role: 'ACCOUNTANT',
  });

  await api.login(user.email, password);

  await t.test('التبديل إلى منشأة لا يملكها مرفوض', async () => {
    const res = await api.selectBusiness(other.id);
    assert.equal(res.status, 403);
  });

  await t.test('الدخول يرى منشآته وحدها', async () => {
    const me = await api.get('/api/auth/me');
    assert.equal(me.body.businesses.length, 1);
    assert.equal(me.body.businesses[0].id, api.seeded.business.id);
  });

  await t.test('إدارة النظام ممنوعة على غير الآدمن', async () => {
    assert.equal((await api.get('/api/admin/users')).status, 403);
    assert.equal((await api.get('/api/admin/businesses')).status, 403);
    assert.equal(
      (await api.post('/api/admin/businesses', { name: 'خلسة', slug: 'sneaky' })).status,
      403,
    );
  });
});

test('إلزام تغيير كلمة المرور يسدّ كل شيء إلا التغيير نفسه', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  // الآدمن ينشئ مستخدماً: كلمة مؤقتة تُعرض مرة واحدة، وإلزام بتغييرها
  const created = await api.post('/api/admin/users', {
    name: 'موظف جديد',
    email: 'fresh@mizan.local',
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.temporaryPassword, 'تُعاد كلمة مؤقتة لتسليمها لصاحبها');
  assert.equal(created.body.user.mustChangePassword, true);

  const temp = created.body.temporaryPassword;
  await api.put(`/api/admin/users/${created.body.user.id}/access/${api.seeded.business.id}`, {
    role: 'ACCOUNTANT',
  });

  const session = await api.login('fresh@mizan.local', temp);
  assert.equal(session.user.mustChangePassword, true);

  await t.test('كل المسارات مسدودة قبل التغيير', async () => {
    assert.equal((await api.get('/api/accounts')).status, 403);
    assert.equal((await api.get('/api/parties')).status, 403);
    assert.equal((await api.get('/api/reports/trial-balance')).status, 403);
  });

  await t.test('كلمة ضعيفة مرفوضة', async () => {
    const res = await api.post('/api/auth/change-password', {
      currentPassword: temp,
      newPassword: 'short',
    });
    assert.equal(res.status, 400);
  });

  await t.test('التغيير يفتح الطريق', async () => {
    const res = await api.post('/api/auth/change-password', {
      currentPassword: temp,
      newPassword: 'Fresh@20261',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.mustChangePassword, false);

    api.setToken(res.body.token);
    assert.equal((await api.get('/api/accounts')).status, 200);
  });

  await t.test('الكلمة القديمة لم تبقَ صالحة', async () => {
    const res = await api.post('/api/auth/login', { email: 'fresh@mizan.local', password: temp });
    assert.equal(res.status, 401);
  });
});

test('إعادة تعيين كلمة المرور بيد الآدمن', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();

  const { user, password } = await api.createUser({
    email: 'forgot@mizan.local',
    name: 'ناسٍ كلمته',
    businessId: api.seeded.business.id,
  });

  // يعمل قبل إعادة التعيين
  const before = await api.post('/api/auth/login', { email: user.email, password });
  assert.equal(before.status, 200);

  await api.login();
  const reset = await api.post(`/api/admin/users/${user.id}/reset-password`, {});
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword);

  await t.test('الكلمة القديمة سقطت', async () => {
    const res = await api.post('/api/auth/login', { email: user.email, password });
    assert.equal(res.status, 401);
  });

  await t.test('المؤقتة تعمل وتُلزم بالتغيير', async () => {
    const res = await api.post('/api/auth/login', {
      email: user.email,
      password: reset.body.temporaryPassword,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.mustChangePassword, true);
  });

  await t.test('لا مسار يعرض كلمة مرور قائمة', async () => {
    await api.login();
    const list = await api.get('/api/admin/users');
    assert.equal(list.status, 200);
    const serialized = JSON.stringify(list.body);
    assert.ok(!serialized.includes('$2a$'), 'لا تخرج تجزئة كلمة المرور في الواجهة');
    assert.ok(!serialized.includes('password'), 'لا حقل كلمة مرور في تمثيل المستخدم');
  });
});

test('سجل التدقيق يسجّل الدخول وما يمسّ الحسابات', async (t) => {
  const api = await startServer();
  t.after(() => api.close());

  await api.login();
  await api.post('/api/auth/login', { email: 'tester@mizan.local', password: 'كلمة-خاطئة9' });

  const created = await api.post('/api/admin/users', { name: 'مراقَب', email: 'watch@mizan.local' });
  await api.post(`/api/admin/users/${created.body.user.id}/reset-password`, {});

  const log = await api.get('/api/admin/users/audit/log');
  assert.equal(log.status, 200);

  const actions = log.body.entries.map((e) => e.action);
  for (const action of ['LOGIN', 'LOGIN_FAILED', 'USER_CREATE', 'PASSWORD_RESET']) {
    assert.ok(actions.includes(action), `السجل يحمل ${action}`);
  }
});
