import { useState } from 'react';

import { Alert } from '../components/ui.jsx';
import { ROLE_LABELS, useSession } from '../lib/session';

/** اختيار المنشأة لمن يصل إلى أكثر من واحدة. */
export default function SelectBusiness() {
  const { businesses, selectBusiness, logout, user } = useSession();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  async function pick(id) {
    setError(null);
    setBusy(id);
    try {
      await selectBusiness(id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">
          <div className="brand-mark">م</div>
          <div>
            <div className="brand-name">اختر المنشأة</div>
            <div className="brand-sub">{user?.name}</div>
          </div>
        </div>

        <Alert error={error} />

        {businesses.length === 0 ? (
          <div className="stack">
            <p className="small muted">
              حسابك لا يصل إلى أي منشأة بعد. اطلب من آدمن النظام أن يمنحك وصولاً.
            </p>
            <button className="ghost" onClick={logout}>خروج</button>
          </div>
        ) : (
          <div className="stack">
            <div className="biz-pick-list">
              {businesses.map((business) => (
                <button
                  key={business.id}
                  type="button"
                  className="biz-pick"
                  onClick={() => pick(business.id)}
                  disabled={Boolean(busy)}
                >
                  <span className="biz-pick-name">{business.name}</span>
                  <span className="small muted">
                    {busy === business.id ? 'جارٍ الفتح…' : ROLE_LABELS[business.role] || business.role}
                  </span>
                </button>
              ))}
            </div>
            <button className="ghost" onClick={logout}>خروج</button>
          </div>
        )}
      </div>
    </div>
  );
}
