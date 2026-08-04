import type { Submission } from './record'

/**
 * PATH A — PROVING A SLUG BELONGS TO YOU, WITHOUT AN ACCOUNT SYSTEM.
 *
 * The MCP registry proves a namespace through GitHub: `io.github.acme` means the
 * `acme` GitHub account, and GitHub answers the question for us. There is no
 * equivalent here. wordpress.org has no OAuth, the Joomla Extensions Directory
 * has none either, and Shopify does not expose one for app listings.
 *
 * What every marketplace does give you is a page only the owner can edit. So the
 * proof is: put a token in your own listing, and CI reads the listing back. If
 * the token is there, whoever wrote the record can edit the listing, which is
 * the thing we actually wanted to know.
 *
 * This runs unattended, and it only works for extensions that are ON a public
 * directory. Commercial products that are not listed anywhere have no page to
 * read — those go down Path B, where a maintainer reads the pull request. Both
 * paths are live at once; Path A just makes the common case mechanical.
 *
 * Nothing in this file performs I/O. It decides what to fetch and what a
 * response means; `bin/verify-ownership.ts` does the fetching. Keeping them
 * apart is what makes the matching rules testable without a network.
 */

export type Probe = { url: string; note: string }

export type Verdict =
  | { status: 'verified'; url: string }
  | { status: 'token-not-found'; url: string }
  | { status: 'unreachable'; url: string; detail: string }
  | { status: 'no-path-a'; reason: string }

/**
 * Where to read a listing back from.
 *
 * WordPress goes through the API rather than the HTML page: `readme.txt` is
 * rendered into the `sections` of the JSON response, so a token added to the
 * readme shows up there, and the response is stable enough to match against.
 * The other two have no such API, so their public page is the page.
 */
export function probeFor(record: Pick<Submission, 'platform' | 'slug' | 'listingUrl' | 'ownership'>): Probe | null {
  if (!record.ownership) return null

  if (record.platform === 'wordpress') {
    const query = new URLSearchParams({ action: 'plugin_information', 'request[slug]': record.slug })
    return {
      url: `https://api.wordpress.org/plugins/info/1.2/?${query.toString()}`,
      note: 'wordpress.org plugin information API — a token in readme.txt appears in the rendered sections',
    }
  }

  if (!record.listingUrl) return null
  return { url: record.listingUrl, note: 'the public listing page named by the record' }
}

/**
 * Is the token in what came back?
 *
 * A plain substring match, deliberately. The token is long and random enough
 * that a false positive would have to be a copy of the token, and anything
 * cleverer (parsing HTML, unescaping entities, walking JSON) would be a second
 * place for the rule to be subtly different from what a vendor sees on their own
 * page. Entity-escaped copies are the one real case, so those are folded in.
 */
export function tokenPresent(body: string, token: string): boolean {
  if (body.includes(token)) return true
  // A marketplace that escapes the hyphens or slashes on the way out still shows
  // the vendor the token they pasted.
  const unescaped = body.replace(/\\\//g, '/').replace(/&#0?45;/g, '-').replace(/&amp;/g, '&')
  return unescaped.includes(token)
}

/** What a fetch result means for the record it was fetched for. */
export function verdictFor(
  record: Pick<Submission, 'platform' | 'slug' | 'listingUrl' | 'ownership'>,
  fetched: { ok: boolean; body: string; detail?: string } | null,
): Verdict {
  const probe = probeFor(record)
  if (!probe) {
    return {
      status: 'no-path-a',
      reason: record.ownership
        ? 'no public listing to read back — this record needs a maintainer review (Path B)'
        : 'no ownership token declared — this record needs a maintainer review (Path B)',
    }
  }
  if (!fetched || !fetched.ok) {
    return { status: 'unreachable', url: probe.url, detail: fetched?.detail ?? 'no response' }
  }
  return tokenPresent(fetched.body, record.ownership!.token)
    ? { status: 'verified', url: probe.url }
    : { status: 'token-not-found', url: probe.url }
}

/**
 * Path A is a shortcut, never a gate.
 *
 * A red ownership check must not mean "rejected" — the extensions this registry
 * was built for are the commercial ones that appear on no directory at all, and
 * they can never go green here. Verified means a maintainer can merge without
 * checking; anything else means a maintainer looks.
 */
export function isMergeableWithoutReview(verdict: Verdict): boolean {
  return verdict.status === 'verified'
}
