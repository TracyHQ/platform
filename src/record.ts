import { z } from 'zod'

/**
 * ONE RECORD FOR THREE MARKETPLACES.
 *
 * WordPress, Joomla and Shopify describe their extensions differently, but a
 * consumer asking "who makes this, how many people run it, and what does it
 * cost" is asking the same question of all three. So the core below holds only
 * what all three can answer, and everything platform-specific is confined to
 * `platformData.<platform>` where it cannot leak into the shared vocabulary.
 *
 * Five of the choices here were forced by the data rather than chosen. They are
 * marked FORCED, with the observation that forced them. Simplifying one of them
 * back to the obvious shape loses information that was actually present.
 */

export const PLATFORMS = ['wordpress', 'joomla', 'shopify'] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * FORCED: `kind` is a list, not a value.
 *
 * A single Joomla release is routinely more than one thing at once — 2J Tabs
 * ships as a Component, a Module and a Plugin under one listing. A scalar field
 * would have to pick one and silently drop the rest.
 */
const KindSchema = z.enum([
  'plugin',
  'theme',
  'block',
  'component',
  'module',
  'template',
  'library',
  'package',
  'language',
  'app',
])

/** `{platform}/{slug}`, and it must match the file path. See PATH INVARIANT in scripts/build-dist.mjs. */
const NameSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/, 'name must be {platform}/{slug}')

/**
 * FORCED: timestamps are normalised to ISO 8601 on the way in.
 *
 * wordpress.org reports `2026-05-28 9:18am GMT`, the JED reports a local date,
 * Shopify reports nothing at all. Storing each verbatim would push the parsing
 * problem onto every consumer, and they would not all solve it the same way.
 */
const IsoInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'must be ISO 8601 UTC, e.g. 2026-05-28T09:18:00Z')

/**
 * How a number got here.
 *
 *   directory-reported  the marketplace published it, usually in buckets
 *   third-party-measured someone outside the marketplace measured it
 *
 * FORCED: this never travels separately from `activeInstalls`.
 *
 * wordpress.org and the JED self-report in buckets ("10,000+"); nobody publishes
 * a Shopify install count, so any figure for it was measured from outside. Those
 * are two different kinds of number, and a column that mixes them is broken data
 * that still looks fine. The name of the outside measurer is deliberately not a
 * value here — the classification is what a consumer needs, and the supplier
 * relationship is not ours to publish.
 */
const AdoptionSourceSchema = z.enum(['directory-reported', 'third-party-measured'])

