import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, getToken, setToken } from './api';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const loadSettings = useCallback(async () => {
    const data = await api.get('/settings');
    setSettings(data.settings);
    return data.settings;
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;

    (async () => {
      try {
        const me = await api.get('/auth/me');
        if (cancelled) return;
        setUser(me.user);
        await loadSettings();
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [loadSettings]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    await loadSettings();
  }, [loadSettings]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setSettings(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      settings,
      loading,
      login,
      logout,
      loadSettings,
      setSettings,
      canWrite: user?.role === 'OWNER' || user?.role === 'ACCOUNTANT',
      isOwner: user?.role === 'OWNER',
      currency: settings?.currencySymbol || '',
    }),
    [user, settings, loading, login, logout, loadSettings],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession خارج SessionProvider');
  return context;
}
