import { useState } from 'react';

import { Alert, Card, Loading, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import ExportButtons from '../../components/ExportButtons.jsx';

function Section({ title, rows, total, totalLabel, extra }) {
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
              <tr><td className="empty">لا توجد أرصدة</td></tr>
            )}
            {extra}
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

export default function BalanceSheet() {
  const [asOf, setAsOf] = useState('');
  const report = useAsync(() => api.get(`/reports/balance-sheet${query({ to: asOf })}`), [asOf]);
  const data = report.data;

  return (
    <>
      <PageHead title="المركز المالي" subtitle="الأصول = الالتزامات + حقوق الملكية + نتيجة الفترة">
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 150 }} />
        <ExportButtons
          title="المركز المالي"
          subtitle={data?.to ? `حتى ${data.to}` : 'حتى آخر حركة'}
          columns={[{ label: 'البند' }, { label: 'المبلغ', numeric: true }]}
          rows={
            data
              ? [
                  ['الأصول', ''],
                  ...data.assets.map((row) => [`${row.code} — ${row.name}`, row.amount]),
                  ['إجمالي الأصول', data.totals.assets],
                  ['الالتزامات', ''],
                  ...data.liabilities.map((row) => [`${row.code} — ${row.name}`, row.amount]),
                  ['إجمالي الالتزامات', data.totals.liabilities],
                  ['حقوق الملكية', ''],
                  ...data.equity.map((row) => [`${row.code} — ${row.name}`, row.amount]),
                  ['نتيجة الفترة', data.totals.netProfit],
                  ['إجمالي حقوق الملكية', data.totals.equityWithProfit],
                ]
              : []
          }
          totals={data ? ['الأصول = الالتزامات + حقوق الملكية', data.totals.assets] : null}
        />
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={report.error} />

      {report.loading || !data ? (
        <Loading />
      ) : (
        <>
          {!data.totals.balanced && <div className="alert error">تنبيه: المركز المالي غير متوازن، راجع القيود</div>}
          <div className="grid grid-2">
            <Section title="الأصول" rows={data.assets} total={data.totals.assets} totalLabel="إجمالي الأصول" />
            <div className="stack">
              <Section title="الالتزامات" rows={data.liabilities} total={data.totals.liabilities} totalLabel="إجمالي الالتزامات" />
              <Section
                title="حقوق الملكية"
                rows={data.equity}
                total={data.totals.equityWithProfit}
                totalLabel="إجمالي حقوق الملكية"
                extra={
                  <tr>
                    <td>نتيجة الفترة (ربح/خسارة)</td>
                    <td className="num"><Money value={data.totals.netProfit} signed /></td>
                  </tr>
                }
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
