import { useState } from 'react';

import { Alert, Field, PasswordInput } from '../components/ui.jsx';
import { useSession } from '../lib/session';

export default function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
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
            <div className="brand-name">ميزان</div>
            <div className="brand-sub">نظام محاسبي</div>
          </div>
        </div>

        <Alert error={error} />

        <div className="stack">
          <Field label="البريد الإلكتروني">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              dir="ltr"
            />
          </Field>
          <Field label="كلمة المرور">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </div>
      </form>
    </div>
  );
}
