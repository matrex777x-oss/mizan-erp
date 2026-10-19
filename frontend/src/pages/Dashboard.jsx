import { Link } from 'react-router-dom';

import { Alert, Card, Loading, Money, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';

function Stat({ label, value, signed }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${signed && Number(value) < 0 ? 'neg' : ''}`}>
        <Money value={value} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const summary = useAsync(() => api.get('/reports/dashboard'), []);
  const recent = useAsync(() => api.get('/invoices?limit=8'), []);

  if (summary.loading) return <Loading />;
  if (summary.error) return <Alert error={summary.error} />;

  const data = summary.data;

  return (
    <>
      <PageHead title="لوحة المؤشرات" subtitle="نظرة سريعة على وضع المنشأة المالي" />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="النقدية والبنوك" value={data.cash} />
        <Stat label="ذمم العملاء (لنا)" value={data.receivable} />
        <Stat label="ذمم الموردين (علينا)" value={data.payable} />
        <Stat label="قيمة المخزون" value={data.stockValue} />
        <Stat label="ربح الشهر الجاري" value={data.monthProfit} signed />
      </div>

      <div className="grid grid-2">
        <Card title="أداء الشهر الجاري">
          <div className="spread" style={{ paddingBlock: 6 }}>
            <span className="muted">الإيرادات</span>
            <strong><Money value={data.monthIncome} /></strong>
          </div>
          <div className="spread" style={{ paddingBlock: 6, borderTop: '1px solid var(--border)' }}>
            <span className="muted">المصروفات</span>
            <strong><Money value={data.monthExpense} /></strong>
          </div>
          <div className="spread" style={{ paddingBlock: 6, borderTop: '2px solid var(--border)' }}>
            <span>صافي الربح</span>
            <strong><Money value={data.monthProfit} signed /></strong>
          </div>
        </Card>

        <Card
          title="أحدث الفواتير"
          actions={<Link className="btn" to="/invoices/sales">عرض الكل</Link>}
          pad={false}
        >
          {recent.loading ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الطرف</th>
                    <th>التاريخ</th>
                    <th className="num">الإجمالي</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data?.invoices || []).map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link to={`/invoices/${invoice.kind === 'SALES' ? 'sales' : 'purchase'}/${invoice.id}`}>
                          {invoice.number}
                        </Link>
                      </td>
                      <td>{invoice.party?.name}</td>
                      <td>{formatDate(invoice.date)}</td>
                      <td className="num"><Money value={invoice.total} /></td>
                      <td><span className="badge">{STATUS_LABELS[invoice.status]}</span></td>
                    </tr>
                  ))}
                  {!recent.data?.invoices?.length && (
                    <tr><td colSpan={5} className="empty">لا توجد فواتير بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
