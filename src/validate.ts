import { measuredPathsIn, DESCRIPTIVE_PATHS } from './merge'
import { PLATFORMS, SubmissionSchema, platformOf, slugOf, VENDOR_PATHS } from './record'

export type ValidationError = { code: string; message: string }

/**
 * Pure rules, no network. Runs on every pull request, including when GitHub's
 * API is out of quota and when the vendor's own site is down.
 *
 * The one check that does reach the network — fetching a public listing to look
 * for an ownership token — is deliberately a separate workflow. Mixing them
 * would make "is this file well-formed" fail for reasons that have nothing to do
 * with the file.
 *
 * File path and file content mirror each other on purpose: `git mv`-ing a record
 * into another directory without editing it would change which extension the
 * record is about, so that is an error rather than a surprise.
 */
export function validateRecordFile(filePath: string, raw: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const segments = filePath.split('/').filter(Boolean)

  if (segments.length !== 3 || segments[0] !== 'registry') {
    return [
      {
        code: 'path_outside_registry',
        message: `record must live at registry/{platform}/{slug}.json: ${filePath}`,
      },
    ]
  }

  const pathPlatform = segments[1]!
  const fileSegment = segments[2]!
  const pathSlug = fileSegment.endsWith('.json') ? fileSegment.slice(0, -'.json'.length) : fileSegment

  if (!(PLATFORMS as readonly string[]).includes(pathPlatform)) {
    errors.push({
      code: 'unknown_platform',
      message: `directory "${pathPlatform}" is not a marketplace this registry covers (${PLATFORMS.join(', ')})`,
    })
  }

  const parsed = SubmissionSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ code: 'schema', message: `${issue.path.join('.') || '(root)'}: ${issue.message}` })
    }
    return errors
  }

  const record = parsed.data

  if (platformOf(record.name) !== record.platform) {
    errors.push({
      code: 'name_platform_mismatch',
      message: `name "${record.name}" does not start with platform "${record.platform}"`,
    })
  }
  if (slugOf(record.name) !== record.slug) {
    errors.push({
      code: 'name_slug_mismatch',
      message: `name "${record.name}" does not end with slug "${record.slug}"`,
    })
  }
  if (pathPlatform !== record.platform) {
    errors.push({
      code: 'path_platform_mismatch',
      message: `directory "${pathPlatform}" does not match platform "${record.platform}" inside the record`,
    })
  }
  if (pathSlug !== record.slug) {
    errors.push({
      code: 'path_slug_mismatch',
      message: `file name "${pathSlug}" does not match slug "${record.slug}" inside the record`,
    })
  }

  // THE RULE THIS REGISTRY EXISTS TO PROTECT.
  //
  // Anyone may submit a record. Nobody may submit a measurement. What this
  // dataset has that a marketplace listing does not is a date on which somebody
  // went and looked; a record whose install count came from the vendor who
  // benefits from it has thrown that away and still looks like data.
  const measured = measuredPathsIn(record)
  if (measured.length) {
    errors.push({
      code: 'measured_field_submitted',
      message:
        `${measured.join(', ')} ${measured.length === 1 ? 'is' : 'are'} written by the crawler, not by submission. ` +
        `You own what your product costs (${VENDOR_PATHS.join(', ')}) — install counts, ratings and release dates are ` +
        `observed, and replacing an observation with a claim is the one thing this registry cannot allow. ` +
        `If a measured value is wrong, open an issue and we will re-check it.`,
    })
  }

  // Same reason, one level up: a submitter writing their own provenance could
  // stamp `evidence: observed` on a claim. The merge writes this map; nobody
  // else does.
  if (record.provenance) {
    errors.push({
      code: 'provenance_submitted',
      message:
        'provenance is generated when your record is merged, and cannot be submitted — otherwise a claim could be ' +
        'labelled as an observation. Use declaredAt to say when your declaration was true.',
    })
  }

  const writesSomething =
    [...VENDOR_PATHS, ...DESCRIPTIVE_PATHS].some((path) => {
      const value = (record as Record<string, unknown>)[path.split('.')[0]!]
      return value != null && !(Array.isArray(value) && value.length === 0)
    })
  if (writesSomething && !record.declaredAt) {
    errors.push({
      code: 'declared_at_missing',
      message:
        'declaredAt is required: every provenance entry carries a date, and the build must produce the same bytes ' +
        'twice, so the date cannot be read from the clock at merge time. Use the day your declaration was true, ' +
        'e.g. "2026-08-04T00:00:00Z".',
    })
  }

  return errors
}
