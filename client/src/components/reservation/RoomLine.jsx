/**
 * سطر غرفة في الحجز الجديد: ضيوف الغرفة، ثم عروض الأنواع المتاحة بخططها وأسعارها،
 * ثم (اختياريًّا) غرفة بعينها. كل سطر يبحث بعدد ضيوفه هو: سعر البالغ الزائد والسعة
 * يختلفان من غرفة لأخرى في الحجز نفسه.
 *
 * بيانات البحث تأتي من الصفحة (`availability` = نتيجة useQuery) كي تعرف الصفحة
 * ما اختاره كل سطر وتحسب الوحدات المتبقية بين السطور.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProperty } from '../../context/PropertyContext.jsx';
import { formatMoney, nightsLabel } from '../../lib/format.js';
import { AMENITIES, HK_LABELS, MEAL_LABELS, UNIT_KIND_LABELS } from '../../lib/constants.js';
import { Icon } from '../../lib/icons.jsx';
import { findPlan, isChosen, lineProblem } from '../../lib/reservations.js';
import {
  Badge, Button, EmptyState, Field, Loading, Notice, Select, Skeleton, Stepper,
} from '../ui/index.js';

/** متوسط سعر الليلة (غرفة + أفراد + وجبات) قبل الخدمة والضريبة */
const averageNight = (plan) =>
  Math.round(plan.nightly.reduce((sum, night) => sum + night.room_minor + night.extra_guest_minor + night.meal_minor, 0) / plan.nights);

const planName = (plan) => plan.rate_plan?.name_ar ?? 'السعر الأساسي';

function PlanRow({ plan, selected, disabled, canOverride, currency, onPick }) {
  const locked = !plan.bookable && !canOverride;
  return (
    <div className="plan-row">
      <div className="grow">
        <div className="row wrap" style={{ gap: 8 }}>
          <b>{planName(plan)}</b>
          {plan.rate_plan && plan.rate_plan.meal_plan !== 'RO' && <Badge tone="info">{MEAL_LABELS[plan.rate_plan.meal_plan]}</Badge>}
          {plan.rate_plan && !plan.rate_plan.is_refundable && <Badge tone="warning">غير قابل للاسترداد</Badge>}
          {plan.promo?.valid && <Badge tone="success">خصم {formatMoney(plan.promo.discount_minor, currency)}</Badge>}
        </div>
        <div className="xsmall muted">
          متوسط الليلة <span className="num">{formatMoney(averageNight(plan), currency)}</span> · {nightsLabel(plan.nights)}
        </div>
        {!plan.bookable && (
          <div className="xsmall" style={{ color: 'var(--danger-text)' }}>
            {plan.violations.map((violation) => violation.message).join('، ')}
            {canOverride ? ' — تقدر تتجاوزها بصلاحيتك' : ''}
          </div>
        )}
      </div>
      <div className="row">
        <b className="num">{formatMoney(plan.totals.total_minor, currency)}</b>
        <Button size="sm" variant={selected ? 'primary' : 'secondary'} disabled={disabled || locked} onClick={onPick}>
          {selected ? 'مختارة' : 'اختيار'}
        </Button>
      </div>
    </div>
  );
}

