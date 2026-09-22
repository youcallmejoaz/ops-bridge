import { z } from 'zod';

/**
 * We rely on the official `stripe` package's own TypeScript types for
 * request parameters (they are actively maintained and generated from
 * Stripe's OpenAPI spec, unlike GHL's advanced-search body). These Zod
 * schemas cover only the response fields we actually surface, so a
 * malformed payload from a mocked or future API version fails validation
 * at the boundary rather than producing an unexplained downstream error.
 */

export const stripeCustomerSchema = z.object({
  id: z.string(),
  object: z.literal('customer'),
  email: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  currency: z.string().nullable(),
  balance: z.number(),
  created: z.number(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type StripeCustomerRecord = z.infer<typeof stripeCustomerSchema>;

export const stripePaymentIntentSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  created: z.number(),
  customer: z.string().nullable(),
});
export type StripePaymentIntentRecord = z.infer<typeof stripePaymentIntentSchema>;

export const stripeInvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  amount_paid: z.number(),
  amount_due: z.number(),
  currency: z.string(),
  status: z.string().nullable(),
  created: z.number(),
  hosted_invoice_url: z.string().nullable().optional(),
});
export type StripeInvoiceRecord = z.infer<typeof stripeInvoiceSchema>;

/**
 * As of Stripe API version 2025-03-31+ (we pin 2026-08-26.dahlia),
 * `current_period_end` no longer exists on the Subscription object itself —
 * each subscription item now carries its own billing period. We surface the
 * earliest item-level `current_period_end` as the subscription's renewal
 * date, which is correct for the common single-item-subscription case.
 */
export const stripeSubscriptionItemSchema = z.object({
  current_period_end: z.number(),
});

export const stripeSubscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  currency: z.string(),
  created: z.number(),
  cancel_at_period_end: z.boolean(),
  items: z.object({ data: z.array(stripeSubscriptionItemSchema).default([]) }),
});
export type StripeSubscriptionRecord = z.infer<typeof stripeSubscriptionSchema>;
