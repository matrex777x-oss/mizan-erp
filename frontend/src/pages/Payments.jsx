import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert, Card, DataTable, Money, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate, STATUS_LABELS } from '../lib/format';
import { useSession } from '../lib/session';

export const KIND_BY_SLUG = { receipts: 'RECEIPT', outgoing: 'PAYMENT' };

const TITLES = {
  RECEIPT: { title: 'سندات القبض', party: 'العميل', action: 'سند قبض جديد', hint: 'مبالغ مقبوضة من العملاء' },
  PAYMENT: { title: 'سندات الصرف', party: 'المورد', action: 'سند صرف جديد', hint: 'مبالغ مدفوعة للموردين' },
};

const CAPABILITY_PREFIX = { RECEIPT: 'receipt', PAYMENT: 'expense' };

export default function Payments() {
  const { kind: slug } = useParams();
  const kind = KIND_BY_SLUG[slug] || 'RECEIPT';
  const labels = TITLES[kind];
  const { can } = useSession();
  const canWrite = can(`${CAPABILITY_PREFIX[kind]}.write`);
  const canPost = can(`${CAPABILITY_PREFIX[kind]}.post`);
  const [status, setStatus] = useState('');

  const payments = useAsync(() => api.get(`/payments${query({ kind, status, limit: 100 })}`), [kind, status]);

  return (
    <>
      <PageHead title={labels.title} subtitle={labels.hint}>
        {canWrite && <Link className="btn btn-primary" to={`/payments/${slug}/new`}>{labels.action}</Link>}
      </PageHead>

      <Alert error={payments.error} />

      <Card
        title={`${payments.data?.total ?? 0} سنداً`}
        pad={false}
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
            <option value="">كل الحالات</option>
            <option value="DRAFT">مسودة</option>
            <option value="POSTED">مُرحَّل</option>
            <option value="CANCELLED">ملغى</option>
          </select>
        }
      >
        <DataTable
          loading={payments.loading}
          rows={payments.data?.payments || []}
          rowKey={(row) => row.id}
          empty="لا توجد سندات"
          columns={[
            { key: 'number', label: 'الرقم', width: 140, render: (row) => <Link to={`/payments/${slug}/${row.id}`} dir="ltr">{row.number}</Link> },
            { key: 'party', label: labels.party, render: (row) => row.party?.name },
            { key: 'date', label: 'التاريخ', width: 110, render: (row) => formatDate(row.date) },
            { key: 'cash', label: 'الحساب النقدي', width: 170, render: (row) => row.cashAccount?.name },
            { key: 'amount', label: 'المبلغ', width: 140, numeric: true, render: (row) => <Money value={row.amount} /> },
            { key: 'status', label: 'الحالة', width: 100, render: (row) => <StatusBadge status={row.status} labels={STATUS_LABELS} /> },
          ]}
        />
      </Card>
    </>
  );
}
