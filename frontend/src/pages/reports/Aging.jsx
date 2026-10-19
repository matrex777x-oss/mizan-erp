import { useState } from 'react';

import { Alert, Card, Loading, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import ExportButtons from '../../components/ExportButtons.jsx';
import { today } from '../../lib/format';

export default function Aging() {
  const [kind, setKind] = useState('SALES');
  const [asOf, setAsOf] = useState(today());

  const report = useAsync(() => api.get(`/reports/aging${query({ kind, asOf })}`), [kind, asOf]);
  const data = report.data;

  return (
    <>
      <PageHead
        title="أعمار الديون"
        subtitle={kind === 'SALES' ? 'المستحق لنا على العملاء موزَّعاً حسب التأخير' : 'المستحق علينا للموردين موزَّعاً حسب التأخير'}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 170 }}>
          <option value="SALES">ذمم العملاء</option>
          <option value="PURCHASE">ذمم الموردين</option>
        </select>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 150 }} />
        <ExportButtons
          title="أعمار الديون"
          subtitle={data ? `الإجمالي المستحق ${data.totals.grandTotal}` : ''}
          columns={[
            { label: 'الطرف' },
            ...(data?.buckets || []).map((bucket) => ({ label: bucket.label, numeric: true })),
            { label: 'الإجمالي', numeric: true },
          ]}
          rows={(data?.rows || []).map((row) => [
            row.name,
            ...(data?.buckets || []).map((bucket) => row[bucket.key]),
            row.total,
          ])}
          totals={
            data
              ? [
                  'الإجمالي',
                  ...(data.buckets || []).map((bucket) => data.totals[bucket.key]),
                  data.totals.grandTotal,
                ]
              : null
          }
        />
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={report.error} />

      {report.loading || !data ? (
        <Loading />
      ) : (
        <Card title={`الإجمالي المستحق: ${data.totals.grandTotal}`} pad={false}>
          {!data.rows.length ? (
            <div className="empty">لا توجد مبالغ مستحقة</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الطرف</th>
                    {data.buckets.map((bucket) => (
                      <th key={bucket.key} className="num">{bucket.label}</th>
                    ))}
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.partyId}>
                      <td>{row.partyName}</td>
                      {data.buckets.map((bucket) => (
                        <td key={bucket.key} className="num">
                          {row.buckets[bucket.key] === '0.00' ? '' : <Money value={row.buckets[bucket.key]} />}
                        </td>
                      ))}
                      <td className="num"><strong><Money value={row.total} /></strong></td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>الإجمالي</td>
                    {data.buckets.map((bucket) => (
                      <td key={bucket.key} className="num"><Money value={data.totals[bucket.key]} /></td>
                    ))}
                    <td className="num"><Money value={data.totals.grandTotal} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
