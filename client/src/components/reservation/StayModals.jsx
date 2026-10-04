/**
 * نوافذ عمليات الإقامة في تفاصيل الحجز: دخول · خروج · إلغاء · عدم حضور · تعديل تواريخ · نقل غرفة.
 *
 * الأعراف: كل نافذة تفحص الشروط محليًّا (نفس شروط السيرفر) فيرى الموظف المشكلة قبل الضغط،
 * وتبقى رسالة السيرفر خط الدفاع الأخير. عند النجاح تستدعي `onDone(result)` ثم تُغلَق،
 * والصفحة تحدّث الكاش.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useProperty } from '../../context/PropertyContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  addDays, diffDays, formatDate, formatDayMonth, formatMoney, nightsLabel,
} from '../../lib/format.js';
import { HK_COLORS, HK_LABELS } from '../../lib/constants.js';
import {
  MAX_NIGHTS, checkInReview, checkOutReview, defaultMoveSegment, isIsoDate, isUnitReady, moveWindow, occupiedSummary,
} from '../../lib/reservations.js';
import {
  Button, Checkbox, Field, Input, KeyValue, Modal, MoneyInput, Notice, Select, Textarea,
} from '../ui/index.js';

const unitCodes = (segments) => segments.map((segment) => segment.unit_code).join('، ');

/* ═══════════════ تسجيل الدخول ═══════════════ */

