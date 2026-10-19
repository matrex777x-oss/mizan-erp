import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert, Card, Field, Loading, Money, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { fromMinor, toMinor } from '../lib/calc';
import { formatQuantity, formatDate, STATUS_LABELS, today } from '../lib/format';
import { useSession } from '../lib/session';

const emptyLine = () => ({ itemId: '', direction: 'IN', quantity: '', unitCost: '', memo: '' });

export default function StockAdjustmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const canWrite = can('stock.write');

  const [header, setHeader] = useState({ date: today(), reason: '', counterAccountId: '', notes: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const [status, setStatus] = useState('DRAFT');
  const [number, setNumber] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const items = useAsync(() => api.get('/items?kind=STOCK&active=true'), []);
  const accounts = useAsync(() => api.get('/accounts?postable=true&active=true'), []);
  const existing = useAsync(() => (id ? api.get(`/stock-adjustments/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const adjustment = existing.data?.adjustment;
    if (!adjustment) return;
    setHeader({
      date: adjustment.date,
      reason: adjustment.reason || '',
      counterAccountId: adjustment.counterAccountId,
      notes: adjustment.notes || '',
    });
    setLines(
      adjustment.lines.map((line) => ({
        itemId: line.itemId,
        direction: line.direction,
        quantity: line.quantity,
        unitCost: line.unitCost,
        memo: line.memo || '',
      })),
    );
    setStatus(adjustment.status);
    setNumber(adjustment.number);
  }, [existing.data]);

  const itemsById = useMemo(
    () => new Map((items.data?.items || []).map((item) => [item.id, item])),
    [items.data],
  );

  // الحساب المقابل لا يكون إيراداً: رأس المال للأرصدة الافتتاحية أو مصروف لفروق الجرد
  const counterAccounts = (accounts.data?.accounts || []).filter((a) => a.type !== 'INCOME');
  const readOnly = !canWrite || status !== 'DRAFT';

  function updateLine(index, patch) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /** الإدخال بتكلفته المعلومة، والإخراج بالمتوسط الجاري للصنف. */
  const preview = useMemo(() => {
    let net = 0n;
    const rows = lines.map((line) => {
      const item = itemsById.get(line.itemId);
      const quantity = toMinor(line.quantity, 3);
      if (!item || quantity <= 0n) return { cost: '0.00', signed: 0n };

      const unitCost = line.direction === 'IN' ? toMinor(line.unitCost) : toMinor(item.averageCost);
      const cost = (quantity * unitCost + 500n) / 1000n;
      const signed = line.direction === 'IN' ? cost : -cost;
      net += signed;
      return { cost: fromMinor(cost), signed };
    });
    return { rows, net: fromMinor(net) };
  }, [lines, itemsById]);

  async function submit(post) {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        date: header.date,
        reason: header.reason || null,
        counterAccountId: header.counterAccountId,
        notes: header.notes || null,
        lines: lines
          .filter((line) => line.itemId && Number(line.quantity) > 0)
          .map((line) => ({
            itemId: line.itemId,
            direction: line.direction,
            quantity: line.quantity,
            unitCost: line.direction === 'IN' ? line.unitCost || '0' : '0',
            memo: line.memo || null,
          })),
        ...(post && !id ? { post: true } : {}),
      };

      const saved = id
        ? await api.patch(`/stock-adjustments/${id}`, payload)
        : await api.post('/stock-adjustments', payload);
      const savedId = saved.adjustment.id;
      if (post && id) await api.post(`/stock-adjustments/${savedId}/post`);
      navigate(`/stock-adjustments/${savedId}`, { replace: true });
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
        await api.del(`/stock-adjustments/${id}`);
        navigate('/stock-adjustments', { replace: true });
        return;
      }
      await api.post(`/stock-adjustments/${id}/${action}`);
      existing.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (id && existing.loading) return <Loading />;

  const hasLines = lines.some((line) => line.itemId && Number(line.quantity) > 0);

  return (
    <>
      <PageHead
        title={id ? `تسوية ${number}` : 'تسوية مخزون جديدة'}
        subtitle={id ? formatDate(header.date) : 'استخدمها للأرصدة الافتتاحية وفروق الجرد والتالف'}
      >
        {id && <StatusBadge status={status} labels={STATUS_LABELS} />}
        {id && status === 'POSTED' && canWrite && (
          <button onClick={() => act('unpost', 'إلغاء ترحيل التسوية؟')} disabled={busy}>إلغاء الترحيل</button>
        )}
        {id && status === 'DRAFT' && canWrite && (
          <button className="primary" onClick={() => act('post')} disabled={busy}>ترحيل</button>
        )}
        {id && status !== 'CANCELLED' && canWrite && (
          <button className="danger" onClick={() => act('cancel', 'إلغاء التسوية؟')} disabled={busy}>إلغاء التسوية</button>
        )}
      </PageHead>

      <Alert error={error} />

      <div className="stack">
        <Card title="بيانات التسوية">
          <div className="field-row">
            <Field label="التاريخ">
              <input type="date" value={header.date} onChange={(e) => setHeader({ ...header, date: e.target.value })} disabled={readOnly} />
            </Field>
            <Field label="السبب">
              <input
                value={header.reason}
                onChange={(e) => setHeader({ ...header, reason: e.target.value })}
                disabled={readOnly}
                placeholder="أرصدة افتتاحية / عجز جرد / تالف"
              />
            </Field>
            <Field label="الحساب المقابل" hint="رأس المال للافتتاحي، فروق المخزون للجرد">
              <select
                value={header.counterAccountId}
                onChange={(e) => setHeader({ ...header, counterAccountId: e.target.value })}
                disabled={readOnly}
              >
                <option value="">— اختر —</option>
                {counterAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
          </div>
        </Card>

        <Card
          title="الأصناف"
          pad={false}
          actions={!readOnly && <button onClick={() => setLines([...lines, emptyLine()])}>إضافة سطر</button>}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>الصنف</th>
                  <th style={{ width: 120 }}>الاتجاه</th>
                  <th className="num" style={{ width: 110 }}>الكمية</th>
                  <th className="num" style={{ width: 120 }}>تكلفة الوحدة</th>
                  <th className="num" style={{ width: 120 }}>الرصيد الحالي</th>
                  <th className="num" style={{ width: 120 }}>قيمة الحركة</th>
                  {!readOnly && <th style={{ width: 50 }} />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const item = itemsById.get(line.itemId);
                  const isIn = line.direction === 'IN';
                  return (
                    <tr key={index}>
                      <td>
                        <select
                          value={line.itemId}
                          onChange={(e) => {
                            const picked = itemsById.get(e.target.value);
                            updateLine(index, {
                              itemId: e.target.value,
                              unitCost: line.unitCost || picked?.purchasePrice || '',
                            });
                          }}
                          disabled={readOnly}
                        >
                          <option value="">— اختر —</option>
                          {(items.data?.items || []).map((option) => (
                            <option key={option.id} value={option.id}>{option.code} — {option.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={line.direction} onChange={(e) => updateLine(index, { direction: e.target.value })} disabled={readOnly}>
                          <option value="IN">إدخال</option>
                          <option value="OUT">إخراج</option>
                        </select>
                      </td>
                      <td><input className="num" dir="ltr" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} disabled={readOnly} /></td>
                      <td>
                        {isIn ? (
                          <input className="num" dir="ltr" value={line.unitCost} onChange={(e) => updateLine(index, { unitCost: e.target.value })} disabled={readOnly} />
                        ) : (
                          <span className="muted small">المتوسط {item ? item.averageCost : '—'}</span>
                        )}
                      </td>
                      <td className="num muted">{item ? `${formatQuantity(item.onHand)} ${item.unit}` : '—'}</td>
                      <td className="num"><Money value={preview.rows[index]?.cost} /></td>
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="total">
                  <td colSpan={readOnly ? 5 : 6}>صافي أثر التسوية على المخزون</td>
                  <td className="num"><Money value={preview.net} signed /></td>
                  {!readOnly && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {existing.data?.adjustment?.journalEntry && (
          <Card>
            <div className="spread">
              <span className="muted">القيد المحاسبي</span>
              <strong>قيد رقم {existing.data.adjustment.journalEntry.number}</strong>
            </div>
          </Card>
        )}

        {!readOnly && (
          <div className="toolbar">
            <button className="primary" onClick={() => submit(false)} disabled={busy || !hasLines || !header.counterAccountId}>
              {id ? 'حفظ التعديلات' : 'حفظ كمسودة'}
            </button>
            <button onClick={() => submit(true)} disabled={busy || !hasLines || !header.counterAccountId}>حفظ وترحيل</button>
            {id && <button className="danger" onClick={() => act('delete', 'حذف المسودة؟')} disabled={busy}>حذف</button>}
          </div>
        )}
      </div>
    </>
  );
}
