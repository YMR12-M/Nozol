# نُزُل — حالة التنفيذ

آخر تحديث: 2026-10-04. ملف شغل مؤقت لمن يكمل المشروع: يتشال أو يتحوّل لـ `ARCHITECTURE.md` لما المشروع يخلص.

## الهدف
نظام إدارة كامل للفنادق الصغيرة والشاليهات وبيوت الضيافة في مصر: لوحة إدارة ويب + تطبيق موبايل + تطبيق ديسكتوب + صفحة حجز عامة. المطلوب جودة «شغل حقيقي» لا نموذج أوّلي. المكدّس: HTML/CSS/JS + React + Node + Express + MySQL.
المشروع التوأم «مصروفي» في `../../Masrofy` (خطّته في `Masrofy/docs/PLAN.md`) بنفس البنية والأعراف.

## المستودع
- GitHub **خاص**: `YMR12-M/Nozol` (الفرع `main` فيه أول commit: السيرفر والواجهة وصفحتا الحجز). `.gitignore` جاهز (يستثني `node_modules` و`dist` و`.env` و`uploads`…).
- **الهوية البصرية الجديدة («مكتب الاستقبال»)** على فرع محلي `design/hospitality-identity`، **لم تُدمج في `main` ولم تُرفع** لحين موافقة صاحب المشروع. الشرح الكامل في [`docs/BRAND.md`](BRAND.md).

## اللي خلص

### `server/` — كامل ومختبَر
- 171 اختبار تكامل ووحدة كلها ناجحة (منها سباق حجز متزامن: 8 طلبات على 3 غرف ← 3 حجوزات بالظبط بلا تكرار).
- منع الحجز المزدوج على مستوى القاعدة (`unit_nights` بمفتاح وحدة+ليلة)، محرّك تسعير صرف (قواعد موسمية، رسوم أفراد، وجبات، قيود إقامة، أكواد خصم، خدمة وضريبة)، فوترة ودفعات وورديات ومصروفات، نظافة وصيانة، iCal استيراد وتصدير (مع حماية SSRF)، واجهة حجز عامة، تقارير وتصدير CSV، مصادقة (JWT قصير + refresh دوّار مع كشف إعادة الاستخدام)، صلاحيات حسب الدور، سجل تدقيق.
- أُضيف في هذه الجلسة: `POST /properties/:id/reservations/quote` (معاينة سعر حجز كامل بنفس مسار الإنشاء، انظر «بيانات مفيدة») و«اختبار `GET /availability/units`» (الأنسب أولًا + استثناء حجز بعينه). فُصل `preparePlan` إلى `priceRooms` + التحقق من الكود الترويجي ولم يتغيّر سلوك الإنشاء.

### `client/` — قيد التنفيذ (لوحة الإدارة)
- جاهز: التصميم **بهوية «مكتب الاستقبال»** (`src/styles`: tokens وbase وcomponents وlayout وpages وprint؛ والأدوات في `components/ui/Office.jsx` و`Art.jsx`، والتفصيل في `docs/BRAND.md`)، `src/lib` (api وformat وconstants وicons وhooks وforms وcalendar **وreservations**)، `src/context` (Auth وProperty وToast وTheme)، `src/components/ui` (Controls وDisplay وOverlays) و`layout/Shell.jsx`، `App.jsx` (المسارات).
- صفحات جاهزة: Login وForgotPassword وResetPassword وMustChangePassword وOnboarding وToday وCalendarPage (تقويم الإشغال) وReservations **وNewReservation وReservationDetail**.
  - `components/reservation/`: `GuestPicker` (بحث/نزيل جديد/تنبيه تكرار/قائمة سوداء) · `RoomLine` (سطر غرفة: ضيوف + عروض الأنواع والخطط + اختيار غرفة بعينها) · `StayModals` (دخول، خروج، إلغاء، عدم حضور، تعديل تواريخ، نقل غرفة) · `BillingModals` (دفعة/مرتجع، بند فاتورة، إصدار فاتورة، تعديل بيانات الحجز).
  - `lib/reservations.js` منطق خالص (بناء جسم الطلب، الإجراءات المتاحة لكل حالة وصلاحية، مراجعة الدخول والخروج، صفوف الإجماليات…) وله `reservations.test.js` (31 اختبار vitest). وأُضيف `src/test/setup.js` فصار `npm test` يعمل.