export function CheckInModal({ reservation, today, currency, onClose, onDone, onPay }) {
  const { api } = useProperty();
  const toast = useToast();
  const review = checkInReview(reservation, today);
  const [early, setEarly] = useState(false);
  const [forceDirty, setForceDirty] = useState(false);
  const [message, setMessage] = useState(null);

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/check-in`, { early: review.early && early, force_dirty: forceDirty }),
    onSuccess: (result) => {
      toast.success(`تم تسجيل دخول ${result.reservation.guest_name}`);
      result.warnings?.forEach((warning) => toast.info(warning.message));
      onDone(result);
      onClose();
    },
    // الوصول المبكّر قد يصطدم بحجز آخر على الغرفة: نذكر من يشغلها
    onError: (error) => setMessage([error.message, occupiedSummary(error.errors?.occupied)].filter(Boolean).join(' — ')),
  });

  const blocked = review.ended || review.outOfOrder.length > 0
    || (review.early && !early)
    || (review.notReady.length > 0 && !forceDirty);

  return (
    <Modal
      open
      onClose={onClose}
      title="تسجيل دخول النزيل"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={blocked} onClick={() => mutation.mutate()}>تسجيل الدخول</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}

        <KeyValue items={[
          { label: 'النزيل', value: reservation.guest_name },
          { label: 'الغرفة', value: review.units.length > 0 ? unitCodes(review.units) : unitCodes(reservation.segments) },
          { label: 'الإقامة', value: <span className="range">{formatDate(reservation.check_in)} ← {formatDate(reservation.check_out)}</span> },
        ]}
        />

        {review.ended && <Notice tone="danger" icon="alert">فترة الحجز انتهت — مينفعش تسجّل دخول. سجّل «عدم حضور» أو عدّل التواريخ.</Notice>}

        {review.early && !review.ended && (
          <Notice tone="warning" icon="clock">
            <div className="stack sm">
              <span>الوصول المحجوز <b className="num">{formatDate(reservation.check_in)}</b> — النزيل وصل بدري.</span>
              <Checkbox
                label={`ابدأ الإقامة من النهارده (تتضاف ${nightsLabel(review.earlyNights)} للحجز وتتسعّر بالسعر الحالي)`}
                checked={early}
                onChange={(event) => setEarly(event.target.checked)}
              />
            </div>
          </Notice>
        )}

        {review.outOfOrder.length > 0 && (
          <Notice tone="danger" icon="wrench">
            الغرفة {unitCodes(review.outOfOrder)} خارج الخدمة — انقل النزيل لغرفة تانية الأول (من «نقل غرفة»).
          </Notice>
        )}

        {review.notReady.length > 0 && (
          <Notice tone="warning" icon="broom">
            <div className="stack sm">
              <span>
                {review.notReady.map((segment) => `${segment.unit_code} (${HK_LABELS[segment.housekeeping_status]})`).join('، ')} — لسه مش جاهزة للنزول.
              </span>
              <Checkbox label="أسمح بالدخول رغم عدم جاهزية الغرفة" checked={forceDirty} onChange={(event) => setForceDirty(event.target.checked)} />
            </div>
          </Notice>
        )}

        {reservation.balance_minor > 0 && (
          <Notice tone="info" icon="dollar" action={onPay && <Button size="sm" onClick={onPay}>تسجيل دفعة</Button>}>
            المتبقي على النزيل <b className="num">{formatMoney(reservation.balance_minor, currency)}</b>
          </Notice>
        )}

        {review.idMissing && <Notice icon="info">بيانات هوية النزيل غير مسجّلة — يفضّل تسجيلها من صفحة النزيل.</Notice>}
      </div>
    </Modal>
  );
}

/* ═══════════════ تسجيل الخروج ═══════════════ */

export function CheckOutModal({ reservation, today, currency, canOverride, onClose, onDone, onPay }) {
  const { api } = useProperty();
  const toast = useToast();
  const review = checkOutReview(reservation, today);
  const [early, setEarly] = useState(false);
  const [allowUnpaid, setAllowUnpaid] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/check-out`, {
      early_departure: review.canDepartEarly && early,
      allow_unpaid: allowUnpaid,
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: (result) => {
      toast.success(`تم تسجيل خروج ${result.reservation.guest_name}`);
      result.warnings?.forEach((warning) => toast.info(warning.message));
      onDone(result);
      onClose();
    },
    onError: (error) => setMessage(error.message),
  });

  const owes = review.balance > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="تسجيل خروج النزيل"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={owes && !allowUnpaid} onClick={() => mutation.mutate()}>تسجيل الخروج</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}

        <KeyValue items={[
          { label: 'النزيل', value: reservation.guest_name },
          { label: 'الغرفة', value: unitCodes(reservation.segments) },
          { label: 'الإجمالي', value: <span className="num">{formatMoney(reservation.total_minor, currency)}</span> },
          { label: 'المدفوع', value: <span className="num">{formatMoney(reservation.paid_minor, currency)}</span> },
        ]}
        />

        {owes ? (
          <Notice tone="danger" icon="dollar" action={onPay && <Button size="sm" onClick={onPay}>تسجيل دفعة</Button>}>
            <div className="stack sm">
              <span>على النزيل رصيد <b className="num">{formatMoney(review.balance, currency)}</b></span>
              {canOverride && <Checkbox label="أسمح بالمغادرة برصيد غير مسدّد" checked={allowUnpaid} onChange={(event) => setAllowUnpaid(event.target.checked)} />}
            </div>
          </Notice>
        ) : <Notice tone="success" icon="check">الحساب مسدّد بالكامل.</Notice>}

        {review.canDepartEarly && (
          <Notice tone="warning" icon="clock">
            <div className="stack sm">
              <span>موعد المغادرة <b className="num">{formatDate(reservation.check_out)}</b> — فاضل {nightsLabel(review.remainingNights)}.</span>
              <Checkbox
                label="خروج مبكّر: حرّر الليالي المتبقية للبيع (السعر يتعدّل لعدد الليالي الفعلية)"
                checked={early}
                onChange={(event) => setEarly(event.target.checked)}
              />
            </div>
          </Notice>
        )}

        <Field label="ملاحظة (اختياري)">{(p) => <Input {...p} value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} />}</Field>
      </div>
    </Modal>
  );
}

/* ═══════════════ إلغاء · عدم حضور ═══════════════ */

