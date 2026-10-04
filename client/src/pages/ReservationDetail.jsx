import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProperty } from '../context/PropertyContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import {
  diffDays, formatClock, formatDate, formatDateTime, formatDayMonth, formatMoney, formatPhone, formatWeekday, nightsLabel,
  peopleLabel, todayIn, whatsappLink,
} from '../lib/format.js';
import { ID_TYPE_LABELS, METHOD_LABELS, SOURCE_LABELS, STATUS_LABELS } from '../lib/constants.js';
import { Icon } from '../lib/icons.jsx';
import { holdRemaining, promoDiscountMinor, reservationActions, totalsRows } from '../lib/reservations.js';
import {
  Avatar, BackLink, Badge, Button, Card, ErrorState, KeyValue, Loading, Menu, MenuItem, Notice, PageHead, Plate, Stamp, useConfirm,
} from '../components/ui/index.js';
import {
  CancelModal, ChangeDatesModal, CheckInModal, CheckOutModal, MoveModal, NoShowModal,
} from '../components/reservation/StayModals.jsx';
import {
  EditDetailsModal, FolioItemModal, InvoiceModal, PaymentModal,
} from '../components/reservation/BillingModals.jsx';

/** كل ما يتأثّر بتغيير حجز: قوائمه ولوحة اليوم والتقويم وعدّادات الشريط */
const INVALIDATE = ['reservations', 'today', 'calendar', 'nav-counters', 'available-units'];