- راجعنا في المتصفح (قاعدة مؤقتة حُذفت) صفحات Reservations وNewReservation وReservationDetail كاملة بأدوار المالك والاستقبال، ديسكتوب وموبايل، داكن وفاتح: الإنشاء (غرف متعدّدة، كود خصم ثابت، قيد حدّ أدنى مع التجاوز، نزيل جديد بمطابقة الهاتف، نزيل محظور، حجز معلّق بعربون، فتح من التقويم و`?guest=`)، والتفاصيل (تأكيد، دخول مبكّر وتعارضه، خروج برصيد، إلغاء بغرامة، عدم حضور، دفعة وإلغاؤها، بنود، فاتورة، تمديد وتعارض ونقل تلقائي، نقل غرفة). **باقي الصفحات لم تُراجَع في متصفح.**
- بعد إعادة التصميم رُوجعت في المتصفح (ديسكتوب 1360 و1000 وموبايل 375، فاتح وداكن) صفحات: الدخول، اليوم، التقويم، الحجوزات، الحجز الجديد، تفاصيل الحجز مع نافذة الدفعة، والإعداد الأولي؛ وفُحص التباين (`npm run check:contrast`) فنجحت كل الأزواج. صُحّحت في المرور نفسه أخطاء قديمة: ظهور «0» بجوار اسم النزيل غير الـVIP، وتشوّه ترتيب أرقام داخل جمل عربية (`.num` على نص مختلط).
- **صفحات ناقصة** (`App.jsx` يستوردها بـ `lazy` فالبناء `npm run build` يفشل لحد ما تتكتب): Guests، GuestDetail، Rooms، Rates، Housekeeping، Maintenance، Billing، Reports، Channels، Team، Settings، Account، Audit، PrintInvoice، PrintRegistration، PublicBooking (ثنائية اللغة وقابلة للتضمين)، NotFound.
  - صفحة التفاصيل تربط: `/print/invoice/:invoiceId` (معرّف الفاتورة)، `/print/registration/:reservationId` (استمارة التسجيل)، `/guests/:id`، و`/billing` (فتح وردية). وصفحة الحجز الجديد تقبل `?guest=<id>` فزر «حجز جديد» في ملف النزيل يكفيه الرابط.
- ناقص كذلك: اختبارات vitest لـ `lib/calendar.js` (`barPlacement` و`buildTape`)، واختبارات مكوّنات (RTL)، ورابط لصفحة `/settings/account` في الشريط الجانبي.
- لم يُدعَم في «حجز جديد»: الحجز بأثر رجعي (تاريخ وصول قبل اليوم)؛ السيرفر يقبله بـ `override.past` لكن بحث التوافر لا يقبل ماضيًا، فالواجهة تمنعه.

## الترتيب المقترح للباقي
1. صفحات الواجهة الناقصة. الأنسب بعد ما بُني: PrintInvoice وPrintRegistration (مرتبطتان من تفاصيل الحجز)، ثم Guests وGuestDetail.
2. مراجعة كل صفحة جديدة في المتصفح (على قاعدة مؤقتة).
3. اختبارات الواجهة (`lib/calendar.js` أولًا).
4. `mobile/` (واجهة لمس للموظفين: اليوم، الحجوزات، النظافة، الصيانة، المدفوعات، إشعارات) بـ Capacitor.
5. `desktop/` بـ Electron: جسر `window.nozolDesktop` (`getRefreshToken` و`setRefreshToken` و`clearRefreshToken`)، طباعة صامتة، ضبط عنوان الـ API، `electron-builder`، والبناء عبر GitHub Actions.
6. ودجت الحجز العام (سكربت تضمين بلا مكتبات)، `README` عربي، `docs/` (ARCHITECTURE وAPI وDATABASE وDEPLOY؛ **BRAND جاهز** و`.gitignore` جاهز)، Dockerfile وcompose.

