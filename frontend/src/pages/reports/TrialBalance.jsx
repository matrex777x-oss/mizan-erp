import { useState } from 'react';

import { Alert, Card, DataTable, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ACCOUNT_TYPE_LABELS, formatDate } from '../../lib/format';
import ExportButtons from '../../components/ExportButtons.jsx';

export default function TrialBalance() {
  const [range, setRange] = useState({ from: '', to: '' });
  const report = useAsync(() => api.get(`/reports/trial-balance${query(range)}`), [range.from, range.to]);

  const data = report.data;

  return (
    <>
      <PageHead
        title="ميزان المراجعة"
        subtitle={data ? `حتى ${data.to ? formatDate(data.to) : 'آخر حركة'}` : ''}
      >
        <ExportButtons
          title="ميزان المراجعة"
          subtitle={data?.to ? `حتى ${data.to}` : 'حتى آخر حركة'}
          columns={[
            { label: 'الرمز' },
            { label: 'الحساب' },
            { label: 'النوع' },
            { label: 'حركة مدينة', numeric: true },
            { label: 'حركة دائنة', numeric: true },
            { label: 'رصيد مدين', numeric: true },
            { label: 'رصيد دائن', numeric: true },
          ]}
          rows={(data?.rows || []).map((row) => [
            row.code,
            row.name,
            ACCOUNT_TYPE_LABELS[row.type],
            row.debit,
            row.credit,
            row.balanceDebit,
            row.balanceCredit,
          ])}
          totals={data ? ['', 'الإجمالي', '', data.totals.debit, data.totals.credit, '', ''] : null}
        />
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={report.error} />

      <Card
        title={data?.totals?.balanced === false ? 'الميزان غير متوازن!' : 'الميزان متوازن'}
        pad={false}
        actions={
          <>
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 150 }} />
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 150 }} />
          </>
        }
      >
        <DataTable
          loading={report.loading}
          rows={data?.rows || []}
          rowKey={(row) => row.accountId}
          empty="لا توجد حركات في هذه الفترة"
          columns={[
            { key: 'code', label: 'الرمز', width: 90, render: (row) => <span dir="ltr">{row.code}</span> },
            { key: 'name', label: 'الحساب', render: (row) => row.name },
            { key: 'type', label: 'النوع', width: 110, render: (row) => ACCOUNT_TYPE_LABELS[row.type] },
            { key: 'debit', label: 'حركة مدينة', width: 130, numeric: true, render: (row) => <Money value={row.debit} /> },
            { key: 'credit', label: 'حركة دائنة', width: 130, numeric: true, render: (row) => <Money value={row.credit} /> },
            {
              key: 'balanceDebit',
              label: 'رصيد مدين',
              width: 130,
              numeric: true,
              render: (row) => (row.balanceDebit === '0.00' ? '' : <Money value={row.balanceDebit} />),
            },
            {
              key: 'balanceCredit',
              label: 'رصيد دائن',
              width: 130,
              numeric: true,
              render: (row) => (row.balanceCredit === '0.00' ? '' : <Money value={row.balanceCredit} />),
            },
          ]}
        />
        {data && (
          <div className="table-wrap">
            <table>
              <tbody>
                <tr className="total">
                  <td>الإجمالي</td>
                  <td className="num" style={{ width: 130 }}><Money value={data.totals.debit} /></td>
                  <td className="num" style={{ width: 130 }}><Money value={data.totals.credit} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
