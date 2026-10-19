import { useState } from 'react';

import { Alert, Card, DataTable, Field, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { ACCOUNT_TYPE_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

const EMPTY = { code: '', name: '', type: 'EXPENSE', parentId: '', isGroup: false };

export default function Accounts() {
  const { canWrite } = useSession();
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const accounts = useAsync(() => api.get('/accounts'), []);
  const rows = (accounts.data?.accounts || []).filter(
    (account) =>
      !filter ||
      account.name.includes(filter) ||
      account.code.includes(filter) ||
      ACCOUNT_TYPE_LABELS[account.type].includes(filter),
  );

  const depthOf = (account) => {
    let depth = 0;
    let cursor = account.parentId;
    const byId = new Map((accounts.data?.accounts || []).map((a) => [a.id, a]));
    while (cursor && depth < 4) {
      depth += 1;
      cursor = byId.get(cursor)?.parentId;
    }
    return depth;
  };

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      const payload = { ...form, parentId: form.parentId || null };
      if (form.id) await api.patch(`/accounts/${form.id}`, payload);
      else await api.post('/accounts', payload);
      setForm(null);
      accounts.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(account) {
    if (!confirm(`حذف الحساب «${account.name}»؟`)) return;
    setError(null);
    try {
      await api.del(`/accounts/${account.id}`);
      accounts.reload();
    } catch (err) {
      setError(err);
    }
  }

  const groups = (accounts.data?.accounts || []).filter((a) => a.isGroup);

  return (
    <>
      <PageHead title="شجرة الحسابات" subtitle="الحسابات التجميعية لا تقبل القيود، والحسابات النظامية لا تُحذف">
        {canWrite && <button className="primary" onClick={() => setForm({ ...EMPTY })}>حساب جديد</button>}
      </PageHead>

      <Alert error={error} />

      {form && (
        <Card title={form.id ? 'تعديل حساب' : 'حساب جديد'} className="no-print" >
          <form onSubmit={save} className="stack">
            <div className="field-row">
              <Field label="الرمز">
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required dir="ltr" />
              </Field>
              <Field label="الاسم">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="النوع">
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parentId: '' })}>
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="الحساب الأب">
                <select value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                  <option value="">— بلا أب —</option>
                  {groups
                    .filter((g) => g.type === form.type && g.id !== form.id)
                    .map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
                </select>
              </Field>
            </div>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.isGroup}
                onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
              />
              <span>حساب تجميعي (عنوان لا تُسجَّل عليه قيود)</span>
            </label>
            <div className="toolbar">
              <button type="submit" className="primary">حفظ</button>
              <button type="button" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title={`${rows.length} حساباً`}
        actions={<input placeholder="بحث بالاسم أو الرمز" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />}
        pad={false}
      >
        <DataTable
          loading={accounts.loading}
          rows={rows}
          rowKey={(row) => row.id}
          rowClass={(row) => (row.isGroup ? 'group-row' : '')}
          empty="لا توجد حسابات مطابقة"
          columns={[
            { key: 'code', label: 'الرمز', width: 100, render: (row) => <span dir="ltr">{row.code}</span> },
            {
              key: 'name',
              label: 'اسم الحساب',
              render: (row) => (
                <span className={`tree-indent-${Math.min(depthOf(row), 3)}`}>
                  {row.name}
                  {row.systemKey && <span className="badge" style={{ marginInlineStart: 8 }}>نظامي</span>}
                  {!row.active && <span className="badge bad" style={{ marginInlineStart: 8 }}>معطّل</span>}
                </span>
              ),
            },
            { key: 'type', label: 'النوع', width: 120, render: (row) => ACCOUNT_TYPE_LABELS[row.type] },
            {
              key: 'actions',
              label: '',
              width: 150,
              render: (row) =>
                canWrite && (
                  <div className="row">
                    <button className="sm ghost" onClick={() => setForm({ ...row, parentId: row.parentId || '' })}>تعديل</button>
                    {!row.systemKey && <button className="sm ghost danger" onClick={() => remove(row)}>حذف</button>}
                  </div>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
