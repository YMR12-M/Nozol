import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProperty } from '../context/PropertyContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import {
  addDays, formatDayMonth, formatMonthYear, formatWeekdayShort, isWeekend, todayIn,
} from '../lib/format.js';
import { barPlacement, buildTape, monthSpans, tapeRowTemplate } from '../lib/calendar.js';
import { BLOCK_REASON_LABELS, HK_COLORS, HK_LABELS, STATUS_LABELS } from '../lib/constants.js';
import { Icon } from '../lib/icons.jsx';
import {
  Button, ErrorState, Field, Input, Loading, Modal, Notice, PageHead, Plate, Segmented, Select, useConfirm,
} from '../components/ui/index.js';

const LEGEND = ['pending', 'confirmed', 'checked_in', 'checked_out'];

function BlockModal({ unit, from, onClose }) {
  const { api } = useProperty();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm({ start_date: from, end_date: addDays(from, 1), reason: 'maintenance', note: '' });
  const [message, setMessage] = useState(null);

  const mutation = useMutation({
    mutationFn: () => api.post(`/units/${unit.id}/blocks`, { ...form.values, note: form.values.note.trim() || null }),
    onSuccess: () => {
      toast.success(`اتحجبت الوحدة ${unit.code}`);
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      onClose();
    },
    onError: (error) => {
      const occupied = error.errors?.occupied;
      setMessage(Array.isArray(occupied) && occupied.length > 0
        ? `الوحدة مشغولة: ${[...new Set(occupied.map((o) => o.guest_name ?? 'حجب سابق'))].join('، ')}`
        : form.fail(error));
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`حجب الوحدة ${unit.code}`}
      footer={(
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>حجب</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <div className="grid cols-2">
          <Field label="من (الليلة الأولى)" error={form.errors.start_date}>{(p) => <Input {...p} type="date" value={form.values.start_date} onChange={form.on('start_date')} />}</Field>
          <Field label="إلى (يوم العودة للبيع)" error={form.errors.end_date}>{(p) => <Input {...p} type="date" min={addDays(form.values.start_date, 1)} value={form.values.end_date} onChange={form.on('end_date')} />}</Field>
        </div>
        <Field label="السبب">{(p) => <Select {...p} value={form.values.reason} onChange={form.on('reason')}>{['maintenance', 'owner_use', 'other'].map((r) => <option key={r} value={r}>{BLOCK_REASON_LABELS[r]}</option>)}</Select>}</Field>
        <Field label="ملاحظة">{(p) => <Input {...p} value={form.values.note} onChange={form.on('note')} placeholder="مثال: تغيير المكيّف" />}</Field>
      </div>
    </Modal>
  );
}

export default function CalendarPage() {
  useDocumentTitle('التقويم');
  const { api, property } = useProperty();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const today = useMemo(() => todayIn(property?.timezone ?? 'Africa/Cairo'), [property?.timezone]);
  const [days, setDays] = useState(21);
  const [from, setFrom] = useState(() => addDays(today, -2));
  const [typeFilter, setTypeFilter] = useState('');
  const [blockFor, setBlockFor] = useState(null);

  const to = addDays(from, days - 1);
  const query = useQuery({
    queryKey: ['calendar', api.id, from, to],
    queryFn: () => api.get('/calendar', { from, to }),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });

  const removeBlock = useMutation({
    mutationFn: (blockId) => api.del(`/blocks/${blockId}`),
    onSuccess: () => { toast.success('اترفع الحجب'); queryClient.invalidateQueries({ queryKey: ['calendar'] }); },
    onError: (error) => toast.error(error.message),
  });

  const tape = useMemo(() => (query.data
    ? buildTape({ units: query.data.units, stays: query.data.stays, blocks: query.data.blocks, from, to, typeFilter })
    : null), [query.data, from, to, typeFilter]);

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const canBook = can('reservations.write');
  const months = monthSpans(tape.days);

  async function askRemoveBlock(item) {
    const answer = await confirm({
      title: 'رفع الحجب؟',
      message: `الوحدة هتبقى متاحة للحجز من ${formatDayMonth(item.start)} حتى ${formatDayMonth(item.end)}.`,
      confirmLabel: 'رفع الحجب',
    });
    if (answer) removeBlock.mutate(item.block_id);
  }

  return (
    <div className="page full">
      <PageHead
        title="تقويم الإشغال"
        description="كل غرفة وكل ليلة — اضغط على خانة فاضية لحجز جديد، أو على حجز لفتحه."
        actions={canBook && <Button variant="primary" icon="plus" onClick={() => navigate('/reservations/new')}>حجز جديد</Button>}
      />

      <div className="toolbar">
        <div className="row" style={{ gap: 6 }}>
          <Button icon="chevron-right" aria-label="الأسبوع السابق" onClick={() => setFrom(addDays(from, -7))} />
          <Button onClick={() => setFrom(addDays(today, -2))}>اليوم</Button>
          <Button icon="chevron-left" aria-label="الأسبوع التالي" onClick={() => setFrom(addDays(from, 7))} />
        </div>
        <Field label="من تاريخ">{(p) => <Input {...p} type="date" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} />}</Field>
        <Field label="العرض">{() => <Segmented value={days} onChange={setDays} label="عدد الأيام" options={[{ value: 14, label: '14 يوم' }, { value: 21, label: '21 يوم' }, { value: 31, label: '31 يوم' }]} />}</Field>
        {tape.types.length > 1 && (
          <Field label="النوع">{(p) => <Select {...p} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">كل الأنواع</option>{tape.types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>}</Field>
        )}
      </div>

      <div className="legend" aria-label="دليل الألوان">
        {LEGEND.map((status) => <span key={status}><i style={{ background: `var(--st-${status}-bar)` }} />{STATUS_LABELS[status]}</span>)}
        <span><i style={{ background: 'var(--ink-300)' }} />مجحوبة</span>
        <span><i style={{ background: 'var(--brass-500)' }} />تقويم خارجي</span>
      </div>

      {tape.rows.length === 0 ? (
        <Notice icon="info">لسه مفيش غرف — أضفها من «الغرف والوحدات».</Notice>
      ) : (
        <div className="tape" style={{ '--days': days }}>
          <div className="tape-grid" style={{ gridTemplateRows: tapeRowTemplate(tape.rows) }}>
            <div className="tape-corner">الوحدة</div>
            {months.map((month) => (
              <div key={month.key} className="tape-month" style={{ gridColumn: `${month.index + 2} / span ${month.span}` }}>{formatMonthYear(month.day)}</div>
            ))}
            {tape.days.map((day, index) => (
              <div key={day} className={`tape-day ${isWeekend(day) ? 'weekend' : ''} ${day === query.data.today ? 'today' : ''}`} style={{ gridColumn: index + 2 }}>
                <span>{formatWeekdayShort(day)}</span><b className="num">{Number(day.slice(8))}</b>
              </div>
            ))}

            {tape.rows.map((row) => (row.kind === 'group'
              ? <div key={`g${row.typeId}`} className="tape-group" style={{ gridRow: row.row }}><span>{row.name}<span className="faint num">({row.count})</span></span></div>
              : (
                <UnitRow
                  key={row.unit.id}
                  row={row}
                  days={tape.days}
                  from={from}
                  span={days}
                  today={query.data.today}
                  canBook={canBook}
                  canBlock={can('units.write')}
                  onBook={(day) => navigate(`/reservations/new?unit=${row.unit.id}&type=${row.unit.unit_type_id}&check_in=${day}&check_out=${addDays(day, 1)}`)}
                  onOpen={(id) => navigate(`/reservations/${id}`)}
                  onBlockUnit={() => setBlockFor(row.unit)}
                  onRemoveBlock={askRemoveBlock}
                />
              )))}

            <div className="tape-foot label" style={{ gridRow: tape.footerRow }}>الإشغال</div>
            {tape.occupancy.map((cell, index) => {
              const ratio = cell.available > 0 ? cell.occupied / cell.available : 0;
              const tone = ratio >= 1 ? 'full' : ratio >= 0.7 ? 'busy' : '';
              return (
                <div
                  key={cell.day}
                  className={`tape-foot ${tone}`}
                  style={{ gridRow: tape.footerRow, gridColumn: index + 2 }}
                  title={`${formatDayMonth(cell.day)}: ${cell.occupied} مشغولة من ${cell.available} متاحة${cell.held ? ` + ${cell.held} معلّقة` : ''}`}
                >
                  <span className="num">{cell.occupied}/{cell.available}</span>
                  {cell.held > 0 && <small className="num">+{cell.held}</small>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {blockFor && <BlockModal unit={blockFor} from={from} onClose={() => setBlockFor(null)} />}
    </div>
  );
}

function UnitRow({ row, days, from, span, today, canBook, canBlock, onBook, onOpen, onBlockUnit, onRemoveBlock }) {
  const { unit, items } = row;
  const outOfOrder = unit.status === 'out_of_order';
  const bookable = canBook && !outOfOrder;

  return (
    <>
      <div className="tape-label" style={{ gridRow: row.row }} title={`${HK_LABELS[unit.housekeeping_status]}${outOfOrder ? ' — خارج الخدمة' : ''}`}>
        <span className="dot" style={{ background: HK_COLORS[unit.housekeeping_status] }} />
        <Plate size="sm">{unit.code}</Plate>
        {outOfOrder && <span className="badge danger">خارج الخدمة</span>}
        {canBlock && (
          <button
            type="button"
            className="btn ghost icon sm"
            style={{ marginInlineStart: 'auto' }}
            aria-label={`حجب الوحدة ${unit.code}`}
            title="حجب الوحدة (صيانة / استخدام شخصي)"
            onClick={onBlockUnit}
          >
            <Icon name="ban" size={15} />
          </button>
        )}
      </div>

      {days.map((day, index) => (
        <div
          key={day}
          className={`tape-cell ${isWeekend(day) ? 'weekend' : ''} ${day === today ? 'today' : ''} ${bookable ? '' : 'disabled'}`}
          style={{ gridRow: row.row, gridColumn: index + 2 }}
          title={bookable ? `حجز جديد — ${formatDayMonth(day)}` : undefined}
          aria-hidden="true"
          onClick={() => bookable && onBook(day)}
        />
      ))}

      {items.map((item) => {
        const place = barPlacement(from, span, item.start, item.end);
        if (!place.visible) return null;
        const style = { gridRow: row.row, gridColumn: place.column };
        const clip = `${place.clipStart ? 'clip-start' : ''} ${place.clipEnd ? 'clip-end' : ''}`;

        if (item.kind === 'block') {
          const label = item.external ? 'تقويم خارجي' : BLOCK_REASON_LABELS[item.reason];
          return (
            <button
              key={`b${item.block_id}`}
              type="button"
              className={`tape-bar block ${item.external ? 'external' : ''} ${clip}`}
              style={style}
              title={`${label}${item.note ? ` — ${item.note}` : ''}${item.external || !canBlock ? '' : '\nاضغط لرفع الحجب'}`}
              onClick={() => { if (!item.external && canBlock) onRemoveBlock(item); }}
            >
              <span>{label}</span>
            </button>
          );
        }

        const reservation = item.reservation;
        const owes = reservation.total_minor > reservation.paid_minor && reservation.status !== 'checked_out';
        return (
          <button
            key={`s${item.segment_id}`}
            type="button"
            className={`tape-bar st-${reservation.status} ${clip}`}
            style={style}
            title={`${reservation.guest_name} — ${reservation.code}\n${STATUS_LABELS[reservation.status]}${owes ? ' · عليه رصيد' : ''}`}
            onClick={() => onOpen(reservation.id)}
          >
            {Boolean(reservation.is_vip) && <Icon name="star" size={12} />}
            <span dir="auto">{reservation.guest_name}</span>
            {owes && <span aria-label="رصيد مستحق" title="رصيد مستحق">●</span>}
          </button>
        );
      })}
    </>
  );
}