function OfferCard({ result, line, remaining, currency, canOverride, onPick }) {
  const { unit_type: type, available_units: available, capacity_ok: capacityOk, plans } = result;
  const photo = type.photos[0]?.url;
  const cheapest = plans.length > 0 ? Math.min(...plans.map((plan) => plan.totals.total_minor)) : null;
  const blocked = !capacityOk || remaining <= 0;

  let reason = null;
  if (!capacityOk) reason = `السعة لا تكفي — أقصى ${type.max_adults} بالغين و${type.max_children} أطفال (إجمالي ${type.max_occupancy})`;
  else if (available === 0) reason = 'مفيش وحدات فاضية في التواريخ دي';
  else if (remaining <= 0) reason = 'كل وحدات النوع ده اتحجزت في غرف تانية من نفس الحجز';

  const amenities = (type.amenities ?? []).filter((key) => AMENITIES[key]).slice(0, 6);
  return (
    <div className={`offer ${line.unit_type_id === type.id ? 'selected' : ''}`} style={blocked ? { opacity: 0.7 } : undefined}>
      <div className="photo" style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
        {!photo && <Icon name="bed" size={32} />}
      </div>
      <div className="stack sm" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <h3>{type.name_ar}</h3>
          <Badge>{UNIT_KIND_LABELS[type.kind] ?? type.kind}</Badge>
          {!blocked && <Badge tone={remaining <= 2 ? 'warning' : 'success'}>متاح {remaining}</Badge>}
        </div>
        <div className="muted small row wrap" style={{ gap: 12 }}>
          <span>حتى {type.max_adults} بالغين{type.max_children > 0 ? ` + ${type.max_children} أطفال` : ''}</span>
          {type.beds && <span>{type.beds}</span>}
          {type.size_sqm && <span className="num">{type.size_sqm} م²</span>}
        </div>
        {amenities.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {amenities.map((key) => <span key={key} className="chip">{AMENITIES[key]}</span>)}
          </div>
        )}
        {reason && <Notice tone="warning" icon="alert">{reason}</Notice>}
        {plans.length > 0 && (
          <div className="plans">
            {plans.map((plan) => (
              <PlanRow
                key={plan.rate_plan?.id ?? 'base'}
                plan={plan}
                selected={line.unit_type_id === type.id && (plan.rate_plan?.id ?? null) === line.rate_plan_id}
                disabled={blocked}
                canOverride={canOverride}
                currency={currency}
                onPick={() => onPick(result, plan)}
              />
            ))}
          </div>
        )}
      </div>
      {cheapest !== null && !blocked && (
        <div style={{ textAlign: 'end' }}>
          <div className="xsmall muted">ابتداءً من</div>
          <b className="num">{formatMoney(cheapest, currency)}</b>
        </div>
      )}
    </div>
  );
}

