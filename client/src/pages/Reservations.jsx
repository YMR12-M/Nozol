import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProperty } from '../context/PropertyContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useDebounce, useDocumentTitle } from '../lib/hooks.js';
import { formatDayMonth, formatMoney, formatPhone, nightsLabel } from '../lib/format.js';
import { SOURCE_LABELS, STATUS_LABELS, STATUS_ORDER } from '../lib/constants.js';
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, PageHead, Pagination, Plates, SearchInput,
  Select, StatusBadge,
} from '../components/ui/index.js';

const PAGE_SIZE = 25;

/** المرشّحات تعيش في الرابط: تُحفَظ عند الرجوع، وتُشارَك، وتعمل معها روابط لوحة اليوم */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? '',
    status: (params.get('status') ?? '').split(',').filter(Boolean),
    source: params.get('source') ?? '',
    in_house: params.get('in_house') === 'true',
    unpaid: params.get('unpaid') === 'true',
    check_in_from: params.get('check_in_from') ?? '',
    check_in_to: params.get('check_in_to') ?? '',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(params.get('page')) || 1),
  };

  /** يدمج تغييرات المرشّحات ويعيد الصفحة للأولى (إلا لو التغيير هو الصفحة نفسها) */
  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      const empty = value === '' || value === false || value === null || (Array.isArray(value) && value.length === 0);
      if (empty) next.delete(key); else next.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }
  return [filters, update, () => setParams(new URLSearchParams(), { replace: true })];
}

export default function Reservations() {
  useDocumentTitle('الحجوزات');
  const { api, property } = useProperty();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [filters, update, clear] = useFilters();

  // نص البحث يُكتب فورًا ويُرسَل للسيرفر بعد توقّف الكتابة
  const [text, setText] = useState(filters.q);
  const debounced = useDebounce(text, 350);
  useEffect(() => { if (debounced !== filters.q) update({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(filters.q); }, [filters.q]);

  const query = useQuery({
    queryKey: ['reservations', api.id, filters],
    queryFn: () => api.page('/reservations', { ...filters, page_size: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const currency = property?.currency ?? 'EGP';
  const active = filters.q || filters.status.length || filters.source || filters.in_house || filters.unpaid || filters.check_in_from || filters.check_in_to;
  const toggleStatus = (status) => update({ status: filters.status.includes(status) ? filters.status.filter((s) => s !== status) : [...filters.status, status] });

  return (
    <div className="page">
      <PageHead
        title="الحجوزات"
        description={query.data ? `${query.data.meta.total} حجز${active ? ' مطابق للبحث' : ''}` : undefined}
        actions={can('reservations.write') && <Button variant="primary" icon="plus" onClick={() => navigate('/reservations/new')}>حجز جديد</Button>}
      />

      <Card>
        <div className="stack">
          <div className="toolbar">
            <div className="search"><SearchInput value={text} onChange={setText} placeholder="اسم النزيل، رقم الحجز، الهاتف…" aria-label="بحث في الحجوزات" /></div>
            <Field label="المصدر">{(p) => (
              <Select {...p} value={filters.source} onChange={(event) => update({ source: event.target.value })}>
                <option value="">كل المصادر</option>
                {Object.entries(SOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            )}</Field>
            <Field label="الوصول من">{(p) => <Input {...p} type="date" value={filters.check_in_from} onChange={(event) => update({ check_in_from: event.target.value })} />}</Field>
            <Field label="الوصول إلى">{(p) => <Input {...p} type="date" value={filters.check_in_to} min={filters.check_in_from || undefined} onChange={(event) => update({ check_in_to: event.target.value })} />}</Field>
            <Field label="الترتيب">{(p) => (
              <Select {...p} value={filters.order} onChange={(event) => update({ order: event.target.value })}>
                <option value="desc">الأحدث وصولًا أولًا</option>
                <option value="asc">الأقدم وصولًا أولًا</option>
              </Select>
            )}</Field>
          </div>

          <div className="row wrap" style={{ gap: 'var(--sp-2)' }}>
            {STATUS_ORDER.map((status) => (
              <button key={status} type="button" className="chip" aria-pressed={filters.status.includes(status)} onClick={() => toggleStatus(status)}>
                {STATUS_LABELS[status]}
              </button>
            ))}
            <span className="faint">|</span>
            <Checkbox label="مقيمون الآن" checked={filters.in_house} onChange={(event) => update({ in_house: event.target.checked })} />
            <Checkbox label="عليهم رصيد" checked={filters.unpaid} onChange={(event) => update({ unpaid: event.target.checked })} />
            {active && <Button variant="ghost" size="sm" onClick={clear}>مسح المرشّحات</Button>}
          </div>
        </div>
      </Card>

      <Card flush>
        {query.isLoading ? <Loading /> : query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : query.data.rows.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={active ? 'مفيش حجوزات مطابقة' : 'لسه مفيش حجوزات'}
            description={active ? 'جرّب تغيّر المرشّحات أو تمسحها.' : 'ابدأ بأول حجز من التقويم أو زر «حجز جديد».'}
            action={active ? <Button onClick={clear}>مسح المرشّحات</Button> : (can('reservations.write') && <Button variant="primary" icon="plus" onClick={() => navigate('/reservations/new')}>حجز جديد</Button>)}
          />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
              <table className="table ledger wide hover">
                <thead>
                  <tr>
                    <th>الحجز</th><th>النزيل</th><th>الوحدة</th><th>الإقامة</th><th>الحالة</th>
                    <th style={{ textAlign: 'end' }}>الإجمالي</th><th style={{ textAlign: 'end' }}>المتبقي</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((reservation) => (
                    <tr key={reservation.id} onClick={() => navigate(`/reservations/${reservation.id}`)}>
                      <td>
                        <Link to={`/reservations/${reservation.id}`} className="code-pill" onClick={(event) => event.stopPropagation()}>{reservation.code}</Link>
                        <div className="xsmall muted">{SOURCE_LABELS[reservation.source] ?? reservation.source}</div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <b className="nowrap">{reservation.guest_name}</b>
                          {Boolean(reservation.is_vip) && <Badge tone="accent">VIP</Badge>}
                        </div>
                        <div className="xsmall muted num">{formatPhone(reservation.guest_phone)}</div>
                      </td>
                      <td><Plates codes={reservation.unit_codes} /></td>
                      <td>
                        <span className="range">{formatDayMonth(reservation.check_in)} ← {formatDayMonth(reservation.check_out)}</span>
                        <div className="xsmall muted">{nightsLabel(reservation.nights)} · {reservation.adults + reservation.children} أفراد</div>
                      </td>
                      <td><StatusBadge status={reservation.status} /></td>
                      <td className="num" style={{ textAlign: 'end' }}>{formatMoney(reservation.total_minor, currency)}</td>
                      <td className="num" style={{ textAlign: 'end', color: reservation.balance_minor > 0 && !['cancelled', 'no_show'].includes(reservation.status) ? 'var(--danger-text)' : undefined, fontWeight: 600 }}>
                        {reservation.balance_minor > 0 ? formatMoney(reservation.balance_minor, currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={query.data.meta} onPage={(page) => update({ page })} />
          </>
        )}
      </Card>
    </div>
  );
}
