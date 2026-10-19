import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Card, DataTable, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

export default function StockAdjustments() {
  const { can } = useSession();
  const canWrite = can('stock.write');
  const [status, setStatus] = useState('');

  const adjustments = useAsync(() => api.get(`/stock-adjustments${query({ status })}`), [status]);

  return (
    <>
      <PageHead
        title="تسويات المخزون"
        subtitle="الأرصدة الافتتاحية وفروق الجرد والتالف — كل تسوية تولّد قيداً مقابل الحساب الذي تختاره"
      >
        {canWrite && <Link className="btn btn-primary" to="/stock-adjustments/new">تسوية جديدة</Link>}
      </PageHead>

      <Alert error={adjustments.error} />

      <Card
        title={`${adjustments.data?.adjustments?.length || 0} تسوية`}
        pad={false}
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
            <option value="">كل الحالات</option>
            <option value="DRAFT">مسودة</option>
            <option value="POSTED">مُرحَّلة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        }
      >
        <DataTable
          loading={adjustments.loading}
          rows={adjustments.data?.adjustments || []}
          rowKey={(row) => row.id}
          empty="لا توجد تسويات"
          columns={[
            {
              key: 'number',
              label: 'الرقم',
              width: 150,
              render: (row) => <Link to={`/stock-adjustments/${row.id}`} dir="ltr">{row.number}</Link>,
            },
            { key: 'date', label: 'التاريخ', width: 110, render: (row) => formatDate(row.date) },
            { key: 'reason', label: 'السبب', render: (row) => row.reason || '—' },
            { key: 'counter', label: 'الحساب المقابل', width: 200, render: (row) => row.counterAccount?.name },
            { key: 'lines', label: 'الأصناف', width: 90, numeric: true, render: (row) => row.lineCount },
            { key: 'status', label: 'الحالة', width: 100, render: (row) => <StatusBadge status={row.status} labels={STATUS_LABELS} /> },
          ]}
        />
      </Card>
    </>
  );
}
