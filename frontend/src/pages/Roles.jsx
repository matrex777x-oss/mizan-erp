import { Alert, Card, Loading, PageHead } from '../components/ui.jsx';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useSession } from '../lib/session';

/** تجميع القدرات بمجالها، ليُقرأ الجدول بالمجال لا بسلسلة طويلة. */
const GROUPS = [
  { label: 'المبيعات', prefix: 'sales.' },
  { label: 'المشتريات', prefix: 'purchase.' },
  { label: 'سندات القبض', prefix: 'receipt.' },
  { label: 'سندات الصرف', prefix: 'expense.' },
  { label: 'العملاء والموردون', prefix: 'parties.' },
  { label: 'الأصناف', prefix: 'items.' },
  { label: 'المخزون', prefix: 'stock.' },
  { label: 'شجرة الحسابات', prefix: 'accounts.' },
  { label: 'القيود اليومية', prefix: 'journal.' },
  { label: 'الإقفال السنوي', prefix: 'closing.' },
  { label: 'التقارير', prefix: 'reports.' },
  { label: 'إعدادات المنشأة', prefix: 'settings.' },
];

export default function Roles() {
  const { role: myRole } = useSession();
  const data = useAsync(() => api.get('/auth/roles'), []);

  if (data.loading) return <Loading />;
  if (data.error) return <Alert error={data.error} />;

  const { roles, capabilities } = data.data;

  return (
    <>
      <PageHead
        title="الأدوار والصلاحيات"
        subtitle="ما يستطيعه كل دور داخل هذه المنشأة — وهو نفسه ما يفرضه الخادم"
      />

      <Card title="الأدوار">
        <div className="stack">
          {roles.map((row) => (
            <div key={row.role} className="spread">
              <div>
                <div>
                  {row.label}
                  {row.role === myRole && <span className="small muted"> — دورك</span>}
                </div>
                <div className="small muted">{row.description}</div>
              </div>
              <span className="small muted">{row.capabilities.length} صلاحية</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="مصفوفة الصلاحيات" pad={false}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الصلاحية</th>
                {roles.map((row) => (
                  <th key={row.role} className="num">{row.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => {
                const caps = Object.keys(capabilities).filter((cap) => cap.startsWith(group.prefix));
                if (!caps.length) return null;

                return [
                  <tr key={group.label} className="group-row">
                    <td colSpan={roles.length + 1}>
                      <strong>{group.label}</strong>
                    </td>
                  </tr>,
                  ...caps.map((cap) => (
                    <tr key={cap}>
                      <td>{capabilities[cap]}</td>
                      {roles.map((row) => (
                        <td key={row.role} className="num">
                          {row.capabilities.includes(cap) ? (
                            <span className="yes" title="مسموح">✓</span>
                          ) : (
                            <span className="no" title="ممنوع">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="small muted">
        الأدوار ثابتة في النظام: يمنح آدمن النظام كل مستخدم دوره في كل منشأة على
        حدة من شاشة المستخدمين، فقد يكون مالكاً في منشأة ومحاسباً في أخرى.
      </p>
    </>
  );
}
