import { HighLevel } from '@gohighlevel/api-client';
import {
  GHLAuthenticationError,
  GHLError,
  GHLForbiddenError,
  GHLNotFoundError,
  GHLRateLimitError,
  GHLValidationError,
} from '@gohighlevel/api-client';
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
import { logger } from '../../utils/logging.js';
import { stripUndefined } from '../../utils/object.js';
import type {
  GhlContactCreateInput,
  GhlContactUpdateInput,
  GhlNote,
  GhlOpportunity,
  GhlPipeline,
} from './types.js';
import {
  ghlContactEnvelopeSchema,
  ghlContactSearchResponseSchema,
  ghlNoteEnvelopeSchema,
  ghlNotesListSchema,
  ghlOpportunityEnvelopeSchema,
  ghlOpportunitySearchResponseSchema,
  ghlPipelinesResponseSchema,
} from './types.js';

/** Maps a GHLError (from @gohighlevel/api-client) to our typed error hierarchy. */
function mapGhlError(err: unknown): Error {
  if (err instanceof GHLAuthenticationError) {
    return new AuthenticationError(
      'GHL authentication failed. Check the configured GHL_API_KEY (Private Integration Token).',
      { integration: 'ghl' },
    );
  }
  if (err instanceof GHLForbiddenError) {
    return new AuthorizationError(
      'GHL rejected this request: the configured token lacks the required scope for this operation.',
      { integration: 'ghl' },
    );
  }
  if (err instanceof GHLNotFoundError) {
    return new NotFoundError('The requested GHL record was not found.', { integration: 'ghl' });
  }
  if (err instanceof GHLValidationError) {
    return new ValidationError(`GHL rejected the request: ${err.message}`, { integration: 'ghl' });
  }
  if (err instanceof GHLRateLimitError) {
    return new RateLimitError('GHL rate limit exceeded. Please retry shortly.', {
      integration: 'ghl',
      ...(err.rateLimit?.intervalMs !== undefined
        ? { retryAfterMs: err.rateLimit.intervalMs }
        : {}),
    });
  }
  if (err instanceof GHLError) {
    return new ExternalAPIError(`GHL request failed: ${err.message}`, {
      integration: 'ghl',
      ...(err.statusCode !== undefined ? { statusCode: err.statusCode } : {}),
    });
  }
  return new ExternalAPIError(
    `Unexpected error calling GHL: ${err instanceof Error ? err.message : String(err)}`,
    { integration: 'ghl', cause: err },
  );
}

let cachedClient: HighLevel | undefined;

function getClient(): HighLevel {
  if (cachedClient) return cachedClient;
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) {
    throw new ConfigurationError(
      'GHL integration is enabled but GHL_API_KEY / GHL_LOCATION_ID are not configured.',
      { integration: 'ghl' },
    );
  }
  cachedClient = new HighLevel({
    privateIntegrationToken: env.GHL_API_KEY,
    rateLimitRetry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15000 },
    logLevel: 'warn',
  });
  return cachedClient;
}

export const ghlLocationId = (): string => {
  if (!env.GHL_LOCATION_ID) {
    throw new ConfigurationError('GHL_LOCATION_ID is not configured.', { integration: 'ghl' });
  }
  return env.GHL_LOCATION_ID;
};

export interface GhlContactSearchParams {
  query?: string;
  limit: number;
  startAfter?: number;
  startAfterId?: string;
}

export async function searchGhlContacts(params: GhlContactSearchParams) {
  try {
    const client = getClient();
    const raw = await client.contacts.getContacts({
      locationId: ghlLocationId(),
      limit: params.limit,
      ...(params.query !== undefined ? { query: params.query } : {}),
      ...(params.startAfter !== undefined ? { startAfter: params.startAfter } : {}),
      ...(params.startAfterId !== undefined ? { startAfterId: params.startAfterId } : {}),
    });
    return ghlContactSearchResponseSchema.parse(raw);
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function getGhlContact(contactId: string) {
  try {
    const client = getClient();
    const raw = await client.contacts.getContact({ contactId });
    return ghlContactEnvelopeSchema.parse(raw).contact;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function createGhlContact(input: GhlContactCreateInput) {
  try {
    const client = getClient();
    const raw = await client.contacts.createContact(stripUndefined(input));
    const parsed = ghlContactEnvelopeSchema.parse(raw);
    return parsed.contact;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function updateGhlContact(contactId: string, input: GhlContactUpdateInput) {
  try {
    const client = getClient();
    const raw = await client.contacts.updateContact({ contactId }, stripUndefined(input));
    const parsed = ghlContactEnvelopeSchema.parse(raw);
    return parsed.contact;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function addGhlContactNote(
  contactId: string,
  note: { body: string; userId?: string },
): Promise<GhlNote | undefined> {
  try {
    const client = getClient();
    const raw = await client.contacts.createNote(
      { contactId },
      { body: note.body, ...(note.userId !== undefined ? { userId: note.userId } : {}) },
    );
    return ghlNoteEnvelopeSchema.parse(raw).note;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function getGhlContactNotes(contactId: string): Promise<GhlNote[]> {
  try {
    const client = getClient();
    const raw = await client.contacts.getAllNotes({ contactId });
    return ghlNotesListSchema.parse(raw).notes;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export interface GhlOpportunitySearchParams {
  query?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  status?: string;
  page?: number;
  limit: number;
}

export async function searchGhlOpportunities(params: GhlOpportunitySearchParams) {
  try {
    const client = getClient();
    const raw = await client.opportunities.searchOpportunity({
      locationId: ghlLocationId(),
      limit: params.limit,
      ...(params.query !== undefined ? { q: params.query } : {}),
      ...(params.pipelineId !== undefined ? { pipelineId: params.pipelineId } : {}),
      ...(params.pipelineStageId !== undefined ? { pipelineStageId: params.pipelineStageId } : {}),
      ...(params.contactId !== undefined ? { contactId: params.contactId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.page !== undefined ? { page: params.page } : {}),
    });
    return ghlOpportunitySearchResponseSchema.parse(raw);
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function getGhlOpportunity(id: string): Promise<GhlOpportunity | undefined> {
  try {
    const client = getClient();
    const raw = await client.opportunities.getOpportunity({ id });
    return ghlOpportunityEnvelopeSchema.parse(raw).opportunity;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function updateGhlOpportunityStage(
  id: string,
  pipelineStageId: string,
): Promise<GhlOpportunity | undefined> {
  try {
    const client = getClient();
    const raw = await client.opportunities.updateOpportunity({ id }, { pipelineStageId });
    return ghlOpportunityEnvelopeSchema.parse(raw).opportunity;
  } catch (err) {
    throw mapGhlError(err);
  }
}

export async function getGhlPipelines(): Promise<GhlPipeline[]> {
  try {
    const client = getClient();
    const raw = await client.opportunities.getPipelines({ locationId: ghlLocationId() });
    return ghlPipelinesResponseSchema.parse(raw).pipelines;
  } catch (err) {
    throw mapGhlError(err);
  }
}

/** Reset the cached client — used only by tests to force re-initialization. */
export function __resetGhlClientForTests(): void {
  cachedClient = undefined;
  logger.debug({ integration: 'ghl' }, 'GHL client cache reset');
}
