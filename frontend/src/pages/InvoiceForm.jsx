import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert, Card, Field, Loading, Money, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { computeInvoice } from '../lib/calc';
import { formatDate, STATUS_LABELS, today } from '../lib/format';
import { useSession } from '../lib/session';
import { KIND_BY_SLUG } from './Invoices.jsx';

const LABELS = {
  SALES: { new: 'فاتورة مبيعات جديدة', party: 'العميل', partyKind: 'CUSTOMER', account: 'حساب الإيراد' },
  PURCHASE: { new: 'فاتورة مشتريات جديدة', party: 'المورد', partyKind: 'SUPPLIER', account: 'حساب المصروف' },
};

const emptyLine = (taxRate) => ({ description: '', quantity: '1', unitPrice: '', taxRate: taxRate || '0', accountId: '' });

export default function InvoiceForm() {
  const { kind: slug, id } = useParams();
  const kind = KIND_BY_SLUG[slug] || 'SALES';
  const labels = LABELS[kind];
  const navigate = useNavigate();
  const { canWrite, settings } = useSession();

  const [header, setHeader] = useState({ date: today(), dueDate: '', partyId: '', notes: '' });
  const [lines, setLines] = useState([emptyLine(settings?.defaultTaxRate)]);
  const [status, setStatus] = useState('DRAFT');
  const [number, setNumber] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const parties = useAsync(() => api.get(`/parties${query({ kind: labels.partyKind, active: 'true' })}`), [kind]);
  const accounts = useAsync(() => api.get('/accounts?postable=true&active=true'), []);
  const existing = useAsync(() => (id ? api.get(`/invoices/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const invoice = existing.data?.invoice;
    if (!invoice) return;
    setHeader({
      date: invoice.date,
      dueDate: invoice.dueDate || '',
      partyId: invoice.partyId,
      notes: invoice.notes || '',
    });
    setLines(
      invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        accountId: line.accountId,
      })),
    );
    setStatus(invoice.status);
    setNumber(invoice.number);
  }, [existing.data]);

  const allowedTypes = kind === 'SALES' ? ['INCOME'] : ['EXPENSE', 'ASSET'];
  const lineAccounts = (accounts.data?.accounts || []).filter((a) => allowedTypes.includes(a.type));
  const totals = useMemo(() => computeInvoice(lines), [lines]);

  const readOnly = !canWrite || status !== 'DRAFT';

  function updateLine(index, patch) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(post) {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        kind,
        date: header.date,
        dueDate: header.dueDate || null,
        partyId: header.partyId,
        notes: header.notes || null,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity || '0',
          unitPrice: line.unitPrice || '0',
          taxRate: line.taxRate || '0',
          accountId: line.accountId,
        })),
        ...(post ? { post: true } : {}),
      };

      const saved = id ? await api.patch(`/invoices/${id}`, payload) : await api.post('/invoices', payload);
      const invoiceId = saved.invoice.id;
      if (post && id) await api.post(`/invoices/${invoiceId}/post`);
      navigate(`/invoices/${slug}/${invoiceId}`, { replace: true });
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
        await api.del(`/invoices/${id}`);
        navigate(`/invoices/${slug}`, { replace: true });
        return;
      }
      await api.post(`/invoices/${id}/${action}`);
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
        title={id ? `فاتورة ${number}` : labels.new}
        subtitle={id ? `أُنشئت في ${formatDate(header.date)}` : 'احفظها كمسودة أو رحّلها مباشرة إلى الحسابات'}
      >
        {id && <StatusBadge status={status} labels={STATUS_LABELS} />}
        {id && status === 'POSTED' && canWrite && (
          <button onClick={() => act('unpost', 'إلغاء ترحيل الفاتورة وإرجاعها مسودة؟')} disabled={busy}>
            إلغاء الترحيل
          </button>
        )}
        {id && status === 'DRAFT' && canWrite && (
          <button className="primary" onClick={() => act('post')} disabled={busy}>ترحيل</button>
        )}
        {id && status !== 'CANCELLED' && canWrite && (
          <button className="danger" onClick={() => act('cancel', 'إلغاء الفاتورة نهائياً؟')} disabled={busy}>إلغاء الفاتورة</button>
        )}
        {id && <button onClick={() => window.print()}>طباعة</button>}
      </PageHead>

      <Alert error={error} />

      <div className="stack">
        <Card title="بيانات الفاتورة">
          <div className="field-row">
            <Field label={labels.party}>
              <select
                value={header.partyId}
                onChange={(e) => setHeader({ ...header, partyId: e.target.value })}
                disabled={readOnly}
                required
              >
                <option value="">— اختر —</option>
                {(parties.data?.parties || []).map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </select>
            </Field>
            <Field label="التاريخ">
              <input type="date" value={header.date} onChange={(e) => setHeader({ ...header, date: e.target.value })} disabled={readOnly} />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <input type="date" value={header.dueDate} onChange={(e) => setHeader({ ...header, dueDate: e.target.value })} disabled={readOnly} />
            </Field>
            <Field label="ملاحظات">
              <input value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} disabled={readOnly} />
            </Field>
          </div>
        </Card>

        <Card
          title="الأصناف والخدمات"
          pad={false}
          actions={
            !readOnly && (
              <button onClick={() => setLines([...lines, emptyLine(settings?.defaultTaxRate)])}>إضافة سطر</button>
            )
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>الوصف</th>
                  <th style={{ width: 200 }}>{labels.account}</th>
                  <th className="num" style={{ width: 100 }}>الكمية</th>
                  <th className="num" style={{ width: 120 }}>سعر الوحدة</th>
                  <th className="num" style={{ width: 90 }}>الضريبة %</th>
                  <th className="num" style={{ width: 120 }}>الإجمالي</th>
                  {!readOnly && <th style={{ width: 50 }} />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(index, { description: e.target.value })}
                        disabled={readOnly}
                        placeholder="وصف البند"
                      />
                    </td>
                    <td>
                      <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })} disabled={readOnly}>
                        <option value="">— اختر —</option>
                        {lineAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                        ))}
                      </select>
                    </td>
                    <td><input className="num" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} disabled={readOnly} dir="ltr" /></td>
                    <td><input className="num" value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} disabled={readOnly} dir="ltr" /></td>
                    <td><input className="num" value={line.taxRate} onChange={(e) => updateLine(index, { taxRate: e.target.value })} disabled={readOnly} dir="ltr" /></td>
                    <td className="num"><Money value={totals.lines[index]?.lineTotal} /></td>
                    {!readOnly && (
                      <td>
                        <button
                          className="sm ghost danger"
                          onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== index) : lines)}
                          disabled={lines.length === 1}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total">
                  <td colSpan={readOnly ? 4 : 5}>المجموع قبل الضريبة</td>
                  <td className="num" colSpan={readOnly ? 2 : 2}><Money value={totals.subtotal} /></td>
                </tr>
                <tr className="total">
                  <td colSpan={readOnly ? 4 : 5}>الضريبة</td>
                  <td className="num" colSpan={2}><Money value={totals.taxTotal} /></td>
                </tr>
                <tr className="total">
                  <td colSpan={readOnly ? 4 : 5}>الإجمالي المستحق</td>
                  <td className="num" colSpan={2}><Money value={totals.total} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {existing.data?.invoice && status === 'POSTED' && (
          <Card title="السداد">
            <div className="field-row">
              <div><div className="stat-label">الإجمالي</div><strong><Money value={existing.data.invoice.total} /></strong></div>
              <div><div className="stat-label">المسدَّد</div><strong><Money value={existing.data.invoice.paid} /></strong></div>
              <div><div className="stat-label">المتبقي</div><strong><Money value={existing.data.invoice.due} /></strong></div>
              <div>
                <div className="stat-label">القيد المحاسبي</div>
                <strong>{existing.data.invoice.journalEntry ? `قيد رقم ${existing.data.invoice.journalEntry.number}` : '—'}</strong>
              </div>
            </div>
          </Card>
        )}

        {!readOnly && (
          <div className="toolbar no-print">
            <button className="primary" onClick={() => submit(false)} disabled={busy || totals.isEmpty || !header.partyId}>
              {id ? 'حفظ التعديلات' : 'حفظ كمسودة'}
            </button>
            <button onClick={() => submit(true)} disabled={busy || totals.isEmpty || !header.partyId}>
              حفظ وترحيل
            </button>
            {id && <button className="danger" onClick={() => act('delete', 'حذف المسودة نهائياً؟')} disabled={busy}>حذف</button>}
          </div>
        )}
      </div>
    </>
  );
}
