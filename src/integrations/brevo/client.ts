import { Brevo, BrevoClient, BrevoError, BrevoTimeoutError } from '@getbrevo/brevo';
import { env } from '../../config/env.js';
import {
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  ExternalAPIError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../errors/errors.js';
import { stripUndefined } from '../../utils/object.js';
import {
  brevoCampaignSchema,
  brevoCampaignsPageSchema,
  brevoContactSchema,
  brevoContactsPageSchema,
  brevoListSchema,
  brevoListsPageSchema,
  type BrevoListMembershipBody,
} from './types.js';

/** Maps a Brevo SDK error to our typed error hierarchy. */
function mapBrevoError(err: unknown): Error {
  if (err instanceof Brevo.UnauthorizedError) {
    return new AuthenticationError(
      'Brevo authentication failed. Check the configured BREVO_API_KEY.',
      { integration: 'brevo' },
    );
  }
  if (err instanceof Brevo.ForbiddenError) {
    return new AuthorizationError(
      'Brevo rejected this request: the configured API key lacks permission for this operation.',
      { integration: 'brevo' },
    );
  }
  if (err instanceof Brevo.NotFoundError) {
    return new NotFoundError('The requested Brevo record was not found.', { integration: 'brevo' });
  }
  if (err instanceof Brevo.BadRequestError || err instanceof Brevo.UnprocessableEntityError) {
    return new ValidationError(`Brevo rejected the request: ${err.message}`, {
      integration: 'brevo',
    });
  }
  if (err instanceof Brevo.TooManyRequestsError) {
    return new RateLimitError('Brevo rate limit exceeded. Please retry shortly.', {
      integration: 'brevo',
    });
  }
  if (err instanceof BrevoTimeoutError) {
    return new ExternalAPIError('Brevo request timed out.', { integration: 'brevo' });
  }
  if (err instanceof BrevoError) {
    // The generated SDK only throws a specific subclass (UnauthorizedError,
    // NotFoundError, ...) for status codes a given endpoint's OpenAPI spec
    // happens to document as a possible response — e.g. `getContacts`
    // documents 400/429 but not 401, so a real 401 there surfaces as this
    // generic BrevoError instead of Brevo.UnauthorizedError. Fall back to
    // checking statusCode directly so our mapping doesn't depend on each
    // endpoint's spec coverage being complete.
    switch (err.statusCode) {
      case 401:
        return new AuthenticationError(
          'Brevo authentication failed. Check the configured BREVO_API_KEY.',
          { integration: 'brevo' },
        );
      case 403:
        return new AuthorizationError(
          'Brevo rejected this request: the configured API key lacks permission for this operation.',
          { integration: 'brevo' },
        );
      case 404:
        return new NotFoundError('The requested Brevo record was not found.', {
          integration: 'brevo',
        });
      case 429:
        return new RateLimitError('Brevo rate limit exceeded. Please retry shortly.', {
          integration: 'brevo',
        });
      case 400:
      case 422:
        return new ValidationError(`Brevo rejected the request: ${err.message}`, {
          integration: 'brevo',
        });
      default:
        return new ExternalAPIError(`Brevo request failed: ${err.message}`, {
          integration: 'brevo',
          ...(err.statusCode !== undefined ? { statusCode: err.statusCode } : {}),
        });
    }
  }
  return new ExternalAPIError(
    `Unexpected error calling Brevo: ${err instanceof Error ? err.message : String(err)}`,
    { integration: 'brevo', cause: err },
  );
}

let cachedClient: BrevoClient | undefined;

function getClient(): BrevoClient {
  if (cachedClient) return cachedClient;
  if (!env.BREVO_API_KEY) {
    throw new ConfigurationError(
      'Brevo integration is enabled but BREVO_API_KEY is not configured.',
      {
        integration: 'brevo',
      },
    );
  }
  cachedClient = new BrevoClient({
    apiKey: env.BREVO_API_KEY,
    maxRetries: 2,
    timeoutInSeconds: 20,
  });
  return cachedClient;
}

export interface BrevoContactSearchParams {
  limit: number;
  offset: number;
  listId?: number;
  /** Raw Brevo attribute filter, e.g. `equals(FIRSTNAME,"John")` — see brevo_search_contacts tool description. */
  filter?: string;
}

export async function searchBrevoContacts(params: BrevoContactSearchParams) {
  try {
    const client = getClient();
    const raw = await client.contacts.getContacts({
      limit: params.limit,
      offset: params.offset,
      ...(params.listId !== undefined ? { listIds: params.listId } : {}),
      ...(params.filter !== undefined ? { filter: params.filter } : {}),
    });
    return brevoContactsPageSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

/** identifier can be an email, numeric contact id, or ext_id (as a string). */
export async function getBrevoContact(identifier: string) {
  try {
    const client = getClient();
    const raw = await client.contacts.getContactInfo({ identifier });
    return brevoContactSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

/**
 * Optional fields are typed `T | undefined` rather than plain `T` so that
 * objects produced by parsing a Zod `.optional()` schema satisfy this
 * interface directly under `exactOptionalPropertyTypes` — see the same note
 * on GhlContactCreateInput in integrations/ghl/types.ts.
 */
export interface BrevoContactUpsertInput {
  email?: string | undefined;
  attributes?: Record<string, string | number | boolean | string[]> | undefined;
  listIds?: number[] | undefined;
  emailBlacklisted?: boolean | undefined;
}

export async function createBrevoContact(input: BrevoContactUpsertInput) {
  try {
    const client = getClient();
    const raw = await client.contacts.createContact(stripUndefined(input));
    return raw?.id;
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function updateBrevoContact(
  identifier: string,
  input: Omit<BrevoContactUpsertInput, 'email'> & {
    email?: string | undefined;
    unlinkListIds?: number[] | undefined;
  },
): Promise<void> {
  try {
    const client = getClient();
    await client.contacts.updateContact({
      identifier,
      ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
      ...(input.listIds !== undefined ? { listIds: input.listIds } : {}),
      ...(input.unlinkListIds !== undefined ? { unlinkListIds: input.unlinkListIds } : {}),
      ...(input.emailBlacklisted !== undefined ? { emailBlacklisted: input.emailBlacklisted } : {}),
    });
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function getBrevoLists(params: { limit: number; offset: number }) {
  try {
    const client = getClient();
    const raw = await client.contacts.getLists({ limit: params.limit, offset: params.offset });
    return brevoListsPageSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function getBrevoList(listId: number) {
  try {
    const client = getClient();
    const raw = await client.contacts.getList({ listId });
    return brevoListSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function addBrevoContactToList(
  listId: number,
  body: BrevoListMembershipBody,
): Promise<void> {
  try {
    const client = getClient();
    await client.contacts.addContactToList({ listId, body });
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function removeBrevoContactFromList(
  listId: number,
  body: BrevoListMembershipBody,
): Promise<void> {
  try {
    const client = getClient();
    await client.contacts.removeContactFromList({ listId, body });
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function getBrevoCampaigns(params: {
  limit: number;
  offset: number;
  status?: 'suspended' | 'archive' | 'sent' | 'queued' | 'draft' | 'inProcess';
}) {
  try {
    const client = getClient();
    const raw = await client.emailCampaigns.getEmailCampaigns({
      limit: params.limit,
      offset: params.offset,
      statistics: 'globalStats',
      excludeHtmlContent: true,
      ...(params.status !== undefined ? { status: params.status } : {}),
    });
    return brevoCampaignsPageSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

export async function getBrevoCampaignActivity(campaignId: number) {
  try {
    const client = getClient();
    const raw = await client.emailCampaigns.getEmailCampaign({
      campaignId,
      statistics: 'globalStats',
      excludeHtmlContent: true,
    });
    return brevoCampaignSchema.parse(raw);
  } catch (err) {
    throw mapBrevoError(err);
  }
}

/** Reset the cached client — used only by tests to force re-initialization. */
export function __resetBrevoClientForTests(): void {
  cachedClient = undefined;
}
