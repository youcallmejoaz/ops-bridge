import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  email: z.string().email().describe("The customer's email — used to find their GHL contact."),
  note: z
    .string()
    .min(1)
    .describe(
      'The note text, e.g. "Added to the Brevo newsletter on Sept 22 after a Stripe purchase."',
    ),
});

export const customerNoteTool = defineTool({
  name: 'customer_note',
  title: 'Add Cross-System Customer Note',
  description:
    'Add a note to a customer\'s GHL contact documenting an action taken elsewhere, e.g. "John was added to ' +
    'the Brevo newsletter on September 22." Finds the GHL contact by exact email and prefixes the note with ' +
    '"[OpsBridge]" so it\'s clearly attributable. Fails with NotFound if the person has no GHL contact — use ' +
    'sync_customer first if one should be created. This is a WRITE operation.',
  inputSchema,
  requiredScopes: [Scope.WRITE_CRM],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute: async (args) => {
    const result = await customerService.customerNote(args);
    return {
      summary: `Added note to GHL contact ${result.ghlContactId}.`,
      data: result,
    };
  },
});
