import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  contactId: z.string().min(1).describe('The GHL contact id to update.'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  companyName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ghlUpdateContactTool = defineTool({
  name: 'ghl_update_contact',
  title: 'Update GHL Contact',
  description:
    'Update fields on an existing GoHighLevel contact. Only fields provided are changed; omitted fields ' +
    'are left as-is. Use ghl_get_contact first if you need to confirm current values. This is a WRITE ' +
    'operation — it does not delete or merge contacts.',
  inputSchema,
  requiredScopes: [Scope.WRITE_CRM],
  integration: 'ghl',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const { contactId, ...updates } = args;
    const contact = await ghlService.updateContact(contactId, updates);
    return {
      summary: `Updated GHL contact ${contactId}.`,
      data: contact,
    };
  },
});
