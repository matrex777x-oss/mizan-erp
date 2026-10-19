import { useEffect, useState } from 'react';

import { Alert, Card, Field, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

const PREFIX_FIELDS = [
  ['prefixSales', 'فواتير المبيعات'],
  ['prefixPurchase', 'فواتير المشتريات'],
  ['prefixReceipt', 'سندات القبض'],
  ['prefixPayment', 'سندات الصرف'],
  ['prefixAdjustment', 'تسويات المخزون'],
];

/** مثال حيّ على شكل الرقم القادم بالإعدادات المعروضة الآن. */
function sampleNumber(prefix, includeYear, padding) {
  const year = new Date().getFullYear();
  const stem = includeYear ? `${prefix}-${year}-` : `${prefix}-`;
  return `${stem}${String(1).padStart(Number(padding) || 1, '0')}`;
}

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

  const set = (patch) => setForm({ ...form, ...patch });

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const data = await api.patch('/settings', { ...form, lockDate: form.lockDate || null });
      setSettings(data.settings);
      setForm({ ...data.settings, lockDate: data.settings.lockDate || '' });
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
            <div className="stack">
              <div className="field-row">
                <Field label="اسم المنشأة">
                  <input value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} required />
                </Field>
                <Field label="الرقم الضريبي">
                  <input value={form.taxNumber || ''} onChange={(e) => set({ taxNumber: e.target.value })} dir="ltr" />
                </Field>
              </div>
              <div className="field-row">
                <Field label="الهاتف">
                  <input value={form.phone || ''} onChange={(e) => set({ phone: e.target.value })} dir="ltr" />
                </Field>
                <Field label="البريد الإلكتروني">
                  <input type="email" value={form.email || ''} onChange={(e) => set({ email: e.target.value })} dir="ltr" />
                </Field>
              </div>
              <Field label="العنوان">
                <input value={form.address || ''} onChange={(e) => set({ address: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="العملة">
            <div className="field-row">
              <Field label="رمز العملة" hint="مثل SAR أو EGP">
                <input value={form.currencyCode} onChange={(e) => set({ currencyCode: e.target.value })} dir="ltr" />
              </Field>
              <Field label="رمز العرض" hint="مثل ر.س">
                <input value={form.currencySymbol} onChange={(e) => set({ currencySymbol: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="السياسات المحاسبية">
            <div className="field-row">
              <Field label="شهر بداية السنة المالية">
                <select value={form.fiscalYearStart} onChange={(e) => set({ fiscalYearStart: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </Field>
              <Field label="نسبة الضريبة الافتراضية %">
                <input className="num" value={form.defaultTaxRate} onChange={(e) => set({ defaultTaxRate: e.target.value })} dir="ltr" />
              </Field>
              <Field label="إقفال الفترة حتى" hint="يمنع أي قيد في هذا التاريخ أو قبله">
                <input type="date" value={form.lockDate} onChange={(e) => set({ lockDate: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="ترقيم المستندات">
            <div className="stack">
              <div className="field-row">
                {PREFIX_FIELDS.map(([field, label]) => (
                  <Field key={field} label={label}>
                    <input
                      value={form[field] || ''}
                      onChange={(e) => set({ [field]: e.target.value.toUpperCase() })}
                      dir="ltr"
                      maxLength={8}
                    />
                  </Field>
                ))}
              </div>

              <div className="field-row">
                <Field label="عدد الخانات" hint="0001 أو 000001">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    className="num"
                    value={form.numberPadding}
                    onChange={(e) => set({ numberPadding: Number(e.target.value) })}
                    dir="ltr"
                  />
                </Field>
                <label className="field-inline">
                  <input
                    type="checkbox"
                    checked={Boolean(form.numberIncludeYear)}
                    onChange={(e) => set({ numberIncludeYear: e.target.checked })}
                  />
                  <span>إدراج السنة في الرقم</span>
                </label>
              </div>

              <div className="small muted">
                شكل الرقم القادم:{' '}
                <code dir="ltr">
                  {sampleNumber(form.prefixSales || 'INV', form.numberIncludeYear, form.numberPadding)}
                </code>
              </div>

              <p className="small muted">
                تغيير البادئة يبدأ تسلسلاً جديداً من 1، ولا يمسّ أرقام المستندات
                المحفوظة. ولا يصح تكرار البادئة بين نوعين.
              </p>
            </div>
          </Card>

          <Card title="الوحدات">
            <div className="stack">
              <label className="field-inline">
                <input
                  type="checkbox"
                  checked={Boolean(form.inventoryEnabled)}
                  onChange={(e) => set({ inventoryEnabled: e.target.checked })}
                />
                <span>وحدة المخزون</span>
              </label>
              <p className="small muted">
                أوقفها في المنشأة الخدمية فتختفي شاشات المخزون وتُرفض الأصناف
                المخزنية. لا يمكن إيقافها بعد تسجيل أي حركة مخزون، لأن أرصدتها
                وتكاليفها تكون قد دخلت الدفتر.
              </p>
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
