import { describe, expect, it } from 'vitest'

import { isMergeableWithoutReview, probeFor, tokenPresent, verdictFor } from '../ownership'

const TOKEN = 'tracy-verify-a1b2c3d4e5f60718'

const wordpress = {
  platform: 'wordpress' as const,
  slug: 'acme-checkout',
  listingUrl: 'https://wordpress.org/plugins/acme-checkout/',
  ownership: { method: 'listing-token' as const, token: TOKEN },
}

describe('what gets fetched', () => {
  it('reads a WordPress listing through the API, where readme.txt ends up', () => {
    expect(probeFor(wordpress)!.url).toBe(
      'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=acme-checkout',
    )
  })

  it('reads the listing page itself for the marketplaces with no such API', () => {
    expect(probeFor({ ...wordpress, platform: 'joomla', listingUrl: 'https://extensions.joomla.org/extension/x/' })!.url).toBe(
      'https://extensions.joomla.org/extension/x/',
    )
  })

  it('has nothing to fetch for a product that is on no directory', () => {
    expect(probeFor({ ...wordpress, platform: 'joomla', listingUrl: null })).toBeNull()
  })
})

describe('matching the token', () => {
  it('finds it in a JSON response', () => {
    expect(tokenPresent(`{"sections":{"description":"<p>${TOKEN}</p>"}}`, TOKEN)).toBe(true)
  })

  it('finds it when the marketplace escaped the output', () => {
    expect(tokenPresent('tracy&#45;verify&#45;a1b2c3d4e5f60718', TOKEN)).toBe(true)
  })

  it('does not find a different token', () => {
    expect(tokenPresent(`{"description":"tracy-verify-ffffffffffffffff"}`, TOKEN)).toBe(false)
  })
})

describe('what a verdict means', () => {
  it('green only when the token was actually read back', () => {
    expect(isMergeableWithoutReview(verdictFor(wordpress, { ok: true, body: TOKEN }))).toBe(true)
  })

  it('not green when the listing does not carry the token', () => {
    expect(verdictFor(wordpress, { ok: true, body: 'nothing here' }).status).toBe('token-not-found')
  })

  it('not green when the listing could not be read', () => {
    expect(verdictFor(wordpress, { ok: false, body: '', detail: 'HTTP 404' }).status).toBe('unreachable')
  })

  /**
   * The extensions this registry was built for are the commercial ones that
   * appear on no directory. If a red check meant rejection, they could never be
   * submitted at all — so it means "a maintainer reads this one" instead.
   */
  it('is not a rejection for a product with no public listing', () => {
    const offDirectory = { ...wordpress, platform: 'joomla' as const, listingUrl: null }

    expect(verdictFor(offDirectory, null).status).toBe('no-path-a')
    expect(isMergeableWithoutReview(verdictFor(offDirectory, null))).toBe(false)
  })
})
