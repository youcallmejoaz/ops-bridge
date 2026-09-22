import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  email: z
    .string()
    .email()
    .describe("The customer's email — the key used to find and match records."),
  from: z
    .enum(['ghl', 'brevo'])
    .describe('The system to copy the record FROM (must already exist here).'),
  to: z
    .enum(['ghl', 'brevo'])
    .describe('The system to create the record IN (must not already exist here).'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'Set true to actually create the record. Without this, the tool only previews what would change.',
    ),
});

export const syncCustomerTool = defineTool({
  name: 'sync_customer',
  title: 'Sync Customer Between Systems',
  description:
    'Synchronize a customer\'s existence between GHL and Brevo, e.g. "create John in Brevo if he exists in ' +
    'GHL but not Brevo." Checks both systems first — if the source record is missing, or the target already ' +
    'has one, nothing happens. By default this only returns a PREVIEW of the planned change (`plan`); pass ' +
    'confirm: true to actually create the record. Only supports "ghl" and "brevo" — Stripe customers are ' +
    "never auto-created here (that has billing implications outside this tool's scope).",
  inputSchema,
  requiredScopes: [Scope.WRITE_CUSTOMERS],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.syncCustomer(args);
    return {
      summary: result.reason,
      data: result,
    };
  },
});
