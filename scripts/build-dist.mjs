/**
 * Build the served surface (`dist/`) from the raw data (`data/`) and the
 * submissions (`registry/`).
 *
 *   pnpm build-dist
 *   pnpm build-dist --check    (build twice in-process and compare; writes nothing)
 *
 * WHY THIS FILE RUNS UNDER tsx
 *
 * The MCP registry's builder is plain node with no dependencies, which is nicer.
 * It can be, because nothing it publishes depends on a rule defined in `src/`.
 * Here the served record is the *merge* of a crawl and a submission, and the
 * ownership rules that govern that merge live in `src/merge.ts` because CI has to
 * enforce them on pull requests too. Reimplementing them here in plain JS would
 * put one contract in two files, which is the drift this repo has a gate against
 * everywhere else. So the builder imports them and pays for a toolchain.
 *
 * WHY THIS STEP EXISTS INSTEAD OF SERVING `data/` DIRECTLY
 *
 *   1. `data/` is one NDJSON file per platform; consumers want one JSON file per
 *      record, at a path they can construct without asking.
 *   2. A full record is around 700 bytes and there are 69,052 of them. Nobody is
 *      downloading 48 MB to look one up, so a slim index is built alongside.
 *   3. `registry/` submissions have to be folded in, per field, with provenance.
 *   4. The root of `dist/` stays EMPTY. Not an oversight — `registry.tracy.ai`
 *      serves `mcp/` and `skills/` from other repos, and the root name is left
 *      unclaimed so "index" at the root can never become ambiguous.
 *
 * EVERYTHING HERE MUST BE DETERMINISTIC. No timestamps, no filesystem-dependent
 * ordering. `--check` proves it and CI runs it before every deploy.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { mergeRecord } from '../src/merge'
import { PLATFORMS, PlatformRecordSchema, SubmissionSchema } from '../src/record'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA = path.join(ROOT, 'data')
const DIST = path.join(ROOT, 'dist')
const PREFIX = 'platform'

function fail(message, details = []) {
  console.error(message)
  for (const detail of details) console.error(`  ${detail}`)
  process.exit(1)
}

/** One NDJSON file per platform. A platform with no file yet is simply absent. */
function readCrawled() {
  const byPlatform = new Map()
  for (const platform of PLATFORMS) {
    const file = path.join(DATA, `${platform}.ndjson`)
    if (!fs.existsSync(file)) continue
    const records = new Map()
    const broken = []
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!line) return
      let record
      try {
        record = JSON.parse(line)
      } catch (error) {
        broken.push(`${platform}.ndjson:${i + 1} is not JSON — ${error.message}`)
        return
      }
      // PATH INVARIANT: `name` is `{platform}/{slug}`, and that is the served
      // path. This stands in for a redundant `path` field on every record — a
      // client must never have to guess a path, and we must not invent a second
      // way of saying one. A rule CI enforces is not guesswork; a rule that only
      // lives in a README is.
      if (record.name !== `${platform}/${record.slug}` || record.platform !== platform) {
        broken.push(`${platform}.ndjson:${i + 1} declares name="${record.name}" platform="${record.platform}"`)
        return
      }
      if (records.has(record.slug)) {
        broken.push(`${platform}.ndjson:${i + 1} repeats slug "${record.slug}"`)
        return
      }
      records.set(record.slug, record)
    })
    if (broken.length) fail(`Path invariant violated in data/${platform}.ndjson:`, broken)
    byPlatform.set(platform, records)
  }
  return byPlatform
}

/** Vendor submissions, `registry/{platform}/{slug}.json`. */
function readSubmissions() {
  const byPlatform = new Map()
  const base = path.join(ROOT, 'registry')
  if (!fs.existsSync(base)) return byPlatform
  for (const platform of fs.readdirSync(base).sort()) {
    const dir = path.join(base, platform)
    if (!fs.statSync(dir).isDirectory()) continue
    const records = new Map()
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const parsed = SubmissionSchema.safeParse(raw)
      if (!parsed.success) {
        fail(
          `registry/${platform}/${file} does not match the record schema. Run 'pnpm validate' for the reason.`,
          parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        )
      }
      records.set(parsed.data.slug, parsed.data)
    }
    byPlatform.set(platform, records)
  }
  return byPlatform
}

/**
 * The lookup projection: enough to search, rank and decide, in a file a browser
 * can hold. Everything else is one fetch away at `{name}.json`, which is why no
 * path appears here.
 *
 * `activeInstallsSource` travels with `activeInstalls` even though it is the same
 * value on every WordPress row today. Hoisting it into a file-level header would
 * save 2.7 MB and would be silently wrong the first time one platform reports two
 * kinds of number — which is the exact mistake the field was invented to prevent.
 */
function slim(record) {
  const out = { name: record.name, title: record.title, kind: record.kind }
  if (record.adoption?.activeInstalls != null) {
    out.activeInstalls = record.adoption.activeInstalls
    out.activeInstallsSource = record.adoption.activeInstallsSource
  }
  if (record.adoption?.rating != null) {
    out.rating = record.adoption.rating
    out.ratingScale = record.adoption.ratingScale
    out.ratingCount = record.adoption.ratingCount ?? 0
  }
  if (record.release?.lastUpdated) out.lastUpdated = record.release.lastUpdated
  if (record.commercial?.businessModel) out.businessModel = record.commercial.businessModel
  return out
}

/** Compact JSON, one record per line. Pretty-printing 69,052 records costs 60 MB of indentation. */
function jsonLines(records) {
  return `[\n${records.map((record) => JSON.stringify(record)).join(',\n')}\n]\n`
}