## التشغيل محليًا
- MySQL 8 بحساب `root` بلا كلمة سر. القواعد الموجودة: `nozol` (مُهاجَرة وفاضية، بلا مستخدمين) و`nozol_test`.
- السيرفر (من `server/`): بورت **4010**. `npm install` ثم `npm run db:setup` (هجرات + إنشاء المنظّمة والمالك الأول؛ `db:bootstrap` يقبل `--org --name --email --phone --password` أو متغيّرات ORG_NAME/ADMIN_*) ثم `npm run dev`.
- الاختبارات: `npm test` من `server/` (171). لا تحتاج `.env` محليًا: القيم الافتراضية تشير إلى `root` بلا كلمة سر وقاعدة `nozol_test`، والاختبارات تمسح بياناتها فاسم القاعدة لازم ينتهي بـ `_test`. واختبارات الواجهة: `npm test` من `client/`.
- الواجهة (من `client/`): بورت **5180** (الموبايل المخطّط 5181) والبروكسي يوجّه `/api` و`/uploads` للسيرفر.
- **للمراجعة في المتصفح:** أنشئ قاعدة مؤقتة (مثلًا `nozol_ui`) وشغّل `DB_NAME=nozol_ui npm run db:setup` ثم السيرفر عليها، وامسحها بعد المراجعة. لا تضع بيانات تجريبية في قاعدة `nozol`؛ صاحب المشروع لا يريد بيانات وهمية. جهّز البيانات (منشأة وأنواع وخطط) عبر الـ API نفسه، وبيانات الدخول المؤقتة تُحفظ خارج المشروع.
- **تشغيل الواجهة قبل اكتمال الصفحات:** `vite` يرفض الإقلاع بسبب استيرادات `App.jsx` الناقصة. استعملنا ملف إعداد خارج المشروع (`--config`) فيه plugin صغير (`resolveId` + `load`) يحوّل أي `./pages/X.jsx` غير موجود إلى مكوّن فارغ؛ لا تضعه داخل `client/`.

## أعراف لازم تتّبع
- كود بنفس أسلوب باقي المشاريع: تعليقات عربية، ESM، Express 4 + mysql2 + Zod، فحص البيئة عند الإقلاع، ردود `{success, data}`.
- **المال أعداد صحيحة بالقروش** في كل مكان، والنسب بـ basis points، والتواريخ نصوص `YYYY-MM-DD` تُحسب بـ UTC، ومنطقة المنشأة الزمنية لتحديد «اليوم» فقط.
- أخطاء الـ API تصل للواجهة كـ `error.code` و`error.errors` (خريطة حقول؛ الحقول المتداخلة بمفتاح منقوط مثل `guest.phone`). `ApiRequestError` يحمل رسالة عربية جاهزة. ولاحظ: `errors` قد لا يكون خريطة نصوص (`STAY_RESTRICTED` يحمل `rooms` أو `violations`، و`UNIT_NOT_AVAILABLE` يحمل `occupied`).
- أرسل `null` لا `''` في `birth_date` و`id_type`، ولا `unit_id: null` في سطر غرفة (احذف المفتاح). باقي النصوص الفارغة تتحوّل إلى `null` عند السيرفر.
- كل إجراء مدمّر في الواجهة يمرّ بـ `useConfirm()` (ومعه `reason: { required: true }` لو يلزم سبب). نافذة `Modal` تقرأ `onClose` عبر مرجع، فلا تقلق من تمرير دالة جديدة في كل رسم.
- الألوان والمقاسات من `tokens.css` فقط. المستثنى عمدًا: `print.css` (ورق الطباعة ثابت الألوان ولا يتبع الثيم) وطبقات `rgba` الشفافة (ظلال، وتظليل فوق الغلاف الحبري). لو غيّرت لونًا شغّل `npm run check:contrast` من `client/`.
- **عناصر الهوية في الصفحات الجديدة:** أرقام الغرف `Plate/Plates`، حالة الحجز `Stamp` في الرأس و`StatusBadge` في القوائم، الجداول المالية `table ledger` (والطويلة `wide`)، الفراغ `EmptyState` برسم. **أعلام MySQL (`is_vip`…) تصل `0/1`** فاكتب `Boolean(x) && …` وإلا طُبع «0». والقائمة الكاملة في `docs/BRAND.md` («أعراف للصفحات القادمة»).
- **اتجاه الأرقام والتواريخ (RTL):** `.num` يفرض LTR ويصلح للأرقام والهواتف والمبالغ فقط (**لا تضعه على جملة فيها كلمات عربية**، لُفّ كل رقم بـ`<span className="num">` على حدة). دوال التواريخ والأوقات في `format.js` ترجع نصًّا معزولًا RTL (علامات RLI/PDI) فتظهر «4 أكتوبر 2026» بترتيبها الطبيعي حتى داخل `.num`؛ لكن **نطاق التواريخ «A ← B» يوضع في `.range` لا `.num`** (وإلا انقلب ترتيب الوصول والمغادرة)، وفي حاويات flex/grid لا تلفّ التاريخ بـ `.num` وإلا تحاذى يسارًا. `formatMoney` يحذف LRM الذي يضعه `Intl` قبل السالب (وإلا انقلب مكان «ج.م.» للمبالغ السالبة)، و`whatsappLink` يحذف علامات العزل من نص الرسالة.
- `api.get` يُرجع `null` لرد `data: null` (مثل `GET /shifts/current` بلا وردية) ولا يستبدله بجسم الرد.
- بلا اعتماد على Docker محليًا (غير مثبّت)، وبناء أندرويد وiOS يحتاج SDK وXcode غير موجودين على الجهاز.