/** وقت الآن يتجدّد كل دقيقة (لعدّاد مهلة الحجز المعلّق) */
function useNow(interval = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

const struck = { textDecoration: 'line-through', color: 'var(--text-faint)' };

export default function ReservationDetail() {
  const { id } = useParams();
  const { api, property } = useProperty();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const now = useNow();
  const [modal, setModal] = useState(null);

  const key = ['reservation', api.id, id];
  const query = useQuery({ queryKey: key, queryFn: () => api.get(`/reservations/${id}`) });
  useDocumentTitle(query.data ? `حجز ${query.data.code}` : 'تفاصيل الحجز');

  /** ما رجع من السيرفر حجزًا كاملًا نضعه في الكاش فورًا، وغيره نعيد جلبه */
  const refresh = (result) => {
    if (result?.reservation) queryClient.setQueryData(key, result.reservation);
    else queryClient.invalidateQueries({ queryKey: key });
    INVALIDATE.forEach((name) => queryClient.invalidateQueries({ queryKey: [name] }));
  };

  const confirmReservation = useMutation({
    mutationFn: () => api.post(`/reservations/${id}/confirm`, { send_confirmation: true }),
    onSuccess: (reservation) => { toast.success('تم تأكيد الحجز'); refresh({ reservation }); },
    onError: (error) => toast.error(error.message),
  });

  /** إلغاء بند/دفعة/فاتورة: لا حذف للفلوس أبدًا — إلغاء بسبب مكتوب يبقى في السجل */
  const voiding = useMutation({
    mutationFn: ({ url, reason }) => api.post(url, { reason }),
    onSuccess: (_result, { done }) => { toast.success(done); refresh(); },
    onError: (error) => toast.error(error.message),
  });

  async function askConfirm() {
    const r = query.data;
    const answer = await confirm({
      title: 'تأكيد الحجز؟',
      message: r.guest_email ? 'هيتحوّل الحجز لمؤكّد وهيتبعت للنزيل إيميل تأكيد.' : 'هيتحوّل الحجز لمؤكّد.',
      confirmLabel: 'تأكيد الحجز',
    });
    if (answer) confirmReservation.mutate();
  }

  async function askVoid({ title, message, url, done }) {
    const answer = await confirm({
      title, message, danger: true, confirmLabel: 'إلغاء', cancelLabel: 'رجوع', reason: { label: 'سبب الإلغاء', required: true },
    });
    if (answer) voiding.mutate({ url, reason: answer.reason, done });
  }

  const goBack = (event) => {
    event.preventDefault();
    // فُتحت الصفحة مباشرةً (بلا تنقّل سابق داخل التطبيق)؟ نرجع للقائمة بدل الخروج من التطبيق
    if (location.key === 'default') navigate('/reservations'); else navigate(-1);
  };

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div className="page">
        <BackLink to="/reservations" onClick={(event) => { event.preventDefault(); navigate('/reservations'); }}>الحجوزات</BackLink>
        <ErrorState error={query.error} onRetry={query.refetch} />
      </div>
    );
  }

  const r = query.data;
  const currency = r.currency;
  const today = todayIn(property?.timezone ?? 'Africa/Cairo');
  const actions = reservationActions(r, { today, can });
  const canOverride = ['owner', 'manager'].includes(user.role);
  const released = ['cancelled', 'no_show'].includes(r.status);
  const hold = r.status === 'pending' ? holdRemaining(r.hold_expires_at, now) : null;
  const balance = r.balance_minor;
  const { rows: totalRows, included } = totalsRows(r, { inclusive: Boolean(property?.prices_include_tax) });
  const promoPart = promoDiscountMinor(r);
  const open = (name, extra = {}) => setModal({ name, ...extra });
  const close = () => setModal(null);

  const lateArrival = r.status === 'confirmed' && today > r.check_in && today < r.check_out;
  const stayEnded = r.status === 'confirmed' && today >= r.check_out;
  const overstayed = r.status === 'checked_in' && today > r.check_out;

  const waText = `أهلًا ${r.guest_name}، بخصوص حجزك رقم ${r.code} في ${property?.name_ar ?? ''} من ${formatDate(r.check_in)} إلى ${formatDate(r.check_out)}.`;

  return (
    <div className="page">
      <BackLink to="/reservations" onClick={goBack}>رجوع</BackLink>

      <PageHead
        title={(
          <span className="row wrap" style={{ gap: 10 }}>
            حجز <span className="code-pill">{r.code}</span>
            <Stamp status={r.status} />
            {Boolean(r.is_vip) && <Badge tone="accent">VIP</Badge>}
          </span>
        )}
        description={`${r.guest_name} · ${nightsLabel(r.nights)} · ${peopleLabel(r.adults, r.children)}`}
        actions={(
          <>
            {actions.confirm && <Button variant="primary" icon="check" loading={confirmReservation.isPending} onClick={askConfirm}>تأكيد الحجز</Button>}
            {actions.checkIn && <Button variant="primary" icon="login" onClick={() => open('checkin')}>تسجيل دخول</Button>}
            {actions.checkOut && <Button variant="primary" icon="logout" onClick={() => open('checkout')}>تسجيل خروج</Button>}
            <Menu trigger={<Button icon="more">المزيد</Button>}>
              {actions.changeDates && <MenuItem icon="calendar" onClick={() => open('dates')}>تعديل التواريخ</MenuItem>}
              {actions.move && <MenuItem icon="swap" onClick={() => open('move')}>نقل غرفة</MenuItem>}
              {actions.edit && <MenuItem icon="edit" onClick={() => open('edit')}>تعديل البيانات والملاحظات</MenuItem>}
              <div className="sep" />
              <Link to={`/print/registration/${r.id}`}><Icon name="print" size={16} />استمارة التسجيل (طباعة)</Link>
              {r.guest_phone && <a href={whatsappLink(r.guest_phone, waText)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} />رسالة واتساب للنزيل</a>}
              {(actions.noShow || actions.cancel) && <div className="sep" />}
              {actions.noShow && <MenuItem icon="ban" danger onClick={() => open('noshow')}>عدم حضور</MenuItem>}
              {actions.cancel && <MenuItem icon="close" danger onClick={() => open('cancel')}>إلغاء الحجز</MenuItem>}
            </Menu>
          </>
        )}
      />

      <div className="stack sm">
        {hold && (
          <Notice tone={hold.urgent ? 'danger' : 'warning'} icon="clock" action={actions.confirm && <Button size="sm" variant="primary" onClick={askConfirm}>تأكيد</Button>}>
            حجز معلّق — {hold.expired ? 'انتهت المهلة وهيتحرّر قريبًا إلا لو اتأكّد.' : `باقي ${hold.label} على تحريره تلقائيًّا.`}
            {r.paid_minor > 0 && ' عليه مدفوعات فمش هيتحرّر تلقائيًّا.'}
          </Notice>
        )}
        {lateArrival && <Notice tone="warning" icon="clock">كان المفروض يصل <b className="num">{formatDate(r.check_in)}</b> — سجّل دخوله أو سجّل «عدم حضور».</Notice>}
        {stayEnded && <Notice tone="warning" icon="alert">فترة الحجز انتهت ولم يُسجَّل دخول — سجّل «عدم حضور» أو ألغِ الحجز.</Notice>}
        {overstayed && <Notice tone="danger" icon="alert">النزيل تجاوز موعد المغادرة (<b className="num">{formatDate(r.check_out)}</b>) — سجّل خروجه أو مدّد الإقامة.</Notice>}
        {Boolean(r.is_blacklisted) && <Notice tone="danger" icon="ban">النزيل ده في القائمة السوداء.</Notice>}
        {released && (
          <Notice tone="danger" icon="ban">
            {STATUS_LABELS[r.status]}{r.cancel_reason ? `: ${r.cancel_reason}` : ''}{r.cancelled_at ? ` — ${formatDateTime(r.cancelled_at)}` : ''}
          </Notice>
        )}
        {balance < 0 && (
          <Notice tone="info" icon="dollar" action={actions.addPayment && <Button size="sm" onClick={() => open('payment', { type: 'refund' })}>تسجيل مرتجع</Button>}>
            مدفوع زيادة عن الإجمالي — مستحق ردّ <b className="num">{formatMoney(-balance, currency)}</b> للنزيل.
          </Notice>
        )}
      </div>

      <div className="res-layout">
        <div className="stack lg">
          {/* الإقامة */}
          <Card title="الإقامة" actions={actions.changeDates && <Button size="sm" icon="calendar" onClick={() => open('dates')}>تعديل التواريخ</Button>}>
            <div className="stack">
              <div className="facts">
                <div className="stack sm">
                  <span className="label">الوصول</span>
                  <b>{formatWeekday(r.check_in)}</b>
                  <span>{formatDate(r.check_in)}</span>
                  {property?.check_in_time && <span className="xsmall muted">من {formatClock(property.check_in_time)}</span>}
                </div>
                <div className="stack sm">
                  <span className="label">المغادرة</span>
                  <b>{formatWeekday(r.check_out)}</b>
                  <span>{formatDate(r.check_out)}</span>
                  {property?.check_out_time && <span className="xsmall muted">حتى {formatClock(property.check_out_time)}</span>}
                </div>
                <div className="stack sm">
                  <span className="label">المدة</span>
                  <b>{nightsLabel(r.nights)}</b>
                  <span className="muted small">{peopleLabel(r.adults, r.children)}</span>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>الغرفة</th><th>الفترة</th><th>الضيوف</th><th style={{ textAlign: 'end' }}>الحساب</th><th /></tr>
                  </thead>
                  <tbody>
                    {r.segments.map((segment) => {
                      const here = r.status === 'checked_in' && segment.check_in <= today && segment.check_out > today;
                      return (
                        <tr key={segment.id}>
                          <td>
                            <div className="row" style={{ gap: 6 }}><Plate>{segment.unit_code}</Plate>{here && <Badge tone="success">النزيل هنا</Badge>}</div>
                            <div className="xsmall muted">{segment.unit_type_name_ar}</div>
                          </td>
                          <td className="nowrap">
                            <span className="range">{formatDayMonth(segment.check_in)} ← {formatDayMonth(segment.check_out)}</span>
                            <div className="xsmall muted">{nightsLabel(diffDays(segment.check_in, segment.check_out))}</div>
                          </td>
                          <td className="nowrap">{peopleLabel(segment.adults, segment.children)}</td>
                          <td className="num" style={{ textAlign: 'end', ...(released ? struck : {}) }}>
                            {formatMoney(segment.rooms_minor + segment.extra_guest_minor + segment.meal_minor, currency)}
                          </td>
                          <td className="actions">
                            {actions.move && <Button size="sm" variant="ghost" icon="swap" onClick={() => open('move', { segmentId: segment.id })}>نقل</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <details>
                <summary className="small muted" style={{ cursor: 'pointer' }}>تفاصيل سعر كل ليلة</summary>
                <div className="stack" style={{ marginTop: 'var(--sp-3)' }}>
                  {r.segments.map((segment) => (
                    <div key={segment.id} className="stack sm">
                      {r.segments.length > 1 && <span className="xsmall muted">الغرفة <span className="num">{segment.unit_code}</span></span>}
                      <div className="nights-strip">
                        {segment.nights.map((night) => {
                          const total = night.room_minor + night.extra_guest_minor + night.meal_minor;
                          return (
                            <span
                              key={night.night}
                              className="night-chip"
                              title={`غرفة ${formatMoney(night.room_minor, currency)}${night.extra_guest_minor ? ` · أفراد ${formatMoney(night.extra_guest_minor, currency)}` : ''}${night.meal_minor ? ` · وجبات ${formatMoney(night.meal_minor, currency)}` : ''}`}
                            >
                              <span className="num">{formatDayMonth(night.night)}</span> · <b className="num">{formatMoney(total, currency, { compact: true })}</b>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </Card>

          {/* الحساب */}
          <Card title="الحساب" actions={actions.addItem && <Button size="sm" icon="plus" onClick={() => open('item')}>إضافة بند</Button>} flush>
            <div className="table-wrap">
              <table className="table ledger">
                <thead><tr><th>البند</th><th style={{ textAlign: 'end' }}>المبلغ</th><th /></tr></thead>
                <tbody>
                  {!released && r.segments.map((segment) => (
                    <FolioStayRows key={segment.id} segment={segment} currency={currency} />
                  ))}
                  {promoPart > 0 && (
                    <tr>
                      <td>خصم ترويجي {r.promo_code && <span className="code-pill">{r.promo_code}</span>}</td>
                      <td className="num" style={{ textAlign: 'end', color: 'var(--success-text)' }}>{formatMoney(-promoPart, currency)}</td>
                      <td />
                    </tr>
                  )}
                  {r.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="row wrap" style={{ gap: 8 }}>
                          <span style={item.voided_at ? struck : undefined}>{item.description}</span>
                          {item.voided_at && <Badge tone="danger">ملغي</Badge>}
                        </div>
                        <div className="xsmall muted">
                          {Number(item.quantity) !== 1 && <span className="num">× {Number(item.quantity)} · </span>}
                          <span className="num">{formatDate(item.posted_on)}</span>{item.posted_by_name ? ` · ${item.posted_by_name}` : ''}
                          {item.voided_at && item.void_reason ? ` · السبب: ${item.void_reason}` : ''}
                        </div>
                      </td>
                      <td className="num" style={{ textAlign: 'end', ...(item.voided_at ? struck : item.amount_minor < 0 ? { color: 'var(--success-text)' } : {}) }}>
                        {formatMoney(item.amount_minor, currency)}
                      </td>
                      <td className="actions">
                        {actions.voidItem && !item.voided_at && (
                          <Button size="sm" variant="ghost" icon="trash" aria-label="إلغاء البند" title="إلغاء البند" onClick={() => askVoid({
                            title: 'إلغاء البند؟', message: `${item.description} — ${formatMoney(item.amount_minor, currency)}`, url: `/reservations/${r.id}/items/${item.id}/void`, done: 'تم إلغاء البند',
                          })}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                  {released && r.items.length === 0 && <tr><td colSpan={3} className="muted center">لا بنود على الحساب.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {/* الدفعات */}
          <Card
            title={`الدفعات (${r.payments.filter((payment) => !payment.voided_at).length})`}
            flush
            actions={actions.addPayment && (
              <>
                <Button size="sm" variant="primary" icon="plus" onClick={() => open('payment')}>تسجيل دفعة</Button>
                {r.paid_minor > 0 && <Button size="sm" onClick={() => open('payment', { type: 'refund' })}>مرتجع</Button>}
              </>
            )}
          >
            {r.payments.length === 0 ? <p className="muted center" style={{ padding: 'var(--sp-5)' }}>لم تُسجَّل دفعات بعد.</p> : (
              <div className="table-wrap">
                <table className="table ledger">
                  <thead><tr><th>الوقت</th><th>الطريقة</th><th style={{ textAlign: 'end' }}>المبلغ</th><th>بواسطة</th><th /></tr></thead>
                  <tbody>
                    {r.payments.map((payment) => {
                      const refund = payment.type === 'refund';
                      return (
                        <tr key={payment.id}>
                          <td className="nowrap">{formatDateTime(payment.received_at)}</td>
                          <td>
                            <div className="row wrap" style={{ gap: 8 }}>
                              <span style={payment.voided_at ? struck : undefined}>{METHOD_LABELS[payment.method] ?? payment.method}</span>
                              {refund && <Badge tone="danger">مرتجع</Badge>}
                              {payment.voided_at && <Badge tone="danger">ملغي</Badge>}
                            </div>
                            <div className="xsmall muted">
                              {payment.reference && <span className="ltr">{payment.reference}</span>}
                              {payment.note ? `${payment.reference ? ' · ' : ''}${payment.note}` : ''}
                              {payment.voided_at && payment.void_reason ? ` · السبب: ${payment.void_reason}` : ''}
                            </div>
                          </td>
                          <td className="num" style={{ textAlign: 'end', fontWeight: 600, ...(payment.voided_at ? struck : refund ? { color: 'var(--danger-text)' } : {}) }}>
                            {formatMoney(refund ? -payment.amount_minor : payment.amount_minor, currency)}
                          </td>
                          <td className="small muted">{payment.received_by_name ?? '—'}</td>
                          <td className="actions">
                            {actions.voidPayment && !payment.voided_at && (
                              <Button size="sm" variant="ghost" icon="trash" aria-label="إلغاء الدفعة" title="إلغاء الدفعة" onClick={() => askVoid({
                                title: refund ? 'إلغاء المرتجع؟' : 'إلغاء الدفعة؟',
                                message: `${METHOD_LABELS[payment.method]} — ${formatMoney(payment.amount_minor, currency)} — الدفعات في الورديات المقفولة تُصحَّح بمرتجع لا بإلغاء.`,
                                url: `/reservations/${r.id}/payments/${payment.id}/void`, done: 'تم إلغاء الدفعة',
                              })}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* الفواتير */}
          {r.status !== 'pending' && (
            <Card title="الفواتير" actions={actions.issueInvoice && <Button size="sm" icon="receipt" onClick={() => open('invoice')}>إصدار فاتورة</Button>} flush>
              {r.invoices.length === 0 ? (
                <p className="muted center" style={{ padding: 'var(--sp-5)' }}>لم تُصدَر فاتورة بعد.</p>
              ) : (
                r.invoices.map((invoice) => (
                  <div key={invoice.id} className="list-row">
                    <div className="main">
                      <div className="row wrap" style={{ gap: 8 }}>
                        <span className="code-pill">{invoice.number}</span>
                        {invoice.status === 'void' ? <Badge tone="danger">ملغاة</Badge> : <Badge tone="success">سارية</Badge>}
                        <span className="muted small">{invoice.bill_to_name}</span>
                      </div>
                      <div className="xsmall muted num">{formatDateTime(invoice.issued_at)}</div>
                    </div>
                    <b className="num" style={invoice.status === 'void' ? struck : undefined}>{formatMoney(invoice.total_minor, currency)}</b>
                    <Link className="btn secondary sm" to={`/print/invoice/${invoice.id}`}>عرض / طباعة</Link>
                    {actions.voidInvoice && invoice.status === 'issued' && (
                      <Button size="sm" variant="ghost" icon="trash" aria-label="إلغاء الفاتورة" title="إلغاء الفاتورة" onClick={() => askVoid({
                        title: `إلغاء الفاتورة ${invoice.number}؟`, message: 'بعد الإلغاء تقدر تصدر فاتورة جديدة بالأرقام الحالية.', url: `/invoices/${invoice.id}/void`, done: 'تم إلغاء الفاتورة',
                      })}
                      />
                    )}
                  </div>
                ))
              )}
            </Card>
          )}

          {/* الملاحظات */}
          {(r.guest_notes || r.internal_notes || actions.edit) && (
            <Card title="الملاحظات" actions={actions.edit && <Button size="sm" icon="edit" onClick={() => open('edit')}>تعديل</Button>}>
              <div className="stack">
                <div>
                  <span className="label">طلبات النزيل</span>
                  <p className={r.guest_notes ? 'soft' : 'faint'} style={{ whiteSpace: 'pre-wrap' }}>{r.guest_notes || 'لا يوجد.'}</p>
                </div>
                <div>
                  <span className="label">ملاحظات داخلية</span>
                  <p className={r.internal_notes ? 'soft' : 'faint'} style={{ whiteSpace: 'pre-wrap' }}>{r.internal_notes || 'لا يوجد.'}</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        <aside className="res-aside">
          <Card title="النزيل" actions={can('guests.read') && <Link className="small" to={`/guests/${r.guest_id}`}>الملف ←</Link>}>
            <div className="stack">
              <div className="row">
                <Avatar name={r.guest_name} size={44} />
                <div className="grow"><b>{r.guest_name}</b></div>
                {Boolean(r.is_vip) && <Badge tone="accent">VIP</Badge>}
              </div>
              <KeyValue items={[
                r.guest_phone && {
                  label: 'الهاتف',
                  value: (
                    <span className="row" style={{ gap: 8 }}>
                      <a href={`tel:${r.guest_phone}`} className="num">{formatPhone(r.guest_phone)}</a>
                      <a href={whatsappLink(r.guest_phone, waText)} target="_blank" rel="noreferrer" aria-label="واتساب" title="واتساب"><Icon name="whatsapp" size={16} /></a>
                    </span>
                  ),
                },
                r.guest_email && { label: 'البريد', value: <a href={`mailto:${r.guest_email}`} className="ltr">{r.guest_email}</a> },
                r.guest_nationality && { label: 'الجنسية', value: r.guest_nationality },
                r.guest_id_number && { label: ID_TYPE_LABELS[r.guest_id_type] ?? 'الهوية', value: <span className="num">{r.guest_id_number}</span> },
              ]}
              />
              {!r.guest_id_number && <p className="xsmall muted">بيانات الهوية غير مسجّلة.</p>}
            </div>
          </Card>

          <Card title="الإجماليات">
            <div className="stack">
              <div className="totals">
                {totalRows.map((row) => (
                  <div className="line" key={row.key}>
                    <span className="muted">{row.label}</span>
                    <span className="num" style={row.minor < 0 ? { color: 'var(--success-text)' } : undefined}>{formatMoney(row.minor, currency)}</span>
                  </div>
                ))}
                <div className="line total"><span>الإجمالي</span><span className="num">{formatMoney(r.total_minor, currency)}</span></div>
                {included.map((row) => (
                  <div className="line xsmall muted" key={row.key}><span>{row.label}</span><span className="num">{formatMoney(row.minor, currency)}</span></div>
                ))}
                <div className="line"><span className="muted">المدفوع</span><span className="num">{formatMoney(r.paid_minor, currency)}</span></div>
                <div className={`line ${balance > 0 ? 'due' : 'paid-ok'}`}>
                  <span>{balance > 0 ? 'المتبقي' : balance < 0 ? 'زيادة مدفوعة' : 'مسدّد بالكامل'}</span>
                  {balance !== 0 && <span className="num">{formatMoney(Math.abs(balance), currency)}</span>}
                </div>
              </div>
              {r.status === 'pending' && r.deposit_due_minor > 0 && (
                <div className="row between small"><span className="muted">العربون المطلوب</span><b className="num">{formatMoney(r.deposit_due_minor, currency)}</b></div>
              )}
              {actions.addPayment && balance > 0 && <Button variant="primary" block icon="dollar" onClick={() => open('payment')}>تسجيل دفعة</Button>}
            </div>
          </Card>

          <Card title="بيانات الحجز">
            <KeyValue items={[
              { label: 'المصدر', value: SOURCE_LABELS[r.source] ?? r.source },
              r.external_ref && { label: 'رقم المنصّة', value: <span className="ltr">{r.external_ref}</span> },
              r.rate_plan_name_ar && { label: 'خطة السعر', value: r.rate_plan_name_ar },
              r.promo_code && { label: 'كود الخصم', value: <span className="code-pill">{r.promo_code}</span> },
              r.expected_arrival && { label: 'الوصول المتوقّع', value: <span className="num">{formatClock(r.expected_arrival)}</span> },
              { label: 'أنشأه', value: `${r.created_by_name ?? 'النظام'} · ${formatDateTime(r.created_at)}` },
              r.checked_in_at && { label: 'دخل', value: <span className="num">{formatDateTime(r.checked_in_at)}</span> },
              r.checked_out_at && { label: 'خرج', value: <span className="num">{formatDateTime(r.checked_out_at)}</span> },
              r.public_code && { label: 'رمز النزيل', value: <span className="code-pill">{r.public_code}</span> },
            ]}
            />
          </Card>
        </aside>
      </div>

      {modal?.name === 'checkin' && <CheckInModal reservation={r} today={today} currency={currency} onClose={close} onDone={refresh} onPay={() => open('payment')} />}
      {modal?.name === 'checkout' && <CheckOutModal reservation={r} today={today} currency={currency} canOverride={canOverride} onClose={close} onDone={refresh} onPay={() => open('payment')} />}
      {modal?.name === 'cancel' && <CancelModal reservation={r} currency={currency} onClose={close} onDone={refresh} />}
      {modal?.name === 'noshow' && <NoShowModal reservation={r} currency={currency} onClose={close} onDone={refresh} />}
      {modal?.name === 'dates' && <ChangeDatesModal reservation={r} today={today} canOverride={canOverride} onClose={close} onDone={refresh} />}
      {modal?.name === 'move' && <MoveModal reservation={r} today={today} segmentId={modal.segmentId} onClose={close} onDone={refresh} />}
      {modal?.name === 'payment' && <PaymentModal reservation={r} currency={currency} initialType={modal.type} onClose={close} onDone={refresh} />}
      {modal?.name === 'item' && <FolioItemModal reservation={r} currency={currency} onClose={close} onDone={refresh} />}
      {modal?.name === 'invoice' && <InvoiceModal reservation={r} onClose={close} onDone={refresh} />}
      {modal?.name === 'edit' && <EditDetailsModal reservation={r} onClose={close} onDone={refresh} />}
    </div>
  );
}

/** صفوف الإقامة في كشف الحساب: الغرفة، ثم الأفراد الإضافيون والوجبات لو وُجدت */
function FolioStayRows({ segment, currency }) {
  const nights = diffDays(segment.check_in, segment.check_out);
  const label = `${segment.unit_type_name_ar} — ${segment.unit_code} (${nightsLabel(nights)}: ${formatDayMonth(segment.check_in)} ← ${formatDayMonth(segment.check_out)})`;
  const lines = [
    { key: 'room', text: `إقامة: ${label}`, minor: segment.rooms_minor },
    { key: 'extra', text: 'أفراد إضافيون', minor: segment.extra_guest_minor },
    { key: 'meal', text: 'وجبات', minor: segment.meal_minor },
  ].filter((line) => line.minor !== 0);
  return lines.map((line) => (
    <tr key={line.key}>
      <td className={line.key === 'room' ? '' : 'muted small'} style={line.key === 'room' ? undefined : { paddingInlineStart: 'var(--sp-6)' }}>{line.text}</td>
      <td className="num" style={{ textAlign: 'end' }}>{formatMoney(line.minor, currency)}</td>
      <td />
    </tr>
  ));
}
