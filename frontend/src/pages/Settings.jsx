import { useEffect, useState } from 'react';

import { Alert, Card, Field, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export default function Settings() {
  const { settings, setSettings } = useSession();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setForm({ ...settings, lockDate: settings.lockDate || '' });
  }, [settings]);

  if (!form) return null;

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const data = await api.patch('/settings', { ...form, lockDate: form.lockDate || null });
      setSettings(data.settings);
      setSaved('حُفظت الإعدادات');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="إعدادات المنشأة" subtitle="تُطبَّق على كل المستندات والتقارير" />

      <Alert error={error} success={saved} />

      <form onSubmit={submit}>
        <div className="stack">
          <Card title="بيانات المنشأة">
            <div className="field-row">
              <Field label="اسم المنشأة">
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />
              </Field>
              <Field label="رمز العملة" hint="مثل SAR أو EGP">
                <input value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value })} dir="ltr" />
              </Field>
              <Field label="رمز العرض" hint="مثل ر.س">
                <input value={form.currencySymbol} onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="السياسات المحاسبية">
            <div className="field-row">
              <Field label="شهر بداية السنة المالية">
                <select value={form.fiscalYearStart} onChange={(e) => setForm({ ...form, fiscalYearStart: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </Field>
              <Field label="نسبة الضريبة الافتراضية %">
                <input className="num" value={form.defaultTaxRate} onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })} dir="ltr" />
              </Field>
              <Field label="إقفال الفترة حتى" hint="يمنع أي قيد في هذا التاريخ أو قبله">
                <input type="date" value={form.lockDate} onChange={(e) => setForm({ ...form, lockDate: e.target.value })} />
              </Field>
            </div>
          </Card>

          <div className="toolbar">
            <button type="submit" className="primary" disabled={busy}>حفظ الإعدادات</button>
          </div>
        </div>
      </form>
    </>
  );
}
