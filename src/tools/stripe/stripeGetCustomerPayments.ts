import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as stripeService from '../../services/stripeService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  customerId: z.string().min(1).describe('The Stripe customer id.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max payment intents to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (a payment intent id) from a previous response's nextCursor."),
});

export const stripeGetCustomerPaymentsTool = defineTool({
  name: 'stripe_get_customer_payments',
  title: 'Get Stripe Customer Payments',
  description:
    "List a Stripe customer's payment intents (individual payment attempts), most recent first. Each item " +
    'has an amount, currency, and status (e.g. "succeeded", "requires_payment_method"). For an aggregate ' +
    'total, use stripe_get_payment_summary instead.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await stripeService.getCustomerPayments(args.customerId, args);
    return {
      summary: `Found ${result.items.length} Stripe payment(s) for customer ${args.customerId}${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
