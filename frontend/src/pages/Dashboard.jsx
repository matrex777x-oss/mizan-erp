import { Link } from 'react-router-dom';

import { Alert, Card, Loading, Money, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

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
  const { can } = useSession();

  const summary = useAsync(() => api.get('/reports/dashboard'), []);
  // من لا يرى المبيعات لا يُطلب له جدول أحدث الفواتير أصلاً
  const canSeeInvoices = can('sales.read') || can('purchase.read');
  const recent = useAsync(
    () => (canSeeInvoices ? api.get('/invoices?limit=8') : Promise.resolve({ invoices: [] })),
    [canSeeInvoices],
  );

  if (summary.loading) return <Loading />;
  if (summary.error) return <Alert error={summary.error} />;

  const data = summary.data;

  // الخادم يحذف ما لا قدرة عليه، فنخفي بطاقته بدل أن نعرض صفراً يوهم بأن
  // الخزينة فارغة. الصفر رقم، وغياب الصلاحية ليس رقماً.
  const financial = data.cash !== undefined;

  return (
    <>
      <PageHead
        title="لوحة المؤشرات"
        subtitle={financial ? 'نظرة سريعة على وضع المنشأة المالي' : 'نظرة سريعة على ما يخصّك'}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {financial && <Stat label="النقدية والبنوك" value={data.cash} />}
        {financial && <Stat label="ذمم العملاء (لنا)" value={data.receivable} />}
        {financial && <Stat label="ذمم الموردين (علينا)" value={data.payable} />}
        {data.stockValue !== undefined && <Stat label="قيمة المخزون" value={data.stockValue} />}
        {financial && <Stat label="ربح الشهر الجاري" value={data.monthProfit} signed />}
        {data.postedSalesInvoices !== undefined && (
          <div className="card stat">
            <div className="stat-label">فواتير مبيعات مُرحَّلة</div>
            <div className="stat-value">{data.postedSalesInvoices}</div>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        {financial && (
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
        )}

        {canSeeInvoices && (
          <Card
          title="أحدث الفواتير"
          actions={
            <Link className="btn" to={can('sales.read') ? '/invoices/sales' : '/invoices/purchase'}>
              عرض الكل
            </Link>
          }
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
        )}
      </div>
    </>
  );
}
