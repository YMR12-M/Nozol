/**
 * تحديد المنشأة من المسار `/properties/:propertyId/...` والتأكد أن المستخدم
 * يحقّ له الوصول إليها.
 *
 * القواعد:
 *   1) المنشأة لازم تتبع منظّمة المستخدم — وإلا نردّ 404 (لا 403) كي لا
 *      نكشف وجود منشآت عملاء آخرين.
 *   2) المالك يصل لكل منشآت منظّمته؛ باقي الأدوار فقط لما أُسنِدت لهم
 *      في `user_properties`.
 *
 * بعدها يكون `req.property` جاهزًا لكل الـ controllers تحته، وكل
 * الاستعلامات تُقيَّد بـ `property_id = req.property.id`.
 */
import { queryOne } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const PROPERTY_COLUMNS = `
  p.id, p.uuid, p.organization_id, p.slug, p.kind, p.name_ar, p.name_en,
  p.description_ar, p.description_en, p.phone, p.whatsapp, p.email,
  p.address_ar, p.address_en, p.city, p.governorate, p.latitude, p.longitude,
  p.timezone, p.currency, p.check_in_time, p.check_out_time,
  p.tax_bps, p.service_charge_bps, p.tax_on_service_charge, p.prices_include_tax,
  p.city_fee_per_night_minor, p.deposit_percent, p.hold_hours,
  p.cancellation_policy_ar, p.cancellation_policy_en, p.free_cancel_hours,
  p.invoice_prefix, p.booking_prefix, p.public_booking_enabled, p.status,
  p.created_at, p.updated_at
`;

export const propertyScope = asyncHandler(async (req, _res, next) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw ApiError.badRequest('معرّف المنشأة غير صالح', { code: 'BAD_PROPERTY_ID' });
  }

  const property = await queryOne(
    `SELECT ${PROPERTY_COLUMNS}
       FROM properties p
      WHERE p.id = ? AND p.organization_id = ? AND p.status <> 'archived'`,
    [propertyId, req.user.organization_id],
  );
  if (!property) throw ApiError.notFound('المنشأة غير موجودة', { code: 'PROPERTY_NOT_FOUND' });

  if (req.user.role !== 'owner') {
    const access = await queryOne(
      'SELECT 1 AS ok FROM user_properties WHERE user_id = ? AND property_id = ?',
      [req.user.id, propertyId],
    );
    if (!access) throw ApiError.notFound('المنشأة غير موجودة', { code: 'PROPERTY_NOT_FOUND' });
  }

  req.property = property;
  next();
});