const AdoptionSchema = z
  .object({
    activeInstalls: z.number().int().nonnegative().nullable().optional(),
    activeInstallsSource: AdoptionSourceSchema.nullable().optional(),
    rating: z.number().nonnegative().nullable().optional(),
    /**
     * FORCED: always with `rating`, never without.
     *
     * wordpress.org rates out of 100; the JED and Shopify rate out of 5. A bare
     * `4.6` is unreadable, and a bare `92` read as a five-point score is worse
     * than unreadable because it looks plausible.
     */
    ratingScale: z.union([z.literal(5), z.literal(100)]).nullable().optional(),
    ratingCount: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()

/**
 * What it costs, in a vocabulary that works on all three marketplaces.
 *
 * DO NOT ADD `community` HERE. wordpress.org has a `business_model` field whose
 * values are `commercial`, `community` and `canonical` — that field says who
 * maintains a plugin, not what it costs, and it is kept verbatim at
 * `platformData.wordpress.directoryBusinessModel`. `provenance` also has a
 * notion of a community source. Three different meanings for one word already
 * collided once in the MCP registry and took a while to spot; keeping the value
 * out of this enum is what stops it happening a third time.
 */
const BusinessModelSchema = z.enum(['free', 'freemium', 'paid', 'subscription'])

const TierSchema = z
  .object({
    name: z.string().min(1).max(80),
    price: z.string().min(1).max(80).nullable().optional(),
    url: z.url().nullable().optional(),
  })
  .strict()

/**
 * Everything under here belongs to the vendor. See FIELD OWNERSHIP in src/merge.ts.
 * A directory may seed `businessModel`; a vendor declaration outranks it.
 */
const CommercialSchema = z
  .object({
    businessModel: BusinessModelSchema.nullable().optional(),
    pricingUrl: z.url().nullable().optional(),
    supportUrl: z.url().nullable().optional(),
    tiers: z.array(TierSchema).optional(),
    /** If this extension exposes an MCP server, the endpoint belongs here — see TracyHQ/mcp. */
    mcpEndpoint: z.url().nullable().optional(),
  })
  .strict()

const AuthorshipSchema = z
  .object({
    author: z.string().min(1).max(200).nullable().optional(),
    authorUrl: z.url().nullable().optional(),
    contributors: z.array(z.string().min(1).max(100)).optional(),
  })
  .strict()

/**
 * FORCED: both fields are nullable.
 *
 * Shopify publishes neither a version nor a last-updated date for apps in its
 * store. Making either required would leave a submitter with two options —
 * invent a value, or not submit — and the first one is what people actually do.
 */
const ReleaseSchema = z
  .object({
    version: z.string().min(1).max(255).nullable().optional(),
    lastUpdated: IsoInstant.nullable().optional(),
  })
  .strict()

/**
 * WHO SAID SO, PER FIELD.
 *
 * Keyed by field path, most specific wins. `"*"` is the whole record: a crawl is
 * a single observation covering every field it wrote, and repeating that
 * sentence once per field group across 69,052 records costs 26 MB to say
 * nothing new. A vendor who later fills in `commercial` adds `"commercial"`
 * beside the `"*"` entry, and the record then carries both sources — which is
 * the whole point of keeping this map.
 *
 *   evidence: observed   we fetched it and this is what was there
 *   evidence: declared   somebody stated it; we did not check it against anything
 */
const ProvenanceEntrySchema = z
  .object({
    source: z.string().min(1).max(120),
    evidence: z.enum(['observed', 'declared']),
    observedAt: IsoInstant,
  })
  .strict()

/**
 * Proof that the submitter controls the listing they are writing about.
 *
 * Path A of the two ownership paths (see registry/README.md). The vendor puts
 * `token` somewhere on their own public listing; CI fetches that listing and
 * looks for it. Path B — a maintainer reads the pull request — needs no field
 * here, and is what off-directory products use.
 */
const OwnershipSchema = z
  .object({
    method: z.literal('listing-token'),
    token: z
      .string()
      .regex(/^tracy-verify-[a-z0-9]{16,64}$/, 'token must look like tracy-verify-<16-64 lowercase alphanumerics>'),
  })
  .strict()

const CoreShape = {
  $schema: z.url().optional(),
  name: NameSchema,
  platform: z.enum(PLATFORMS),
  slug: z
    .string()
    .min(1)
    .max(190)
    .regex(/^[a-zA-Z0-9._-]+$/, 'slug must be url-safe'),
  title: z.string().min(1).max(300),
  kind: z.array(KindSchema).min(1),
  /** Null for a commercial product that is not listed on any public directory — the case this registry exists for. */
  listingUrl: z.url().nullable().optional(),
  authorship: AuthorshipSchema.optional(),
  release: ReleaseSchema.optional(),
  adoption: AdoptionSchema.optional(),
  commercial: CommercialSchema.optional(),
  /**
   * Platform-specific fields, under the record's own platform key only. A
   * WordPress record carrying a `shopify` block would be describing something it
   * is not, so validation refuses it rather than quietly serving it.
   */
  platformData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  provenance: z.record(z.string(), ProvenanceEntrySchema).optional(),
  ownership: OwnershipSchema.optional(),
}

/** Cross-field rules that no single field can express. */
function pinnedInvariants(record: { adoption?: unknown; platformData?: unknown; platform?: string }, ctx: z.RefinementCtx) {
  const adoption = record.adoption as z.infer<typeof AdoptionSchema> | undefined
  if (adoption) {
    if (adoption.activeInstalls != null && adoption.activeInstallsSource == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['adoption', 'activeInstallsSource'],
        message:
          'activeInstalls without activeInstallsSource: a self-reported bucket and an outside measurement are not the same number',
      })
    }
    if (adoption.rating != null && adoption.ratingScale == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['adoption', 'ratingScale'],
        message: 'rating without ratingScale: marketplaces rate out of 5 and out of 100, and the value alone does not say which',
      })
    }
  }

  const platformData = record.platformData as Record<string, unknown> | undefined
  if (platformData) {
    for (const key of Object.keys(platformData)) {
      if (key !== record.platform) {
        ctx.addIssue({
          code: 'custom',
          path: ['platformData', key],
          message: `platformData.${key} on a ${record.platform} record: platform-specific fields belong under the record's own platform`,
        })
      }
    }
  }
}

/** The full record: what `data/` holds and what `dist/` serves. */
export const PlatformRecordSchema = z.object(CoreShape).strict().superRefine(pinnedInvariants)
export type PlatformRecord = z.infer<typeof PlatformRecordSchema>

/**
 * What a vendor may put in `registry/`.
 *
 * Deliberately the same shape as the full record, including the measured fields.
 * Leaving them out of the schema would produce "unrecognized key: adoption",
 * which tells a submitter nothing about why. They are accepted here and rejected
 * by name in `src/validate.ts`, with the reason.
 *
 * `declaredAt` is the one field that exists here and nowhere else. Every entry in
 * `provenance` needs a date, and the build has to be reproducible — so the date
 * cannot come from the clock at merge time, or two builds of the same input would
 * differ. It comes from the submitter instead, which is also what it honestly is:
 * a date somebody stated, on a record marked `evidence: declared`. The merge
 * copies it into provenance and drops the field.
 */
export const SubmissionSchema = z
  .object({ ...CoreShape, declaredAt: IsoInstant.optional() })
  .strict()
  .superRefine(pinnedInvariants)
export type Submission = z.infer<typeof SubmissionSchema>

/**
 * FIELD PATHS ONLY THE CRAWLER MAY WRITE.
 *
 * Not a trust ranking of sources — an ownership map. A vendor is the authority
 * on what their own product costs. They are not the authority on how many people
 * installed it, because somebody else counted that. The single thing this
 * dataset sells is "the day we measured"; a pull request that replaces a
 * measurement with a claim deletes exactly that.
 */
export const MEASURED_PATHS = ['adoption', 'release.version', 'release.lastUpdated'] as const

/** Field paths a vendor owns outright: their declaration wins over anything crawled. */
export const VENDOR_PATHS = ['commercial'] as const

/** The platform half of `name`. */
export function platformOf(name: string): string {
  return name.split('/')[0] ?? ''
}

/** The slug half of `name`, which must match the file name. */
export function slugOf(name: string): string {
  return name.split('/')[1] ?? ''
}
