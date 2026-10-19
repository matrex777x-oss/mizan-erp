import { useState } from 'react';

import { Alert, Card, DataTable, Field, PageHead } from '../../components/ui.jsx';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS, useSession } from '../../lib/session';

const EMPTY = { name: '', slug: '' };

/** يقترح معرّفاً لاتينياً من ترتيب المنشأة، فالأسماء العربية لا تصلح اسماً لملف. */
function suggestSlug(count) {
  return `biz-${String(count + 1).padStart(2, '0')}`;
}

export default function Businesses() {
  const { businessId, selectBusiness, refresh } = useSession();

  const businesses = useAsync(() => api.get('/admin/businesses'), []);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/admin/businesses', form);
      setForm(null);
      businesses.reload();
      // المنشأة الجديدة تدخل قائمة منشآتي، فيظهر مبدّل المنشآت في الشريط
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function rename(row) {
    const name = prompt('اسم المنشأة الجديد', row.name);
    if (!name || name === row.name) return;
    setError(null);
    try {
      await api.patch(`/admin/businesses/${row.id}`, { name });
      businesses.reload();
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleActive(row) {
    const action = row.active ? 'إيقاف' : 'تفعيل';
    if (!confirm(`${action} منشأة «${row.name}»؟ بياناتها تبقى كما هي.`)) return;
    setError(null);
    try {
      await api.patch(`/admin/businesses/${row.id}`, { active: !row.active });
      businesses.reload();
      // منشأة موقوفة تخرج من قائمة منشآتي، فيختفي أثرها من المبدّل
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function open(row) {
    setError(null);
    try {
      await selectBusiness(row.id);
    } catch (err) {
      setError(err);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'المنشأة',
      render: (row) => (
        <div>
          <div>
            {row.name}
            {row.id === businessId && <span className="small muted"> — مفتوحة الآن</span>}
          </div>
          <div className="small muted" dir="ltr">{row.slug}.db</div>
        </div>
      ),
    },
    {
      key: 'users',
      label: 'المستخدمون',
      render: (row) =>
        row.users.length ? (
          <span className="small">
            {row.users.map((u) => `${u.name} (${ROLE_LABELS[u.role] || u.role})`).join('، ')}
          </span>
        ) : (
          <span className="small muted">لا أحد</span>
        ),
    },
    { key: 'state', label: 'الحالة', render: (row) => <span className="small">{row.active ? 'نشطة' : 'موقوفة'}</span> },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="toolbar">
          {row.active && row.id !== businessId && (
            <button className="ghost sm" onClick={() => open(row)}>فتح</button>
          )}
          <button className="ghost sm" onClick={() => rename(row)}>تغيير الاسم</button>
          <button className="ghost sm" onClick={() => toggleActive(row)}>
            {row.active ? 'إيقاف' : 'تفعيل'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHead title="المنشآت" subtitle="لكل منشأة قاعدة بياناتها المستقلة — لا تلتقي حساباتها بحساب غيرها">
        <button
          className="primary"
          onClick={() => setForm({ ...EMPTY, slug: suggestSlug(businesses.data?.businesses.length || 0) })}
        >
          منشأة جديدة
        </button>
      </PageHead>

      <Alert error={error} />

      {form && (
        <Card title="منشأة جديدة">
          <form className="stack" onSubmit={create}>
            <div className="field-row">
              <Field label="اسم المنشأة">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
              <Field
                label="المعرّف اللاتيني"
                hint="اسم ملف قاعدة البيانات — لا يتغيّر بعد الإنشاء"
              >
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  pattern="[a-z0-9-]+"
                  dir="ltr"
                  required
                />
              </Field>
            </div>

            <div className="toolbar">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'جارٍ الإنشاء…' : 'إنشاء'}
              </button>
              <button type="button" className="ghost" onClick={() => setForm(null)}>إلغاء</button>
            </div>

            <p className="small muted">
              تُنشأ لها قاعدة مستقلة بشجرة حسابات عربية كاملة وحساباتها النظامية،
              وتصبح أنت مالكها.
            </p>
          </form>
        </Card>
      )}

      <Card title="كل المنشآت" pad={false}>
        <DataTable
          columns={columns}
          rows={businesses.data?.businesses}
          loading={businesses.loading}
          empty="لا منشآت"
          rowKey={(row) => row.id}
        />
      </Card>
    </>
  );
}
