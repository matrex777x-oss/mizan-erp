import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { ROLE_LABELS, useSession } from '../lib/session';

// لكل رابط القدرة التي تفتحه. ما لا يملكه الدور يختفي من الشريط، فلا يرى
// المستخدم باباً يُغلق في وجهه — والفرض يبقى في الخادم على كل حال.
const NAV = [
  {
    label: 'الرئيسية',
    links: [{ to: '/', label: 'لوحة المؤشرات', end: true }],
  },
  {
    label: 'الحركات',
    links: [
      { to: '/invoices/sales', label: 'فواتير المبيعات', cap: 'sales.read' },
      { to: '/invoices/purchase', label: 'فواتير المشتريات', cap: 'purchase.read' },
      { to: '/payments/receipts', label: 'سندات القبض', cap: 'receipt.read' },
      { to: '/payments/outgoing', label: 'سندات الصرف', cap: 'expense.read' },
      { to: '/stock-adjustments', label: 'تسويات المخزون', cap: 'stock.read', module: 'inventory' },
      { to: '/journal', label: 'القيود اليومية', cap: 'journal.read' },
      { to: '/closing', label: 'الإقفال السنوي', cap: 'closing.read' },
    ],
  },
  {
    label: 'البيانات الأساسية',
    links: [
      { to: '/parties', label: 'العملاء والموردون', cap: 'parties.read' },
      { to: '/items', label: 'الأصناف والخدمات', cap: 'items.read' },
      { to: '/accounts', label: 'شجرة الحسابات', cap: 'accounts.read' },
      { to: '/assets', label: 'الأصول الثابتة', cap: 'assets.read' },
    ],
  },
  {
    label: 'التقارير',
    links: [
      { to: '/reports/stock', label: 'المخزون', cap: 'reports.operational', module: 'inventory' },
      { to: '/reports/trial-balance', label: 'ميزان المراجعة', cap: 'reports.financial' },
      { to: '/reports/income-statement', label: 'قائمة الدخل', cap: 'reports.financial' },
      { to: '/reports/balance-sheet', label: 'المركز المالي', cap: 'reports.financial' },
      { to: '/reports/ledger', label: 'كشف حساب', cap: 'reports.financial' },
      { to: '/reports/aging', label: 'أعمار الديون', cap: 'reports.operational' },
    ],
  },
];

export default function Layout() {
  const { user, settings, logout, can, isAdmin, businesses, businessId, role, selectBusiness } =
    useSession();

  const [switching, setSwitching] = useState(false);

  async function switchBusiness(id) {
    if (!id || id === businessId) return;
    setSwitching(true);
    try {
      await selectBusiness(id);
    } finally {
      setSwitching(false);
    }
  }

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

        {/* مبدّل المنشآت: يظهر لمن يصل إلى أكثر من واحدة */}
        {businesses.length > 1 && (
          <div className="biz-switch">
            <span className="nav-group-label">المنشأة</span>
            <select
              value={businessId || ''}
              onChange={(e) => switchBusiness(e.target.value)}
              disabled={switching}
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {NAV.map((group) => {
          const links = group.links.filter(
            (link) =>
              (!link.cap || can(link.cap)) &&
              (link.module !== 'inventory' || settings?.inventoryEnabled !== false),
          );
          if (!links.length) return null;

          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
                  {link.label}
                </NavLink>
              ))}
            </div>
          );
        })}

        <div className="nav-group">
          <div className="nav-group-label">الإعدادات</div>
          {can('settings.write') && (
            <NavLink to="/settings" className="nav-link">إعدادات المنشأة</NavLink>
          )}
          <NavLink to="/roles" className="nav-link">الأدوار والصلاحيات</NavLink>
          <NavLink to="/account" className="nav-link">حسابي</NavLink>
        </div>

        {isAdmin && (
          <div className="nav-group">
            <div className="nav-group-label">إدارة النظام</div>
            <NavLink to="/admin/users" className="nav-link">المستخدمون</NavLink>
            <NavLink to="/admin/businesses" className="nav-link">المنشآت</NavLink>
            <NavLink to="/admin/audit" className="nav-link">سجل التدقيق</NavLink>
            <NavLink to="/admin/system" className="nav-link">النظام</NavLink>
          </div>
        )}

        <div className="sidebar-foot">
          <div className="spread">
            <div>
              <div>{user?.name}</div>
              <div className="small muted">
                {ROLE_LABELS[role] || role}
                {isAdmin ? ' · آدمن' : ''}
              </div>
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
