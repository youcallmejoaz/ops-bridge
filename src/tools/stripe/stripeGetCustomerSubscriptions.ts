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
    .describe('Max subscriptions to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (a subscription id) from a previous response's nextCursor."),
});

export const stripeGetCustomerSubscriptionsTool = defineTool({
  name: 'stripe_get_customer_subscriptions',
  title: 'Get Stripe Customer Subscriptions',
  description:
    'List a Stripe customer\'s subscriptions with their status (e.g. "active", "trialing", "canceled"), ' +
    'currency, and renewal date.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await stripeService.getCustomerSubscriptions(args.customerId, args);
    return {
      summary: `Found ${result.items.length} Stripe subscription(s) for customer ${args.customerId}${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
