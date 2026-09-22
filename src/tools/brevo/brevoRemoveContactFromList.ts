import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  listId: z.number().int().positive().describe('The Brevo list id to remove contact(s) from.'),
  emails: z.array(z.string().email()).optional(),
  ids: z.array(z.number().int().positive()).optional().describe('Brevo numeric contact ids.'),
  extIds: z.array(z.string()).optional().describe('Your own external ids for the contacts.'),
});

export const brevoRemoveContactFromListTool = defineTool({
  name: 'brevo_remove_contact_from_list',
  title: 'Remove Contact(s) from Brevo List',
  description:
    'Remove one or more contacts from a Brevo list, identified by email, Brevo contact id, or ext_id ' +
    '(provide exactly one of these arrays). This removes list membership only — it does not blacklist the ' +
    "contact from all email (see brevo_update_contact's emailBlacklisted for that). This is a WRITE operation.",
  inputSchema,
  requiredScopes: [Scope.WRITE_MARKETING],
  integration: 'brevo',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const { listId, ...identifiers } = args;
    const result = await brevoService.removeContactFromList(listId, identifiers);
    return {
      summary: `Removed contact(s) from Brevo list ${listId}.`,
      data: result,
    };
  },
});
