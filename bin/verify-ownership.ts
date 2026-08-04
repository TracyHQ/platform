import fs from 'node:fs/promises'
import path from 'node:path'

import { SubmissionSchema } from '../src/record'
import { probeFor, verdictFor, type Verdict } from '../src/ownership'

/**
 * Path A of ownership verification: read the vendor's own public listing back
 * and look for the token they declared.
 *
 * THIS IS THE ONE CHECK THAT TOUCHES THE NETWORK, AND IT RUNS ON ITS OWN.
 *
 * `pnpm validate` stays pure so that "is this file well-formed" never fails
 * because wordpress.org was slow. This runs in a separate workflow, and its
 * green check is what lets a maintainer merge a directory-listed submission
 * without reading it.
 *
 * EXIT CODES ARE NOT A VERDICT ON THE SUBMISSION.
 *
 *   1  a token was declared and the listing does not carry it — the claim is
 *      false as stated, and that is worth stopping for
 *   0  everything else, including "this product is on no directory". Most of the
 *      extensions this registry exists for are in that state; failing them here
 *      would make the repo useless for its actual purpose. They go to Path B,
 *      where a maintainer reads the pull request.
 */

const root = process.cwd()
const registryDir = path.join(root, 'registry')

async function read(url: string): Promise<{ ok: boolean; body: string; detail?: string }> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'TracyRegistryBot/0.1 (+https://registry.tracy.ai; ownership verification)' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { ok: false, body: '', detail: `HTTP ${response.status}` }
    return { ok: true, body: await response.text() }
  } catch (error) {
    return { ok: false, body: '', detail: error instanceof Error ? error.message : String(error) }
  }
}

function line(relative: string, verdict: Verdict): string {
  switch (verdict.status) {
    case 'verified':
      return `verified   ${relative} — token found at ${verdict.url}`
    case 'token-not-found':
      return `FAIL       ${relative} — ${verdict.url} does not carry the declared token`
    case 'unreachable':
      return `unreadable ${relative} — ${verdict.url}: ${verdict.detail}`
    case 'no-path-a':
      return `review     ${relative} — ${verdict.reason}`
  }
}

let failed = 0
const summary: string[] = []

const platforms = await fs.readdir(registryDir).catch(() => [] as string[])
for (const platform of platforms.sort()) {
  const dir = path.join(registryDir, platform)
  if (!(await fs.stat(dir)).isDirectory()) continue
  for (const file of (await fs.readdir(dir)).sort()) {
    if (!file.endsWith('.json')) continue
    const relative = path.posix.join('registry', platform, file)
    const parsed = SubmissionSchema.safeParse(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')))
    if (!parsed.success) continue // pnpm validate reports this properly; do not report it twice

    const probe = probeFor(parsed.data)
    const verdict = verdictFor(parsed.data, probe ? await read(probe.url) : null)
    const text = line(relative, verdict)
    console.log(text)
    summary.push(text)
    if (verdict.status === 'token-not-found') failed += 1
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    ['## Listing ownership (Path A)', '', '```', ...summary, '```', ''].join('\n'),
  )
}

if (failed > 0) {
  console.error(`\n${failed} record(s) declared a token that is not on the listing`)
  process.exit(1)
}
