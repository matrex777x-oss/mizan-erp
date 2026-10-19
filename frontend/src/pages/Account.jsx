import { useState } from 'react';

import { Alert, Card, Field, PageHead, PasswordInput } from '../components/ui.jsx';
import { ROLE_LABELS, useSession } from '../lib/session';

/** حسابي: بياناتي وتغيير كلمة مروري. */
export default function Account() {
  const { user, businesses, business, role, changePassword } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (next !== confirm) {
      setError(new Error('الكلمتان غير متطابقتين'));
      return;
    }

    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setSuccess('تم تغيير كلمة المرور');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="حسابي" subtitle={user?.email} />

      <Card title="بياناتي">
        <div className="stack">
          <div className="spread">
            <span className="muted">الاسم</span>
            <span>{user?.name}</span>
          </div>
          <div className="spread">
            <span className="muted">البريد الإلكتروني</span>
            <span dir="ltr">{user?.email}</span>
          </div>
          <div className="spread">
            <span className="muted">المنشأة الحالية</span>
            <span>
              {business?.name || '—'}
              {role ? ` — ${ROLE_LABELS[role] || role}` : ''}
            </span>
          </div>
          <div className="spread">
            <span className="muted">منشآتي</span>
            <span>
              {businesses.length
                ? businesses.map((b) => `${b.name} (${ROLE_LABELS[b.role] || b.role})`).join('، ')
                : '—'}
            </span>
          </div>
          {user?.isAdmin && (
            <div className="spread">
              <span className="muted">صلاحية النظام</span>
              <span>آدمن النظام — يدير المنشآت والمستخدمين</span>
            </div>
          )}
        </div>
      </Card>

      <Card title="تغيير كلمة المرور">
        <form className="stack" onSubmit={submit}>
          <Alert error={error} success={success} />

          <Field label="كلمة المرور الحالية">
            <PasswordInput
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="كلمة المرور الجديدة" hint="ثمانية أحرف على الأقل، فيها حرف ورقم">
            <PasswordInput
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="تأكيد كلمة المرور الجديدة">
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <div className="toolbar">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
          </div>

          <p className="small muted">
            لا يستطيع أحد — ولا آدمن النظام — عرض كلمة مرورك: تُخزَّن بتجزئة لا تُفك.
            إن نسيتها يعيد الآدمن تعيينها بكلمة مؤقتة تضع بعدها كلمةً تعرفها وحدك.
          </p>
        </form>
      </Card>
    </>
  );
}
