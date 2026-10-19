import { useState } from 'react';

import { Alert, Card, DataTable, Field, Money, PageHead } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';

const METHOD_LABELS = { STRAIGHT_LINE: 'قسط ثابت', DECLINING_BALANCE: 'قسط متناقص' };

const EMPTY = {
  name: '',
  description: '',
  acquiredAt: new Date().toISOString().slice(0, 10),
  cost: '',
  salvageValue: '0',
  method: 'STRAIGHT_LINE',
  usefulLifeMonths: 60,
  decliningRate: '20',
  postAcquisition: false,
  creditAccountId: '',
};

/** آخر يوم في الشهر الحالي — الافتراضي لفترة الإهلاك. */
function thisMonthEnd() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export default function Assets() {
  const { can } = useSession();
  const canWrite = can('assets.write');

  const [status, setStatus] = useState('ACTIVE');
  const [form, setForm] = useState(null);
  const [dispose, setDispose] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(thisMonthEnd());
  const [due, setDue] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);

  const assets = useAsync(() => api.get(`/fixed-assets${query({ status })}`), [status]);
  const accounts = useAsync(() => api.get('/accounts?postable=true'), []);

  const postable = accounts.data?.accounts || [];

  async function save(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.post('/fixed-assets', form);
      setForm(null);
      assets.reload();
      setSuccess('أُضيف الأصل');
    } catch (err) {
      setError(err);
    }
  }

  async function loadDue() {
    setError(null);
    setDue(null);
    try {
      const res = await api.get(`/fixed-assets/depreciation/due?periodEnd=${periodEnd}`);
      setDue(res);
    } catch (err) {
      setError(err);
    }
  }

  async function runDepreciation() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await api.post('/fixed-assets/depreciation', { periodEnd });
      setDue(null);
      assets.reload();
      setSuccess(`رُحّل إهلاك ${res.assets.length} أصلاً بقيد #${res.entryNumber}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(entryId) {
    if (!confirm('التراجع عن دفعة الإهلاك؟ يُحذف قيدها من الدفتر.')) return;
    setError(null);
    setSuccess(null);
    try {
      await api.del(`/fixed-assets/depreciation/${entryId}`);
      assets.reload();
      setSuccess('تراجعتُ عن دفعة الإهلاك');
    } catch (err) {
      setError(err);
    }
  }

  async function submitDispose(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await api.post(`/fixed-assets/${dispose.asset.id}/dispose`, {
        date: dispose.date,
        proceeds: dispose.proceeds || '0',
        cashAccountId: dispose.cashAccountId || null,
        gainLossAccountId: dispose.gainLossAccountId,
      });
      setDispose(null);
      assets.reload();
      const result = Number(res.result);
      setSuccess(
        `استُبعد الأصل بقيد #${res.entryNumber} — ${result >= 0 ? 'ربح' : 'خسارة'} ${Math.abs(result).toFixed(2)}`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'الأصل',
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <div className="small muted" dir="ltr">{row.code}</div>
        </div>
      ),
    },
    { key: 'acquired', label: 'الاقتناء', render: (row) => <span className="small">{formatDate(row.acquiredAt)}</span> },
    { key: 'cost', label: 'التكلفة', numeric: true, render: (row) => <Money value={row.cost} /> },
    {
      key: 'method',
      label: 'الإهلاك',
      render: (row) => (
        <span className="small">
          {METHOD_LABELS[row.method]}
          <br />
          <span className="muted">
            {row.method === 'STRAIGHT_LINE'
              ? `${row.usefulLifeMonths} شهراً`
              : `${(row.decliningRate / 100).toFixed(2)}% سنوياً`}
          </span>
        </span>
      ),
    },
    { key: 'accumulated', label: 'المجمّع', numeric: true, render: (row) => <Money value={row.accumulated} /> },
    {
      key: 'book',
      label: 'القيمة الدفترية',
      numeric: true,
      render: (row) => <strong><Money value={row.bookValue} /></strong>,
    },
    {
      key: 'history',
      label: '',
      render: (row) => (
        <button className="ghost sm" onClick={() => setHistory(row)}>سجل الإهلاك</button>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) =>
        canWrite && row.status === 'ACTIVE' ? (
          <button
            className="ghost sm"
            onClick={() =>
              setDispose({
                asset: row,
                date: new Date().toISOString().slice(0, 10),
                proceeds: '',
                cashAccountId: '',
                gainLossAccountId: '',
              })
            }
          >
            استبعاد
          </button>
        ) : row.status === 'DISPOSED' ? (
          <span className="small muted">استُبعد في {formatDate(row.disposedAt)}</span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHead title="الأصول الثابتة" subtitle="بطاقة كل أصل وإهلاكه الدوري واستبعاده">
        {canWrite && <button className="primary" onClick={() => setForm({ ...EMPTY })}>أصل جديد</button>}
      </PageHead>

      <Alert error={error} success={success} />

      {form && (
        <Card title="أصل جديد">
          <form className="stack" onSubmit={save}>
            <div className="field-row">
              <Field label="اسم الأصل">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="تاريخ الاقتناء">
                <input
                  type="date"
                  value={form.acquiredAt}
                  onChange={(e) => setForm({ ...form, acquiredAt: e.target.value })}
                  required
                />
              </Field>
              <Field label="التكلفة">
                <input
                  className="num"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  dir="ltr"
                  required
                />
              </Field>
              <Field label="القيمة التخريدية">
                <input
                  className="num"
                  value={form.salvageValue}
                  onChange={(e) => setForm({ ...form, salvageValue: e.target.value })}
                  dir="ltr"
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="طريقة الإهلاك">
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {Object.entries(METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>

              {form.method === 'STRAIGHT_LINE' ? (
                <Field label="العمر الإنتاجي (شهراً)">
                  <input
                    type="number"
                    min="1"
                    className="num"
                    value={form.usefulLifeMonths}
                    onChange={(e) => setForm({ ...form, usefulLifeMonths: Number(e.target.value) })}
                    dir="ltr"
                  />
                </Field>
              ) : (
                <Field label="النسبة السنوية %">
                  <input
                    className="num"
                    value={form.decliningRate}
                    onChange={(e) => setForm({ ...form, decliningRate: e.target.value })}
                    dir="ltr"
                  />
                </Field>
              )}
            </div>

            <label className="field-inline">
              <input
                type="checkbox"
                checked={form.postAcquisition}
                onChange={(e) => setForm({ ...form, postAcquisition: e.target.checked })}
              />
              <span>سجّل قيد الاقتناء الآن</span>
            </label>

            {form.postAcquisition && (
              <Field label="الحساب الدائن" hint="النقدية أو البنك أو ذمم الموردين">
                <select
                  value={form.creditAccountId}
                  onChange={(e) => setForm({ ...form, creditAccountId: e.target.value })}
                  required
                >
                  <option value="">— اختر —</option>
                  {postable.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <p className="small muted">
              اترك قيد الاقتناء إن كان الأصل قد دخل الدفتر بفاتورة شراء من قبل، وإلا
              قُيّدت تكلفته مرتين.
            </p>

            <div className="toolbar">
              <button type="submit" className="primary">حفظ</button>
              <button type="button" className="ghost" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      {dispose && (
        <Card title={`استبعاد ${dispose.asset.name}`}>
          <form className="stack" onSubmit={submitDispose}>
            <div className="spread">
              <span className="muted">القيمة الدفترية الآن</span>
              <strong><Money value={dispose.asset.bookValue} /></strong>
            </div>

            <div className="field-row">
              <Field label="تاريخ الاستبعاد">
                <input
                  type="date"
                  value={dispose.date}
                  onChange={(e) => setDispose({ ...dispose, date: e.target.value })}
                  required
                />
              </Field>
              <Field label="حصيلة البيع" hint="صفر إن كان تالفاً أو متبرَّعاً به">
                <input
                  className="num"
                  value={dispose.proceeds}
                  onChange={(e) => setDispose({ ...dispose, proceeds: e.target.value })}
                  dir="ltr"
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="الحساب النقدي" hint="مطلوب إن كانت هناك حصيلة">
                <select
                  value={dispose.cashAccountId}
                  onChange={(e) => setDispose({ ...dispose, cashAccountId: e.target.value })}
                >
                  <option value="">— لا شيء —</option>
                  {postable.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="حساب الربح أو الخسارة" hint="إيرادات أخرى أو مصروفات متنوعة">
                <select
                  value={dispose.gainLossAccountId}
                  onChange={(e) => setDispose({ ...dispose, gainLossAccountId: e.target.value })}
                  required
                >
                  <option value="">— اختر —</option>
                  {postable.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="toolbar">
              <button type="submit" className="primary" disabled={busy}>تنفيذ الاستبعاد</button>
              <button type="button" className="ghost" onClick={() => setDispose(null)}>إلغاء</button>
            </div>
          </form>
        </Card>
      )}

      <Card title="إهلاك الفترة">
        <div className="stack">
          <div className="field-row">
            <Field label="حتى نهاية شهر">
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </Field>
            <div className="toolbar" style={{ alignItems: 'end' }}>
              <button className="ghost" onClick={loadDue}>عرض المستحقّ</button>
              {canWrite && (
                <button className="primary" onClick={runDepreciation} disabled={busy}>
                  ترحيل الإهلاك
                </button>
              )}
            </div>
          </div>

          {due && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الأصل</th>
                    <th>أشهر</th>
                    <th className="num">القسط</th>
                    <th className="num">القيمة الدفترية بعده</th>
                  </tr>
                </thead>
                <tbody>
                  {due.assets.map((row) => (
                    <tr key={row.id}>
                      <td>{row.code} — {row.name}</td>
                      <td>{row.months}</td>
                      <td className="num"><Money value={row.amount} /></td>
                      <td className="num"><Money value={row.bookValueAfter} /></td>
                    </tr>
                  ))}
                  {!due.assets.length && (
                    <tr><td colSpan={4} className="empty">لا أصل مستحقّ في هذه الفترة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {due && due.assets.length > 0 && (
            <div className="spread">
              <span>إجمالي القسط</span>
              <strong><Money value={due.total} /></strong>
            </div>
          )}
        </div>
      </Card>

      {history && (
        <Card title={`سجل إهلاك ${history.name}`} pad={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>حتى</th>
                  <th>أشهر</th>
                  <th className="num">القسط</th>
                  <th className="num">الدفترية بعده</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.depreciations.map((row, index) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.periodEnd)}</td>
                    <td>{row.months}</td>
                    <td className="num"><Money value={row.amount} /></td>
                    <td className="num"><Money value={row.bookValueAfter} /></td>
                    <td>
                      {canWrite && index === 0 && (
                        <button className="ghost sm" onClick={() => reverse(row.entryId)}>تراجع</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!history.depreciations.length && (
                  <tr><td colSpan={5} className="empty">لم يُرحَّل إهلاك بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ padding: 10 }}>
            <button className="ghost sm" onClick={() => setHistory(null)}>إغلاق</button>
          </div>
        </Card>
      )}

      <Card
        title="الأصول"
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">القائمة</option>
            <option value="DISPOSED">المستبعَدة</option>
            <option value="">الكل</option>
          </select>
        }
        pad={false}
      >
        <DataTable
          columns={columns}
          rows={assets.data?.assets}
          loading={assets.loading}
          empty="لا أصول ثابتة بعد"
          rowKey={(row) => row.id}
        />
      </Card>

      {assets.data?.totals && status === 'ACTIVE' && (
        <div className="spread">
          <span className="muted">إجمالي الأصول القائمة</span>
          <span className="small">
            التكلفة <Money value={assets.data.totals.cost} /> · المجمّع{' '}
            <Money value={assets.data.totals.accumulated} /> · الدفترية{' '}
            <strong><Money value={assets.data.totals.bookValue} /></strong>
          </span>
        </div>
      )}
    </>
  );
}
