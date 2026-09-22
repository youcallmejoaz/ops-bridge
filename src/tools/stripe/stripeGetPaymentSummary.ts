import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as stripeService from '../../services/stripeService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  customerId: z.string().min(1).describe('The Stripe customer id.'),
});

export const stripeGetPaymentSummaryTool = defineTool({
  name: 'stripe_get_payment_summary',
  title: 'Get Stripe Payment Summary',
  description:
    'Return an aggregate payment summary for a Stripe customer: total paid, currency, number of successful ' +
    'payments, the most recent payment date, and active subscription status (if any). This scans up to the ' +
    "customer's most recent 200 payment intents — a `truncated: true` flag means the customer has more " +
    'history than was scanned. Use stripe_get_customer_payments for the raw list.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const summary = await stripeService.getPaymentSummary(args.customerId);
    return {
      summary:
        `Customer ${args.customerId} has paid ${summary.totalSpent} ${summary.currency ?? ''} across ${summary.successfulPaymentCount} successful payment(s).`.trim(),
      data: summary,
    };
  },
});
