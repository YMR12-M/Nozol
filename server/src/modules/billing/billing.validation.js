import { z } from 'zod';
import { idSchema, isoDate, minorAmount, optionalText, pagingSchema } from '../../utils/schemas.js';

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'instapay', 'wallet', 'other'];

export const paymentSchema = z.object({
  type: z.enum(['payment', 'refund']).default('payment'),
  method: z.enum(PAYMENT_METHODS),
  amount_minor: minorAmount.refine((value) => value > 0, 'المبلغ لازم يكون أكبر من صفر'),
  reference: optionalText(120),
  note: optionalText(255),
});

/** إضافة بند للفاتورة: خدمة من الكتالوج، أو بند حرّ، أو خصم، أو رسم */
export const folioItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('service'),
    service_id: idSchema,
    quantity: z.number().positive().max(1000).default(1),
    description: optionalText(190),
  }),
  z.object({
    kind: z.literal('charge'),
    description: z.string().trim().min(2).max(190),
    unit_price_minor: minorAmount,
    quantity: z.number().positive().max(1000).default(1),
    taxable: z.boolean().default(true),
    service_chargeable: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('discount'),
    description: z.string().trim().min(2).max(190),
    amount_minor: minorAmount.refine((value) => value > 0, 'مبلغ الخصم لازم يكون أكبر من صفر'),
  }),
  z.object({
    kind: z.literal('fee'),
    description: z.string().trim().min(2).max(190),
    amount_minor: minorAmount.refine((value) => value > 0, 'المبلغ لازم يكون أكبر من صفر'),
    taxable: z.boolean().default(false),
    service_chargeable: z.boolean().default(false),
  }),
]);

export const voidSchema = z.object({
  reason: z.string().trim().min(3, 'اكتب سبب الإلغاء').max(255),
});

export const invoiceSchema = z.object({
  bill_to_name: z.string().trim().min(2).max(190).optional(),
  bill_to_tax_id: z.string().trim().max(40).transform((v) => (v === '' ? null : v)).nullish(),
  bill_to_address: optionalText(255),
});

export const openShiftSchema = z.object({
  opening_float_minor: minorAmount.default(0),
});

export const closeShiftSchema = z.object({
  counted_cash_minor: minorAmount,
  note: optionalText(500),
});

export const listShiftsQuery = pagingSchema.extend({ user_id: idSchema.optional() });

export const listPaymentsQuery = pagingSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  shift_id: idSchema.optional(),
});

export const expenseSchema = z.object({
  category: z.string().trim().min(2).max(40),
  description: z.string().trim().min(2).max(255),
  amount_minor: minorAmount.refine((value) => value > 0, 'المبلغ لازم يكون أكبر من صفر'),
  spent_on: isoDate,
  method: z.enum(['cash', 'bank', 'card', 'other']).default('cash'),
});

export const listExpensesQuery = pagingSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.string().trim().max(40).optional(),
});
