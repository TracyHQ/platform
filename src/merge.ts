import { MEASURED_PATHS, VENDOR_PATHS, type PlatformRecord, type Submission } from './record'

/**
 * FIELD OWNERSHIP, NOT SOURCE RANKING.
 *
 * The MCP registry keeps measurements and claims apart by namespace: `wordpress`
 * is reserved, so a submission physically cannot land on top of a scanned
 * record. That rule cannot be copied here, because here every record lives under
 * one of those three namespaces and the whole purpose of the repo is to let a
 * vendor describe their own commercial extension. A vendor's WordPress plugin
 * *is* `wordpress/<slug>`; there is nowhere else to put it.
 *
 * So the split moves inside the record, and it follows who is the authority on
 * each field rather than who is more trusted overall:
 *
 *   MEASURED     adoption.*, release.version, release.lastUpdated
 *                Crawler only. A vendor is not the authority on how many people
 *                installed their plugin — somebody else counted that. A pull
 *                request touching these is refused, with the reason.
 *
 *   VENDOR       commercial.* — price, tiers, purchase and support links, an MCP
 *                endpoint if there is one. The vendor is the authority, and a
 *                crawl mostly cannot see any of it. A declaration wins outright.
 *
 *   DESCRIPTIVE  title, kind, listingUrl, authorship, platformData
 *                A vendor may fill these in where the crawl found nothing. Where
 *                the crawl did find something, the crawl wins: it is the same
 *                text the marketplace itself is showing.
 *
 * Every field a submission actually changes gets its own `provenance` entry, so
 * a merged record says which parts were measured and which were asserted.
 */
export const DESCRIPTIVE_PATHS = ['title', 'kind', 'listingUrl', 'authorship', 'platformData'] as const

/** Source name recorded in `provenance` for anything that arrived through `registry/`. */
export const VENDOR_SOURCE = 'vendor'

function getPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }, target)
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cursor = target
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys.at(-1)!] = value
}

/** Absent, null, an empty array or an empty object all count as "the crawl found nothing". */
function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return value === ''
}

/**
 * The measured paths a submission is trying to write.
 *
 * `src/validate.ts` turns a non-empty result into a failed pull request. This
 * lives here rather than there so the rule and the merge that depends on it stay
 * in one file — the failure mode being avoided is a validator that blocks one set
 * of paths while the merge protects a different set.
 */
export function measuredPathsIn(submission: Partial<Submission>): string[] {
  return MEASURED_PATHS.filter((path) => !isEmpty(getPath(submission, path)))
}

function provenanceEntry(observedAt: string) {
  return { source: VENDOR_SOURCE, evidence: 'declared' as const, observedAt }
}

/**
 * Combine what was crawled with what was submitted for the same slug.
 *
 * Deterministic: no clock is read. Vendor provenance dates come from the
 * submission's `declaredAt`, which is why that field exists.
 */
export function mergeRecord(crawled: PlatformRecord | null, submitted: Submission | null): PlatformRecord {
  if (!crawled && !submitted) throw new Error('mergeRecord needs at least one side')

  if (!crawled) {
    const { declaredAt, ...rest } = submitted as Submission
    return {
      ...(rest as PlatformRecord),
      // Nothing here was measured. Saying so once, at the root, is the honest
      // shape — a reader should not have to notice an absence to learn it.
      provenance: { ...(rest.provenance ?? {}), '*': provenanceEntry(declaredAt ?? epochFallback()) },
    }
  }

  if (!submitted) return crawled

  const merged: Record<string, unknown> = structuredClone(crawled) as Record<string, unknown>
  const provenance: Record<string, unknown> = { ...(crawled.provenance ?? {}) }
  const declaredAt = submitted.declaredAt ?? epochFallback()

  for (const path of VENDOR_PATHS) {
    const value = getPath(submitted, path)
    if (isEmpty(value)) continue
    setPath(merged, path, value)
    provenance[path] = provenanceEntry(declaredAt)
  }

  for (const path of DESCRIPTIVE_PATHS) {
    const value = getPath(submitted, path)
    // The crawl wins where it has something: that value is what the marketplace
    // is showing the world right now.
    if (isEmpty(value) || !isEmpty(getPath(crawled, path))) continue
    setPath(merged, path, value)
    provenance[path] = provenanceEntry(declaredAt)
  }

  // Measured paths are never read off the submission, even though validation
  // already refuses them. Two gates, because this one is the one that would
  // silently produce wrong data rather than a red build.

  if (submitted.ownership) merged.ownership = submitted.ownership
  merged.provenance = provenance
  return merged as PlatformRecord
}

/**
 * A submission with no `declaredAt` still needs a date, and it must not be the
 * current time or the build stops being reproducible. The Unix epoch is used as
 * an obviously-not-real value: it reads as "undated" at a glance, and it keeps
 * the provenance entry present so the vendor source is still visible.
 */
function epochFallback(): string {
  return '1970-01-01T00:00:00Z'
}
