import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert, Card, Field, Money, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { fromMinor, toMinor } from '../lib/calc';
import { today } from '../lib/format';

const emptyLine = () => ({ accountId: '', partyId: '', debit: '', credit: '', memo: '' });

export default function JournalForm() {
  const navigate = useNavigate();
  const [header, setHeader] = useState({ date: today(), memo: '' });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const accounts = useAsync(() => api.get('/accounts?postable=true&active=true'), []);
  const parties = useAsync(() => api.get('/parties?active=true'), []);

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + toMinor(line.debit), 0n);
    const credit = lines.reduce((sum, line) => sum + toMinor(line.credit), 0n);
    return { debit: fromMinor(debit), credit: fromMinor(credit), balanced: debit === credit && debit > 0n };
  }, [lines]);

  function updateLine(index, patch) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.post('/journal', {
        date: header.date,
        memo: header.memo || null,
        lines: lines
          .filter((line) => line.accountId && (toMinor(line.debit) > 0n || toMinor(line.credit) > 0n))
          .map((line) => ({
            accountId: line.accountId,
            partyId: line.partyId || null,
            debit: line.debit || '0',
            credit: line.credit || '0',
            memo: line.memo || null,
          })),
      });
      navigate('/journal', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="قيد يومية يدوي" subtitle="يجب أن يتساوى مجموع المدين مع مجموع الدائن" />

      <Alert error={error} />

      <div className="stack">
        <Card title="بيانات القيد">
          <div className="field-row">
            <Field label="التاريخ">
              <input type="date" value={header.date} onChange={(e) => setHeader({ ...header, date: e.target.value })} />
            </Field>
            <Field label="البيان">
              <input value={header.memo} onChange={(e) => setHeader({ ...header, memo: e.target.value })} placeholder="شرح موجز للقيد" />
            </Field>
          </div>
        </Card>

        <Card title="السطور" pad={false} actions={<button onClick={() => setLines([...lines, emptyLine()])}>إضافة سطر</button>}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>الحساب</th>
                  <th style={{ width: 170 }}>الطرف (اختياري)</th>
                  <th style={{ minWidth: 150 }}>البيان</th>
                  <th className="num" style={{ width: 130 }}>مدين</th>
                  <th className="num" style={{ width: 130 }}>دائن</th>
                  <th style={{ width: 50 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })}>
                        <option value="">— اختر —</option>
                        {(accounts.data?.accounts || []).map((account) => (
                          <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={line.partyId} onChange={(e) => updateLine(index, { partyId: e.target.value })}>
                        <option value="">—</option>
                        {(parties.data?.parties || []).map((party) => (
                          <option key={party.id} value={party.id}>{party.name}</option>
                        ))}
                      </select>
                    </td>
                    <td><input value={line.memo} onChange={(e) => updateLine(index, { memo: e.target.value })} /></td>
                    <td>
                      <input
                        className="num" dir="ltr" value={line.debit}
                        onChange={(e) => updateLine(index, { debit: e.target.value, credit: '' })}
                      />
                    </td>
                    <td>
                      <input
                        className="num" dir="ltr" value={line.credit}
                        onChange={(e) => updateLine(index, { credit: e.target.value, debit: '' })}
                      />
                    </td>
                    <td>
                      <button
                        className="sm ghost danger"
                        onClick={() => setLines(lines.length > 2 ? lines.filter((_, i) => i !== index) : lines)}
                        disabled={lines.length <= 2}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total">
                  <td colSpan={3}>المجاميع</td>
                  <td className="num"><Money value={totals.debit} /></td>
                  <td className="num"><Money value={totals.credit} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {!totals.balanced && (
          <div className="alert error">القيد غير متوازن — الفرق {<Money value={String(Number(totals.debit) - Number(totals.credit))} />}</div>
        )}

        <div className="toolbar">
          <button className="primary" onClick={submit} disabled={busy || !totals.balanced}>حفظ القيد</button>
          <button onClick={() => navigate('/journal')}>إلغاء</button>
        </div>
      </div>
    </>
  );
}
