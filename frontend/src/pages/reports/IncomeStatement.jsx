import { useState } from 'react';

import { Alert, Card, Loading, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

function Section({ title, rows, total, totalLabel }) {
  return (
    <Card title={title} pad={false}>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.accountId} className={row.isGroup ? 'group-row' : ''}>
                  <td>
                    <span dir="ltr" className="muted small">{row.code}</span>{' '}
                    <span className={row.isGroup ? '' : 'tree-indent-1'}>{row.name}</span>
                  </td>
                  <td className="num" style={{ width: 160 }}><Money value={row.amount} /></td>
                </tr>
              ))
            ) : (
              <tr><td className="empty">لا توجد حركات</td></tr>
            )}
            <tr className="total">
              <td>{totalLabel}</td>
              <td className="num"><Money value={total} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function IncomeStatement() {
  const [range, setRange] = useState({ from: '', to: '' });
  const report = useAsync(() => api.get(`/reports/income-statement${query(range)}`), [range.from, range.to]);
  const data = report.data;

  return (
    <>
      <PageHead title="قائمة الدخل" subtitle="الإيرادات ناقص المصروفات خلال الفترة">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 150 }} />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 150 }} />
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={report.error} />

      {report.loading || !data ? (
        <Loading />
      ) : (
        <div className="stack">
          <Section title="الإيرادات" rows={data.income} total={data.totals.income} totalLabel="إجمالي الإيرادات" />
          <Section title="المصروفات" rows={data.expenses} total={data.totals.expenses} totalLabel="إجمالي المصروفات" />
          <Card>
            <div className="spread">
              <h2>{Number(data.totals.netProfit) < 0 ? 'صافي الخسارة' : 'صافي الربح'}</h2>
              <div className="stat-value"><Money value={data.totals.netProfit} signed /></div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
