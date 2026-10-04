/**
 * رسوم الهوية: خطّ حبر مع تعبئة ملوّنة مُزاحة بضع نقاط (كأن طبقتَي الطباعة لم تنطبقا تمامًا)،
 * وكلها من أدوات مكتب الاستقبال. بلا مكتبة خارجية فتعمل بلا اتصال. الأنماط في components.css (.art).
 */

/** تعبئة مُزاحة تحت الخطّ؛ `tone`: fa نحاس · fb بحر · fc أحمر الفوّة */
const Fill = ({ tone = 'fa', d, children }) => (
  <g className={tone} transform="translate(5 4)">{d ? <path d={d} /> : children}</g>
);

const DRAWINGS = {
  /** باب مزدوج مقوّس وعلّاقته على المقبض */
  door: (
    <>
      <Fill d="M54 104V52a26 26 0 0 1 52 0v52z" />
      <path className="ln" d="M54 104V52a26 26 0 0 1 52 0v52" />
      <path className="ln thin" d="M62 104V54a18 18 0 0 1 36 0v50M80 36v68" />
      <circle className="solid" cx="73" cy="80" r="2.6" />
      <circle className="solid" cx="87" cy="80" r="2.6" />
      <path className="ln" d="M87 83v5" />
      <rect className="ln" x="82" y="88" width="10" height="14" rx="3" />
      <circle className="ln thin" cx="87" cy="93" r="1.6" />
      <path className="ln" d="M34 104h92" />
      <path className="ln thin" d="M120 30v8M116 34h8M42 46v6M39 49h6" />
    </>
  ),
  /** لوحة مفتاح مع مفتاحها */
  key: (
    <>
      <Fill tone="fb"><rect x="44" y="16" width="40" height="66" rx="11" /></Fill>
      <rect className="ln" x="44" y="16" width="40" height="66" rx="11" />
      <circle className="ln" cx="64" cy="31" r="5.5" />
      <path className="ln thin" d="M53 50h22M53 58h22M53 66h14" />
      <circle className="ln" cx="113" cy="94" r="11" />
      <circle className="ln thin" cx="113" cy="94" r="4" />
      <path className="ln" d="M102 94H58M70 94v9M78 94v6M86 94v9" />
      <path className="ln thin" d="M122 40v8M118 44h8" />
    </>
  ),
  /** حقيبة سفر بقسيمة */
  suitcase: (
    <>
      <Fill tone="fc"><rect x="36" y="40" width="88" height="58" rx="8" /></Fill>
      <rect className="ln" x="36" y="40" width="88" height="58" rx="8" />
      <path className="ln" d="M64 40V30a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v10" />
      <path className="ln thin" d="M58 40v58M102 40v58" />
      <rect className="ln" x="68" y="62" width="24" height="16" rx="2" />
      <path className="ln thin" d="M73 68h14M73 73h9" />
      <path className="ln" d="M30 104h100" />
    </>
  ),
  /** دفتر مفتوح بختم */
  ledger: (
    <>
      <Fill tone="fb" d="M80 36C66 28 46 28 32 34V92C46 86 66 86 80 94zM80 36C94 28 114 28 128 34V92C114 86 94 86 80 94z" />
      <path className="ln" d="M80 36C66 28 46 28 32 34V92C46 86 66 86 80 94zM80 36C94 28 114 28 128 34V92C114 86 94 86 80 94zM80 36v58" />
      <path className="ln thin" d="M42 48c8-3 18-3 28 0M42 58c8-3 18-3 28 0M42 68c8-3 18-3 28 0M42 78c8-3 18-3 28 0M90 48c10-3 20-3 28 0M90 58c10-3 20-3 28 0M90 68c10-3 20-3 28 0" />
      <Fill tone="fc"><circle cx="106" cy="80" r="9" /></Fill>
      <circle className="ln thin" cx="106" cy="80" r="9" />
      <path className="ln" d="M30 104h100" />
    </>
  ),
  /** كوب شاي على طبقه */
  tea: (
    <>
      <Fill d="M62 46h36l-4 40a8 8 0 0 1-8 7H74a8 8 0 0 1-8-7z" />
      <path className="ln" d="M62 46h36l-4 40a8 8 0 0 1-8 7H74a8 8 0 0 1-8-7z" />
      <path className="ln thin" d="M65 58h30" />
      <ellipse className="ln" cx="80" cy="99" rx="30" ry="6" />
      <path className="ln thin" d="M72 36c-4-5 4-8 0-14M82 34c-4-5 4-8 0-14M92 36c-4-5 4-8 0-14" />
      <path className="ln" d="M98 52l14-14" />
      <circle className="ln thin" cx="114" cy="36" r="3" />
    </>
  ),
  /** فانوس: الافتراضي لكل حالة فارغة */
  lantern: (
    <>
      <circle className="ln" cx="80" cy="14" r="4" />
      <path className="ln" d="M80 18v16" />
      <Fill d="M62 52L80 34l18 18z" />
      <path className="ln" d="M62 52L80 34l18 18zM60 52h40" />
      <path className="ln" d="M64 52h32v34l6 18H58l6-18z" />
      <path className="ln thin" d="M72 56v46M88 56v46" />
      <Fill d="M80 70c-5 6-5 12 0 15 5-3 5-9 0-15z" />
      <path className="ln thin" d="M80 70c-5 6-5 12 0 15 5-3 5-9 0-15z" />
      <path className="ln" d="M54 104h52" />
      <path className="ln thin" d="M118 40v8M114 44h8M40 60v6M37 63h6" />
    </>
  ),
  /** جرس الاستقبال */
  bell: (
    <>
      <Fill d="M52 86a28 28 0 0 1 56 0z" />
      <path className="ln" d="M52 86a28 28 0 0 1 56 0z" />
      <path className="ln" d="M80 58v-5" />
      <circle className="solid" cx="80" cy="50" r="3.5" />
      <path className="ln" d="M44 86h72v8a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4z" />
      <path className="ln thin" d="M62 80a18 18 0 0 1 14-14M30 58l-8-6M130 58l8-6M26 74h-9M134 74h9" />
    </>
  ),
};

