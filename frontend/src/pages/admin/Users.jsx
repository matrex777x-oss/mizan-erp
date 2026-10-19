import { useState } from 'react';

import {
  Alert,
  Card,
  DataTable,
  Empty,
  Field,
  OneTimeSecret,
  PageHead,
  PasswordInput,
} from '../../components/ui.jsx';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS, useSession } from '../../lib/session';

const EMPTY = { name: '', email: '', password: '', isAdmin: false };

function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Users() {
  const { user: me, refresh } = useSession();

  const users = useAsync(() => api.get('/admin/users'), []);
  const businesses = useAsync(() => api.get('/admin/businesses'), []);

  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [secret, setSecret] = useState(null);
  const [access, setAccess] = useState(null);

  async function create(event) {
    event.preventDefault();
    setError(null);
    setSecret(null);
    try {
      const body = { name: form.name, email: form.email, isAdmin: form.isAdmin };
      // كلمة المرور اختيارية: بلا قيمة يولّد الخادم كلمة مؤقتة
      if (form.password) body.password = form.password;

      const res = await api.post('/admin/users', body);
      setForm(null);
      setSecret({ for: res.user.email, value: res.temporaryPassword });
      users.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleActive(row) {
    const action = row.active ? 'إيقاف' : 'تفعيل';
    if (!confirm(`${action} حساب «${row.name}»؟`)) return;
    setError(null);
    try {
      await api.patch(`/admin/users/${row.id}`, { active: !row.active });
      users.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleAdmin(row) {
    setError(null);
    try {
      await api.patch(`/admin/users/${row.id}`, { isAdmin: !row.isAdmin });
      users.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function resetPassword(row) {
    if (!confirm(`إعادة تعيين كلمة مرور «${row.name}»؟ كلمته الحالية تسقط فوراً.`)) return;
    setError(null);
    setSecret(null);
    try {
      const res = await api.post(`/admin/users/${row.id}/reset-password`, {});
      setSecret({ for: row.email, value: res.temporaryPassword });
      users.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function grant(userId, businessId, role) {
    setError(null);
    try {
      if (role) await api.put(`/admin/users/${userId}/access/${businessId}`, { role });
      else await api.del(`/admin/users/${userId}/access/${businessId}`);
      users.reload();
      // قد يكون المتأثر هو الآدمن نفسه، فتتغيّر منشآته ودوره في الحال
      if (userId === me?.id) await refresh();
    } catch (err) {
      setError(err);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'المستخدم',
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <div className="small muted" dir="ltr">{row.email}</div>
        </div>
      ),
    },
    {
      key: 'access',
      label: 'الوصول',
      render: (row) =>
        row.access.length ? (
          <span className="small">
            {row.access.map((a) => `${a.businessName} (${ROLE_LABELS[a.role] || a.role})`).join('، ')}
          </span>
        ) : (
          <span className="small muted">لا منشآت</span>
        ),
    },
    {
      key: 'state',
      label: 'الحالة',
      render: (row) => (
        <span className="small">
          {row.active ? 'نشط' : 'موقوف'}
          {row.isAdmin ? ' · آدمن نظام' : ''}
          {row.mustChangePassword ? ' · مُلزَم بتغيير كلمته' : ''}
        </span>
      ),
    },
    { key: 'last', label: 'آخر دخول', render: (row) => <span className="small muted">{dateTime(row.lastLoginAt)}</span> },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="toolbar">
          <button className="ghost sm" onClick={() => setAccess(access === row.id ? null : row.id)}>
            الصلاحيات
          </button>
          <button className="ghost sm" onClick={() => resetPassword(row)}>إعادة تعيين المرور</button>
          {row.id !== me?.id && (
            <>
              <button className="ghost sm" onClick={() => toggleAdmin(row)}>
                {row.isAdmin ? 'إسقاط الإدارة' : 'ترقية لآدمن'}
              </button>
              <button className="ghost sm" onClick={() => toggleActive(row)}>
                {row.active ? 'إيقاف' : 'تفعيل'}
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const selected = users.data?.users.find((u) => u.id === access) || null;

  return (
    <>
      <PageHead title="المستخدمون" subtitle="من يدخل النظام، وبأي دور في كل منشأة">
        <button className="primary" onClick={() => setForm({ ...EMPTY })}>مستخدم جديد</button>
      </PageHead>

      <Alert error={error} />

      {secret && (
        <Card title={`كلمة مرور ${secret.for}`}>
          <OneTimeSecret value={secret.value} />
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="ghost sm" onClick={() => setSecret(null)}>إغلاق</button>
          </div>
        </Card>
      )}

      {form && (
        <Card title="مستخدم جديد">
          <form className="stack" onSubmit={create}>
            <div className="field-row">
              <Field label="الاسم">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="البريد الإلكتروني">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  dir="ltr"
                  required
                />
              </Field>
            </div>

            <Field
              label="كلمة المرور (اختياري)"
              hint="اتركها فارغة ليولّد النظام كلمة مؤقتة تُعرض مرة واحدة"
            >
              <PasswordInput
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>

            <label className="field-inline">
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
              />
              <span>آدمن نظام — يدير المنشآت والمستخدمين</span>
            </label>

            <div className="toolbar">
              <button type="submit" className="primary">إنشاء</button>
              <button type="button" className="ghost" onClick={() => setForm(null)}>إلغاء</button>
            </div>

            <p className="small muted">
              يُلزَم كل مستخدم جديد بوضع كلمة يعرفها وحده عند أول دخول.
            </p>
          </form>
        </Card>
      )}

      {selected && (
        <Card title={`صلاحيات ${selected.name}`}>
          {businesses.loading ? null : !businesses.data?.businesses.length ? (
            <Empty label="لا منشآت بعد" />
          ) : (
            <div className="stack">
              {businesses.data.businesses.map((business) => {
                const current = selected.access.find((a) => a.businessId === business.id);
                return (
                  <div className="spread" key={business.id}>
                    <span>{business.name}</span>
                    <select
                      value={current?.role || ''}
                      onChange={(e) => grant(selected.id, business.id, e.target.value)}
                    >
                      <option value="">لا وصول</option>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Card title="كل المستخدمين" pad={false}>
        <DataTable
          columns={columns}
          rows={users.data?.users}
          loading={users.loading}
          empty="لا مستخدمين"
          rowKey={(row) => row.id}
        />
      </Card>
    </>
  );
}
