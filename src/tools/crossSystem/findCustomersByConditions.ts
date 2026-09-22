import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  purchased: z
    .boolean()
    .optional()
    .describe(
      'true = has at least one successful Stripe payment; false = no successful payment found.',
    ),
  marketing_subscribed: z
    .boolean()
    .optional()
    .describe(
      'true = subscribed (not Brevo-blacklisted); false = not subscribed or not a Brevo contact.',
    ),
  crm_status: z
    .string()
    .optional()
    .describe('Match GHL opportunity status exactly (case-insensitive), e.g. "open", "won".'),
  min_total_spent: z
    .number()
    .nonnegative()
    .optional()
    .describe('Minimum lifetime Stripe spend, in major currency units (e.g. dollars).'),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe('ISO currency code to filter min_total_spent by, e.g. "usd".'),
  list_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Brevo list id — combine with marketing_subscribed: true to mean "on this list".'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max customers to return (default 20, max 100).'),
});

export const findCustomersByConditionsTool = defineTool({
  name: 'find_customers_by_conditions',
  title: 'Find Customers by Conditions',
  description:
    'Cross-system filtering with a fixed, safe condition set (not arbitrary SQL) — the tool behind ' +
    '"find customers who have purchased but aren\'t subscribed to our newsletter". Every condition is ' +
    'ANDed together. IMPORTANT: at least one "positive" condition — purchased: true, ' +
    'marketing_subscribed: true, list_id, or crm_status — is required to drive a BOUNDED search; a query ' +
    'made only of negative conditions (e.g. marketing_subscribed: false alone) is rejected because it has ' +
    'no bounded starting point. This tool never modifies anything — see add_customer_to_marketing / ' +
    'customer_note for follow-up actions on the results.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.findCustomersByConditions({
      ...(args.purchased !== undefined ? { purchased: args.purchased } : {}),
      ...(args.marketing_subscribed !== undefined
        ? { marketingSubscribed: args.marketing_subscribed }
        : {}),
      ...(args.crm_status !== undefined ? { crmStatus: args.crm_status } : {}),
      ...(args.min_total_spent !== undefined ? { minTotalSpent: args.min_total_spent } : {}),
      ...(args.currency !== undefined ? { currency: args.currency } : {}),
      ...(args.list_id !== undefined ? { listId: args.list_id } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    return {
      summary: `Found ${result.customers.length} customer(s) matching the given conditions${result.truncated ? ' (scan was truncated — more may match)' : ''}.`,
      data: result,
    };
  },
});
