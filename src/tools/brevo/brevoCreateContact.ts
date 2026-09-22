import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  email: z
    .string()
    .email()
    .describe("Email address — required (Brevo's primary identifier for this tool)."),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional()
    .describe(
      'Brevo contact attributes in ALL CAPS, e.g. {"FIRSTNAME":"John","LASTNAME":"Smith"}.',
    ),
  listIds: z
    .array(z.number().int().positive())
    .optional()
    .describe('Brevo list ids to add the contact to on creation.'),
});

export const brevoCreateContactTool = defineTool({
  name: 'brevo_create_contact',
  title: 'Create Brevo Contact',
  description:
    'Create a new Brevo contact by email. Before calling this, check whether the contact already exists ' +
    '(brevo_get_contact) — Brevo will reject a duplicate email unless updateEnabled semantics are used, ' +
    'which this tool does not set. This is a WRITE operation and does NOT by itself add marketing consent ' +
    'beyond what listIds implies.',
  inputSchema,
  requiredScopes: [Scope.WRITE_MARKETING],
  integration: 'brevo',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute: async (args) => {
    const result = await brevoService.createContact(args);
    return {
      summary: `Created Brevo contact ${result.id ?? '(unknown id)'} (${result.email}).`,
      data: result,
    };
  },
});
