import { formatDate, formatMoney, formatNumber } from '../../lib/format.js';
import { HK_COLORS, HK_LABELS, STATUS_LABELS } from '../../lib/constants.js';
import { Icon } from '../../lib/icons.jsx';

export function Card({ title, actions, children, flush = false, className = '', bodyClassName = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3 className="card-title">{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PageHead({ title, description, actions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = '', dot = false, children, className = '' }) {
  return <span className={`badge ${tone} ${dot ? 'dot' : ''} ${className}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  return <Badge tone={`st-${status}`} dot>{STATUS_LABELS[status] ?? status}</Badge>;
}

/** نقطة + اسم حالة النظافة */
export function HkStatus({ status, compact = false }) {
  return (
    <span className="row" style={{ gap: 6 }} title={HK_LABELS[status]}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: HK_COLORS[status], flex: 'none' }} />
      {!compact && <span className="small">{HK_LABELS[status]}</span>}
    </span>
  );
}

export const Money = ({ minor, currency = 'EGP', className = '' }) => (
  <span className={`num ${className}`}>{formatMoney(minor, currency)}</span>
);
export const DateText = ({ iso }) => <span className="num">{formatDate(iso)}</span>;
export const NumberText = ({ value }) => <span className="num">{formatNumber(value)}</span>;

export function Loading({ label = 'جارٍ التحميل…' }) {
  return (
    <div className="loading" role="status">
      <div className="stack" style={{ alignItems: 'center' }}>
        <span className="spinner" />
        <span className="muted small">{label}</span>
      </div>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function EmptyState({ icon = 'info', title, description, action }) {
  return (
    <div className="empty">
      <div className="icon-wrap"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {description && <p style={{ maxWidth: 420 }}>{description}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = '', icon = 'info', children, action }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <Icon name={icon} size={18} />
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="icon-wrap" style={{ color: 'var(--danger)' }}><Icon name="alert" size={26} /></div>
      <h3>تعذّر تحميل البيانات</h3>
      <p>{error?.message ?? 'حصل خطأ غير متوقّع'}</p>
      {onRetry && <button type="button" className="btn secondary" onClick={onRetry}>حاول تاني</button>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon }) {
  return (
    <div className="card stat">
      <div className="row between">
        <span className="label">{label}</span>
        {icon && <Icon name={icon} size={18} style={{ color: 'var(--text-faint)' }} />}
      </div>
      <span className="value num" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="kv" style={{ margin: 0 }}>
      {items.filter((item) => item && item.value !== undefined && item.value !== null && item.value !== '').map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = 36 }) {
  const letter = (name ?? '').trim()[0] ?? '؟';
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>{letter}</span>;
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" className="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)}>
          {item.label}
          {item.count !== undefined && <span className="count num">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.page_size + 1;
  const to = Math.min(meta.page * meta.page_size, meta.total);
  return (
    <div className="pagination">
      <span className="num">{from}–{to} من {meta.total}</span>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn secondary sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          <Icon name="chevron-right" size={16} /> السابق
        </button>
        <span className="num muted small">{meta.page} / {meta.total_pages}</span>
        <button type="button" className="btn secondary sm" disabled={meta.page >= meta.total_pages} onClick={() => onPage(meta.page + 1)}>
          التالي <Icon name="chevron-left" size={16} />
        </button>
      </div>
    </div>
  );
}

/** مسار فتات: يُستخدم في الصفحات التفصيلية */
export function BackLink({ to, children, onClick }) {
  return (
    <a href={to} onClick={onClick} className="row small" style={{ gap: 4, color: 'var(--text-muted)', width: 'fit-content' }}>
      <Icon name="arrow-right" size={16} /> {children}
    </a>
  );
}
