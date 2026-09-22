import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  identifier: z.string().min(1).describe('Contact email, numeric Brevo contact id, or ext_id.'),
});

export const brevoGetContactListsTool = defineTool({
  name: 'brevo_get_contact_lists',
  title: "Get Brevo Contact's Lists",
  description:
    'Retrieve the marketing lists a specific Brevo contact currently belongs to, with names resolved where ' +
    'possible. Use this to check membership before adding a contact to a list to avoid a redundant call.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await brevoService.getContactLists(args.identifier);
    return {
      summary: `Contact ${result.contactId} belongs to ${result.lists.length} Brevo list(s).`,
      data: result,
    };
  },
});
