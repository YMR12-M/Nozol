import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProperty } from '../context/PropertyContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDebounce, useDocumentTitle } from '../lib/hooks.js';
import {
  addDays, diffDays, formatClock, formatDate, formatMoney, formatWeekday, nightsLabel, peopleLabel, todayIn,
} from '../lib/format.js';
import { METHOD_LABELS, SOURCE_LABELS, STAFF_SOURCES } from '../lib/constants.js';
import {
  MAX_NIGHTS, MAX_ROOMS, buildReservationPayload, isChosen, isIsoDate, lineProblem, newLine, occupiedSummary,
  pricingRoom, quoteTotals, restrictionLines, stayIssue, totalsRows,
} from '../lib/reservations.js';
import {
  Button, Card, Checkbox, Field, Input, MoneyInput, Notice, PageHead, Segmented, Select, Skeleton, Stepper, Switch, Textarea,
} from '../components/ui/index.js';
import GuestPicker from '../components/reservation/GuestPicker.jsx';
import RoomLine from '../components/reservation/RoomLine.jsx';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EXTERNAL_SOURCES = ['booking_com', 'airbnb', 'other'];
/** كل ما يتأثّر بحجز جديد: القوائم، لوحة اليوم، التقويم، التوفّر، النزلاء، عدّادات الشريط */
const INVALIDATE = ['reservations', 'today', 'calendar', 'availability', 'available-units', 'guests', 'nav-counters'];

/** معاملات الرابط القادمة من التقويم (خانة فاضية) أو من صفحة نزيل */
function readParams(params, today) {
  const wantedIn = params.get('check_in');
  const checkIn = isIsoDate(wantedIn) && wantedIn >= today ? wantedIn : today;
  const wantedOut = params.get('check_out');
  const checkOut = isIsoDate(wantedOut) && wantedOut > checkIn ? wantedOut : addDays(checkIn, 1);
  const id = (key) => Number(params.get(key)) || null;
  return { checkIn, checkOut, typeId: id('type'), unitId: id('unit'), guestId: id('guest') };
}

