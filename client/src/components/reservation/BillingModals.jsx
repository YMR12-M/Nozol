/**
 * نوافذ الحسابات في تفاصيل الحجز: دفعة/مرتجع · بند على الفاتورة · إصدار فاتورة · تعديل بيانات الحجز.
 * المبالغ قروش صحيحة (MoneyInput يحوّل من الجنيه)، والنصوص الفارغة لا تُرسَل إلا حيث يقبلها السيرفر.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useProperty } from '../../context/PropertyContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useForm } from '../../lib/forms.js';
import { formatMoney } from '../../lib/format.js';
import { METHOD_LABELS, SOURCE_LABELS, STAFF_SOURCES } from '../../lib/constants.js';
import { suggestedAmount } from '../../lib/reservations.js';
import {
  Button, Checkbox, Field, Input, KeyValue, Modal, MoneyInput, Notice, Segmented, Select, Textarea,
} from '../ui/index.js';

/* ═══════════════ دفعة · مرتجع ═══════════════ */

export function PaymentModal({ reservation, currency, initialType = 'payment', onClose, onDone }) {
  const { api } = useProperty();
  const { can } = useAuth();
  const toast = useToast();
  const [type, setType] = useState(initialType);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(() => suggestedAmount(initialType, reservation));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);

  // الدفعة النقدية تُربَط بوردية الموظف المفتوحة؛ نُنبّه لو ما عنده وردية
  const shift = useQuery({
    queryKey: ['shift-current', api.id],
    queryFn: () => api.get('/shifts/current'),
    enabled: can('billing.shift') && method === 'cash',
    staleTime: 30_000,
  });

  const refund = type === 'refund';
  const tooMuch = refund && amount > reservation.paid_minor;
  const valid = amount > 0 && !tooMuch;

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/payments`, {
      type,
      method,
      amount_minor: amount,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: (result) => {
      toast.success(refund ? 'تم تسجيل المرتجع' : 'تم تسجيل الدفعة');
      onDone(result);
      onClose();
    },
    onError: (error) => setMessage(error.message),
  });

  const switchType = (next) => { setType(next); setAmount(suggestedAmount(next, reservation)); };

  return (
    <Modal
      open
      onClose={onClose}
      title={refund ? 'تسجيل مرتجع' : 'تسجيل دفعة'}
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant={refund ? 'danger' : 'primary'} loading={mutation.isPending} disabled={!valid} onClick={() => { setMessage(null); mutation.mutate(); }}>
            {refund ? 'تسجيل المرتجع' : 'تسجيل الدفعة'}
          </Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}

        <Segmented
          label="نوع العملية"
          value={type}
          onChange={switchType}
          options={[{ value: 'payment', label: 'دفعة من النزيل' }, { value: 'refund', label: 'مرتجع للنزيل' }]}
        />

        <KeyValue items={[
          { label: 'الإجمالي', value: <span className="num">{formatMoney(reservation.total_minor, currency)}</span> },
          { label: 'المدفوع', value: <span className="num">{formatMoney(reservation.paid_minor, currency)}</span> },
          { label: reservation.balance_minor < 0 ? 'زيادة مدفوعة' : 'المتبقي', value: <span className="num bold">{formatMoney(Math.abs(reservation.balance_minor), currency)}</span> },
        ]}
        />

        <div className="grid cols-2">
          <Field label="طريقة الدفع">
            {(p) => <Select {...p} value={method} onChange={(event) => setMethod(event.target.value)}>{Object.entries(METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}
          </Field>
          <Field label="المبلغ" required error={tooMuch ? `المرتجع أكبر من المدفوع (${formatMoney(reservation.paid_minor, currency)})` : undefined}>
            {() => <MoneyInput value={amount} onChange={setAmount} data-autofocus />}
          </Field>
        </div>

        <div className="row wrap">
          {!refund && reservation.balance_minor > 0 && <Button size="sm" onClick={() => setAmount(reservation.balance_minor)}>المتبقي — {formatMoney(reservation.balance_minor, currency)}</Button>}
          {refund && reservation.paid_minor > 0 && <Button size="sm" onClick={() => setAmount(reservation.paid_minor)}>كل المدفوع — {formatMoney(reservation.paid_minor, currency)}</Button>}
        </div>

        {method === 'cash' && shift.isSuccess && !shift.data && (
          <Notice tone="warning" icon="clock">
            مفيش وردية مفتوحة باسمك — العملية النقدية مش هتتسجّل في عهدة وردية. افتح وردية من <Link to="/billing">الحسابات</Link>.
          </Notice>
        )}

        <div className="grid cols-2">
          <Field label="مرجع العملية" hint="رقم التحويل أو الإيصال (اختياري)">
            {(p) => <Input {...p} dir="ltr" className="ltr-input" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} />}
          </Field>
          <Field label="ملاحظة">
            {(p) => <Input {...p} value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════ بند على الفاتورة ═══════════════ */

const ITEM_KINDS = [
  { value: 'service', label: 'خدمة من الكتالوج' },
  { value: 'charge', label: 'بند حرّ' },
  { value: 'discount', label: 'خصم' },
  { value: 'fee', label: 'رسم' },
];

/** خدمة وبند حرّ يتأثّران بالكمية؛ الخصم والرسم مبلغ واحد */
const NEEDS_QUANTITY = ['service', 'charge'];

export function FolioItemModal({ reservation, currency, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const [kind, setKind] = useState('service');
  const [serviceId, setServiceId] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [taxable, setTaxable] = useState(true);
  const [serviceChargeable, setServiceChargeable] = useState(true);
  const [message, setMessage] = useState(null);

  const services = useQuery({ queryKey: ['services', api.id], queryFn: () => api.get('/services'), staleTime: 60_000 });
  const catalog = (services.data ?? []).filter((service) => service.is_active);
  const service = catalog.find((candidate) => String(candidate.id) === serviceId) ?? null;
  const qty = Number(quantity);
  const qtyOk = Number.isFinite(qty) && qty > 0 && qty <= 1000;
  const unit = kind === 'service' ? service?.price_minor : price;
  const amount = NEEDS_QUANTITY.includes(kind) && unit != null && qtyOk ? Math.round(unit * qty) : price;

  const switchKind = (next) => {
    setKind(next);
    // الرسم عادةً بلا ضريبة ولا خدمة؛ البند الحرّ العكس
    setTaxable(next !== 'fee');
    setServiceChargeable(next !== 'fee');
    setMessage(null);
  };

  let valid;
  if (kind === 'service') valid = Boolean(service) && qtyOk;
  else if (kind === 'charge') valid = description.trim().length >= 2 && price > 0 && qtyOk;
  else valid = description.trim().length >= 2 && price > 0;

  const payload = () => {
    if (kind === 'service') return { kind, service_id: service.id, quantity: qty, ...(description.trim() ? { description: description.trim() } : {}) };
    if (kind === 'charge') return { kind, description: description.trim(), unit_price_minor: price, quantity: qty, taxable, service_chargeable: serviceChargeable };
    if (kind === 'discount') return { kind, description: description.trim(), amount_minor: price };
    return { kind, description: description.trim(), amount_minor: price, taxable, service_chargeable: serviceChargeable };
  };

  const mutation = useMutation({
    mutationFn: () => api.post(`/reservations/${reservation.id}/items`, payload()),
    onSuccess: (result) => {
      toast.success(kind === 'discount' ? 'تم إضافة الخصم' : 'تم إضافة البند للفاتورة');
      onDone(result);
      onClose();
    },
    onError: (error) => setMessage(error.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="إضافة بند للفاتورة"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={!valid} onClick={() => { setMessage(null); mutation.mutate(); }}>إضافة</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Segmented label="نوع البند" value={kind} onChange={switchKind} options={ITEM_KINDS} />

        {kind === 'service' && (
          catalog.length === 0 && services.isSuccess ? (
            <Notice icon="info">مفيش خدمات في الكتالوج — استعمل «بند حرّ»، أو أضف خدمات من <Link to="/rates">الأسعار والعروض</Link>.</Notice>
          ) : (
            <Field label="الخدمة" required>
              {(p) => (
                <Select {...p} value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={services.isLoading}>
                  <option value="">اختار الخدمة…</option>
                  {catalog.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name_ar} — {formatMoney(candidate.price_minor, currency)}</option>)}
                </Select>
              )}
            </Field>
          )
        )}

        {kind !== 'service' && (
          <Field label="الوصف" required>
            {(p) => <Input {...p} data-autofocus value={description} onChange={(event) => setDescription(event.target.value)} maxLength={190} placeholder={kind === 'discount' ? 'مثال: خصم مجاملة' : kind === 'fee' ? 'مثال: رسم تلف' : 'مثال: غسيل ملابس'} />}
          </Field>
        )}

        <div className="grid cols-2">
          {kind !== 'service' && (
            <Field label={kind === 'charge' ? 'سعر الوحدة' : 'المبلغ'} required>
              {() => <MoneyInput value={price} onChange={setPrice} />}
            </Field>
          )}
          {NEEDS_QUANTITY.includes(kind) && (
            <Field label="الكمية" error={qtyOk ? undefined : 'كمية بين 0.01 و1000'}>
              {(p) => <Input {...p} type="number" min="0.01" max="1000" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />}
            </Field>
          )}
          {kind === 'service' && (
            <Field label="وصف مخصّص (اختياري)" hint="بدل اسم الخدمة على الفاتورة">
              {(p) => <Input {...p} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={190} />}
            </Field>
          )}
        </div>

        {(kind === 'charge' || kind === 'fee') && (
          <div className="row wrap" style={{ gap: 'var(--sp-5)' }}>
            <Checkbox label="خاضع للضريبة" checked={taxable} onChange={(event) => setTaxable(event.target.checked)} />
            <Checkbox label="خاضع لرسم الخدمة" checked={serviceChargeable} onChange={(event) => setServiceChargeable(event.target.checked)} />
          </div>
        )}

        {amount > 0 && (
          <div className="row between small">
            <span className="muted">{kind === 'discount' ? 'قيمة الخصم' : 'قيمة البند (قبل الضريبة والخدمة)'}</span>
            <b className="num">{kind === 'discount' ? '− ' : ''}{formatMoney(amount, currency)}</b>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ═══════════════ إصدار فاتورة ═══════════════ */

export function InvoiceModal({ reservation, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const form = useForm({ bill_to_name: reservation.guest_name, bill_to_tax_id: '', bill_to_address: '' });
  const [message, setMessage] = useState(null);

  const mutation = useMutation({
    mutationFn: () => {
      const v = form.values;
      return api.post(`/reservations/${reservation.id}/invoices`, {
        bill_to_name: v.bill_to_name.trim(),
        bill_to_tax_id: v.bill_to_tax_id.trim(),
        bill_to_address: v.bill_to_address.trim(),
      });
    },
    onSuccess: (invoice) => {
      toast.success(`تم إصدار الفاتورة ${invoice.number}`);
      onDone({ invoice });
      onClose();
    },
    onError: (error) => setMessage(form.fail(error)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="إصدار فاتورة"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={form.values.bill_to_name.trim().length < 2} onClick={() => { setMessage(null); mutation.mutate(); }}>إصدار الفاتورة</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Notice icon="info">الفاتورة لقطة ثابتة من الحساب وقت الإصدار؛ لو اتعدّل الحجز بعدها ألغِها وأصدر غيرها.</Notice>
        <Field label="اسم العميل على الفاتورة" required error={form.errors.bill_to_name}>
          {(p) => <Input {...p} data-autofocus value={form.values.bill_to_name} onChange={form.on('bill_to_name')} maxLength={190} />}
        </Field>
        <div className="grid cols-2">
          <Field label="الرقم الضريبي" hint="للشركات (اختياري)" error={form.errors.bill_to_tax_id}>
            {(p) => <Input {...p} dir="ltr" className="ltr-input" value={form.values.bill_to_tax_id} onChange={form.on('bill_to_tax_id')} maxLength={40} />}
          </Field>
          <Field label="العنوان" error={form.errors.bill_to_address}>
            {(p) => <Input {...p} value={form.values.bill_to_address} onChange={form.on('bill_to_address')} maxLength={255} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════ تعديل بيانات الحجز ═══════════════ */

export function EditDetailsModal({ reservation, onClose, onDone }) {
  const { api } = useProperty();
  const toast = useToast();
  const form = useForm({
    source: reservation.source,
    external_ref: reservation.external_ref ?? '',
    expected_arrival: reservation.expected_arrival?.slice(0, 5) ?? '',
    guest_notes: reservation.guest_notes ?? '',
    internal_notes: reservation.internal_notes ?? '',
  });
  const [message, setMessage] = useState(null);
  // مصدر «الموقع» لا يُختار يدويًّا: نعرضه ولا نُرسله ما لم يتغيّر
  const sources = STAFF_SOURCES.includes(reservation.source) ? STAFF_SOURCES : [reservation.source, ...STAFF_SOURCES];

  const mutation = useMutation({
    mutationFn: () => {
      const v = form.values;
      return api.patch(`/reservations/${reservation.id}`, {
        ...(v.source !== reservation.source ? { source: v.source } : {}),
        external_ref: v.external_ref.trim(),
        expected_arrival: v.expected_arrival || null,
        guest_notes: v.guest_notes.trim(),
        internal_notes: v.internal_notes.trim(),
      });
    },
    onSuccess: (updated) => {
      toast.success('تم حفظ التعديلات');
      onDone({ reservation: updated });
      onClose();
    },
    onError: (error) => setMessage(form.fail(error)),
  });

  const v = form.values;
  return (
    <Modal
      open
      onClose={onClose}
      title="تعديل بيانات الحجز"
      footer={(
        <>
          <Button onClick={onClose}>رجوع</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => { setMessage(null); mutation.mutate(); }}>حفظ</Button>
        </>
      )}
    >
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <div className="grid cols-2">
          <Field label="مصدر الحجز" error={form.errors.source}>
            {(p) => <Select {...p} value={v.source} onChange={form.on('source')}>{sources.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source] ?? source}</option>)}</Select>}
          </Field>
          <Field label="وقت الوصول المتوقّع" error={form.errors.expected_arrival}>
            {(p) => <Input {...p} type="time" value={v.expected_arrival} onChange={form.on('expected_arrival')} />}
          </Field>
          <Field label="رقم الحجز على المنصّة" error={form.errors.external_ref}>
            {(p) => <Input {...p} dir="ltr" className="ltr-input" value={v.external_ref} onChange={form.on('external_ref')} maxLength={80} />}
          </Field>
        </div>
        <Field label="طلبات النزيل" error={form.errors.guest_notes}>
          {(p) => <Textarea {...p} rows={3} value={v.guest_notes} onChange={form.on('guest_notes')} maxLength={1000} />}
        </Field>
        <Field label="ملاحظات داخلية" hint="للموظفين فقط" error={form.errors.internal_notes}>
          {(p) => <Textarea {...p} rows={3} value={v.internal_notes} onChange={form.on('internal_notes')} maxLength={5000} />}
        </Field>
      </div>
    </Modal>
  );
}
