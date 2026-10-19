import { Card, DataTable, PageHead } from '../../components/ui.jsx';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

const ACTION_LABELS = {
  LOGIN: 'دخول',
  LOGIN_FAILED: 'محاولة دخول فاشلة',
  PASSWORD_CHANGE: 'تغيير كلمة مرور',
  PASSWORD_RESET: 'إعادة تعيين كلمة مرور',
  USER_CREATE: 'إنشاء مستخدم',
  USER_UPDATE: 'تعديل مستخدم',
  USER_DEACTIVATE: 'إيقاف مستخدم',
  BUSINESS_CREATE: 'إنشاء منشأة',
  BUSINESS_UPDATE: 'تعديل منشأة',
  ACCESS_GRANT: 'منح وصول',
  ACCESS_REVOKE: 'سحب وصول',
};

export default function AuditLog() {
  const log = useAsync(() => api.get('/admin/users/audit/log?limit=200'), []);

  const columns = [
    {
      key: 'at',
      label: 'الوقت',
      render: (row) => (
        <span className="small muted">
          {new Date(row.at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'medium' })}
        </span>
      ),
    },
    { key: 'user', label: 'من', render: (row) => row.userName },
    {
      key: 'action',
      label: 'الحدث',
      render: (row) => ACTION_LABELS[row.action] || row.action,
    },
    {
      key: 'detail',
      label: 'التفصيل',
      render: (row) => (
        <span className="small">
          {[row.businessName, row.detail].filter(Boolean).join(' — ') || '—'}
        </span>
      ),
    },
    { key: 'ip', label: 'العنوان', render: (row) => <span className="small muted" dir="ltr">{row.ip || '—'}</span> },
  ];

  return (
    <>
      <PageHead
        title="سجل التدقيق"
        subtitle="من دخل ومن غيّر الصلاحيات ومن أعاد تعيين كلمة مرور — ومتى"
      />

      <Card title={`آخر ${log.data?.entries.length || 0} حدثاً من ${log.data?.total || 0}`} pad={false}>
        <DataTable
          columns={columns}
          rows={log.data?.entries}
          loading={log.loading}
          empty="السجل فارغ"
          rowKey={(row) => row.id}
        />
      </Card>
    </>
  );
}
