import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { NotFoundError } from '../../errors/errors.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  email: z
    .string()
    .email()
    .describe("The customer's email address — the stable key used to correlate systems."),
  sources: z
    .array(z.enum(['ghl', 'brevo', 'stripe']))
    .optional()
    .describe('Restrict lookup to these systems. Omit to check every enabled integration.'),
});

export const getCustomerTool = defineTool({
  name: 'get_customer',
  title: 'Get Customer',
  description:
    "Retrieve a customer's unified profile by exact email, combining whatever each connected system knows " +
    'about them (CRM status, marketing subscription, payment summary). Fields from a system that has no ' +
    "record for this person are null, never guessed. For a name-based lookup or when you don't have an " +
    'exact email, use search_customers or customer_360 instead.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const customer = await customerService.getUnifiedCustomerByEmail(args.email, args.sources);
    if (!customer) {
      throw new NotFoundError(`No customer found for ${args.email} in any connected system.`);
    }
    return {
      summary: `Found customer ${customer.name ?? customer.email} across ${customer.sources.length} system(s).`,
      data: customer,
    };
  },
});
