import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert, Card, Field, Loading, Money, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { compareMoney, sumMoney } from '../lib/calc';
import { formatDate, STATUS_LABELS, today } from '../lib/format';
import { useSession } from '../lib/session';
import { KIND_BY_SLUG } from './Payments.jsx';

const LABELS = {
  RECEIPT: { new: 'سند قبض جديد', party: 'العميل', partyKind: 'CUSTOMER', invoices: 'فواتير المبيعات غير المسدَّدة', invoiceKind: 'SALES' },
  PAYMENT: { new: 'سند صرف جديد', party: 'المورد', partyKind: 'SUPPLIER', invoices: 'فواتير المشتريات غير المسدَّدة', invoiceKind: 'PURCHASE' },
};

const CAPABILITY_PREFIX = { RECEIPT: 'receipt', PAYMENT: 'expense' };

export default function PaymentForm() {
  const { kind: slug, id } = useParams();
  const kind = KIND_BY_SLUG[slug] || 'RECEIPT';
  const labels = LABELS[kind];
  const navigate = useNavigate();
  const { can } = useSession();
  const canWrite = can(`${CAPABILITY_PREFIX[kind]}.write`);
  const canPost = can(`${CAPABILITY_PREFIX[kind]}.post`);

  const [form, setForm] = useState({ date: today(), partyId: '', cashAccountId: '', amount: '', reference: '', notes: '' });
  const [allocations, setAllocations] = useState({});
  const [status, setStatus] = useState('DRAFT');
  const [number, setNumber] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const parties = useAsync(() => api.get(`/parties${query({ kind: labels.partyKind, active: 'true' })}`), [kind]);
  const accounts = useAsync(() => api.get('/accounts?postable=true&active=true&type=ASSET'), []);
  const existing = useAsync(() => (id ? api.get(`/payments/${id}`) : Promise.resolve(null)), [id]);

  const openInvoices = useAsync(
    () =>
      form.partyId
        ? api.get(`/invoices${query({ kind: labels.invoiceKind, partyId: form.partyId, status: 'POSTED', limit: 100 })}`)
        : Promise.resolve({ invoices: [] }),
    [form.partyId, kind],
  );

  useEffect(() => {
    const payment = existing.data?.payment;
    if (!payment) return;
    setForm({
      date: payment.date,
      partyId: payment.partyId,
      cashAccountId: payment.cashAccountId,
      amount: payment.amount,
      reference: payment.reference || '',
      notes: payment.notes || '',
    });
    setAllocations(Object.fromEntries((payment.allocations || []).map((a) => [a.invoiceId, a.amount])));
    setStatus(payment.status);
    setNumber(payment.number);
  }, [existing.data]);

  const readOnly = !canWrite || status !== 'DRAFT';
  const allocatedTotal = useMemo(() => sumMoney(Object.values(allocations).filter(Boolean)), [allocations]);
  const overAllocated = compareMoney(allocatedTotal, form.amount || '0') > 0;

  const unpaid = (openInvoices.data?.invoices || []).filter(
    (invoice) => Number(invoice.due) > 0 || allocations[invoice.id],
  );

  async function submit(post) {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        kind,
        date: form.date,
        partyId: form.partyId,
        cashAccountId: form.cashAccountId,
        amount: form.amount || '0',
        reference: form.reference || null,
        notes: form.notes || null,
        allocations: Object.entries(allocations)
          .filter(([, amount]) => amount && Number(amount) > 0)
          .map(([invoiceId, amount]) => ({ invoiceId, amount })),
        ...(post && !id ? { post: true } : {}),
      };

      const saved = id ? await api.patch(`/payments/${id}`, payload) : await api.post('/payments', payload);
      const paymentId = saved.payment.id;
      if (post && id) await api.post(`/payments/${paymentId}/post`);
      navigate(`/payments/${slug}/${paymentId}`, { replace: true });
      if (id) existing.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function act(action, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    setBusy(true);
    try {
      if (action === 'delete') {
        await api.del(`/payments/${id}`);
        navigate(`/payments/${slug}`, { replace: true });
        return;
      }
      await api.post(`/payments/${id}/${action}`);
      existing.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (id && existing.loading) return <Loading />;

  return (
    <>
      <PageHead
        title={id ? `سند ${number}` : labels.new}
        subtitle={id ? formatDate(form.date) : 'وزّع المبلغ على الفواتير المفتوحة أو اتركه دفعة تحت الحساب'}
      >
        {id && <StatusBadge status={status} labels={STATUS_LABELS} />}
        {id && status === 'POSTED' && canPost && (
          <button onClick={() => act('unpost', 'إلغاء ترحيل السند؟')} disabled={busy}>إلغاء الترحيل</button>
        )}
        {id && status === 'DRAFT' && canPost && (
          <button className="primary" onClick={() => act('post')} disabled={busy}>ترحيل</button>
        )}
        {id && status !== 'CANCELLED' && canPost && (
          <button className="danger" onClick={() => act('cancel', 'إلغاء السند؟')} disabled={busy}>إلغاء السند</button>
        )}
      </PageHead>

      <Alert error={error} />

      <div className="stack">
        <Card title="بيانات السند">
          <div className="field-row">
            <Field label={labels.party}>
              <select
                value={form.partyId}
                onChange={(e) => { setForm({ ...form, partyId: e.target.value }); setAllocations({}); }}
                disabled={readOnly}
              >
                <option value="">— اختر —</option>
                {(parties.data?.parties || []).map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </select>
            </Field>
            <Field label="الحساب النقدي / البنكي">
              <select value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })} disabled={readOnly}>
                <option value="">— اختر —</option>
                {(accounts.data?.accounts || []).map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                ))}
              </select>
            </Field>
            <Field label="التاريخ">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={readOnly} />
            </Field>
            <Field label="المبلغ">
              <input className="num" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} disabled={readOnly} dir="ltr" />
            </Field>
            <Field label="المرجع" hint="رقم الشيك أو الحوالة">
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} disabled={readOnly} />
            </Field>
          </div>
        </Card>

        <Card
          title={labels.invoices}
          pad={false}
          actions={
            <span className={overAllocated ? 'badge bad' : 'badge'}>
              الموزَّع: <Money value={allocatedTotal} />
            </span>
          }
        >
          {!form.partyId ? (
            <div className="empty">اختر {labels.party} أولاً</div>
          ) : openInvoices.loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : !unpaid.length ? (
            <div className="empty">لا توجد فواتير مفتوحة لهذا الطرف</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>التاريخ</th>
                    <th className="num">الإجمالي</th>
                    <th className="num">المتبقي</th>
                    <th className="num" style={{ width: 150 }}>المبلغ الموزَّع</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaid.map((invoice) => (
                    <tr key={invoice.id}>
                      <td dir="ltr">{invoice.number}</td>
                      <td>{formatDate(invoice.date)}</td>
                      <td className="num"><Money value={invoice.total} /></td>
                      <td className="num"><Money value={invoice.due} /></td>
                      <td className="num">
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <input
                            className="num"
                            value={allocations[invoice.id] || ''}
                            onChange={(e) => setAllocations({ ...allocations, [invoice.id]: e.target.value })}
                            disabled={readOnly}
                            dir="ltr"
                            placeholder="0.00"
                          />
                          {!readOnly && (
                            <button
                              className="sm ghost"
                              type="button"
                              onClick={() => setAllocations({ ...allocations, [invoice.id]: invoice.due })}
                            >
                              الكل
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {overAllocated && <div className="alert error">مجموع التوزيع يتجاوز مبلغ السند</div>}

        {!readOnly && (
          <div className="toolbar">
            <button className="primary" onClick={() => submit(false)} disabled={busy || overAllocated || !form.partyId || !form.cashAccountId}>
              {id ? 'حفظ التعديلات' : 'حفظ كمسودة'}
            </button>
            <button onClick={() => submit(true)} disabled={busy || overAllocated || !form.partyId || !form.cashAccountId}>
              حفظ وترحيل
            </button>
            {id && <button className="danger" onClick={() => act('delete', 'حذف المسودة؟')} disabled={busy}>حذف</button>}
          </div>
        )}
      </div>
    </>
  );
}
