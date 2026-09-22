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
    .describe('Max invoices to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (an invoice id) from a previous response's nextCursor."),
});

export const stripeGetCustomerInvoicesTool = defineTool({
  name: 'stripe_get_customer_invoices',
  title: 'Get Stripe Customer Invoices',
  description:
    "List a Stripe customer's invoices, most recent first, including amount due/paid, currency, and status.",
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await stripeService.getCustomerInvoices(args.customerId, args);
    return {
      summary: `Found ${result.items.length} Stripe invoice(s) for customer ${args.customerId}${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
