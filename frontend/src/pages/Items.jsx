import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Card, DataTable, Field, Money, PageHead } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatQuantity, ITEM_KIND_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

const EMPTY = {
  kind: 'STOCK',
  name: '',
  unit: 'حبة',
  salePrice: '',
  purchasePrice: '',
  taxRate: '',
  salesAccountId: '',
  expenseAccountId: '',
  inventoryAccountId: '',
  cogsAccountId: '',
  reorderLevel: '',
  notes: '',
};

export default function Items() {
  const { can, settings } = useSession();
  const canWrite = can('items.write');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const items = useAsync(() => api.get(`/items${query({ kind, q: search })}`), [kind, search]);
  const accounts = useAsync(() => api.get('/accounts?postable=true&active=true'), []);

  const byType = (...types) => (accounts.data?.accounts || []).filter((a) => types.includes(a.type));

  function openNew() {
    setForm({ ...EMPTY, taxRate: settings?.defaultTaxRate || '' });
  }

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        salePrice: form.salePrice || '0',
        purchasePrice: form.purchasePrice || '0',
        taxRate: form.taxRate || '0',
        reorderLevel: form.reorderLevel || '0',
        expenseAccountId: form.expenseAccountId || null,
        inventoryAccountId: form.inventoryAccountId || null,
        cogsAccountId: form.cogsAccountId || null,
      };
      if (form.id) await api.patch(`/items/${form.id}`, payload);
      else await api.post('/items', payload);
      setForm(null);
      items.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(item) {
    if (!confirm(`حذف الصنف «${item.name}»؟`)) return;
    setError(null);
    try {
      await api.del(`/items/${item.id}`);
      items.reload();
    } catch (err) {
      setError(err);
    }
  }

  const isStock = form?.kind === 'STOCK';

  return (
    <>
      <PageHead
        title="الأصناف والخدمات"
        subtitle="الصنف المخزني يُتابَع كمياً وتُحسب تكلفته بالمتوسط المرجّح، والخدمة لا رصيد لها"
      >
        {canWrite && <button className="primary" onClick={openNew}>صنف جديد</button>}
      </PageHead>

      <Alert error={error} />

      {form && (
        <Card title={form.id ? `تعديل ${form.name}` : 'صنف جديد'}>
          <form onSubmit={save} className="stack">
            <div className="field-row">
              <Field label="النوع">
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  disabled={Boolean(form.id)}
                >
                  {Object.entries(ITEM_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="الاسم">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="الوحدة">
                <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </Field>
              <Field label="سعر البيع">
                <input className="num" dir="ltr" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
              </Field>
              <Field label="سعر الشراء">
                <input className="num" dir="ltr" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
              </Field>
              <Field label="الضريبة %">
                <input className="num" dir="ltr" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
              </Field>
            </div>

            <div className="field-row">
              <Field label="حساب الإيراد" hint="يُقيَّد عليه البيع">
                <select value={form.salesAccountId} onChange={(e) => setForm({ ...form, salesAccountId: e.target.value })} required>
                  <option value="">— اختر —</option>
                  {byType('INCOME').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </Field>

              {isStock ? (
                <>
                  <Field label="حساب المخزون" hint="الافتراضي 1301">
                    <select value={form.inventoryAccountId} onChange={(e) => setForm({ ...form, inventoryAccountId: e.target.value })}>
                      <option value="">— الافتراضي —</option>
                      {byType('ASSET').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </Field>
                  <Field label="حساب تكلفة المبيعات" hint="الافتراضي 5101">
                    <select value={form.cogsAccountId} onChange={(e) => setForm({ ...form, cogsAccountId: e.target.value })}>
                      <option value="">— الافتراضي —</option>
                      {byType('EXPENSE').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </Field>
                  <Field label="حد إعادة الطلب">
                    <input className="num" dir="ltr" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
                  </Field>
                </>
              ) : (
                <Field label="حساب المصروف" hint="يُقيَّد عليه شراء الخدمة">
                  <select value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}>
                    <option value="">— بلا شراء —</option>
                    {byType('EXPENSE', 'ASSET').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
              )}
            </div>

            <div className="toolbar">
              <button type="submit" className="primary">حفظ</button>
              <button type="button" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title={`${items.data?.items?.length || 0} صنفاً`}
        pad={false}
        actions={
          <>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 150 }}>
              <option value="">الكل</option>
              <option value="STOCK">الأصناف المخزنية</option>
              <option value="SERVICE">الخدمات</option>
            </select>
            <input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          </>
        }
      >
        <DataTable
          loading={items.loading}
          rows={items.data?.items || []}
          rowKey={(row) => row.id}
          empty="لا توجد أصناف"
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
            { key: 'kind', label: 'النوع', width: 110, render: (row) => ITEM_KIND_LABELS[row.kind] },
            { key: 'unit', label: 'الوحدة', width: 80, render: (row) => row.unit },
            { key: 'salePrice', label: 'سعر البيع', width: 120, numeric: true, render: (row) => <Money value={row.salePrice} /> },
            {
              key: 'onHand',
              label: 'الرصيد',
              width: 110,
              numeric: true,
              render: (row) =>
                row.kind === 'STOCK' ? (
                  <span className={Number(row.onHand) <= Number(row.reorderLevel) && Number(row.reorderLevel) > 0 ? 'stat-value neg' : ''}>
                    {formatQuantity(row.onHand)}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'value',
              label: 'قيمة المخزون',
              width: 130,
              numeric: true,
              render: (row) => (row.kind === 'STOCK' ? <Money value={row.stockValue} /> : '—'),
            },
            {
              key: 'actions',
              label: '',
              width: 190,
              render: (row) => (
                <div className="row">
                  {row.kind === 'STOCK' && <Link className="btn sm" to={`/reports/stock?itemId=${row.id}`}>الحركة</Link>}
                  {canWrite && <button className="sm ghost" onClick={() => setForm({ ...row, id: row.id })}>تعديل</button>}
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
