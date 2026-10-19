import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../lib/session';

const NAV = [
  {
    label: 'الرئيسية',
    links: [{ to: '/', label: 'لوحة المؤشرات', end: true }],
  },
  {
    label: 'الحركات',
    links: [
      { to: '/invoices/sales', label: 'فواتير المبيعات' },
      { to: '/invoices/purchase', label: 'فواتير المشتريات' },
      { to: '/payments/receipts', label: 'سندات القبض' },
      { to: '/payments/outgoing', label: 'سندات الصرف' },
      { to: '/stock-adjustments', label: 'تسويات المخزون' },
      { to: '/journal', label: 'القيود اليومية' },
    ],
  },
  {
    label: 'البيانات الأساسية',
    links: [
      { to: '/parties', label: 'العملاء والموردون' },
      { to: '/items', label: 'الأصناف والخدمات' },
      { to: '/accounts', label: 'شجرة الحسابات' },
    ],
  },
  {
    label: 'التقارير',
    links: [
      { to: '/reports/stock', label: 'المخزون' },
      { to: '/reports/trial-balance', label: 'ميزان المراجعة' },
      { to: '/reports/income-statement', label: 'قائمة الدخل' },
      { to: '/reports/balance-sheet', label: 'المركز المالي' },
      { to: '/reports/ledger', label: 'كشف حساب' },
      { to: '/reports/aging', label: 'أعمار الديون' },
    ],
  },
];

const ROLE_LABELS = { OWNER: 'مالك', ACCOUNTANT: 'محاسب', VIEWER: 'مُطّلع' };

export default function Layout() {
  const { user, settings, logout, isOwner } = useSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">م</div>
          <div>
            <div className="brand-name">ميزان</div>
            <div className="brand-sub">{settings?.companyName || 'نظام محاسبي'}</div>
          </div>
        </div>

        {NAV.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
                {link.label}
              </NavLink>
            ))}
          </div>
        ))}

        {isOwner && (
          <div className="nav-group">
            <div className="nav-group-label">الإعدادات</div>
            <NavLink to="/settings" className="nav-link">إعدادات المنشأة</NavLink>
          </div>
        )}

        <div className="sidebar-foot">
          <div className="spread">
            <div>
              <div>{user?.name}</div>
              <div className="small muted">{ROLE_LABELS[user?.role] || user?.role}</div>
            </div>
            <button className="ghost sm" onClick={logout}>خروج</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
