import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Card, DataTable, Field, Money, PageHead } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { PARTY_KIND_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

const EMPTY = { kind: 'CUSTOMER', name: '', phone: '', email: '', taxNumber: '', address: '', notes: '' };

export default function Parties() {
  const { canWrite } = useSession();
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const parties = useAsync(() => api.get(`/parties${query({ kind, q: search })}`), [kind, search]);

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      if (form.id) await api.patch(`/parties/${form.id}`, form);
      else await api.post('/parties', form);
      setForm(null);
      parties.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(party) {
    if (!confirm(`حذف «${party.name}»؟`)) return;
    setError(null);
    try {
      await api.del(`/parties/${party.id}`);
      parties.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHead title="العملاء والموردون" subtitle="الرصيد الموجب يعني مستحق لنا، والسالب مستحق علينا">
        {canWrite && <button className="primary" onClick={() => setForm({ ...EMPTY })}>إضافة طرف</button>}
      </PageHead>

      <Alert error={error} />

      {form && (
        <Card title={form.id ? 'تعديل بيانات' : 'طرف جديد'}>
          <form onSubmit={save} className="stack">
            <div className="field-row">
              <Field label="النوع">
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(PARTY_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="الاسم">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="الهاتف">
                <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              </Field>
              <Field label="البريد">
                <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
              </Field>
              <Field label="الرقم الضريبي">
                <input value={form.taxNumber || ''} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} dir="ltr" />
              </Field>
            </div>
            <Field label="العنوان">
              <input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <div className="toolbar">
              <button type="submit" className="primary">حفظ</button>
              <button type="button" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title={`${parties.data?.parties?.length || 0} طرفاً`}
        pad={false}
        actions={
          <>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 150 }}>
              <option value="">كل الأطراف</option>
              <option value="CUSTOMER">العملاء</option>
              <option value="SUPPLIER">الموردون</option>
            </select>
            <input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          </>
        }
      >
        <DataTable
          loading={parties.loading}
          rows={parties.data?.parties || []}
          rowKey={(row) => row.id}
          empty="لا توجد أطراف مسجّلة"
          columns={[
            { key: 'code', label: 'الرمز', width: 90, render: (row) => <span dir="ltr">{row.code}</span> },
            {
              key: 'name',
              label: 'الاسم',
              render: (row) => (
                <>
                  {row.name}
                  {!row.active && <span className="badge bad" style={{ marginInlineStart: 8 }}>معطّل</span>}
                </>
              ),
            },
            { key: 'kind', label: 'النوع', width: 110, render: (row) => PARTY_KIND_LABELS[row.kind] },
            { key: 'phone', label: 'الهاتف', width: 130, render: (row) => <span dir="ltr">{row.phone || '—'}</span> },
            { key: 'balance', label: 'الرصيد', width: 140, numeric: true, render: (row) => <Money value={row.balance} signed /> },
            {
              key: 'actions',
              label: '',
              width: 200,
              render: (row) => (
                <div className="row">
                  <Link className="btn sm" to={`/reports/ledger?partyId=${row.id}`}>كشف حساب</Link>
                  {canWrite && <button className="sm ghost" onClick={() => setForm({ ...row })}>تعديل</button>}
                  {canWrite && <button className="sm ghost danger" onClick={() => remove(row)}>حذف</button>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
