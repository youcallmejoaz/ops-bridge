import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  listId: z.number().int().positive().describe('The Brevo list id to add contact(s) to.'),
  emails: z.array(z.string().email()).optional(),
  ids: z.array(z.number().int().positive()).optional().describe('Brevo numeric contact ids.'),
  extIds: z.array(z.string()).optional().describe('Your own external ids for the contacts.'),
});

export const brevoAddContactToListTool = defineTool({
  name: 'brevo_add_contact_to_list',
  title: 'Add Contact(s) to Brevo List',
  description:
    'Add one or more existing contacts to a Brevo list, identified by email, Brevo contact id, or ext_id ' +
    '(provide exactly one of these arrays). Does NOT check consent or existing membership — for a safer, ' +
    "consent-aware add driven by a person's name/email across systems, use the cross-system " +
    'add_customer_to_marketing tool instead. This is a WRITE operation.',
  inputSchema,
  requiredScopes: [Scope.WRITE_MARKETING],
  integration: 'brevo',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const { listId, ...identifiers } = args;
    const result = await brevoService.addContactToList(listId, identifiers);
    return {
      summary: `Added contact(s) to Brevo list ${listId}.`,
      data: result,
    };
  },
});
