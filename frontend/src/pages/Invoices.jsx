import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert, Card, DataTable, Money, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

export const KIND_BY_SLUG = { sales: 'SALES', purchase: 'PURCHASE' };
export const SLUG_BY_KIND = { SALES: 'sales', PURCHASE: 'purchase' };

const TITLES = {
  SALES: { title: 'فواتير المبيعات', party: 'العميل', action: 'فاتورة مبيعات جديدة' },
  PURCHASE: { title: 'فواتير المشتريات', party: 'المورد', action: 'فاتورة مشتريات جديدة' },
};

const CAPABILITY_PREFIX = { SALES: 'sales', PURCHASE: 'purchase' };

export default function Invoices() {
  const { kind: slug } = useParams();
  const kind = KIND_BY_SLUG[slug] || 'SALES';
  const labels = TITLES[kind];

  const { can } = useSession();
  const canWrite = can(`${CAPABILITY_PREFIX[kind]}.write`);
  const canPost = can(`${CAPABILITY_PREFIX[kind]}.post`);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const invoices = useAsync(
    () => api.get(`/invoices${query({ kind, status, q: search, limit: 100 })}`),
    [kind, status, search],
  );

  return (
    <>
      <PageHead title={labels.title} subtitle="المسودات لا تؤثر على الحسابات حتى تُرحَّل">
        {canWrite && <Link className="btn btn-primary" to={`/invoices/${slug}/new`}>{labels.action}</Link>}
      </PageHead>

      <Alert error={invoices.error} />

      <Card
        title={`${invoices.data?.total ?? 0} فاتورة`}
        pad={false}
        actions={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
              <option value="">كل الحالات</option>
              <option value="DRAFT">مسودة</option>
              <option value="POSTED">مُرحَّلة</option>
              <option value="CANCELLED">ملغاة</option>
            </select>
            <input placeholder="بحث برقم أو اسم" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          </>
        }
      >
        <DataTable
          loading={invoices.loading}
          rows={invoices.data?.invoices || []}
          rowKey={(row) => row.id}
          empty="لا توجد فواتير"
          columns={[
            {
              key: 'number',
              label: 'الرقم',
              width: 140,
              render: (row) => <Link to={`/invoices/${slug}/${row.id}`} dir="ltr">{row.number}</Link>,
            },
            { key: 'party', label: labels.party, render: (row) => row.party?.name },
            { key: 'date', label: 'التاريخ', width: 110, render: (row) => formatDate(row.date) },
            { key: 'due', label: 'الاستحقاق', width: 110, render: (row) => formatDate(row.dueDate) },
            { key: 'total', label: 'الإجمالي', width: 130, numeric: true, render: (row) => <Money value={row.total} /> },
            { key: 'paid', label: 'المسدَّد', width: 130, numeric: true, render: (row) => <Money value={row.paid} /> },
            {
              key: 'remaining',
              label: 'المتبقي',
              width: 130,
              numeric: true,
              render: (row) => (row.status === 'POSTED' ? <Money value={row.due} /> : '—'),
            },
            {
              key: 'status',
              label: 'الحالة',
              width: 110,
              render: (row) =>
                row.status === 'POSTED' && row.settled ? (
                  <span className="badge ok">مسدَّدة</span>
                ) : (
                  <StatusBadge status={row.status} labels={STATUS_LABELS} />
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
