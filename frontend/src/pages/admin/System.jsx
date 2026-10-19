import { useState } from 'react';

import { Alert, Card, DataTable, Loading, PageHead } from '../../components/ui.jsx';
import { api, getToken } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.بايت`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.بايت`;
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h} ساعة و${m} دقيقة`;
  return `${m} دقيقة`;
}

export default function System() {
  const info = useAsync(() => api.get('/admin/system'), []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  /**
   * التنزيل بـ fetch لا برابط مباشر: المسار يحتاج ترويسة المصادقة،
   * ولا سبيل لوضعها في <a href>.
   */
  async function download(business) {
    setError(null);
    setBusy(business.id);
    try {
      const response = await fetch(`/api/admin/system/backup/${business.id}`, {
        headers: { authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'تعذّر تنزيل النسخة');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mizan-${business.slug}.db`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (info.loading) return <Loading />;
  if (info.error) return <Alert error={info.error} />;

  const data = info.data;

  const columns = [
    {
      key: 'name',
      label: 'المنشأة',
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <div className="small muted" dir="ltr">{row.slug}.db</div>
        </div>
      ),
    },
    { key: 'size', label: 'الحجم', render: (row) => <span className="small">{formatSize(row.size)}</span> },
    {
      key: 'state',
      label: 'الحالة',
      render: (row) => (
        <span className="small">
          {row.active ? 'نشطة' : 'موقوفة'}
          {row.exists ? '' : ' · لا ملف لقاعدتها'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <button className="ghost sm" onClick={() => download(row)} disabled={busy === row.id || !row.exists}>
          {busy === row.id ? 'جارٍ التحضير…' : 'تنزيل نسخة احتياطية'}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHead title="النظام" subtitle="أين تقع البيانات، وكم حجمها، ونسخها الاحتياطية" />

      <Alert error={error} />

      <Card title="حالة النظام">
        <div className="stack">
          <div className="spread">
            <span className="muted">نسخة التطبيق</span>
            <span dir="ltr">{data.version || '—'}</span>
          </div>
          <div className="spread">
            <span className="muted">Node.js</span>
            <span dir="ltr">{data.node}</span>
          </div>
          <div className="spread">
            <span className="muted">مدة التشغيل</span>
            <span>{formatUptime(data.uptimeSeconds)}</span>
          </div>
          <div className="spread">
            <span className="muted">مجلد البيانات</span>
            <span dir="ltr" className="small">{data.dataDir}</span>
          </div>
          <div className="spread">
            <span className="muted">قاعدة النظام</span>
            <span className="small">{formatSize(data.systemDb.size)}</span>
          </div>
          <div className="spread">
            <span className="muted">المستخدمون</span>
            <span className="small">
              {data.counts.activeUsers} نشط من {data.counts.users} · {data.counts.admins} آدمن
            </span>
          </div>
          <div className="spread">
            <span className="muted">سجل التدقيق</span>
            <span className="small">{data.counts.auditEntries} حدثاً</span>
          </div>
        </div>

        {data.dataDirIsDefault && (
          <p className="small muted" style={{ marginTop: 12 }}>
            البيانات داخل مجلد المشروع لأن <code dir="ltr">DATA_DIR</code> غير مضبوط.
            اضبطه على مجلد خارج المشروع حتى لا تُفقد القواعد عند تحديث الكود.
          </p>
        )}
      </Card>

      <Card title="النسخ الاحتياطية" pad={false}>
        <DataTable
          columns={columns}
          rows={data.businesses}
          empty="لا منشآت"
          rowKey={(row) => row.id}
        />
      </Card>

      <p className="small muted">
        النسخة ملف قاعدة كامل يعمل وحده — SQLite ملف واحد، فحفظه حفظ للمنشأة كلها.
        تُؤخذ من لقطة متّسقة دون إيقاف الخادم. احتفظ بها خارج الجهاز.
      </p>
    </>
  );
}