/** إلغاء وعدم الحضور متشابهان: غرامة اختيارية، وبعدها يُحرَّر المخزون ويُحسب المرتجع */
function ReleaseModal({ reservation, currency, kind, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const cancelling = kind === 'cancel';
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState(null);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState(null);

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/${cancelling ? 'cancel' : 'no-show'}`, cancelling
      ? { reason: reason.trim(), fee_minor: fee ?? 0, notify: notify && Boolean(reservation.guest_email) }
      : { fee_minor: fee ?? 0, ...(reason.trim() ? { note: reason.trim() } : {}) }),
    onSuccess: (result) => {
      toast.success(cancelling ? 'تم إلغاء الحجز' : 'تم تسجيل عدم الحضور');
      if (result.refund_due_minor > 0) toast.info(`مستحق ردّ ${formatMoney(result.refund_due_minor, currency)} للنزيل`, { duration: 9000 });
      onDone(result);
      onClose();
    },
    onError: (error) => setMessage(error.message),
  });

  const reasonOk = !cancelling || reason.trim().length >= 3;
  return (
    <Modal
      open
      onClose={onClose}
      title={cancelling ? `إلغاء الحجز ${reservation.code}` : `عدم حضور — ${reservation.code}`}
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="danger" loading={mutation.isPending} disabled={!reasonOk} onClick={() => mutation.mutate()}>
            {cancelling ? 'تأكيد الإلغاء' : 'تأكيد عدم الحضور'}
          </Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Notice tone="warning" icon="alert">
          هتتحرّر الغرفة للبيع فورًا.
          {reservation.paid_minor > 0 && <> المدفوع حتى الآن <b className="num">{formatMoney(reservation.paid_minor, currency)}</b> — بعد خصم الغرامة بيظهر المستحق ردّه، وتقدر تسجّل مرتجعًا من قسم الدفعات.</>}
        </Notice>
        <Field label={cancelling ? 'سبب الإلغاء' : 'ملاحظة'} required={cancelling}>
          {(p) => <Textarea {...p} data-autofocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} />}
        </Field>
        <Field label={cancelling ? 'غرامة إلغاء (اختياري)' : 'غرامة عدم حضور (اختياري)'} hint="بتتضاف على الحساب كرسم بدون ضريبة">
          {() => <MoneyInput value={fee} onChange={setFee} />}
        </Field>
        {cancelling && reservation.guest_email && (
          <Checkbox label="إبلاغ النزيل بالإلغاء بالإيميل" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
        )}
      </div>
    </Modal>
  );
}

export const CancelModal = (props) => <ReleaseModal {...props} kind="cancel" />;
export const NoShowModal = (props) => <ReleaseModal {...props} kind="no_show" />;

/* ═══════════════ تعديل التواريخ ═══════════════ */

export function ChangeDatesModal({ reservation, today, canOverride, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const inHouse = reservation.status === 'checked_in';
  const [dates, setDates] = useState({ check_in: reservation.check_in, check_out: reservation.check_out });
  const [allowReassign, setAllowReassign] = useState(false);
  const [overrideRestrictions, setOverrideRestrictions] = useState(false);
  const [problem, setProblem] = useState(null);
  // الخيارات الإضافية تظهر حين يحتاجها السيرفر وتبقى ظاهرة بعد ذلك (لا تختفي مع كل محاولة)
  const [offered, setOffered] = useState({ reassign: false, override: false });

  const valid = isIsoDate(dates.check_in) && isIsoDate(dates.check_out) && dates.check_out > dates.check_in;
  const nights = valid ? diffDays(dates.check_in, dates.check_out) : null;
  const changed = dates.check_in !== reservation.check_in || dates.check_out !== reservation.check_out;

  let issue = null;
  if (!valid) issue = 'اختار تاريخي وصول ومغادرة صحيحين (المغادرة بعد الوصول).';
  else if (nights > MAX_NIGHTS) issue = `الحدّ الأقصى للإقامة ${MAX_NIGHTS} ليلة.`;
  else if (!inHouse && dates.check_in < today && dates.check_in !== reservation.check_in) issue = 'تاريخ الوصول الجديد في الماضي.';
  else if (inHouse && dates.check_out < today) issue = 'تاريخ المغادرة الجديد قبل اليوم.';

  const mutation = useMutation({
    mutationFn: () => {
      // وصول فات موعده ولم يُسجَّل دخوله: نبقي تاريخه كما هو بتصريح «أثر رجعي» صريح
      const override = {};
      if (!inHouse && dates.check_in === reservation.check_in && reservation.check_in < today) override.past = true;
      if (overrideRestrictions) override.restrictions = true;
      return api.post(`/reservations/${reservation.id}/change-dates`, {
        check_in: dates.check_in,
        check_out: dates.check_out,
        allow_reassign: allowReassign,
        ...(Object.keys(override).length > 0 ? { override } : {}),
      });
    },
    onSuccess: (updated) => {
      toast.success('تم تعديل التواريخ');
      onDone({ reservation: updated });
      onClose();
    },
    onError: (error) => {
      if (error.code === 'UNIT_NOT_AVAILABLE') {
        setOffered((current) => ({ ...current, reassign: true }));
        setProblem({ message: `${error.message}. ${occupiedSummary(error.errors?.occupied)}` });
      } else if (error.code === 'STAY_RESTRICTED') {
        setOffered((current) => ({ ...current, override: true }));
        setProblem({ message: 'التواريخ الجديدة بتخالف قيود التسعير:', violations: error.errors?.violations?.map((violation) => violation.message) ?? [] });
      } else {
        setProblem({ message: error.message });
      }
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="تعديل تواريخ الحجز"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={Boolean(issue) || !changed} onClick={() => { setProblem(null); mutation.mutate(); }}>حفظ التواريخ</Button>
        </>
      )}
    >
      <div className="stack">
        {problem && (
          <Notice tone="danger" icon="alert">
            <div className="stack sm">
              <span>{problem.message}</span>
              {problem.violations?.length > 0 && <ul style={{ margin: 0, paddingInlineStart: 18 }}>{problem.violations.map((text) => <li key={text}>{text}</li>)}</ul>}
            </div>
          </Notice>
        )}
        {(offered.reassign || offered.override) && (
          <div className="stack sm">
            {offered.reassign && <Checkbox label="لو الغرفة مشغولة، انقل الحجز لغرفة فاضية من نفس النوع" checked={allowReassign} onChange={(event) => setAllowReassign(event.target.checked)} />}
            {offered.override && (canOverride
              ? <Checkbox label="أتجاوز قيود التسعير وأكمل التعديل" checked={overrideRestrictions} onChange={(event) => setOverrideRestrictions(event.target.checked)} />
              : <span className="small muted">تجاوز القيود للمدير أو المالك فقط.</span>)}
          </div>
        )}

        <div className="grid cols-2">
          <Field label="الوصول" hint={inHouse ? 'النزيل مقيم — تاريخ الوصول ثابت' : undefined}>
            {(p) => <Input {...p} type="date" value={dates.check_in} disabled={inHouse} onChange={(event) => setDates((current) => ({ ...current, check_in: event.target.value }))} />}
          </Field>
          <Field label="المغادرة">
            {(p) => <Input {...p} type="date" min={isIsoDate(dates.check_in) ? addDays(dates.check_in, 1) : undefined} value={dates.check_out} onChange={(event) => setDates((current) => ({ ...current, check_out: event.target.value }))} />}
          </Field>
        </div>

        {issue && changed ? <Notice tone="warning" icon="alert">{issue}</Notice> : (
          <p className="small muted">
            من {nightsLabel(reservation.nights)} إلى {nights ? nightsLabel(nights) : '—'}.
            {' '}الليالي الباقية بتحتفظ بسعرها وقت الحجز، والليالي المضافة بتتسعّر بالأسعار الحالية.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ═══════════════ نقل غرفة ═══════════════ */

export function MoveModal({ reservation, today, segmentId: wantedId = null, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const movable = reservation.segments.filter((candidate) => {
    const span = moveWindow(reservation, candidate, today);
    return span.min <= span.max;
  });
  const initial = movable.find((candidate) => candidate.id === wantedId)
    ?? defaultMoveSegment({ ...reservation, segments: movable }, today) ?? movable[0];

  const [segmentId, setSegmentId] = useState(initial?.id ?? null);
  const segment = movable.find((candidate) => candidate.id === segmentId) ?? movable[0];
  const bounds = segment ? moveWindow(reservation, segment, today) : null;
  const [effective, setEffective] = useState(bounds?.min ?? '');
  const [typeId, setTypeId] = useState(segment?.unit_type_id ?? null);
  const [targetId, setTargetId] = useState(null);
  const [forceDirty, setForceDirty] = useState(false);
  const [message, setMessage] = useState(null);

  // تغيير الجزء يعيد التاريخ والنوع والاختيار لقيمها الافتراضية لهذا الجزء
  const pickSegment = (id) => {
    const next = movable.find((candidate) => candidate.id === id);
    setSegmentId(id);
    setEffective(moveWindow(reservation, next, today).min);
    setTypeId(next.unit_type_id);
    setTargetId(null);
  };

  const types = useQuery({ queryKey: ['unit-types', api.id], queryFn: () => api.get('/unit-types', { active: true }), staleTime: 60_000 });
  const effectiveOk = Boolean(segment) && isIsoDate(effective) && effective >= bounds.min && effective <= bounds.max;

  const candidates = useQuery({
    queryKey: ['available-units', api.id, typeId, effective, segment?.check_out, reservation.id],
    queryFn: () => api.get('/availability/units', {
      unit_type_id: typeId, check_in: effective, check_out: segment.check_out, exclude_reservation_id: reservation.id,
    }),
    enabled: Boolean(typeId) && effectiveOk,
    staleTime: 10_000,
  });
  const units = (candidates.data ?? []).filter((unit) => unit.id !== segment?.unit_id);
  const target = units.find((unit) => unit.id === targetId) ?? null;
  const typeChanged = segment && typeId !== segment.unit_type_id;
  const needsForce = Boolean(target) && !isUnitReady(target.housekeeping_status) && reservation.status === 'checked_in' && effective <= today;

  // الغرفة المختارة اختفت من الفاضية بعد تغيير التاريخ/النوع
  useEffect(() => {
    if (candidates.data && targetId && !units.some((unit) => unit.id === targetId)) setTargetId(null);
  }, [candidates.data, targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/move`, {
      segment_id: segment.id, to_unit_id: targetId, effective_date: effective, force_dirty: forceDirty,
    }),
    onSuccess: (result) => {
      toast.success(`تم نقل النزيل إلى الغرفة ${target.code}`);
      onDone(result);
      onClose();
    },
    onError: (error) => setMessage([error.message, occupiedSummary(error.errors?.occupied)].filter(Boolean).join(' — ')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="نقل غرفة"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={!target || !effectiveOk || (needsForce && !forceDirty)} onClick={() => { setMessage(null); mutation.mutate(); }}>
            نقل
          </Button>
        </>
      )}
    >
      {!segment ? (
        <Notice icon="info">مفيش ليالٍ قادمة ينفع نقلها في الحجز ده.</Notice>
      ) : (
        <div className="stack">
          {message && <Notice tone="danger" icon="alert">{message}</Notice>}

          <div className="grid cols-2">
            {movable.length > 1 && (
              <Field label="الجزء المراد نقله">
                {(p) => (
                  <Select {...p} value={segment.id} onChange={(event) => pickSegment(Number(event.target.value))}>
                    {movable.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.unit_code} — {formatDayMonth(candidate.check_in)} ← {formatDayMonth(candidate.check_out)}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field label="من أي ليلة" hint={`الغرفة الحالية ${segment.unit_code} حتى ${formatDayMonth(segment.check_out)}`}>
              {(p) => <Input {...p} type="date" min={bounds.min} max={bounds.max} value={effective} onChange={(event) => { setEffective(event.target.value); setTargetId(null); }} />}
            </Field>
            <Field label="النوع">
              {(p) => (
                <Select {...p} value={typeId ?? ''} onChange={(event) => { setTypeId(Number(event.target.value)); setTargetId(null); }}>
                  {(types.data ?? []).map((type) => <option key={type.id} value={type.id}>{type.name_ar}{type.id === segment.unit_type_id ? ' (الحالي)' : ''}</option>)}
                </Select>
              )}
            </Field>
          </div>

          {typeChanged && <Notice icon="info">نوع مختلف: الليالي المنقولة هتتسعّر بسعر النوع الجديد، وبقية الحجز بتفضل بسعرها.</Notice>}

          <div className="stack sm">
            <span className="label">الغرفة الجديدة</span>
            {!effectiveOk ? <p className="muted small">اختار تاريخ نقل صحيح داخل فترة الجزء.</p> : candidates.isLoading ? (
              <p className="muted small">جارٍ البحث عن الغرف الفاضية…</p>
            ) : units.length === 0 ? (
              <Notice tone="warning" icon="alert">مفيش غرف فاضية من النوع ده في الفترة دي.</Notice>
            ) : (
              <div className="row wrap" style={{ gap: 'var(--sp-2)' }}>
                {units.map((unit) => (
                  <button key={unit.id} type="button" className="chip" aria-pressed={unit.id === targetId} onClick={() => setTargetId(unit.id)} title={HK_LABELS[unit.housekeeping_status]}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: HK_COLORS[unit.housekeeping_status], flex: 'none' }} />
                    <span className="num">{unit.code}</span>
                    {unit.floor && <span className="muted">دور {unit.floor}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {needsForce && (
            <Notice tone="warning" icon="broom">
              <div className="stack sm">
                <span>الغرفة {target.code} ({HK_LABELS[target.housekeeping_status]}) لسه مش جاهزة.</span>
                <Checkbox label="أنقل النزيل رغم عدم جاهزيتها" checked={forceDirty} onChange={(event) => setForceDirty(event.target.checked)} />
              </div>
            </Notice>
          )}
        </div>
      )}
    </Modal>
  );
}