export default function NewReservation() {
  useDocumentTitle('حجز جديد');
  const { api, property } = useProperty();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const currency = property?.currency ?? 'EGP';
  const canOverride = ['owner', 'manager'].includes(user.role);
  const today = useMemo(() => todayIn(property?.timezone ?? 'Africa/Cairo'), [property?.timezone]);
  const [initial] = useState(() => readParams(params, today));

  const [stay, setStay] = useState({ check_in: initial.checkIn, check_out: initial.checkOut });
  const [promoText, setPromoText] = useState('');
  const [promoError, setPromoError] = useState(null);
  const nextKey = useRef(1);
  const [lines, setLines] = useState(() => [newLine(0, initial.typeId ? { unit_type_id: initial.typeId, unit_id: initial.unitId } : {})]);
  const [guest, setGuest] = useState(null);
  const guestForm = useForm({ full_name: '', phone: '', email: '', nationality: '', id_type: '', id_number: '' });
  const details = useForm({
    status: 'confirmed', source: 'direct', external_ref: '', expected_arrival: '', guest_notes: '', internal_notes: '', send_confirmation: true,
  });
  const [deposit, setDeposit] = useState({ enabled: false, method: 'cash', amount_minor: null, reference: '' });
  const [override, setOverride] = useState({ restrictions: false, blacklist: false });
  const [formError, setFormError] = useState(null);
  const [serverRestrictions, setServerRestrictions] = useState([]);
  const [blacklistHit, setBlacklistHit] = useState(false);

  /* ── نزيل جاء من صفحة النزيل (?guest=) ── */
  const preselected = useQuery({
    queryKey: ['guest', api.id, initial.guestId],
    queryFn: () => api.get(`/guests/${initial.guestId}`),
    enabled: Boolean(initial.guestId),
  });
  useEffect(() => {
    if (preselected.data) setGuest((current) => current ?? { kind: 'existing', data: preselected.data });
  }, [preselected.data]);

  /* ── الإقامة: التواريخ تُحدَّث فورًا، والطلبات بعد توقّف الكتابة ── */
  const queryStay = useDebounce(stay, 350);
  const normalizedPromo = promoText.trim().toUpperCase();
  const promo = useDebounce(normalizedPromo, 500);
  const stayProblem = stayIssue(stay, today);
  const datesValid = !stayIssue(queryStay, today);
  const nights = isIsoDate(stay.check_in) && isIsoDate(stay.check_out) ? Math.max(1, diffDays(stay.check_in, stay.check_out)) : 1;

  // أي تعديل يُسقِط رسالة الخطأ القديمة (لم تعد تصف ما على الشاشة)
  const clearErrors = () => { setFormError(null); setServerRestrictions([]); };

  const setCheckIn = (value) => {
    clearErrors();
    setStay((current) => {
      if (!isIsoDate(value)) return { ...current, check_in: value };
      const kept = isIsoDate(current.check_in) && isIsoDate(current.check_out) ? Math.max(1, diffDays(current.check_in, current.check_out)) : 1;
      return { check_in: value, check_out: addDays(value, kept) }; // نحافظ على عدد الليالي
    });
  };
  const setCheckOut = (value) => { clearErrors(); setStay((current) => ({ ...current, check_out: value })); };
  const setNights = (count) => {
    clearErrors();
    setStay((current) => (isIsoDate(current.check_in) ? { ...current, check_out: addDays(current.check_in, count) } : current));
  };

  /* ── الغرف ── */
  const updateLine = (key, patch) => {
    clearErrors();
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };
  const addLine = () => {
    const key = nextKey.current;
    nextKey.current += 1;
    setLines((current) => (current.length >= MAX_ROOMS ? current : [...current, newLine(key)]));
  };
  const removeLine = (key) => setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));

  // بحث التوافر لكل «عدد ضيوف» مختلف مرّة واحدة (سطران بنفس العدد يتشاركان النتيجة بلا استعلام مكرّر)
  const occupancies = [...new Set(lines.map((line) => `${line.adults}:${line.children}`))];
  const occupancyQueries = useQueries({
    queries: occupancies.map((key) => {
      const [adults, children] = key.split(':').map(Number);
      return {
        queryKey: ['availability', api.id, queryStay.check_in, queryStay.check_out, adults, children, promo],
        queryFn: () => api.get('/availability', {
          check_in: queryStay.check_in, check_out: queryStay.check_out, adults, children, promo_code: promo,
        }),
        enabled: datesValid,
        placeholderData: (previous) => previous,
        staleTime: 10_000,
      };
    }),
  });
  const availabilityFor = (line) => occupancyQueries[occupancies.indexOf(`${line.adults}:${line.children}`)];

  // كم غرفة اختارها كل نوع (لخصمها من الوحدات الفاضية) وأي وحدات بعينها محجوزة في السطور
  const countByType = new Map();
  for (const line of lines) if (isChosen(line)) countByType.set(line.unit_type_id, (countByType.get(line.unit_type_id) ?? 0) + 1);
  const usedByOthersFor = (line) => (typeId) => (countByType.get(typeId) ?? 0) - (isChosen(line) && line.unit_type_id === typeId ? 1 : 0);

  const lineProblems = lines.map((line) => {
    const { data, isPlaceholderData } = availabilityFor(line);
    if (!data || isPlaceholderData) return null;
    const result = data.results.find((candidate) => candidate.unit_type.id === line.unit_type_id);
    return lineProblem(line, result, usedByOthersFor(line)(line.unit_type_id));
  });

  /* ── السعر: معاينة السيرفر لحجز كامل — نفس مسار الإنشاء (خصم واحد على المجموع، وقيود كل غرفة) ── */
  const chosenIndexes = lines.flatMap((line, index) => (isChosen(line) ? [index] : []));
  const quote = useQuery({
    queryKey: ['reservation-quote', api.id, queryStay.check_in, queryStay.check_out, promo, chosenIndexes.map((index) => pricingRoom(lines[index]))],
    queryFn: () => api.post('/reservations/quote', {
      check_in: queryStay.check_in,
      check_out: queryStay.check_out,
      promo_code: promo || undefined,
      rooms: chosenIndexes.map((index) => pricingRoom(lines[index])),
    }),
    enabled: datesValid && chosenIndexes.length > 0,
    placeholderData: (previous) => previous,
  });
  const preview = chosenIndexes.length > 0 && quote.data && !quote.isPlaceholderData ? quote.data : null;
  const combined = preview ? quoteTotals(preview) : null;
  const promoInfo = preview && promo && promo === normalizedPromo ? preview.promo : null;
  const inputsSettled = queryStay === stay && promo === normalizedPromo;
  // مخالفات المعاينة مرقّمة بترتيب الغرف المختارة؛ نرجعها لأرقام سطورها في الصفحة
  const previewViolations = preview ? restrictionLines(preview.violations.map((entry) => ({ ...entry, room: chosenIndexes[entry.room] })), lines.length) : [];

  /* ── النزيل والبريد ── */
  const guestEmail = guest?.kind === 'existing' ? guest.data.email : guestForm.values.email.trim();
  const canEmail = Boolean(guestEmail) && (guest?.kind !== 'new' || EMAIL.test(guestEmail));
  const chosenGuestBlacklisted = guest?.kind === 'existing' && guest.data.is_blacklisted;
  const needsRestrictionOverride = Boolean(preview && !preview.bookable) || serverRestrictions.length > 0;

  /* ── ما يمنع الحفظ (يُعرض للموظف قائمةً) ── */
  const blockers = [];
  if (stayProblem) blockers.push(stayProblem);
  if (lines.some((line) => !isChosen(line))) blockers.push(lines.length > 1 ? 'اختار غرفة وخطة لكل سطر' : 'اختار الغرفة والخطة');
  if (lineProblems.some(Boolean)) blockers.push('في غرفة محتاجة مراجعة');
  if (!guest) blockers.push('حدّد النزيل');
  else if (guest.kind === 'new' && guestForm.values.full_name.trim().length < 2) blockers.push('اكتب اسم النزيل');
  if (needsRestrictionOverride && !(canOverride && override.restrictions)) {
    blockers.push(canOverride ? 'الإقامة بتخالف قيود التسعير — فعّل التجاوز لو مقصود' : 'الإقامة بتخالف قيود التسعير — المدير أو المالك فقط يتجاوزها');
  }
  if (chosenGuestBlacklisted && !(canOverride && override.blacklist)) blockers.push('النزيل في القائمة السوداء');
  if (deposit.enabled && !(deposit.amount_minor > 0)) blockers.push('اكتب مبلغ الدفعة المقدّمة');
  if (deposit.enabled && combined && deposit.amount_minor > combined.total_minor) blockers.push('الدفعة أكبر من إجمالي الحجز');
  if (!stayProblem && chosenIndexes.length > 0 && !(preview && inputsSettled)) blockers.push(quote.isError ? quote.error.message : 'جارٍ حساب السعر…');

  /* ── الحفظ ── */
  const create = useMutation({
    mutationFn: (payload) => api.post('/reservations', payload),
    onSuccess: (reservation) => {
      toast.success(`تم إنشاء الحجز ${reservation.code}`);
      INVALIDATE.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      navigate(`/reservations/${reservation.id}`, { replace: true });
    },
    onError: (error) => {
      const fields = error.errors && typeof error.errors === 'object' && !Array.isArray(error.errors) ? error.errors : {};

      if (error.code === 'STAY_RESTRICTED') {
        setServerRestrictions(restrictionLines(fields.rooms, lines.length));
        setFormError(canOverride ? 'الإقامة بتخالف قيود التسعير — فعّل التجاوز لو مقصود.' : 'الإقامة بتخالف قيود التسعير، والتجاوز للمدير أو المالك فقط.');
      } else if (error.code === 'UNIT_NOT_AVAILABLE' || error.code === 'NO_AVAILABILITY') {
        setFormError([error.message, occupiedSummary(fields.occupied)].filter(Boolean).join(' — '));
        ['availability', 'available-units'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      } else if (error.code === 'GUEST_BLACKLISTED') {
        setBlacklistHit(true);
        setFormError(`${error.message}${canOverride ? ' — فعّل التجاوز لو مقصود.' : ' — الحجز له محتاج مدير أو مالك.'}`);
      } else {
        // أخطاء الحقول تُوزَّع على حقولها؛ ما لا حقل له يُلحَق بالرسالة العامة
        const entries = Object.entries(fields).filter(([, value]) => typeof value === 'string');
        const pick = (keys) => Object.fromEntries(entries.filter(([key]) => keys.includes(key)));
        const guestErrors = Object.fromEntries(entries.filter(([key]) => key.startsWith('guest.')).map(([key, value]) => [key.slice(6), value]));
        const detailErrors = pick(['external_ref', 'expected_arrival', 'guest_notes', 'internal_notes']);
        if (Object.keys(guestErrors).length > 0) guestForm.setErrors(guestErrors);
        if (Object.keys(detailErrors).length > 0) details.setErrors(detailErrors);
        if (typeof fields.promo_code === 'string') setPromoError(fields.promo_code);

        const placed = new Set(['promo_code', ...Object.keys(guestErrors).map((key) => `guest.${key}`), ...Object.keys(detailErrors)]);
        const others = entries.filter(([key]) => !placed.has(key)).map(([key, value]) => `${key}: ${value}`);
        setFormError(others.length > 0 ? `${error.message} (${others.join('، ')})` : error.message);
      }
    },
  });

  function submit() {
    setFormError(null);
    setPromoError(null);
    guestForm.setErrors({});
    create.mutate(buildReservationPayload({
      stay,
      lines,
      guest,
      guestValues: guestForm.values,
      promoCode: promoText,
      details: { ...details.values, send_confirmation: details.values.send_confirmation && canEmail },
      deposit,
      override: {
        restrictions: canOverride && override.restrictions && needsRestrictionOverride,
        blacklist: canOverride && override.blacklist && (chosenGuestBlacklisted || blacklistHit),
      },
    }));
  }

  // الرابط مفتوح لأي مستخدم مسجَّل، والسيرفر هو من يمنع في النهاية؛ نوضّح هنا بدل نموذج لن يُحفَظ
  if (!can('reservations.write')) {
    return <div className="page"><Notice tone="warning" icon="lock">مفيش عندك صلاحية إنشاء حجوزات — كلّم المدير.</Notice></div>;
  }

  const dv = details.values;
  const inclusive = Boolean(property?.prices_include_tax);
  const depositPercent = property?.deposit_percent ?? 0;
  const summaryRows = combined ? totalsRows(combined, { inclusive }) : null;

  return (
    <div className="page">
      <PageHead
        title="حجز جديد"
        description="حدّد الإقامة، اختار الغرفة، ثم النزيل — والسعر بيتحسب تلقائيًّا بقواعد المنشأة."
        actions={<Button onClick={() => navigate('/reservations')}>رجوع للحجوزات</Button>}
      />

      <div className="res-layout">
        <div className="stack lg">
          {/* 1) الإقامة */}
          <Card title="1 · الإقامة">
            <div className="stack">
              <div className="grid cols-3">
                <Field label="الوصول" required>{(p) => <Input {...p} type="date" min={today} value={stay.check_in} onChange={(event) => setCheckIn(event.target.value)} />}</Field>
                <Field label="المغادرة" required>{(p) => <Input {...p} type="date" min={isIsoDate(stay.check_in) ? addDays(stay.check_in, 1) : undefined} value={stay.check_out} onChange={(event) => setCheckOut(event.target.value)} />}</Field>
                <Field label="عدد الليالي">{() => <Stepper value={nights} min={1} max={MAX_NIGHTS} onChange={setNights} label="عدد الليالي" />}</Field>
              </div>
              {stayProblem ? (
                <Notice tone="warning" icon="calendar">{stayProblem}</Notice>
              ) : (
                <p className="muted small">
                  <b className="soft">{formatWeekday(stay.check_in)}</b> <span className="num">{formatDate(stay.check_in)}</span>
                  {' ← '}
                  <b className="soft">{formatWeekday(stay.check_out)}</b> <span className="num">{formatDate(stay.check_out)}</span>
                  {' · '}{nightsLabel(nights)}
                  {property?.check_in_time && <> · الدخول من <span className="num">{formatClock(property.check_in_time)}</span> والخروج حتى <span className="num">{formatClock(property.check_out_time)}</span></>}
                </p>
              )}
              <div className="grid cols-3">
                <Field
                  label="كود خصم"
                  hint={promoInfo?.valid ? undefined : 'اختياري'}
                  error={promoError ?? (promoInfo && !promoInfo.valid ? promoInfo.message : undefined)}
                >
                  {(p) => <Input {...p} dir="ltr" className="ltr-input" value={promoText} onChange={(event) => { setPromoText(event.target.value); setPromoError(null); }} placeholder="SUMMER10" autoComplete="off" />}
                </Field>
                {promoInfo?.valid && (
                  <div className="field"><span className="label">الخصم</span><b className="num" style={{ color: 'var(--success-text)' }}>− {formatMoney(promoInfo.discount_minor, currency)}</b></div>
                )}
              </div>
            </div>
          </Card>

          {/* 2) الغرف */}
          <Card title="2 · الغرف والأسعار">
            <div className="stack lg">
              {lines.map((line, index) => (
                <RoomLine
                  key={line.key}
                  index={index}
                  line={line}
                  lineCount={lines.length}
                  availability={availabilityFor(line)}
                  datesValid={datesValid}
                  usedByOthers={usedByOthersFor(line)}
                  takenUnitIds={new Set(lines.filter((other) => other.key !== line.key && other.unit_id).map((other) => other.unit_id))}
                  stay={queryStay}
                  currency={currency}
                  canOverride={canOverride}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                />
              ))}
              {lines.length < MAX_ROOMS && (
                <div><Button icon="plus" onClick={addLine}>إضافة غرفة أخرى للحجز</Button></div>
              )}

              {needsRestrictionOverride && (
                <Notice tone="warning" icon="lock">
                  <div className="stack sm">
                    <b>الإقامة بتخالف قيود التسعير</b>
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {[...new Set([...previewViolations, ...serverRestrictions])].map((message) => <li key={message}>{message}</li>)}
                    </ul>
                    {canOverride
                      ? <Checkbox label="أتجاوز القيود وأكمل الحجز" checked={override.restrictions} onChange={(event) => setOverride((current) => ({ ...current, restrictions: event.target.checked }))} />
                      : <span>التجاوز للمدير أو المالك فقط — غيّر التواريخ أو الخطة.</span>}
                  </div>
                </Notice>
              )}
            </div>
          </Card>

          {/* 3) النزيل */}
          <Card title="3 · النزيل">
            <div className="stack">
              <GuestPicker
                guest={guest}
                onChange={(next) => { setGuest(next); setBlacklistHit(false); setOverride((current) => ({ ...current, blacklist: false })); }}
                form={guestForm}
                canOverride={canOverride}
                blacklistOk={override.blacklist}
                onBlacklistOk={(checked) => setOverride((current) => ({ ...current, blacklist: checked }))}
              />
              {blacklistHit && guest?.kind === 'new' && canOverride && (
                <Notice tone="danger" icon="ban">
                  <Checkbox label="النزيل مسجّل في القائمة السوداء — أتجاوز وأكمل الحجز" checked={override.blacklist} onChange={(event) => setOverride((current) => ({ ...current, blacklist: event.target.checked }))} />
                </Notice>
              )}
            </div>
          </Card>

          {/* 4) التفاصيل والدفعة */}
          <Card title="4 · التفاصيل والدفعة">
            <div className="stack lg">
              <div className="grid cols-2">
                <Field label="حالة الحجز" hint={dv.status === 'pending' ? `بيحجز الغرفة ${property?.hold_hours ?? 24} ساعة ويتحرّر تلقائيًّا لو ما اتأكّدش ولا اتدفع عليه.` : 'مؤكّد: الغرفة محجوزة للنزيل.'}>
                  {() => <Segmented label="حالة الحجز" value={dv.status} onChange={(status) => details.set('status', status)} options={[{ value: 'confirmed', label: 'مؤكّد' }, { value: 'pending', label: 'معلّق (حجز مؤقّت)' }]} />}
                </Field>
                <Field label="مصدر الحجز">
                  {(p) => <Select {...p} value={dv.source} onChange={details.on('source')}>{STAFF_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source]}</option>)}</Select>}
                </Field>
                {EXTERNAL_SOURCES.includes(dv.source) && (
                  <Field label="رقم الحجز على المنصّة" hint="للمطابقة مع كشف المنصّة" error={details.errors.external_ref}>
                    {(p) => <Input {...p} dir="ltr" className="ltr-input" value={dv.external_ref} onChange={details.on('external_ref')} />}
                  </Field>
                )}
                <Field label="وقت الوصول المتوقّع" hint="اختياري" error={details.errors.expected_arrival}>
                  {(p) => <Input {...p} type="time" value={dv.expected_arrival} onChange={details.on('expected_arrival')} />}
                </Field>
              </div>

              <div className="grid cols-2">
                <Field label="طلبات النزيل" hint="مثل: دور عالي، سرير إضافي، وصول متأخّر">
                  {(p) => <Textarea {...p} rows={3} value={dv.guest_notes} onChange={details.on('guest_notes')} maxLength={1000} />}
                </Field>
                <Field label="ملاحظات داخلية" hint="للموظفين فقط — مش بتظهر للنزيل">
                  {(p) => <Textarea {...p} rows={3} value={dv.internal_notes} onChange={details.on('internal_notes')} maxLength={5000} />}
                </Field>
              </div>

              <Checkbox
                label={canEmail ? 'إرسال تأكيد الحجز للنزيل بالإيميل' : 'إرسال تأكيد بالإيميل (النزيل ملوش إيميل مسجّل)'}
                checked={canEmail && dv.send_confirmation}
                disabled={!canEmail}
                onChange={(event) => details.set('send_confirmation', event.target.checked)}
              />

              {can('billing.write') && (
                <div className="stack">
                  <div className="divider-label">الدفعة المقدّمة</div>
                  <Switch checked={deposit.enabled} onChange={(enabled) => setDeposit((current) => ({ ...current, enabled }))} label="تسجيل دفعة مقدّمة مع الحجز" />
                  {deposit.enabled && (
                    <div className="stack">
                      <div className="grid cols-3">
                        <Field label="طريقة الدفع">
                          {(p) => <Select {...p} value={deposit.method} onChange={(event) => setDeposit((current) => ({ ...current, method: event.target.value }))}>{Object.entries(METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}
                        </Field>
                        <Field label="المبلغ" required>
                          {() => <MoneyInput value={deposit.amount_minor} onChange={(amount) => setDeposit((current) => ({ ...current, amount_minor: amount }))} />}
                        </Field>
                        <Field label="مرجع العملية" hint="رقم التحويل أو الإيصال (اختياري)">
                          {(p) => <Input {...p} dir="ltr" className="ltr-input" value={deposit.reference} onChange={(event) => setDeposit((current) => ({ ...current, reference: event.target.value }))} maxLength={120} />}
                        </Field>
                      </div>
                      {combined && (
                        <div className="row wrap">
                          {depositPercent > 0 && combined.deposit_due_minor > 0 && (
                            <Button size="sm" onClick={() => setDeposit((current) => ({ ...current, amount_minor: combined.deposit_due_minor }))}>
                              العربون المطلوب ({depositPercent}%) — {formatMoney(combined.deposit_due_minor, currency)}
                            </Button>
                          )}
                          <Button size="sm" onClick={() => setDeposit((current) => ({ ...current, amount_minor: combined.total_minor }))}>
                            الإجمالي كاملًا — {formatMoney(combined.total_minor, currency)}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* الملخّص */}
        <aside className="res-aside">
          <Card title="ملخّص الحجز">
            <div className="stack">
              {guest && (
                <div className="small">
                  <span className="muted">النزيل: </span>
                  <b>{guest.kind === 'existing' ? guest.data.full_name : (guestForm.values.full_name.trim() || 'نزيل جديد')}</b>
                </div>
              )}
              {!stayProblem && (
                <div className="small">
                  <b className="num">{formatDate(stay.check_in)}</b> ← <b className="num">{formatDate(stay.check_out)}</b>
                  <span className="muted"> · {nightsLabel(nights)}</span>
                </div>
              )}

              {chosenIndexes.length === 0 && <p className="muted small">اختار الغرفة والخطة عشان يظهر السعر.</p>}
              {chosenIndexes.length > 0 && !combined && !stayProblem && !quote.isError && (
                <div className="stack sm"><Skeleton height={18} /><Skeleton height={18} width="70%" /><Skeleton height={26} /></div>
              )}
              {quote.isError && !combined && <Notice tone="danger" icon="alert">{quote.error.message}</Notice>}
              {combined && (
                <>
                  {preview.rooms.map((room, index) => (
                    <div key={room.index} className="small">
                      <b>{preview.rooms.length > 1 ? `غرفة ${chosenIndexes[index] + 1}: ` : ''}{room.unit_type.name_ar}</b>
                      <span className="muted"> — {room.rate_plan?.name_ar ?? 'السعر الأساسي'} · {peopleLabel(room.adults, room.children)}</span>
                    </div>
                  ))}
                  <div className="totals">
                    {summaryRows.rows.map((row) => (
                      <div className="line" key={row.key}>
                        <span className={row.minor < 0 ? '' : 'muted'}>{row.label}</span>
                        <span className="num" style={row.minor < 0 ? { color: 'var(--success-text)' } : undefined}>{formatMoney(row.minor, currency)}</span>
                      </div>
                    ))}
                    <div className="line total"><span>الإجمالي</span><span className="num">{formatMoney(combined.total_minor, currency)}</span></div>
                    {summaryRows.included.map((row) => (
                      <div className="line xsmall muted" key={row.key}><span>{row.label}</span><span className="num">{formatMoney(row.minor, currency)}</span></div>
                    ))}
                  </div>
                  {combined.deposit_due_minor > 0 && (
                    <div className="row between small"><span className="muted">العربون المطلوب ({depositPercent}%)</span><b className="num">{formatMoney(combined.deposit_due_minor, currency)}</b></div>
                  )}
                </>
              )}
            </div>
          </Card>

          {blockers.length > 0 && (
            <Card title="لإتمام الحجز">
              <ul className="stack sm" style={{ margin: 0, paddingInlineStart: 18 }}>
                {blockers.map((message) => <li key={message} className="small soft">{message}</li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <div className="sticky-bar" style={{ flexWrap: 'wrap' }}>
        {formError && <div style={{ flexBasis: '100%' }}><Notice tone="danger" icon="alert">{formError}</Notice></div>}
        <div>
          <div className="xsmall muted">الإجمالي</div>
          <b className="num" style={{ fontSize: 'var(--fs-xl)' }}>{combined ? formatMoney(combined.total_minor, currency) : '—'}</b>
        </div>
        <div className="row">
          <Button onClick={() => navigate('/reservations')}>إلغاء</Button>
          <Button variant="primary" size="lg" loading={create.isPending} disabled={blockers.length > 0} onClick={submit}>
            {dv.status === 'pending' ? 'إنشاء حجز معلّق' : 'تأكيد الحجز'}
          </Button>
        </div>
      </div>
    </div>
  );
}
