import { describe, expect, it } from 'vitest'

import { PlatformRecordSchema } from '../record'

const base = {
  name: 'wordpress/acme-checkout',
  platform: 'wordpress' as const,
  slug: 'acme-checkout',
  title: 'Acme Checkout',
  kind: ['plugin'],
}

function errorPaths(value: unknown): string[] {
  const parsed = PlatformRecordSchema.safeParse(value)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

/**
 * The five decisions the data forced. Each test is the observation that forced
 * one, so simplifying the schema back breaks a test that explains itself.
 */
describe('shapes the data forced', () => {
  it('accepts a release that is three kinds at once', () => {
    expect(errorPaths({ ...base, platform: 'joomla', name: 'joomla/2j-tabs', slug: '2j-tabs', kind: ['component', 'module', 'plugin'] })).toEqual([])
  })

  it('accepts a Shopify app with no version and no release date', () => {
    expect(
      errorPaths({
        ...base,
        platform: 'shopify',
        name: 'shopify/acme-upsell',
        slug: 'acme-upsell',
        kind: ['app'],
        release: { version: null, lastUpdated: null },
      }),
    ).toEqual([])
  })

  it('refuses a release date that is not ISO 8601', () => {
    expect(errorPaths({ ...base, release: { lastUpdated: '2026-05-28 9:18am GMT' } })).toEqual(['release.lastUpdated'])
  })

  it('refuses an install count with no statement of how it was counted', () => {
    expect(errorPaths({ ...base, adoption: { activeInstalls: 40000 } })).toEqual(['adoption.activeInstallsSource'])
  })

  it('refuses a rating with no scale, because 92 and 4.6 are both plausible', () => {
    expect(errorPaths({ ...base, adoption: { rating: 92 } })).toEqual(['adoption.ratingScale'])
  })
})

describe('the shared vocabulary stays shared', () => {
  it('keeps platform-specific fields under the record own platform', () => {
    expect(errorPaths({ ...base, platformData: { shopify: { pricingPlans: [] } } })).toEqual(['platformData.shopify'])
  })

  it('refuses unknown top-level fields, so a typo is caught rather than served', () => {
    expect(PlatformRecordSchema.safeParse({ ...base, activeInstalls: 40000 }).success).toBe(false)
  })

  it('does not accept "community" as a business model', () => {
    // wordpress.org means "who maintains it" by that word, and provenance means
    // something else again. It is kept verbatim in platformData instead.
    expect(errorPaths({ ...base, commercial: { businessModel: 'community' } })).toEqual(['commercial.businessModel'])
    expect(errorPaths({ ...base, platformData: { wordpress: { directoryBusinessModel: 'community' } } })).toEqual([])
  })
})
