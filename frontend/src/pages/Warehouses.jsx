import { useState } from 'react';

import { Alert, Card, DataTable, Empty, Field, Money, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

const EMPTY_WAREHOUSE = { code: '', name: '', notes: '', isDefault: false };
const EMPTY_TRANSFER = {
  date: new Date().toISOString().slice(0, 10),
  fromWarehouseId: '',
  toWarehouseId: '',
  notes: '',
  lines: [{ itemId: '', quantity: '' }],
};

export default function Warehouses() {
  const { can } = useSession();
  const canWrite = can('stock.write');

  const warehouses = useAsync(() => api.get('/warehouses'), []);
  const transfers = useAsync(() => api.get('/warehouses/transfers/list'), []);
  const items = useAsync(() => api.get('/items?kind=STOCK'), []);

  const [form, setForm] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [stock, setStock] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = warehouses.data?.warehouses || [];
  const stockItems = (items.data?.items || []).filter((item) => item.kind === 'STOCK');

  async function saveWarehouse(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      if (form.id) await api.patch(`/warehouses/${form.id}`, form);
      else await api.post('/warehouses', form);
      setForm(null);
      warehouses.reload();
      setSuccess('حُفظ المستودع');
    } catch (err) {
      setError(err);
    }
  }

  async function setDefault(row) {
    setError(null);
    try {
      await api.patch(`/warehouses/${row.id}`, { isDefault: true });
      warehouses.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleActive(row) {
    setError(null);
    try {
      await api.patch(`/warehouses/${row.id}`, { active: !row.active });
      warehouses.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function showStock(row) {
    setError(null);
    try {
      const res = await api.get(`/warehouses/${row.id}/stock`);
      setStock(res);
    } catch (err) {
      setError(err);
    }
  }

  async function saveTransfer(event, post) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const payload = {
        ...transfer,
        lines: transfer.lines.filter((line) => line.itemId && line.quantity),
        ...(post ? { post: true } : {}),
      };
      if (!payload.lines.length) throw new Error('أضف سطراً واحداً على الأقل');

      const res = await api.post('/warehouses/transfers', payload);
      setTransfer(null);
      transfers.reload();
      warehouses.reload();
      setSuccess(`حُفظ التحويل ${res.transfer.number}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function transferAction(row, action) {
    setError(null);
    try {
      if (action === 'delete') await api.del(`/warehouses/transfers/${row.id}`);
      else await api.post(`/warehouses/transfers/${row.id}/${action}`);
      transfers.reload();
      warehouses.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHead title="المستودعات" subtitle="رصيد كل صنف وتكلفته في كل مستودع على حدة">
        {canWrite && (
          <>
            <button onClick={() => setForm({ ...EMPTY_WAREHOUSE })}>مستودع جديد</button>
            <button
              className="primary"
              onClick={() =>
                setTransfer({
                  ...EMPTY_TRANSFER,
                  fromWarehouseId: list.find((w) => w.isDefault)?.id || '',
                  lines: [{ itemId: '', quantity: '' }],
                })
              }
            >
              تحويل بضاعة
            </button>
          </>
        )}
      </PageHead>

      <Alert error={error} success={success} />

      {form && (
        <Card title={form.id ? 'تعديل مستودع' : 'مستودع جديد'}>
          <form className="stack" onSubmit={saveWarehouse}>
            <div className="field-row">
              <Field label="الرمز" hint="لاتيني وأرقام — لا يتغيّر بعد الإنشاء">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  dir="ltr"
                  disabled={Boolean(form.id)}
                  required
                />
              </Field>
              <Field label="الاسم">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            </div>
            <Field label="ملاحظات">
              <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="toolbar">
              <button type="submit" className="primary">حفظ</button>
              <button type="button" className="ghost" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      {transfer && (
        <Card title="تحويل بضاعة بين مستودعين">
          <form className="stack" onSubmit={(e) => saveTransfer(e, true)}>
            <div className="field-row">
              <Field label="التاريخ">
                <input
                  type="date"
                  value={transfer.date}
                  onChange={(e) => setTransfer({ ...transfer, date: e.target.value })}
                  required
                />
              </Field>
              <Field label="من مستودع">
                <select
                  value={transfer.fromWarehouseId}
                  onChange={(e) => setTransfer({ ...transfer, fromWarehouseId: e.target.value })}
                  required
                >
                  <option value="">— اختر —</option>
                  {list.filter((w) => w.active).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="إلى مستودع">
                <select
                  value={transfer.toWarehouseId}
                  onChange={(e) => setTransfer({ ...transfer, toWarehouseId: e.target.value })}
                  required
                >
                  <option value="">— اختر —</option>
                  {list.filter((w) => w.active && w.id !== transfer.fromWarehouseId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th className="num" style={{ width: 140 }}>الكمية</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {transfer.lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <select
                          value={line.itemId}
                          onChange={(e) => {
                            const lines = [...transfer.lines];
                            lines[index] = { ...line, itemId: e.target.value };
                            setTransfer({ ...transfer, lines });
                          }}
                        >
                          <option value="">— اختر صنفاً —</option>
                          {stockItems.map((item) => (
                            <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="num"
                          value={line.quantity}
                          onChange={(e) => {
                            const lines = [...transfer.lines];
                            lines[index] = { ...line, quantity: e.target.value };
                            setTransfer({ ...transfer, lines });
                          }}
                          dir="ltr"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost sm"
                          onClick={() =>
                            setTransfer({
                              ...transfer,
                              lines:
                                transfer.lines.length > 1
                                  ? transfer.lines.filter((_, i) => i !== index)
                                  : transfer.lines,
                            })
                          }
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <button
                type="button"
                className="ghost"
                onClick={() => setTransfer({ ...transfer, lines: [...transfer.lines, { itemId: '', quantity: '' }] })}
              >
                إضافة سطر
              </button>
              <button type="submit" className="primary" disabled={busy}>حفظ وترحيل</button>
              <button type="button" onClick={(e) => saveTransfer(e, false)} disabled={busy}>حفظ مسودة</button>
              <button type="button" className="ghost" onClick={() => setTransfer(null)}>إلغاء</button>
            </div>

            <p className="small muted">
              التحويل لا يمسّ الدفتر: البضاعة تخرج من مكان وتدخل آخر بالتكلفة نفسها،
              وحساب المخزون واحد.
            </p>
          </form>
        </Card>
      )}

      {stock && (
        <Card title={`أرصدة ${stock.warehouse.name}`} pad={false}>
          <DataTable
            columns={[
              { key: 'code', label: 'الرمز', render: (row) => <span dir="ltr">{row.code}</span> },
              { key: 'name', label: 'الصنف', render: (row) => row.name },
              { key: 'onHand', label: 'الرصيد', numeric: true, render: (row) => row.onHand },
              { key: 'avg', label: 'متوسط التكلفة', numeric: true, render: (row) => <Money value={row.averageCost} /> },
              { key: 'value', label: 'القيمة', numeric: true, render: (row) => <Money value={row.value} /> },
            ]}
            rows={stock.rows}
            empty="لا بضاعة في هذا المستودع"
            rowKey={(row) => row.itemId}
          />
          <div className="toolbar" style={{ padding: 10 }}>
            <strong>الإجمالي: <Money value={stock.total} /></strong>
            <button className="ghost sm" onClick={() => setStock(null)}>إغلاق</button>
          </div>
        </Card>
      )}

      <Card title="المستودعات" pad={false}>
        <DataTable
          columns={[
            {
              key: 'name',
              label: 'المستودع',
              render: (row) => (
                <div>
                  <div>
                    {row.name}
                    {row.isDefault && <span className="small muted"> — الافتراضي</span>}
                  </div>
                  <div className="small muted" dir="ltr">{row.code}</div>
                </div>
              ),
            },
            { key: 'value', label: 'قيمة البضاعة', numeric: true, render: (row) => <Money value={row.stockValue} /> },
            { key: 'state', label: 'الحالة', render: (row) => <span className="small">{row.active ? 'نشط' : 'موقوف'}</span> },
            {
              key: 'actions',
              label: '',
              render: (row) => (
                <div className="toolbar">
                  <button className="ghost sm" onClick={() => showStock(row)}>الأرصدة</button>
                  {canWrite && (
                    <>
                      <button className="ghost sm" onClick={() => setForm({ ...row })}>تعديل</button>
                      {!row.isDefault && row.active && (
                        <button className="ghost sm" onClick={() => setDefault(row)}>اجعله الافتراضي</button>
                      )}
                      {!row.isDefault && (
                        <button className="ghost sm" onClick={() => toggleActive(row)}>
                          {row.active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ),
            },
          ]}
          rows={list}
          loading={warehouses.loading}
          empty="لا مستودعات"
          rowKey={(row) => row.id}
        />
      </Card>

      <Card title="التحويلات" pad={false}>
        {transfers.loading ? null : !transfers.data?.transfers.length ? (
          <Empty label="لا تحويلات بعد" />
        ) : (
          <DataTable
            columns={[
              { key: 'number', label: 'الرقم', render: (row) => <span dir="ltr">{row.number}</span> },
              { key: 'date', label: 'التاريخ', render: (row) => formatDate(row.date) },
              {
                key: 'route',
                label: 'من → إلى',
                render: (row) => (
                  <span className="small">{row.from?.name} ← {row.to?.name}</span>
                ),
              },
              {
                key: 'lines',
                label: 'الأصناف',
                render: (row) => (
                  <span className="small muted">
                    {row.lines.map((line) => `${line.name} (${line.quantity})`).join('، ')}
                  </span>
                ),
              },
              { key: 'status', label: 'الحالة', render: (row) => <span className="badge">{STATUS_LABELS[row.status]}</span> },
              {
                key: 'actions',
                label: '',
                render: (row) =>
                  canWrite && (
                    <div className="toolbar">
                      {row.status === 'DRAFT' && (
                        <>
                          <button className="ghost sm" onClick={() => transferAction(row, 'post')}>ترحيل</button>
                          <button className="ghost sm" onClick={() => transferAction(row, 'delete')}>حذف</button>
                        </>
                      )}
                      {row.status === 'POSTED' && (
                        <button className="ghost sm" onClick={() => transferAction(row, 'unpost')}>إلغاء الترحيل</button>
                      )}
                    </div>
                  ),
              },
            ]}
            rows={transfers.data.transfers}
            rowKey={(row) => row.id}
          />
        )}
      </Card>
    </>
  );
}
