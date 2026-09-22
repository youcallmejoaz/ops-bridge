import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z
    .string()
    .optional()
    .describe('Full display name; use instead of/in addition to firstName+lastName.'),
  email: z.string().email().optional(),
  phone: z.string().optional().describe('Phone number including country code, e.g. +14155551234.'),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional().describe('ISO country code, e.g. US.'),
  companyName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ghlCreateContactTool = defineTool({
  name: 'ghl_create_contact',
  title: 'Create GHL Contact',
  description:
    'Create a new contact in GoHighLevel for this location. Requires at least an email or a phone ' +
    'number. Before calling this, search for an existing contact with ghl_search_contacts to avoid ' +
    'creating a duplicate — GHL does not automatically dedupe on create. This is a WRITE operation.',
  inputSchema,
  requiredScopes: [Scope.WRITE_CRM],
  integration: 'ghl',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute: async (args) => {
    const contact = await ghlService.createContact(args);
    return {
      summary: `Created GHL contact ${contact?.id ?? '(unknown id)'}.`,
      data: contact,
    };
  },
});