/** اختيار غرفة بعينها من الفاضية (المرتّبة بالأنسب أولًا من السيرفر) */
function UnitPicker({ line, stay, takenUnitIds, onChange }) {
  const { api } = useProperty();
  const query = useQuery({
    queryKey: ['available-units', api.id, line.unit_type_id, stay.check_in, stay.check_out],
    queryFn: () => api.get('/availability/units', { unit_type_id: line.unit_type_id, check_in: stay.check_in, check_out: stay.check_out }),
    staleTime: 10_000,
  });
  const units = (query.data ?? []).filter((unit) => !takenUnitIds.has(unit.id) || unit.id === line.unit_id);

  // الغرفة المختارة لم تعد فاضية (تغيّرت التواريخ): نرجع للاختيار التلقائي
  useEffect(() => {
    if (query.data && line.unit_id && !query.data.some((unit) => unit.id === line.unit_id)) onChange({ unit_id: null });
  }, [query.data, line.unit_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Field label="الغرفة" hint="الاختيار التلقائي يقلّل تقطيع التقويم؛ اختار غرفة بعينها لو النزيل طلبها.">
      {(p) => (
        <Select
          {...p}
          value={line.unit_id ?? ''}
          disabled={query.isLoading}
          onChange={(event) => onChange({ unit_id: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">تلقائي — الأنسب</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code}{unit.floor ? ` — دور ${unit.floor}` : ''} · {HK_LABELS[unit.housekeeping_status]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export default function RoomLine({
  index, line, lineCount, availability, datesValid, usedByOthers, takenUnitIds, stay, currency, canOverride, onChange, onRemove,
}) {
  const [expanded, setExpanded] = useState(!isChosen(line));
  const { data } = availability;
  const results = data ? [...data.results].sort((a, b) => Number(b.available_units > 0 && b.capacity_ok) - Number(a.available_units > 0 && a.capacity_ok)) : [];

  const chosen = isChosen(line);
  const chosenResult = data?.results.find((result) => result.unit_type.id === line.unit_type_id);
  const chosenPlan = findPlan(chosenResult, line.rate_plan_id);
  const settled = Boolean(data) && !availability.isPlaceholderData;
  const problem = settled ? lineProblem(line, chosenResult, usedByOthers(line.unit_type_id)) : null;

  // جاء النوع من التقويم بلا خطة: نختار الأنسب (أول خطة مسموحة، والافتراضية أولًا) عند وصول العروض
  useEffect(() => {
    if (line.unit_type_id === null || line.rate_plan_id !== undefined || !settled) return;

    // سعة النوع أقل من عدد الضيوف الافتراضي (غرفة فردية مثلًا): نضبط العدد على السعة بدل إلغاء الاختيار
    if (chosenResult && !chosenResult.capacity_ok) {
      const { max_adults: maxAdults, max_children: maxChildren, max_occupancy: maxOccupancy } = chosenResult.unit_type;
      const adults = Math.max(1, Math.min(line.adults, maxAdults, maxOccupancy));
      const children = Math.max(0, Math.min(line.children, maxChildren, maxOccupancy - adults));
      if (adults !== line.adults || children !== line.children) { onChange({ adults, children }); return; }
    }

    const plan = chosenResult?.plans.find((candidate) => candidate.bookable) ?? chosenResult?.plans[0];
    if (plan) { onChange({ rate_plan_id: plan.rate_plan?.id ?? null }); setExpanded(false); }
    else { onChange({ unit_type_id: null, unit_id: null }); setExpanded(true); }
  }, [line.unit_type_id, line.rate_plan_id, line.adults, line.children, settled, chosenResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ظهرت مشكلة بعد الاختيار (تواريخ/عدد ضيوف تغيّر): نفتح العروض ليعيد الموظف الاختيار
  useEffect(() => { if (problem) setExpanded(true); }, [problem]);

  const pick = (result, plan) => {
    const sameType = line.unit_type_id === result.unit_type.id;
    onChange({ unit_type_id: result.unit_type.id, rate_plan_id: plan.rate_plan?.id ?? null, unit_id: sameType ? line.unit_id : null });
    setExpanded(false);
  };

  return (
    <div className="room-line">
      <div className="row between">
        <h3 className="row" style={{ gap: 8 }}><Icon name="bed" size={18} />{lineCount > 1 ? `الغرفة ${index + 1}` : 'الغرفة'}</h3>
        {lineCount > 1 && <Button variant="ghost" size="sm" icon="trash" onClick={onRemove}>حذف الغرفة</Button>}
      </div>

      <div className="row wrap" style={{ gap: 'var(--sp-5)' }}>
        <Field label="بالغون">{() => <Stepper value={line.adults} min={1} max={30} onChange={(adults) => onChange({ adults })} label="عدد البالغين" />}</Field>
        <Field label="أطفال">{() => <Stepper value={line.children} min={0} max={20} onChange={(children) => onChange({ children })} label="عدد الأطفال" />}</Field>
      </div>

      {problem && <Notice tone="danger" icon="alert">{problem} — اختار غرفة تانية.</Notice>}

      {!datesValid ? (
        <Notice tone="warning" icon="calendar">حدّد تواريخ إقامة صحيحة عشان تظهر الغرف المتاحة.</Notice>
      ) : availability.isError ? (
        <Notice tone="danger" icon="alert" action={<Button size="sm" onClick={() => availability.refetch()}>حاول تاني</Button>}>
          {availability.error.message}
        </Notice>
      ) : !data ? <Loading label="جارٍ البحث عن الغرف…" /> : chosen && !expanded ? (
        <div className="stack">
          <div className="line-summary">
            {chosenResult && chosenPlan ? (
              <>
                <div className="grow">
                  <b>{chosenResult.unit_type.name_ar}</b> <span className="muted">— {planName(chosenPlan)}</span>
                  <div className="xsmall muted">
                    متوسط الليلة <span className="num">{formatMoney(averageNight(chosenPlan), currency)}</span> · {nightsLabel(chosenPlan.nights)}
                  </div>
                </div>
                <b className="num">{formatMoney(chosenPlan.totals.total_minor, currency)}</b>
              </>
            ) : <Skeleton height={36} />}
            <Button size="sm" onClick={() => setExpanded(true)}>تغيير</Button>
          </div>
          {!problem && <UnitPicker line={line} stay={stay} takenUnitIds={takenUnitIds} onChange={onChange} />}
        </div>
      ) : results.length === 0 ? (
        <EmptyState icon="bed" title="مفيش أنواع غرف معرّفة" description="أضف أنواع الغرف ووحداتها من «الغرف والوحدات» أولًا." />
      ) : (
        <div className="stack" style={{ opacity: availability.isPlaceholderData ? 0.6 : 1 }}>
          {results.map((result) => (
            <OfferCard
              key={result.unit_type.id}
              result={result}
              line={line}
              remaining={result.available_units - usedByOthers(result.unit_type.id)}
              currency={currency}
              canOverride={canOverride}
              onPick={pick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
