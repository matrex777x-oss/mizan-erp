import { useState } from 'react';

import { api, getToken } from '../lib/api';
import { useAsync } from '../lib/useAsync';

/**
 * تصدير ما يُعرض على الشاشة إلى Excel أو PDF.
 *
 * الصفحة تمرّر الأعمدة والصفوف كما تراها، فالملف صورة طبق الأصل مما يراه
 * المستخدم — لا إعادة حساب في الخادم قد تخرج بنتيجة أخرى.
 */
export default function ExportButtons({ title, subtitle, columns, rows, totals }) {
  const capabilities = useAsync(() => api.get('/export/capabilities'), []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const ready = Array.isArray(rows) && rows.length > 0;

  async function run(kind) {
    setError(null);
    setBusy(kind);
    try {
      const response = await fetch(`/api/export/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ title, subtitle, columns, rows, totals }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'تعذّر التصدير');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title}.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" onClick={() => run('xlsx')} disabled={!ready || busy}>
        {busy === 'xlsx' ? 'جارٍ…' : 'Excel'}
      </button>

      {/* زر PDF يظهر بقدر ما يوجد متصفّح على الخادم يولّده */}
      {capabilities.data?.pdf !== false && (
        <button type="button" onClick={() => run('pdf')} disabled={!ready || busy}>
          {busy === 'pdf' ? 'جارٍ…' : 'PDF'}
        </button>
      )}

      {error && <span className="small" style={{ color: 'var(--danger, #c33)' }}>{error}</span>}
    </>
  );
}
