/**
 * اختيار نزيل الحجز: بحث في المسجَّلين، أو نزيل جديد بحقول اختيارية.
 *
 * الحالة (`guest`) يملكها الصفحة: null ← لم يُحدَّد، { kind: 'existing', data }، أو { kind: 'new' }
 * وقيم النزيل الجديد في `form` (useForm). السيرفر يطابق النزيل الجديد بالهاتف أو الهوية فلا يتكرّر،
 * ومع ذلك ننبّه الموظف أثناء الكتابة كي يختار السجلّ الموجود بنفسه.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProperty } from '../../context/PropertyContext.jsx';
import { useDebounce } from '../../lib/hooks.js';
import { formatPhone } from '../../lib/format.js';
import { ID_TYPE_LABELS } from '../../lib/constants.js';
import { latinDigits } from '../../lib/reservations.js';
import { Avatar, Badge, Button, Checkbox, Field, Input, Notice, SearchInput, Select } from '../ui/index.js';

/** بحث النزلاء بعد حرفين (يُؤجَّل حتى تتوقّف الكتابة) */
function useGuestSearch(text) {
  const { api } = useProperty();
  const term = useDebounce(latinDigits(text).trim(), 300);
  return useQuery({
    queryKey: ['guests', api.id, 'pick', term],
    queryFn: () => api.page('/guests', { q: term, page_size: 6 }),
    enabled: term.length >= 2,
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

function GuestBadges({ guest }) {
  return (
    <>
      {guest.is_vip && <Badge tone="accent">VIP</Badge>}
      {guest.is_blacklisted && <Badge tone="danger">قائمة سوداء</Badge>}
    </>
  );
}

function GuestOption({ guest, onPick }) {
  return (
    <button type="button" className="guest-option" onClick={() => onPick(guest)}>
      <Avatar name={guest.full_name} size={34} />
      <span className="grow">
        <b>{guest.full_name}</b>
        <span className="xsmall muted num" style={{ display: 'block' }}>{formatPhone(guest.phone)}</span>
      </span>
      <GuestBadges guest={guest} />
      {guest.total_stays > 0 && <span className="xsmall muted nowrap">{guest.total_stays} إقامة</span>}
    </button>
  );
}

/** رقم؟ (أرقام وفواصل فقط وطوله يصلح هاتفًا) — يحدّد هل نعبّئ حقل الهاتف أم الاسم */
const looksLikePhone = (text) => {
  const latin = latinDigits(text).trim();
  return /^[\d\s+()-]+$/.test(latin) && latin.replace(/\D/g, '').length >= 6;
};

function NewGuestForm({ form, onPick, onBack }) {
  const v = form.values;
  const phoneDigits = latinDigits(v.phone).replace(/\D/g, '');
  const idText = latinDigits(v.id_number).trim();
  // تكرار محتمل: نفس الهاتف (8 أرقام فأكثر) أو نفس الهوية (6 فأكثر)
  const lookup = phoneDigits.length >= 8 ? v.phone : (idText.length >= 6 ? v.id_number : '');
  const search = useGuestSearch(lookup);
  const duplicates = lookup && search.data ? search.data.rows : [];

  return (
    <div className="stack">
      <div className="row between">
        <b>نزيل جديد</b>
        <Button variant="ghost" size="sm" icon="arrow-right" onClick={onBack}>رجوع للبحث</Button>
      </div>

      {duplicates.length > 0 && (
        <Notice tone="warning" icon="users">
          <div className="stack sm">
            <span>في نزيل مسجّل بنفس البيانات — لو هو نفسه اختاره بدل ما تكرّر السجلّ:</span>
            <div className="guest-results">
              {duplicates.slice(0, 3).map((guest) => <GuestOption key={guest.id} guest={guest} onPick={onPick} />)}
            </div>
          </div>
        </Notice>
      )}

      <div className="grid cols-2">
        <Field label="الاسم الكامل" required error={form.errors.full_name}>
          {(p) => <Input {...p} autoFocus value={v.full_name} onChange={form.on('full_name')} placeholder="كما في بطاقة الهوية" autoComplete="off" />}
        </Field>
        <Field label="الهاتف" hint="لو الرقم مسجّل قبل كده الحجز بيتربط بنفس النزيل" error={form.errors.phone}>
          {(p) => <Input {...p} type="tel" dir="ltr" className="ltr-input" value={v.phone} onChange={form.on('phone')} placeholder="01012345678" autoComplete="off" />}
        </Field>
        <Field label="البريد الإلكتروني" hint="لإرسال تأكيد الحجز" error={form.errors.email}>
          {(p) => <Input {...p} type="email" dir="ltr" className="ltr-input" value={v.email} onChange={form.on('email')} autoComplete="off" />}
        </Field>
        <Field label="الجنسية" error={form.errors.nationality}>
          {(p) => <Input {...p} value={v.nationality} onChange={form.on('nationality')} placeholder="مصري" />}
        </Field>
        <Field label="نوع الهوية" error={form.errors.id_type}>
          {(p) => (
            <Select {...p} value={v.id_type} onChange={form.on('id_type')}>
              <option value="">غير محدّد</option>
              {Object.entries(ID_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="رقم الهوية" error={form.errors.id_number}>
          {(p) => <Input {...p} dir="ltr" className="ltr-input" value={v.id_number} onChange={form.on('id_number')} autoComplete="off" />}
        </Field>
      </div>
    </div>
  );
}

export default function GuestPicker({ guest, onChange, form, canOverride, blacklistOk, onBlacklistOk }) {
  const [text, setText] = useState('');
  const search = useGuestSearch(text);
  const term = latinDigits(text).trim();

  const pick = (data) => { onChange({ kind: 'existing', data }); setText(''); };
  const startNew = () => {
    const prefill = looksLikePhone(text) ? { phone: term } : { full_name: text.trim() };
    form.setValues((current) => ({ ...current, ...prefill }));
    onChange({ kind: 'new' });
  };

  if (guest?.kind === 'new') {
    return <NewGuestForm form={form} onPick={pick} onBack={() => onChange(null)} />;
  }

  if (guest?.kind === 'existing') {
    const data = guest.data;
    return (
      <div className="stack">
        <div className="guest-card">
          <Avatar name={data.full_name} size={44} />
          <div className="grow">
            <div className="row wrap" style={{ gap: 8 }}><b>{data.full_name}</b><GuestBadges guest={data} /></div>
            <div className="muted small row wrap" style={{ gap: 12 }}>
              {data.phone && <span className="num">{formatPhone(data.phone)}</span>}
              {data.email && <span className="ltr">{data.email}</span>}
              {data.total_stays > 0 && <span>{data.total_stays} إقامة سابقة</span>}
            </div>
            {data.notes && <div className="small soft" style={{ marginTop: 4 }}>{data.notes}</div>}
          </div>
          <Button size="sm" onClick={() => onChange(null)}>تغيير</Button>
        </div>
        {data.is_blacklisted && (
          <Notice tone="danger" icon="ban">
            <div className="stack sm">
              <span>النزيل ده في القائمة السوداء.{canOverride ? '' : ' الحجز له محتاج مدير أو مالك.'}</span>
              {canOverride && <Checkbox label="أتجاوز القائمة السوداء وأكمل الحجز" checked={blacklistOk} onChange={(event) => onBlacklistOk(event.target.checked)} />}
            </div>
          </Notice>
        )}
      </div>
    );
  }

  const rows = term.length >= 2 && search.data ? search.data.rows : [];
  return (
    <div className="stack">
      <SearchInput value={text} onChange={setText} placeholder="ابحث بالاسم أو الهاتف أو رقم الهوية…" aria-label="بحث عن نزيل" />
      {rows.length > 0 && (
        <div className="guest-results" style={{ opacity: search.isPlaceholderData ? 0.6 : 1 }}>
          {rows.map((row) => <GuestOption key={row.id} guest={row} onPick={pick} />)}
        </div>
      )}
      {term.length >= 2 && search.isSuccess && rows.length === 0 && <p className="muted small">مفيش نزيل مسجّل بالبيانات دي.</p>}
      <div className="row wrap">
        <Button variant={rows.length === 0 && term.length >= 2 ? 'primary' : 'secondary'} icon="plus" onClick={startNew}>
          {term.length >= 2 ? 'نزيل جديد بالبيانات دي' : 'نزيل جديد'}
        </Button>
        {term.length < 2 && <span className="muted small">أو اكتب حرفين على الأقل للبحث في النزلاء المسجّلين.</span>}
      </div>
    </div>
  );
}
