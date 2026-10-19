import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert, Card, DataTable, Field, Money, PageHead } from '../../components/ui.jsx';
import { api, query } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { formatDate, formatQuantity, MOVE_KIND_LABELS, MOVE_SOURCE_LABELS } from '../../lib/format';

export default function Stock() {
  const [params] = useSearchParams();
  const [itemId, setItemId] = useState(params.get('itemId') || '');
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);

  const balances = useAsync(
    () => api.get(`/reports/stock${query({ q: search, hideEmpty: hideEmpty ? 'true' : '' })}`),
    [search, hideEmpty],
  );
  const movement = useAsync(
    () => (itemId ? api.get(`/reports/stock/${itemId}`) : Promise.resolve(null)),
    [itemId],
  );

  return (
    <>
      <PageHead title="المخزون" subtitle="أرصدة الأصناف بالتكلفة المتوسطة المرجّحة، وحركة كل صنف تفصيلياً">
        <button onClick={() => window.print()}>طباعة</button>
      </PageHead>

      <Alert error={balances.error || movement.error} />

      <div className="stack">
        <Card
          title={balances.data ? `قيمة المخزون: ${balances.data.totals.value}` : 'أرصدة الأصناف'}
          pad={false}
          actions={
            <>
              <label className="row small">
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={hideEmpty}
                  onChange={(e) => setHideEmpty(e.target.checked)}
                />
                <span>إخفاء الأصناف بلا رصيد</span>
              </label>
              <input placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
            </>
          }
        >
          <DataTable
            loading={balances.loading}
            rows={balances.data?.rows || []}
            rowKey={(row) => row.itemId}
            empty="لا توجد أصناف مخزنية"
            columns={[
              { key: 'code', label: 'الرمز', width: 90, render: (row) => <span dir="ltr">{row.code}</span> },
              {
                key: 'name',
                label: 'الصنف',
                render: (row) => (
                  <>
                    {row.name}
                    {row.belowReorder && <span className="badge warn" style={{ marginInlineStart: 8 }}>تحت حد الطلب</span>}
                  </>
                ),
              },
              { key: 'unit', label: 'الوحدة', width: 80, render: (row) => row.unit },
              { key: 'onHand', label: 'الرصيد', width: 110, numeric: true, render: (row) => formatQuantity(row.onHand) },
              { key: 'avg', label: 'متوسط التكلفة', width: 130, numeric: true, render: (row) => <Money value={row.averageCost} /> },
              { key: 'value', label: 'القيمة', width: 130, numeric: true, render: (row) => <Money value={row.value} /> },
              {
                key: 'actions',
                label: '',
                width: 100,
                render: (row) => (
                  <button className="sm ghost" onClick={() => setItemId(row.itemId)}>الحركة</button>
                ),
              },
            ]}
          />
        </Card>

        <Card className="no-print">
          <Field label="كشف حركة صنف">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">— اختر صنفاً —</option>
              {(balances.data?.rows || []).map((row) => (
                <option key={row.itemId} value={row.itemId}>{row.code} — {row.name}</option>
              ))}
            </select>
          </Field>
        </Card>

        {itemId && movement.data && (
          <Card
            title={`حركة ${movement.data.item.name}`}
            pad={false}
            actions={
              <span className="row small muted">
                <span>الرصيد: {formatQuantity(movement.data.item.onHand)} {movement.data.item.unit}</span>
                <strong>القيمة: <Money value={movement.data.item.stockValue} /></strong>
              </span>
            }
          >
            <DataTable
              loading={movement.loading}
              rows={movement.data.rows}
              rowKey={(row) => row.id}
              empty="لا توجد حركات لهذا الصنف"
              columns={[
                { key: 'date', label: 'التاريخ', width: 110, render: (row) => formatDate(row.date) },
                {
                  key: 'kind',
                  label: 'النوع',
                  width: 90,
                  render: (row) => (
                    <span className={`badge ${row.kind === 'IN' ? 'ok' : 'warn'}`}>{MOVE_KIND_LABELS[row.kind]}</span>
                  ),
                },
                { key: 'source', label: 'المصدر', width: 90, render: (row) => MOVE_SOURCE_LABELS[row.sourceType] || row.sourceType },
                { key: 'memo', label: 'البيان', render: (row) => row.memo || '—' },
                { key: 'qty', label: 'الكمية', width: 100, numeric: true, render: (row) => formatQuantity(row.quantity) },
                { key: 'unitCost', label: 'تكلفة الوحدة', width: 120, numeric: true, render: (row) => <Money value={row.unitCost} /> },
                { key: 'totalCost', label: 'قيمة الحركة', width: 120, numeric: true, render: (row) => <Money value={row.totalCost} /> },
                { key: 'balQty', label: 'رصيد الكمية', width: 110, numeric: true, render: (row) => formatQuantity(row.balanceQty) },
                { key: 'balValue', label: 'رصيد القيمة', width: 120, numeric: true, render: (row) => <Money value={row.balanceValue} /> },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
