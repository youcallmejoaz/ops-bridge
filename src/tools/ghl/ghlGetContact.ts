import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  contactId: z.string().min(1).describe('The GHL contact id.'),
});

export const ghlGetContactTool = defineTool({
  name: 'ghl_get_contact',
  title: 'Get GHL Contact',
  description:
    'Retrieve a single GoHighLevel contact by its GHL contact id. Use this when you already know the ' +
    "GHL id (e.g. from ghl_search_contacts or a unified customer's sources list). Returns NotFound if " +
    'the contact does not exist in this GHL location.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'ghl',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const contact = await ghlService.getContact(args.contactId);
    return {
      summary: `Retrieved GHL contact ${contact.id}${contact.name ? ` (${contact.name})` : ''}.`,
      data: contact,
    };
  },
});