/** `name`: door | key | suitcase | ledger | tea | lantern | bell */
export function Art({ name = 'lantern', width, className = '' }) {
  return (
    <svg className={`art ${className}`} style={width ? { width } : undefined} viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      {DRAWINGS[name] ?? DRAWINGS.lantern}
    </svg>
  );
}

/** أيقونة الحالة الفارغة ← الرسمة المناسبة لها (الصفحات تمرّر اسم أيقونة كالمعتاد) */
export const ART_FOR_ICON = {
  login: 'door', logout: 'suitcase', bed: 'key', receipt: 'ledger', users: 'tea', user: 'tea', sparkles: 'bell', bell: 'bell', calendar: 'ledger', wrench: 'key', file: 'ledger',
};

/**
 * مدخل فندق بالليل لشاشة الدخول: بوّابة مقوّسة مضاءة فيها مكتب استقبال وجرس ولوحة مفاتيح،
 * وفانوس معلّق. رسم مسطّح بلا تدرّجات، من متغيّرات الهوية فيتبع الوضع الليلي.
 */
export function LobbyScene() {
  const ink = { fill: 'var(--ink-800)' };
  const keys = Array.from({ length: 12 }, (_, i) => ({ x: 128 + (i % 6) * 17, y: 196 + Math.floor(i / 6) * 25 }));
  return (
    <svg className="lobby-scene" viewBox="0 0 360 410" aria-hidden="true" focusable="false">
      {/* بوّابة مقوّسة: إطار نحاسي ثم ضوء دافئ */}
      <path d="M44 372V168A136 136 0 0 1 316 168V372z" style={{ fill: 'var(--ink-800)', stroke: 'var(--brass-400)', strokeWidth: 3 }} />
      <path d="M64 372V172A116 116 0 0 1 296 172V372z" style={{ fill: 'var(--brass-100)' }} />
      <path d="M64 372V172A116 116 0 0 1 296 172V372z" style={{ fill: 'none', stroke: 'var(--ink-800)', strokeWidth: 1.5, opacity: 0.45 }} />

      {/* لوحة المفاتيح على الجدار */}
      <rect x="116" y="170" width="128" height="76" rx="6" style={{ fill: 'var(--paper-300)', stroke: 'var(--ink-800)', strokeWidth: 2 }} />
      {keys.map((k, i) => (
        <g key={i}>
          <circle cx={k.x + 5} cy={k.y - 6} r="1.8" style={ink} />
          <rect x={k.x} y={k.y} width="10" height="14" rx="2.5" style={{ fill: i % 5 === 0 ? 'var(--brass-500)' : 'var(--ink-800)' }} />
        </g>
      ))}

      {/* مكتب الاستقبال وجرسه */}
      <path d="M86 372V312H274V372z" style={ink} />
      <path d="M78 312H282V322H78z" style={{ fill: 'var(--ink-900)' }} />
      <path d="M168 312a14 14 0 0 1 28 0z" style={{ fill: 'var(--brass-500)' }} />
      <rect x="164" y="311" width="36" height="4" rx="2" style={{ fill: 'var(--brass-600)' }} />
      <rect x="178" y="292" width="4" height="6" style={{ fill: 'var(--brass-600)' }} />

      {/* فانوس معلّق من قمة القوس */}
      <path d="M180 40V86" style={{ fill: 'none', stroke: 'var(--brass-300)', strokeWidth: 2 }} />
      <circle cx="180" cy="36" r="5" style={{ fill: 'none', stroke: 'var(--brass-300)', strokeWidth: 2 }} />
      <path d="M160 108L180 86L200 108z" style={{ fill: 'var(--brass-500)', stroke: 'var(--ink-800)', strokeWidth: 2 }} />
      <path d="M163 108H197V148L205 168H155L163 148z" style={{ fill: 'var(--brass-200)', stroke: 'var(--ink-800)', strokeWidth: 2 }} />
      <path d="M172 110V166M188 110V166" style={{ fill: 'none', stroke: 'var(--ink-800)', strokeWidth: 1.4 }} />
      <path d="M180 122c-5 6-5 12 0 15 5-3 5-9 0-15z" style={{ fill: 'var(--madder-500)' }} />
      <path d="M152 168H208" style={{ fill: 'none', stroke: 'var(--ink-800)', strokeWidth: 2 }} />

      {/* درجات المدخل */}
      <rect x="34" y="372" width="292" height="12" style={{ fill: 'var(--ink-700)', stroke: 'var(--brass-400)', strokeWidth: 1.5 }} />
      <rect x="20" y="384" width="320" height="12" style={{ fill: 'var(--ink-700)', stroke: 'var(--brass-400)', strokeWidth: 1.5 }} />
      {/* نجوم */}
      <path d="M22 70v12M16 76h12M338 110v10M333 115h10M60 30v8M56 34h8" style={{ fill: 'none', stroke: 'var(--brass-300)', strokeWidth: 1.6, strokeLinecap: 'round' }} />
    </svg>
  );
}

/**
 * فلاتر SVG مشتركة تُعرَّف مرّة واحدة في App: `#ink-rough` يخشّن حواف الختم ويبقّعه كحبر غير متساوٍ.
 * لو غابت ظهر الختم عاديًّا بلا خشونة (تدهور سليم).
 */
export function InkFilters() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <filter id="ink-rough" x="-6%" y="-10%" width="112%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.7" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="9" result="speck" />
          <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.65" result="holes" />
          <feComposite in="rough" in2="holes" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}
