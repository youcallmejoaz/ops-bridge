import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as stripeService from '../../services/stripeService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  customerId: z.string().min(1).describe('The Stripe customer id (starts with "cus_").'),
});

export const stripeGetCustomerTool = defineTool({
  name: 'stripe_get_customer',
  title: 'Get Stripe Customer',
  description:
    'Retrieve a single Stripe customer by id. Returns NotFound if the customer does not exist or was deleted.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const customer = await stripeService.getCustomer(args.customerId);
    return {
      summary: `Retrieved Stripe customer ${customer.id}${customer.email ? ` (${customer.email})` : ''}.`,
      data: customer,
    };
  },
});
