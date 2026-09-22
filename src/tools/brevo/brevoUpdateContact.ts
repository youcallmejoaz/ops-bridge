import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .describe('Contact email, numeric Brevo contact id, or ext_id to update.'),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional()
    .describe('Attributes to update, in ALL CAPS, e.g. {"FIRSTNAME":"John"}.'),
  listIds: z
    .array(z.number().int().positive())
    .optional()
    .describe('List ids to add the contact to.'),
  unlinkListIds: z
    .array(z.number().int().positive())
    .optional()
    .describe('List ids to remove the contact from.'),
  emailBlacklisted: z
    .boolean()
    .optional()
    .describe(
      'Set the email opt-out (blacklist) flag. true = unsubscribed from all email campaigns.',
    ),
});

export const brevoUpdateContactTool = defineTool({
  name: 'brevo_update_contact',
  title: 'Update Brevo Contact',
  description:
    "Update an existing Brevo contact's attributes, list memberships, or blacklist status. Only fields " +
    'provided are changed. To simply add/remove one list membership, prefer brevo_add_contact_to_list / ' +
    'brevo_remove_contact_from_list — they are more explicit about intent. This is a WRITE operation.',
  inputSchema,
  requiredScopes: [Scope.WRITE_MARKETING],
  integration: 'brevo',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const { identifier, ...updates } = args;
    const contact = await brevoService.updateContact(identifier, updates);
    return {
      summary: `Updated Brevo contact ${identifier}.`,
      data: contact,
    };
  },
});
