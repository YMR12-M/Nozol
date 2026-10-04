/** تسميات عربية لقيم النظام — مصدر واحد لكل الواجهة */

export const STATUS_LABELS = {
  pending: 'معلّق', confirmed: 'مؤكّد', checked_in: 'مقيم', checked_out: 'غادر', cancelled: 'ملغي', no_show: 'لم يحضر',
};
export const STATUS_ORDER = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

export const SOURCE_LABELS = {
  direct: 'مباشر', phone: 'هاتف', walk_in: 'زيارة', website: 'الموقع', booking_com: 'Booking.com', airbnb: 'Airbnb', other: 'أخرى',
};
export const STAFF_SOURCES = ['direct', 'phone', 'walk_in', 'booking_com', 'airbnb', 'other'];

export const METHOD_LABELS = {
  cash: 'نقدًا', card: 'بطاقة', bank_transfer: 'تحويل بنكي', instapay: 'إنستاباي', wallet: 'محفظة', other: 'أخرى',
};
export const EXPENSE_METHOD_LABELS = { cash: 'نقدًا', bank: 'بنك', card: 'بطاقة', other: 'أخرى' };

export const ROLE_LABELS = {
  owner: 'مالك', manager: 'مدير', front_desk: 'استقبال', housekeeping: 'نظافة وتجهيز', accountant: 'محاسب', viewer: 'مشاهدة فقط',
};

export const HK_LABELS = { dirty: 'تحتاج تنظيف', cleaning: 'قيد التنظيف', clean: 'نظيفة', inspected: 'تم الفحص' };
export const HK_COLORS = { dirty: 'var(--hk-dirty)', cleaning: 'var(--hk-cleaning)', clean: 'var(--hk-clean)', inspected: 'var(--hk-inspected)' };

export const OCCUPANCY_LABELS = { occupied: 'مشغولة', departing: 'تغادر اليوم', arriving: 'تصل اليوم', vacant: 'فاضية' };

export const TASK_TYPE_LABELS = {
  checkout_clean: 'تنظيف بعد المغادرة', stayover_clean: 'تنظيف الإقامة', inspection: 'فحص', deep_clean: 'تنظيف عميق', turndown: 'تجهيز مسائي', other: 'أخرى',
};
export const TASK_STATUS_LABELS = { pending: 'في الانتظار', in_progress: 'جارٍ', done: 'تمّ', verified: 'تم الفحص', skipped: 'تم التخطّي' };

export const PRIORITY_LABELS = { low: 'منخفضة', normal: 'عادية', high: 'مهمة', urgent: 'عاجلة' };
export const PRIORITY_BADGE = { low: '', normal: '', high: 'warning', urgent: 'danger' };

export const MAINT_STATUS_LABELS = { open: 'مفتوح', in_progress: 'جارٍ', waiting_parts: 'ينتظر قطع غيار', resolved: 'تمّ الحل', cancelled: 'ملغي' };

export const ID_TYPE_LABELS = { national_id: 'بطاقة رقم قومي', passport: 'جواز سفر', other: 'أخرى' };

export const MEAL_LABELS = { RO: 'بدون وجبات', BB: 'إفطار', HB: 'نصف إقامة', FB: 'إقامة كاملة', AI: 'شامل كل شيء' };

export const UNIT_KIND_LABELS = { room: 'غرفة', suite: 'جناح', chalet: 'شاليه', villa: 'فيلا', apartment: 'شقة' };
export const PROPERTY_KIND_LABELS = { hotel: 'فندق', guesthouse: 'بيت ضيافة', chalet: 'شاليهات', apartments: 'شقق فندقية', resort: 'منتجع', hostel: 'نُزل شبابي' };

export const BLOCK_REASON_LABELS = { maintenance: 'صيانة', owner_use: 'استخدام المالك', ical: 'تقويم خارجي', other: 'أخرى' };

export const AMENITIES = {
  wifi: 'واي فاي', ac: 'تكييف', heating: 'تدفئة', tv: 'تلفزيون', satellite: 'ريسيفر', private_bathroom: 'حمام خاص',
  hot_water: 'مياه ساخنة', kitchen: 'مطبخ', kitchenette: 'مطبخ صغير', fridge: 'ثلاجة', minibar: 'ميني بار',
  balcony: 'بلكونة', terrace: 'تراس', sea_view: 'إطلالة على البحر', pool_view: 'إطلالة على حمّام السباحة',
  garden_view: 'إطلالة على الحديقة', nile_view: 'إطلالة على النيل', private_pool: 'حمّام سباحة خاص',
  shared_pool: 'حمّام سباحة مشترك', beach_access: 'وصول للشاطئ', parking: 'موقف سيارات', breakfast: 'إفطار',
  washing_machine: 'غسّالة', hair_dryer: 'سشوار', safe: 'خزنة', elevator: 'مصعد', family_friendly: 'مناسب للعائلات',
  pets_allowed: 'يسمح بالحيوانات الأليفة', accessible: 'مجهّز لذوي الإعاقة',
};

export const DOW_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'جنوب سيناء', 'شمال سيناء', 'البحر الأحمر', 'مطروح', 'الأقصر', 'أسوان', 'الفيوم',
  'بورسعيد', 'السويس', 'الإسماعيلية', 'دمياط', 'الدقهلية', 'الشرقية', 'القليوبية', 'كفر الشيخ', 'الغربية', 'المنوفية',
  'البحيرة', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الوادي الجديد',
];

export const AUDIT_ACTION_LABELS = {
  'reservation.create': 'إنشاء حجز', 'reservation.create_public': 'حجز من الموقع', 'reservation.update': 'تعديل حجز',
  'reservation.confirm': 'تأكيد حجز', 'reservation.check_in': 'تسجيل دخول', 'reservation.check_out': 'تسجيل خروج',
  'reservation.cancel': 'إلغاء حجز', 'reservation.cancel_public': 'إلغاء من النزيل', 'reservation.no_show': 'عدم حضور',
  'reservation.change_dates': 'تعديل التواريخ', 'reservation.move_unit': 'نقل غرفة',
  'payment.payment': 'تسجيل دفعة', 'payment.refund': 'مرتجع', 'payment.void': 'إلغاء دفعة',
  'folio.add': 'إضافة بند', 'folio.void': 'إلغاء بند', 'invoice.issue': 'إصدار فاتورة', 'invoice.void': 'إلغاء فاتورة',
  'shift.open': 'فتح وردية', 'shift.close': 'إقفال وردية', 'expense.create': 'تسجيل مصروف', 'expense.void': 'إلغاء مصروف',
  'guest.create': 'إضافة نزيل', 'guest.update': 'تعديل نزيل', 'guest.delete': 'حذف نزيل',
  'property.update': 'تعديل المنشأة', 'unit_type.update': 'تعديل نوع وحدة', 'price_rule.create': 'قاعدة سعر جديدة',
  'price_rule.update': 'تعديل قاعدة سعر', 'price_rule.delete': 'حذف قاعدة سعر', 'rate_plan.update': 'تعديل خطة سعر',
  'user.create': 'إضافة موظف', 'user.update': 'تعديل موظف', 'user.delete': 'حذف موظف', 'user.temp_password': 'كلمة مؤقتة',
  'unit.update': 'تعديل وحدة', 'unit.block': 'حجب وحدة', 'unit.unblock': 'رفع حجب',
  'auth.login': 'تسجيل دخول للنظام', 'auth.password_changed': 'تغيير كلمة المرور',
  'report.export_reservations': 'تصدير الحجوزات', 'report.export_payments': 'تصدير المدفوعات',
};
