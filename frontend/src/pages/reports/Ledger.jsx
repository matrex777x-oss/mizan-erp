import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert, Card, DataTable, Field, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { formatDate, SOURCE_LABELS } from '../../lib/format';

export default function Ledger() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('partyId') ? 'party' : 'account');
  const [target, setTarget] = useState({ accountId: '', partyId: params.get('partyId') || '' });
  const [range, setRange] = useState({ from: '', to: '' });

  const accounts = useAsync(() => api.get('/accounts?postable=true'), []);
  const parties = useAsync(() => api.get('/parties'), []);

  useEffect(() => {
    if (mode === 'account' && !target.accountId && accounts.data?.accounts?.length) {
      setTarget((current) => ({ ...current, accountId: accounts.data.accounts[0].id }));
    }
  }, [mode, accounts.data, target.accountId]);

  const selected = mode === 'account' ? target.accountId : target.partyId;
  const path = mode === 'account' ? `/reports/ledger/${selected}` : `/reports/party-statement/${selected}`;

  const report = useAsync(
    () => (selected ? api.get(`${path}${query(range)}`) : Promise.resolve(null)),
    [mode, selected, range.from, range.to],
  );

  const data = report.data;
  const heading = mode === 'account' ? data?.account?.name : data?.party?.name;

  return (
    <>
      <PageHead title="كشف حساب" subtitle="حركة تفصيلية برصيد متحرك">
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={report.error} />

      <Card className="no-print">
        <div className="field-row">
          <Field label="نوع الكشف">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="account">حساب من شجرة الحسابات</option>
              <option value="party">عميل أو مورد</option>
            </select>
          </Field>
          {mode === 'account' ? (
            <Field label="الحساب">
              <select value={target.accountId} onChange={(e) => setTarget({ ...target, accountId: e.target.value })}>
                <option value="">— اختر —</option>
                {(accounts.data?.accounts || []).map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="الطرف">
              <select value={target.partyId} onChange={(e) => setTarget({ ...target, partyId: e.target.value })}>
                <option value="">— اختر —</option>
                {(parties.data?.parties || []).map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="من تاريخ">
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="إلى تاريخ">
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
        </div>
      </Card>

      {selected && (
        <Card
          title={heading || 'كشف الحساب'}
          pad={false}
          actions={
            data && (
              <span className="row">
                <span className="muted small">رصيد أول المدة: <Money value={data.opening} signed /></span>
                <strong>رصيد آخر المدة: <Money value={data.closing} signed /></strong>
              </span>
            )
          }
        >
          <DataTable
            loading={report.loading}
            rows={data?.rows || []}
            rowKey={(row, index) => row.lineId || `${row.entryId}-${index}`}
            empty="لا توجد حركات في هذه الفترة"
            columns={[
              { key: 'date', label: 'التاريخ', width: 110, render: (row) => formatDate(row.date) },
              { key: 'entry', label: 'القيد', width: 80, render: (row) => `#${row.entryNumber}` },
              { key: 'source', label: 'المصدر', width: 100, render: (row) => SOURCE_LABELS[row.source] },
              { key: 'memo', label: 'البيان', render: (row) => row.memo || '—' },
              { key: 'debit', label: 'مدين', width: 130, numeric: true, render: (row) => (row.debit === '0.00' ? '' : <Money value={row.debit} />) },
              { key: 'credit', label: 'دائن', width: 130, numeric: true, render: (row) => (row.credit === '0.00' ? '' : <Money value={row.credit} />) },
              { key: 'balance', label: 'الرصيد', width: 140, numeric: true, render: (row) => <Money value={row.balance} signed /> },
            ]}
          />
        </Card>
      )}
    </>
  );
}