function buildTree() {
  const files = new Map()
  const crawled = readCrawled()
  const submitted = readSubmissions()
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'export-manifest.json'), 'utf8'))

  for (const platform of submitted.keys()) {
    if (!PLATFORMS.includes(platform)) {
      fail(`registry/${platform}/ is not a marketplace this registry covers (${PLATFORMS.join(', ')})`)
    }
  }

  const platformEntries = []
  for (const platform of PLATFORMS) {
    const crawledRecords = crawled.get(platform) ?? new Map()
    const submittedRecords = submitted.get(platform) ?? new Map()
    const slugs = [...new Set([...crawledRecords.keys(), ...submittedRecords.keys()])].sort()

    // macOS is case-insensitive and the CI runner is not. Two slugs differing only
    // in case would build fine here and overwrite each other there, so the
    // divergence is caught rather than discovered in production.
    const lowered = new Map()
    for (const slug of slugs) {
      const key = slug.toLowerCase()
      if (lowered.has(key)) {
        fail(`data/${platform}: "${slug}" and "${lowered.get(key)}" differ only in case and cannot both be served`)
      }
      lowered.set(key, slug)
    }

    const merged = []
    for (const slug of slugs) {
      const record = mergeRecord(crawledRecords.get(slug) ?? null, submittedRecords.get(slug) ?? null)
      const parsed = PlatformRecordSchema.safeParse(record)
      if (!parsed.success) {
        fail(
          `${platform}/${slug} is not a valid record after merging:`,
          parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        )
      }
      merged.push(parsed.data)
      // Compact, unlike the two index files. Indenting 69,052 records turns 48 MB
      // of data into 284 MB of mostly spaces, and every one of them is fetched by
      // a program rather than read by a person.
      files.set(`${PREFIX}/${platform}/${slug}.json`, Buffer.from(JSON.stringify(parsed.data) + '\n'))
    }

    if (!merged.length) {
      // A platform with no data yet publishes nothing at all, rather than an
      // empty index that reads like "we looked and found none".
      platformEntries.push({
        platform,
        status: 'not-measured',
        records: 0,
        note: 'No census has been run for this marketplace yet.',
      })
      continue
    }

    const declared = merged.filter((record) => !crawledRecords.has(record.slug)).length
    files.set(
      `${PREFIX}/${platform}/index.json`,
      Buffer.from(
        `{\n"platform": ${JSON.stringify(platform)},\n"count": ${merged.length},\n` +
          `"note": "Slim records for lookup. The full record for any entry is at /${PREFIX}/{name}.json",\n` +
          `"records": ${jsonLines(merged.map(slim))}}\n`,
      ),
    )

    platformEntries.push({
      platform,
      status: 'measured',
      records: merged.length,
      measured: merged.length - declared,
      declared,
      observedAt: manifest.platforms?.[platform]?.observedAt ?? null,
      coverageVsDirectory: manifest.platforms?.[platform]?.coverageVsDirectory ?? null,
      index: `${PREFIX}/${platform}/index.json`,
    })
  }

  files.set(
    `${PREFIX}/index.json`,
    Buffer.from(
      JSON.stringify(
        {
          registry: 'platform',
          url: 'https://registry.tracy.ai/platform/',
          note:
            'Extensions across three marketplaces, in one record shape. Every record says which of its fields ' +
            'were observed and which were declared by the vendor — see the provenance map on each record.',
          schema: `${PREFIX}/schema/platform-record.schema.json`,
          platforms: platformEntries,
          totalRecords: platformEntries.reduce((total, entry) => total + entry.records, 0),
        },
        null,
        2,
      ) + '\n',
    ),
  )

  // Served at the same URL its own `$id` declares, so an editor pointed there
  // loads exactly this file.
  const schemaFile = path.join(ROOT, 'schema', 'platform-record.schema.json')
  if (fs.existsSync(schemaFile)) {
    files.set(`${PREFIX}/schema/platform-record.schema.json`, fs.readFileSync(schemaFile))
  }

  return files
}

function digest(files) {
  const hash = createHash('sha256')
  for (const key of [...files.keys()].sort()) {
    hash.update(key)
    hash.update(files.get(key))
  }
  return hash.digest('hex')
}

const files = buildTree()

if (process.argv.includes('--check')) {
  const first = digest(files)
  const again = digest(buildTree())
  if (first !== again) fail(`NOT DETERMINISTIC: ${first} !== ${again}`)
  console.log(`OK deterministic — sha256 ${first}`)
  console.log(`  ${files.size} files`)
  process.exit(0)
}

fs.rmSync(DIST, { recursive: true, force: true })
for (const [rel, buffer] of files) {
  const dest = path.join(DIST, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buffer)
}

// Checked rather than trusted to care: this mistake only surfaces after a name
// on the shared domain has already been claimed by the wrong repo.
const rootFiles = fs.readdirSync(DIST).filter((entry) => fs.statSync(path.join(DIST, entry)).isFile())
if (rootFiles.length) fail(`The root of dist/ must be empty, but contains: ${rootFiles.join(', ')}`)

const index = JSON.parse(files.get(`${PREFIX}/index.json`))
for (const entry of index.platforms) {
  console.log(
    entry.status === 'measured'
      ? `${entry.platform.padEnd(10)} ${entry.records} records (${entry.measured} measured, ${entry.declared} declared)`
      : `${entry.platform.padEnd(10)} not measured yet`,
  )
}
console.log(`files      ${files.size}`)
console.log(`sha256     ${digest(files)}`)
