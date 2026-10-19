import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, getToken, setToken } from './api';

const SessionContext = createContext(null);

/**
 * الجلسة تحمل المستخدم والمنشأة المختارة معاً.
 *
 * الدور ليس صفة في المستخدم بل في عضويته لهذه المنشأة: قد يكون مالكاً في منشأة
 * ومحاسباً في أخرى، فيتغيّر ما يستطيعه بتبديل المنشأة.
 */
export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState(null);
  const [role, setRole] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const loadSettings = useCallback(async () => {
    const data = await api.get('/settings');
    setSettings(data.settings);
    return data.settings;
  }, []);

  const applySession = useCallback(
    async (data) => {
      setUser(data.user);
      setBusinesses(data.businesses || []);
      setBusinessId(data.businessId || null);

      const current = (data.businesses || []).find((b) => b.id === data.businessId);
      setRole(data.role || current?.role || null);

      // الإعدادات تابعة للمنشأة، فلا تُطلب قبل اختيار واحدة، ولا قبل رفع
      // إلزام تغيير كلمة المرور (كل المسارات مسدودة حتى يُرفع)
      if (data.businessId && !data.user?.mustChangePassword) await loadSettings();
      else setSettings(null);
    },
    [loadSettings],
  );

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;

    (async () => {
      try {
        const me = await api.get('/auth/me');
        if (cancelled) return;
        await applySession(me);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    async (email, password) => {
      const data = await api.post('/auth/login', { email, password });
      setToken(data.token);
      await applySession(data);
      return data;
    },
    [applySession],
  );

  /**
   * يعيد قراءة الجلسة من الخادم.
   * يُستدعى بعد ما يغيّر المنشآت أو الصلاحيات، فيظهر أثره فوراً في المبدّل.
   */
  const refresh = useCallback(async () => {
    const me = await api.get('/auth/me');
    await applySession(me);
    return me;
  }, [applySession]);

  /** تبديل المنشأة: رمز جديد يحملها، فكل طلب بعده يعمل على قاعدتها. */
  const selectBusiness = useCallback(
    async (id) => {
      const data = await api.post('/auth/select-business', { businessId: id });
      setToken(data.token);
      setBusinessId(data.businessId);
      setRole(data.role);
      await loadSettings();
      return data;
    },
    [loadSettings],
  );

  /** تغيير كلمة المرور للمستخدم نفسه — يرفع الإلزام ويُعيد رمزاً جديداً. */
  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      const data = await api.post('/auth/change-password', { currentPassword, newPassword });
      setToken(data.token);
      setUser(data.user);

      const me = await api.get('/auth/me');
      await applySession(me);
      return data;
    },
    [applySession],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setBusinesses([]);
    setBusinessId(null);
    setRole(null);
    setSettings(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      businesses,
      businessId,
      role,
      settings,
      loading,
      login,
      logout,
      selectBusiness,
      changePassword,
      refresh,
      loadSettings,
      setSettings,
      mustChangePassword: Boolean(user?.mustChangePassword),
      isAdmin: Boolean(user?.isAdmin),
      canWrite: role === 'OWNER' || role === 'ACCOUNTANT',
      isOwner: role === 'OWNER',
      business: businesses.find((b) => b.id === businessId) || null,
      currency: settings?.currencySymbol || '',
    }),
    [
      user,
      businesses,
      businessId,
      role,
      settings,
      loading,
      login,
      logout,
      selectBusiness,
      changePassword,
      refresh,
      loadSettings,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession خارج SessionProvider');
  return context;
}

export const ROLE_LABELS = { OWNER: 'مالك', ACCOUNTANT: 'محاسب', VIEWER: 'مُطّلع' };
