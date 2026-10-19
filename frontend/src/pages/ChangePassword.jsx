import { useState } from 'react';

import { Alert, Field, PasswordInput } from '../components/ui.jsx';
import { useSession } from '../lib/session';

/**
 * شاشة إلزام تغيير كلمة المرور.
 *
 * تظهر وحدها بعد أول دخول أو بعد إعادة تعيين بيد الآدمن: كل المسارات مسدودة
 * في الخادم حتى تُرفع، فلا فائدة من إظهار شيء آخر.
 */
export default function ChangePassword() {
  const { user, changePassword, logout } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError(new Error('الكلمتان غير متطابقتين'));
      return;
    }

    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark">م</div>
          <div>
            <div className="brand-name">كلمة مرور جديدة</div>
            <div className="brand-sub">{user?.email}</div>
          </div>
        </div>

        <p className="small muted">
          كلمتك الحالية مؤقتة — ضع كلمة تعرفها وحدك قبل المتابعة.
          ثمانية أحرف على الأقل، فيها حرف ورقم.
        </p>

        <Alert error={error} />

        <div className="stack">
          <Field label="كلمة المرور الحالية (المؤقتة)">
            <PasswordInput
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="كلمة المرور الجديدة">
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

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ والمتابعة'}
          </button>
          <button type="button" className="ghost" onClick={logout}>
            خروج
          </button>
        </div>
      </form>
    </div>
  );
}
