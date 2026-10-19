import { formatMoney } from '../lib/format';
import { useSession } from '../lib/session';

export function Card({ title, actions, children, pad = true, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="toolbar">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="toolbar no-print">{children}</div>}
    </div>
  );
}

export function Money({ value, signed = false }) {
  const { currency } = useSession();
  const number = Number(value ?? 0);
  const className = signed ? (number < 0 ? 'neg' : number > 0 ? 'pos' : '') : '';
  return <span className={className}>{formatMoney(value, currency)}</span>;
}

export function Alert({ error, success }) {
  if (!error && !success) return null;
  const message = error ? error.message || String(error) : success;
  return <div className={`alert ${error ? 'error' : 'ok'}`}>{message}</div>;
}

export function Loading({ label = 'جارٍ التحميل…' }) {
  return <div className="empty">{label}</div>;
}

export function Empty({ label = 'لا توجد بيانات' }) {
  return <div className="empty">{label}</div>;
}

const STATUS_CLASS = { POSTED: 'ok', DRAFT: 'warn', CANCELLED: 'bad' };

export function StatusBadge({ status, labels }) {
  return <span className={`badge ${STATUS_CLASS[status] || ''}`}>{labels[status] || status}</span>;
}

/** جدول بسيط مع حالات فارغة/تحميل موحّدة. */
export function DataTable({ columns, rows, loading, empty, rowKey, rowClass }) {
  if (loading) return <Loading />;
  if (!rows?.length) return <Empty label={empty} />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'num' : ''} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row, index) : index} className={rowClass ? rowClass(row) : ''}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : ''}>
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
