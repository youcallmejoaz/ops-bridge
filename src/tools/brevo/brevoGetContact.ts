import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  identifier: z.string().min(1).describe('Contact email, numeric Brevo contact id, or ext_id.'),
});

export const brevoGetContactTool = defineTool({
  name: 'brevo_get_contact',
  title: 'Get Brevo Contact',
  description:
    "Retrieve a single Brevo contact by exact email, numeric contact id, or ext_id. Returns the contact's " +
    'attributes, list memberships, and blacklist (opt-out) status. Use this — not brevo_search_contacts — ' +
    'when you already know the exact identifier.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const contact = await brevoService.getContact(args.identifier);
    return {
      summary: `Retrieved Brevo contact ${contact.id}${contact.email ? ` (${contact.email})` : ''}.`,
      data: contact,
    };
  },
});
