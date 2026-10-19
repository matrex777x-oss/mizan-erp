import { Navigate, Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { SessionProvider, useSession } from './lib/session';

import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import SelectBusiness from './pages/SelectBusiness.jsx';
import Account from './pages/Account.jsx';
import Roles from './pages/Roles.jsx';
import Users from './pages/admin/Users.jsx';
import Businesses from './pages/admin/Businesses.jsx';
import AuditLog from './pages/admin/AuditLog.jsx';
import System from './pages/admin/System.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import Parties from './pages/Parties.jsx';
import Items from './pages/Items.jsx';
import StockAdjustments from './pages/StockAdjustments.jsx';
import StockAdjustmentForm from './pages/StockAdjustmentForm.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceForm from './pages/InvoiceForm.jsx';
import Payments from './pages/Payments.jsx';
import PaymentForm from './pages/PaymentForm.jsx';
import Journal from './pages/Journal.jsx';
import JournalForm from './pages/JournalForm.jsx';
import TrialBalance from './pages/reports/TrialBalance.jsx';
import IncomeStatement from './pages/reports/IncomeStatement.jsx';
import BalanceSheet from './pages/reports/BalanceSheet.jsx';
import LedgerReport from './pages/reports/Ledger.jsx';
import Aging from './pages/reports/Aging.jsx';
import StockReport from './pages/reports/Stock.jsx';
import Settings from './pages/Settings.jsx';
import Closing from './pages/Closing.jsx';
import Assets from './pages/Assets.jsx';
import Warehouses from './pages/Warehouses.jsx';

function Routed() {
  const { user, loading, mustChangePassword, businessId, isAdmin } = useSession();

  if (loading) return <Loading label="جارٍ فتح الجلسة…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // كل المسارات مسدودة في الخادم حتى تُرفع كلمة المرور المؤقتة، فلا نُظهر غيرها
  if (mustChangePassword) return <ChangePassword />;

  // لا منشأة مختارة: إمّا أكثر من منشأة فيختار، أو لا منشأة فيُخبَر
  if (!businessId) return <SelectBusiness />;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />

        <Route path="invoices/:kind" element={<Invoices />} />
        <Route path="invoices/:kind/new" element={<InvoiceForm />} />
        <Route path="invoices/:kind/:id" element={<InvoiceForm />} />

        <Route path="payments/:kind" element={<Payments />} />
        <Route path="payments/:kind/new" element={<PaymentForm />} />
        <Route path="payments/:kind/:id" element={<PaymentForm />} />

        <Route path="stock-adjustments" element={<StockAdjustments />} />
        <Route path="stock-adjustments/new" element={<StockAdjustmentForm />} />
        <Route path="stock-adjustments/:id" element={<StockAdjustmentForm />} />

        <Route path="journal" element={<Journal />} />
        <Route path="journal/new" element={<JournalForm />} />

        <Route path="parties" element={<Parties />} />
        <Route path="items" element={<Items />} />
        <Route path="accounts" element={<Accounts />} />

        <Route path="reports/stock" element={<StockReport />} />
        <Route path="reports/trial-balance" element={<TrialBalance />} />
        <Route path="reports/income-statement" element={<IncomeStatement />} />
        <Route path="reports/balance-sheet" element={<BalanceSheet />} />
        <Route path="reports/ledger" element={<LedgerReport />} />
        <Route path="reports/aging" element={<Aging />} />

        <Route path="settings" element={<Settings />} />
        <Route path="closing" element={<Closing />} />
        <Route path="assets" element={<Assets />} />
        <Route path="warehouses" element={<Warehouses />} />
        <Route path="account" element={<Account />} />
        <Route path="roles" element={<Roles />} />

        {isAdmin && (
          <>
            <Route path="admin/users" element={<Users />} />
            <Route path="admin/businesses" element={<Businesses />} />
            <Route path="admin/audit" element={<AuditLog />} />
            <Route path="admin/system" element={<System />} />
          </>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routed />
    </SessionProvider>
  );
}