## بيانات مفيدة لصفحات الحجز
- البحث: `GET /availability?check_in&check_out&adults&children&promo_code` يرجع `results[]`، لكل نوع `unit_type` و`available_units` و`capacity_ok` و`plans[]`. كل خطة فيها `rate_plan` و`nightly` و`totals` و`deposit_due_minor` و`bookable` و`violations` و`promo`. (عروض للاختيار فقط: سعر **غرفة واحدة** بعدد ضيوف البحث.)
- اختيار غرفة بعينها: `GET /availability/units?unit_type_id&check_in&check_out&exclude_reservation_id?` — الفاضية بالأنسب أولًا (`id, code, floor, housekeeping_status`)، والاستثناء لتعديل حجز قائم.
- **معاينة السعر النهائي:** `POST /reservations/quote` بجسم `{ check_in, check_out, adults?, children?, rooms: [{unit_type_id, adults?, children?, rate_plan_id?}], rate_plan_id?, promo_code? }` ← `{ nights, rooms[], promo: {code, valid, discount_minor, message?}, bookable, violations: [{room, violations}], totals: {…, breakdown}, deposit_due_minor }`. تطابق الحجز المُنشأ بالقرش (خصم واحد على المجموع)، ولا ترمي عند القيود أو الكود المرفوض. لا تجمع عروض غرف منفصلة في الواجهة (كان الخصم الثابت يتكرّر).
- الإنشاء: `POST /reservations` بجسم `{ guest: {id} | {full_name, phone, …}, check_in, check_out, adults, children, rooms: [{unit_type_id, unit_id?, adults?, children?, rate_plan_id?}], promo_code?, status: 'confirmed'|'pending', source, expected_arrival?, guest_notes?, internal_notes?, deposit?: {method, amount_minor, reference?}, override?: {restrictions?, blacklist?, past?} }`.
- خطأ `STAY_RESTRICTED` (422) يحمل `errors.rooms = [{room, violations: [{code, message}]}]` عند الإنشاء و`errors.violations` عند تعديل التواريخ، والمالك والمدير فقط يتجاوزونه بـ `override.restrictions`. أخطاء أخرى: `NO_AVAILABILITY` و`UNIT_NOT_AVAILABLE` (+ `errors.occupied`) و`GUEST_BLACKLISTED` و`PROMO_*`.
- تفاصيل الحجز `GET /reservations/:id` يرجع الحجز مع `segments[].nights` و`items` و`payments` و`invoices`. العمليات: `confirm` و`check-in` و`check-out` و`cancel` و`no-show` و`change-dates` و`move` و`items` و`payments` و`invoices`. أكواد الأخطاء المفيدة: `TOO_EARLY` و`UNIT_NOT_READY` و`UNIT_OUT_OF_ORDER` و`BALANCE_DUE` و`RESERVATION_PENDING` و`STAY_ENDED` و`ARRIVAL_LOCKED` و`PAST_DATE` و`PAST_NIGHTS` و`INVOICE_EXISTS`.
- بحث النزلاء/الحجوزات بالهاتف (`q`) يطابق `LIKE %digits%` على الرقم المخزَّن `+20…`؛ فالرقم المحلي `010…` يطابق لأن صفر الدولة `+20` يلتقي بالصفر الأولى. يعمل للأرقام المصرية؛ أي صيغة محلية أخرى تحتاج تطبيعًا.
