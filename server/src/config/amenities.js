/**
 * كتالوج المرافق الثابت. الوحدة تحمل مفاتيح فقط، والواجهات تترجم.
 * ثابت في الكود (لا جدول) كي تكون القيم المسموحة معروفة وقابلة للتحقّق.
 */
export const AMENITIES = {
  wifi: { ar: 'واي فاي', en: 'Wi-Fi' },
  ac: { ar: 'تكييف', en: 'Air conditioning' },
  heating: { ar: 'تدفئة', en: 'Heating' },
  tv: { ar: 'تلفزيون', en: 'TV' },
  satellite: { ar: 'ريسيفر', en: 'Satellite TV' },
  private_bathroom: { ar: 'حمام خاص', en: 'Private bathroom' },
  hot_water: { ar: 'مياه ساخنة', en: 'Hot water' },
  kitchen: { ar: 'مطبخ', en: 'Kitchen' },
  kitchenette: { ar: 'مطبخ صغير', en: 'Kitchenette' },
  fridge: { ar: 'ثلاجة', en: 'Fridge' },
  minibar: { ar: 'ميني بار', en: 'Minibar' },
  balcony: { ar: 'بلكونة', en: 'Balcony' },
  terrace: { ar: 'تراس', en: 'Terrace' },
  sea_view: { ar: 'إطلالة على البحر', en: 'Sea view' },
  pool_view: { ar: 'إطلالة على حمّام السباحة', en: 'Pool view' },
  garden_view: { ar: 'إطلالة على الحديقة', en: 'Garden view' },
  nile_view: { ar: 'إطلالة على النيل', en: 'Nile view' },
  private_pool: { ar: 'حمّام سباحة خاص', en: 'Private pool' },
  shared_pool: { ar: 'حمّام سباحة مشترك', en: 'Shared pool' },
  beach_access: { ar: 'وصول للشاطئ', en: 'Beach access' },
  parking: { ar: 'موقف سيارات', en: 'Parking' },
  breakfast: { ar: 'إفطار', en: 'Breakfast' },
  washing_machine: { ar: 'غسّالة', en: 'Washing machine' },
  hair_dryer: { ar: 'سشوار', en: 'Hair dryer' },
  safe: { ar: 'خزنة', en: 'Safe' },
  elevator: { ar: 'مصعد', en: 'Elevator' },
  family_friendly: { ar: 'مناسب للعائلات', en: 'Family friendly' },
  pets_allowed: { ar: 'يسمح بالحيوانات الأليفة', en: 'Pets allowed' },
  accessible: { ar: 'مجهّز لذوي الإعاقة', en: 'Accessible' },
};

export const AMENITY_KEYS = Object.keys(AMENITIES);
