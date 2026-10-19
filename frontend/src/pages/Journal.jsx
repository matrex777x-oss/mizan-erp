import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Card, Loading, Money, PageHead } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, SOURCE_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

export default function Journal() {
  const { canWrite } = useSession();
  const [range, setRange] = useState({ from: '', to: '' });
  const [source, setSource] = useState('');
  const [error, setError] = useState(null);

  const entries = useAsync(
    () => api.get(`/journal${query({ ...range, source, limit: 100 })}`),
    [range.from, range.to, source],
  );

  async function remove(entry) {
    if (!confirm(`حذف القيد رقم ${entry.number}؟`)) return;
    setError(null);
    try {
      await api.del(`/journal/${entry.id}`);
      entries.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHead title="القيود اليومية" subtitle="كل حركة في النظام تُسجَّل هنا بالقيد المزدوج">
        {canWrite && <Link className="btn btn-primary" to="/journal/new">قيد يدوي</Link>}
      </PageHead>

      <Alert error={error || entries.error} />

      <Card
        title={`${entries.data?.total ?? 0} قيداً`}
        actions={
          <>
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 150 }} />
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 150 }} />
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 130 }}>
              <option value="">كل المصادر</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </>
        }
      >
        {entries.loading ? (
          <Loading />
        ) : !entries.data?.entries?.length ? (
          <div className="empty">لا توجد قيود</div>
        ) : (
          <div className="stack">
            {entries.data.entries.map((entry) => (
              <div key={entry.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card-head">
                  <div className="row">
                    <strong>قيد #{entry.number}</strong>
                    <span className="muted">{formatDate(entry.date)}</span>
                    <span className="badge">{SOURCE_LABELS[entry.source]}</span>
                    {entry.memo && <span className="muted small">{entry.memo}</span>}
                  </div>
                  <div className="row">
                    <strong><Money value={entry.totalDebit} /></strong>
                    {canWrite && entry.source === 'MANUAL' && (
                      <button className="sm ghost danger" onClick={() => remove(entry)}>حذف</button>
                    )}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الحساب</th>
                        <th>الطرف</th>
                        <th>البيان</th>
                        <th className="num" style={{ width: 130 }}>مدين</th>
                        <th className="num" style={{ width: 130 }}>دائن</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.lines.map((line) => (
                        <tr key={line.id}>
                          <td><span dir="ltr">{line.account?.code}</span> — {line.account?.name}</td>
                          <td>{line.party?.name || '—'}</td>
                          <td className="muted small">{line.memo || '—'}</td>
                          <td className="num">{line.debit === '0.00' ? '' : <Money value={line.debit} />}</td>
                          <td className="num">{line.credit === '0.00' ? '' : <Money value={line.credit} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
