import { useState } from 'react';

import { Alert, Card, DataTable, Empty, Money, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDate } from '../lib/format';
import { useSession } from '../lib/session';

export default function Closing() {
  const { can, loadSettings } = useSession();
  const canManage = can('closing.manage');

  const data = useAsync(() => api.get('/closing'), []);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function openPreview(year) {
    setError(null);
    try {
      const res = await api.get(`/closing/preview?end=${year.endDate}`);
      setPreview(res);
    } catch (err) {
      setError(err);
    }
  }

  async function close(endDate) {
    setError(null);
    setBusy(true);
    try {
      await api.post('/closing', { end: endDate });
      setPreview(null);
      data.reload();
      // الإقفال يرفع تاريخ قفل الفترة، وهو في الإعدادات
      await loadSettings();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reopen(row) {
    if (!confirm(`إعادة فتح السنة ${row.label}؟ يُحذف قيد الإقفال ويعود القفل إلى ما قبلها.`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.del(`/closing/${row.endDate}`);
      data.reload();
      await loadSettings();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const closes = data.data?.closes || [];
  const closable = data.data?.closable || [];
  const latest = closes[0];

  return (
    <>
      <PageHead
        title="الإقفال السنوي"
        subtitle="يصفّر الإيرادات والمصروفات ويرحّل نتيجة السنة إلى الأرباح المحتجزة"
      />

      <Alert error={error} />

      {data.data?.lockDate && (
        <p className="small muted">
          الفترة مقفلة حتى <strong>{formatDate(data.data.lockDate)}</strong> — لا يُقبل أي قيد في
          هذا التاريخ أو قبله.
        </p>
      )}

      <Card title="سنوات جاهزة للإقفال">
        {data.loading ? null : !closable.length ? (
          <Empty label="لا توجد سنة مالية منتهية غير مقفلة" />
        ) : (
          <div className="stack">
            {closable.map((year) => (
              <div className="spread" key={year.endDate}>
                <div>
                  <div>السنة المالية {year.label}</div>
                  <div className="small muted">
                    {formatDate(year.startDate)} — {formatDate(year.endDate)}
                  </div>
                </div>
                <div className="toolbar">
                  <span className="small">
                    النتيجة: <Money value={year.netResult} signed />
                  </span>
                  <button className="ghost sm" onClick={() => openPreview(year)}>معاينة</button>
                  {canManage && (
                    <button className="primary sm" onClick={() => close(year.endDate)} disabled={busy}>
                      إقفال
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {preview && (
        <Card title={`معاينة إقفال ${preview.label}`}>
          <div className="stack">
            <div className="spread">
              <span className="muted">الإيرادات</span>
              <strong><Money value={preview.income} /></strong>
            </div>
            <div className="spread">
              <span className="muted">المصروفات</span>
              <strong><Money value={preview.expense} /></strong>
            </div>
            <div className="spread" style={{ borderTop: '2px solid var(--border)', paddingTop: 8 }}>
              <span>صافي النتيجة إلى الأرباح المحتجزة</span>
              <strong><Money value={preview.netResult} signed /></strong>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>النوع</th>
                    <th className="num">الرصيد الذي سيُصفَّر</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line) => (
                    <tr key={line.accountId}>
                      <td>{line.code} — {line.name}</td>
                      <td className="small muted">{line.type === 'INCOME' ? 'إيراد' : 'مصروف'}</td>
                      <td className="num"><Money value={line.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              {canManage && (
                <button className="primary" onClick={() => close(preview.endDate)} disabled={busy}>
                  تنفيذ الإقفال
                </button>
              )}
              <button className="ghost" onClick={() => setPreview(null)}>إغلاق المعاينة</button>
            </div>
          </div>
        </Card>
      )}

      <Card title="السنوات المقفلة" pad={false}>
        <DataTable
          columns={[
            { key: 'label', label: 'السنة المالية', render: (row) => row.label },
            {
              key: 'period',
              label: 'الفترة',
              render: (row) => (
                <span className="small muted">
                  {formatDate(row.startDate)} — {formatDate(row.endDate)}
                </span>
              ),
            },
            {
              key: 'result',
              label: 'النتيجة المرحَّلة',
              numeric: true,
              render: (row) => <Money value={row.netResult} signed />,
            },
            {
              key: 'entry',
              label: 'القيد',
              render: (row) => <span className="small muted">#{row.entryNumber}</span>,
            },
            {
              key: 'by',
              label: 'نفّذه',
              render: (row) => <span className="small muted">{row.createdByName || '—'}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (row) =>
                canManage && latest && row.endDate === latest.endDate ? (
                  <button className="ghost sm" onClick={() => reopen(row)} disabled={busy}>
                    إعادة فتح
                  </button>
                ) : null,
            },
          ]}
          rows={closes}
          loading={data.loading}
          empty="لم تُقفل أي سنة بعد"
          rowKey={(row) => row.id}
        />
      </Card>

      <p className="small muted">
        الإقفال يجري بالترتيب: لا تُقفل سنة قبل ما سبقها، ولا يُعاد فتح سنة قبل إعادة فتح
        ما تلاها. وقيد الإقفال قيد عادي في الدفتر يمكن رؤيته في القيود اليومية.
      </p>
    </>
  );
}
