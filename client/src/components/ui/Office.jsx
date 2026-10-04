/**
 * أدوات مكتب الاستقبال: ما يضعه الموظف أمامه كل يوم، بشكل رقمي.
 * (الأنماط في components.css و pages.css — والفكرة كلها في docs/BRAND.md)
 */
import { STATUS_LABELS, HK_COLORS, HK_LABELS } from '../../lib/constants.js';

/** ختم الحالة (مؤكّد · مقيم · ملغي …): يضرب الصفحة بحركة، ويُعاد ضربه عند تغيّر الحالة */
export function Stamp({ status, size = '', children }) {
  return <span key={status} className={`stamp st-${status} ${size}`}>{children ?? STATUS_LABELS[status] ?? status}</span>;
}

/** لوحة نحاسية برقم الغرفة */
export function Plate({ children, size = '' }) {
  return <span className={`plate ${size}`}>{children}</span>;
}

/** أكواد الوحدات «101، 102» ← لوحة لكل وحدة */
export function Plates({ codes, size = 'sm' }) {
  if (!codes) return <span className="muted">—</span>;
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {String(codes).split('،').map((code) => <Plate key={code} size={size}>{code.trim()}</Plate>)}
    </span>
  );
}

/**
 * أبواب الليلة: باب لكل وحدة قابلة للبيع. مغلق بنحاس = مشغولة، مخطّط = محجوز مؤقتًا، مفتوح = فاضية.
 * (نقتصر على 72 بابًا ثم «+ن»، فالمنشآت الكبيرة تعرض الأرقام لا الصور.)
 */
export function Doors({ total, occupied = 0, held = 0, label }) {
  const shown = Math.min(total, 72);
  const doors = Array.from({ length: shown }, (_, i) => (i < occupied ? 'is-occupied' : i < occupied + held ? 'is-held' : ''));
  return (
    <div className="doors" role="img" aria-label={label ?? `${occupied} مشغولة من ${total}`}>
      {doors.map((state, i) => <span key={i} className={`door ${state}`} />)}
      {total > shown && <span className="muted small num" style={{ alignSelf: 'center' }}>+{total - shown}</span>}
    </div>
  );
}

/** علّاقة باب بحالة النظافة وعدد الغرف فيها */
export function Hanger({ status, count }) {
  return (
    <div className="hanger" style={{ '--hk-color': HK_COLORS[status] }} title={HK_LABELS[status]}>
      <b className="num">{count}</b>
      <span className="muted xsmall">{HK_LABELS[status]}</span>
    </div>
  );
}

/**
 * نتيجة الحائط: يوم بغطاء أحمر وثقبين، والأيام الهجرية والقبطية تحتها كما في كل نتيجة مصرية.
 * التاريخ نصّ ISO بتوقيت المنشأة فلا تحويل منطقة زمنية.
 */
export function TearCalendar({ iso }) {
  const date = new Date(`${iso}T12:00:00Z`);
  const part = (options, calendar) => new Intl.DateTimeFormat(
    `ar-EG-u-nu-latn${calendar ? `-ca-${calendar}` : ''}`,
    { timeZone: 'UTC', ...options },
  ).format(date);

  return (
    <div className={`tearcal ${date.getUTCDay() === 5 ? 'is-friday' : ''}`} role="img" aria-label={part({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
      <div className="tearcal-top">{part({ month: 'long' })}<small className="num">{date.getUTCFullYear()}</small></div>
      <div className="tearcal-day num">{date.getUTCDate()}</div>
      <div className="tearcal-weekday">{part({ weekday: 'long' })}</div>
      <div className="tearcal-foot">
        <span>{part({ day: 'numeric', month: 'long', year: 'numeric' }, 'islamic-umalqura')}</span>
        <span>{part({ day: 'numeric', month: 'long' }, 'coptic')}</span>
      </div>
    </div>
  );
}
