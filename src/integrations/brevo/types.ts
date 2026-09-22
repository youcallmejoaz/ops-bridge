import { z } from 'zod';

/**
 * Response shapes we depend on from Brevo, mirrored as Zod schemas so a
 * malformed or unexpected payload fails loudly at the integration boundary
 * instead of silently propagating `undefined`s into the unified model.
 * Fields Brevo's own SDK marks non-optional are still validated (never
 * trusted blindly) but kept required here to match.
 */

export const brevoContactAttributesSchema = z.record(z.string(), z.unknown());

export const brevoContactSchema = z.object({
  id: z.number(),
  email: z.string().nullish(),
  emailBlacklisted: z.boolean(),
  smsBlacklisted: z.boolean(),
  listIds: z.array(z.number()).default([]),
  listUnsubscribed: z.array(z.number()).nullish(),
  attributes: brevoContactAttributesSchema.default({}),
  createdAt: z.string(),
  modifiedAt: z.string(),
  /**
   * Only present on the single-contact getContactInfo response (not on
   * getContacts list results). Left loosely typed — it's a deeply nested,
   * campaign-event-shaped structure we only ever pass through verbatim for
   * get_customer_activity, never parse into the unified model.
   */
  statistics: z.unknown().optional(),
});
export type BrevoContact = z.infer<typeof brevoContactSchema>;

export const brevoContactsPageSchema = z.object({
  contacts: z.array(brevoContactSchema).default([]),
  count: z.number(),
});

export const brevoListSchema = z.object({
  id: z.number(),
  name: z.string(),
  totalBlacklisted: z.number().nullish(),
  totalSubscribers: z.number().nullish(),
  uniqueSubscribers: z.number().nullish(),
  folderId: z.number().nullish(),
});
export type BrevoList = z.infer<typeof brevoListSchema>;

export const brevoListsPageSchema = z.object({
  lists: z.array(brevoListSchema).default([]),
  count: z.number().nullish(),
});

export const brevoCampaignStatsSchema = z.object({
  sent: z.number().nullish(),
  delivered: z.number().nullish(),
  softBounces: z.number().nullish(),
  hardBounces: z.number().nullish(),
  uniqueClicks: z.number().nullish(),
  clickers: z.number().nullish(),
  complaints: z.number().nullish(),
  uniqueViews: z.number().nullish(),
  unsubscriptions: z.number().nullish(),
  viewed: z.number().nullish(),
});
export type BrevoCampaignStats = z.infer<typeof brevoCampaignStatsSchema>;

export const brevoCampaignSchema = z.object({
  id: z.number(),
  name: z.string(),
  subject: z.string().nullish(),
  status: z.string().nullish(),
  type: z.string().nullish(),
  scheduledAt: z.string().nullish(),
  createdAt: z.string().nullish(),
  modifiedAt: z.string().nullish(),
  globalStats: brevoCampaignStatsSchema.nullish(),
});
export type BrevoCampaign = z.infer<typeof brevoCampaignSchema>;

export const brevoCampaignsPageSchema = z.object({
  campaigns: z.array(brevoCampaignSchema).default([]),
  count: z.number().nullish(),
});

/** Union matching Brevo's addContactToList / removeContactFromList body shape. */
export type BrevoListMembershipBody =
  { emails: string[] } | { ids: number[] } | { extIds: string[] };
