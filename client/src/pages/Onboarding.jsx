import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, propertyApi } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useProperty } from '../context/PropertyContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { GOVERNORATES, PROPERTY_KIND_LABELS, UNIT_KIND_LABELS } from '../lib/constants.js';
import {
  Button, Card, Checkbox, Field, Input, MoneyInput, Notice, PageHead, PercentInput, Select, Stepper,
} from '../components/ui/index.js';

const STEPS = ['بيانات المنشأة', 'أول نوع غرف', 'الغرف'];

/**
 * معالج البداية: منشأة ← نوع وحدة ← غرف. ثلاث خطوات تكفي ليعمل النظام فعليًّا
 * (يحجز وتظهر له أسعار). كل ما بعد ذلك (صور، خطط، مواسم) يُضاف من الإعدادات.
 */
export default function Onboarding() {
  useDocumentTitle('إعداد منشأة جديدة');
  const navigate = useNavigate();
  const toast = useToast();
  const { reloadUser } = useAuth();
  const { select } = useProperty();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [createdProperty, setCreatedProperty] = useState(null);
  const [createdType, setCreatedType] = useState(null);

  const property = useForm({
    name_ar: '', name_en: '', kind: 'hotel', phone: '', city: '', governorate: 'القاهرة',
    check_in_time: '14:00', check_out_time: '12:00',
    tax_bps: 0, service_charge_bps: 0, tax_on_service_charge: false, prices_include_tax: false,
  });
  const type = useForm({
    code: 'STD', name_ar: '', kind: 'room', base_price_minor: null, base_adults: 2, max_adults: 2, max_children: 0, extra_adult_minor: 0,
  });
  const units = useForm({ prefix: '', from: 101, to: 110 });

  async function createProperty() {
    setBusy(true); setMessage(null);
    try {
      const v = property.values;
      const created = await api.post('/properties', {
        name_ar: v.name_ar.trim(), name_en: v.name_en.trim() || null, kind: v.kind,
        phone: v.phone.trim() || null, city: v.city.trim() || null, governorate: v.governorate || null,
        check_in_time: v.check_in_time, check_out_time: v.check_out_time,
        tax_bps: v.tax_bps ?? 0, service_charge_bps: v.service_charge_bps ?? 0,
        tax_on_service_charge: v.tax_on_service_charge, prices_include_tax: v.prices_include_tax,
      });
      setCreatedProperty(created);
      setStep(1);
    } catch (error) {
      setMessage(property.fail(error));
    } finally { setBusy(false); }
  }

  async function createType() {
    setBusy(true); setMessage(null);
    try {
      const v = type.values;
      if (v.base_price_minor === null) { type.setErrors({ base_price_minor: 'اكتب سعر الليلة' }); setBusy(false); return; }
      const maxOccupancy = v.max_adults + v.max_children;
      const created = await propertyApi(createdProperty.id).post('/unit-types', {
        code: v.code.trim(), name_ar: v.name_ar.trim(), kind: v.kind, base_price_minor: v.base_price_minor,
        base_adults: Math.min(v.base_adults, v.max_adults), max_adults: v.max_adults, max_children: v.max_children,
        max_occupancy: maxOccupancy, extra_adult_minor: v.extra_adult_minor ?? 0, extra_child_minor: 0,
      });
      setCreatedType(created);
      setStep(2);
    } catch (error) {
      setMessage(type.fail(error));
    } finally { setBusy(false); }
  }

  async function createUnits() {
    setBusy(true); setMessage(null);
    try {
      const v = units.values;
      await propertyApi(createdProperty.id).post('/units/bulk', {
        unit_type_id: createdType.id,
        range: { prefix: v.prefix.trim(), from: Number(v.from), to: Number(v.to) },
      });
      await reloadUser();
      select(createdProperty.id);
      toast.success('المنشأة جاهزة — تقدر تبدأ تستقبل حجوزات');
      navigate('/', { replace: true });
    } catch (error) {
      setMessage(units.fail(error));
    } finally { setBusy(false); }
  }

  const pv = property.values;
  const tv = type.values;
  const uv = units.values;

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHead title="أهلًا بيك في نُزُل" description="خطوات سريعة لإعداد منشأتك — تقدر تعدّل أي حاجة بعد كده." />

      <div className="steps" aria-label="الخطوات">
        {STEPS.map((label, index) => (
          <div key={label} className={`step ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}>
            <span className="n">{index < step ? '✓' : index + 1}</span>{label}
          </div>
        ))}
      </div>

      {message && <Notice tone="danger" icon="alert">{message}</Notice>}

      {step === 0 && (
        <Card title="بيانات المنشأة">
          <div className="stack lg">
            <div className="grid cols-2">
              <Field label="اسم المنشأة (عربي)" required error={property.errors.name_ar}>{(p) => <Input {...p} value={pv.name_ar} onChange={property.on('name_ar')} autoFocus placeholder="فندق النيل" />}</Field>
              <Field label="الاسم بالإنجليزية" hint="يظهر في صفحة الحجز للأجانب" error={property.errors.name_en}>{(p) => <Input {...p} dir="ltr" className="ltr-input" value={pv.name_en} onChange={property.on('name_en')} placeholder="Nile Hotel" />}</Field>
              <Field label="النوع">{(p) => <Select {...p} value={pv.kind} onChange={property.on('kind')}>{Object.entries(PROPERTY_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
              <Field label="هاتف المنشأة" error={property.errors.phone}>{(p) => <Input {...p} dir="ltr" className="ltr-input" value={pv.phone} onChange={property.on('phone')} placeholder="01012345678" />}</Field>
              <Field label="المحافظة">{(p) => <Select {...p} value={pv.governorate} onChange={property.on('governorate')}>{GOVERNORATES.map((g) => <option key={g}>{g}</option>)}</Select>}</Field>
              <Field label="المدينة / المنطقة">{(p) => <Input {...p} value={pv.city} onChange={property.on('city')} placeholder="دهب" />}</Field>
              <Field label="موعد الدخول">{(p) => <Input {...p} type="time" value={pv.check_in_time} onChange={property.on('check_in_time')} />}</Field>
              <Field label="موعد الخروج">{(p) => <Input {...p} type="time" value={pv.check_out_time} onChange={property.on('check_out_time')} />}</Field>
            </div>

            <div className="divider-label">الضرائب والرسوم (اختياري)</div>
            <Notice icon="info">اتركها 0 لو مش بتضيف ضرائب أو خدمة. القيم دي بتتحسب تلقائيًّا في كل فاتورة، وتقدر تغيّرها بعدين من الإعدادات.</Notice>
            <div className="grid cols-2">
              <Field label="رسم الخدمة">{() => <PercentInput value={pv.service_charge_bps} onChange={(v) => property.set('service_charge_bps', v ?? 0)} />}</Field>
              <Field label="الضريبة">{() => <PercentInput value={pv.tax_bps} onChange={(v) => property.set('tax_bps', v ?? 0)} />}</Field>
            </div>
            <div className="row wrap" style={{ gap: 'var(--sp-5)' }}>
              <Checkbox label="الضريبة تُحسب على الخدمة أيضًا" checked={pv.tax_on_service_charge} onChange={property.on('tax_on_service_charge')} />
              <Checkbox label="الأسعار اللي هكتبها شاملة الخدمة والضريبة" checked={pv.prices_include_tax} onChange={property.on('prices_include_tax')} />
            </div>

            <div className="row end">
              <Button variant="primary" size="lg" loading={busy} disabled={pv.name_ar.trim().length < 2} onClick={createProperty}>التالي</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="أول نوع غرف تبيعه">
          <div className="stack lg">
            <Notice icon="info">النوع = فئة بسعر واحد (غرفة مزدوجة، شاليه غرفتين…). تقدر تضيف أنواعًا أخرى بعد كده.</Notice>
            <div className="grid cols-2">
              <Field label="اسم النوع" required error={type.errors.name_ar}>{(p) => <Input {...p} autoFocus value={tv.name_ar} onChange={type.on('name_ar')} placeholder="غرفة مزدوجة" />}</Field>
              <Field label="كود قصير" hint="حروف إنجليزية وأرقام" error={type.errors.code}>{(p) => <Input {...p} dir="ltr" className="ltr-input" value={tv.code} onChange={type.on('code')} />}</Field>
              <Field label="التصنيف">{(p) => <Select {...p} value={tv.kind} onChange={type.on('kind')}>{Object.entries(UNIT_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
              <Field label="سعر الليلة" required error={type.errors.base_price_minor}>{() => <MoneyInput value={tv.base_price_minor} onChange={(v) => type.set('base_price_minor', v)} />}</Field>
              <Field label="البالغون المشمولون في السعر">{() => <Stepper value={tv.base_adults} min={1} max={tv.max_adults} onChange={(v) => type.set('base_adults', v)} label="البالغون المشمولون" />}</Field>
              <Field label="أقصى عدد بالغين">{() => <Stepper value={tv.max_adults} min={1} max={20} onChange={(v) => type.set('max_adults', v)} label="أقصى بالغين" />}</Field>
              <Field label="أقصى عدد أطفال">{() => <Stepper value={tv.max_children} min={0} max={10} onChange={(v) => type.set('max_children', v)} label="أقصى أطفال" />}</Field>
              <Field label="سعر البالغ الزائد (لليلة)" hint="لو مفيش اتركه 0">{() => <MoneyInput value={tv.extra_adult_minor} onChange={(v) => type.set('extra_adult_minor', v ?? 0)} />}</Field>
            </div>
            <div className="row end">
              <Button variant="primary" size="lg" loading={busy} disabled={tv.name_ar.trim().length < 2} onClick={createType}>التالي</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card title={`غرف «${createdType.name_ar}»`}>
          <div className="stack lg">
            <Notice icon="info">اكتب المدى مرّة واحدة: مثلًا من 101 إلى 110 يضيف عشر غرف. تقدر تضيف أو تعدّل غرفًا بعد كده.</Notice>
            <div className="grid cols-3">
              <Field label="بادئة (اختياري)" hint="مثال: A- ← A-1, A-2">{(p) => <Input {...p} dir="ltr" className="ltr-input" value={uv.prefix} onChange={units.on('prefix')} />}</Field>
              <Field label="من رقم" error={units.errors['range.from']}>{(p) => <Input {...p} type="number" min={0} value={uv.from} onChange={units.on('from')} />}</Field>
              <Field label="إلى رقم" error={units.errors['range.to']}>{(p) => <Input {...p} type="number" min={0} value={uv.to} onChange={units.on('to')} />}</Field>
            </div>
            <p className="muted small">هتتضاف <span className="num">{Math.max(0, Number(uv.to) - Number(uv.from) + 1)}</span> وحدة: <span className="num">{uv.prefix}{uv.from} … {uv.prefix}{uv.to}</span></p>
            <div className="row end">
              <Button variant="primary" size="lg" loading={busy} disabled={Number(uv.to) < Number(uv.from)} onClick={createUnits}>إنهاء وبدء الاستخدام</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
