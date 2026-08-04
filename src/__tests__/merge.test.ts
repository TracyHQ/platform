import { describe, expect, it } from 'vitest'

import { mergeRecord, measuredPathsIn, VENDOR_SOURCE } from '../merge'
import { PlatformRecordSchema, type PlatformRecord, type Submission } from '../record'
import { validateRecordFile } from '../validate'

const CRAWL_STAMP = '2026-08-04T06:00:50Z'

const crawled: PlatformRecord = {
  name: 'wordpress/acme-checkout',
  platform: 'wordpress',
  slug: 'acme-checkout',
  title: 'Acme Checkout',
  kind: ['plugin'],
  listingUrl: 'https://wordpress.org/plugins/acme-checkout/',
  authorship: { author: 'Acme', authorUrl: 'https://profiles.wordpress.org/acme/', contributors: ['acme'] },
  release: { version: '2.1.0', lastUpdated: '2026-07-30T00:00:00Z' },
  adoption: {
    activeInstalls: 40000,
    activeInstallsSource: 'directory-reported',
    rating: 92,
    ratingScale: 100,
    ratingCount: 311,
  },
  platformData: { wordpress: { requiresPhp: '7.4', tested: '6.8' } },
  provenance: { '*': { source: 'wordpress.org', evidence: 'observed', observedAt: CRAWL_STAMP } },
}

/** The same slug, as its vendor would submit it: price, and nothing they did not measure. */
const vendorSubmission: Submission = {
  name: 'wordpress/acme-checkout',
  platform: 'wordpress',
  slug: 'acme-checkout',
  title: 'Acme Checkout',
  kind: ['plugin'],
  declaredAt: '2026-08-04T00:00:00Z',
  commercial: {
    businessModel: 'freemium',
    pricingUrl: 'https://acme.com/pricing',
    tiers: [{ name: 'Pro', price: '$99/yr', url: 'https://acme.com/pricing' }],
  },
}

describe('a pull request touching a measured field', () => {
  it('is refused, and the message says who owns the field', () => {
    const errors = validateRecordFile('registry/wordpress/acme-checkout.json', {
      ...vendorSubmission,
      adoption: { activeInstalls: 500000, activeInstallsSource: 'directory-reported' },
    })

    expect(errors.map((e) => e.code)).toContain('measured_field_submitted')
    expect(errors.find((e) => e.code === 'measured_field_submitted')!.message).toMatch(/observed/)
  })

  it('is refused for a release date too, not only for install counts', () => {
    const errors = validateRecordFile('registry/wordpress/acme-checkout.json', {
      ...vendorSubmission,
      release: { lastUpdated: '2026-08-01T00:00:00Z' },
    })

    expect(measuredPathsIn({ ...vendorSubmission, release: { lastUpdated: '2026-08-01T00:00:00Z' } })).toEqual([
      'release.lastUpdated',
    ])
    expect(errors.map((e) => e.code)).toContain('measured_field_submitted')
  })

  it('never reaches the merged record even if validation were bypassed', () => {
    const merged = mergeRecord(crawled, {
      ...vendorSubmission,
      adoption: { activeInstalls: 500000, activeInstallsSource: 'directory-reported' },
    } as Submission)

    expect(merged.adoption?.activeInstalls).toBe(40000)
  })
})

describe('a pull request filling in a vendor-owned field', () => {
  it('passes validation', () => {
    expect(validateRecordFile('registry/wordpress/acme-checkout.json', vendorSubmission)).toEqual([])
  })

  it('lands in the merged record', () => {
    const merged = mergeRecord(crawled, vendorSubmission)

    expect(merged.commercial?.businessModel).toBe('freemium')
    expect(merged.commercial?.tiers).toHaveLength(1)
    expect(PlatformRecordSchema.safeParse(merged).success).toBe(true)
  })

  it('does not carry declaredAt into the served record', () => {
    expect(mergeRecord(crawled, vendorSubmission)).not.toHaveProperty('declaredAt')
  })
})

describe('one slug with both sources', () => {
  const merged = mergeRecord(crawled, vendorSubmission)

  it('keeps the measurement intact', () => {
    expect(merged.adoption).toEqual(crawled.adoption)
    expect(merged.release).toEqual(crawled.release)
  })

  it('records both sources in provenance', () => {
    expect(merged.provenance).toEqual({
      '*': { source: 'wordpress.org', evidence: 'observed', observedAt: CRAWL_STAMP },
      commercial: { source: VENDOR_SOURCE, evidence: 'declared', observedAt: '2026-08-04T00:00:00Z' },
    })
  })

  it('marks the vendor half as declared, not observed', () => {
    expect(merged.provenance!.commercial!.evidence).toBe('declared')
    expect(merged.provenance!['*']!.evidence).toBe('observed')
  })
})

describe('descriptive fields', () => {
  it('let the crawl win where it found something', () => {
    const merged = mergeRecord(crawled, { ...vendorSubmission, title: 'Acme Checkout PRO — Best Checkout Plugin' })

    expect(merged.title).toBe('Acme Checkout')
    expect(merged.provenance).not.toHaveProperty('title')
  })

  it('let the vendor fill a gap the crawl left', () => {
    const withoutAuthor = { ...crawled, authorship: undefined }
    const merged = mergeRecord(withoutAuthor, {
      ...vendorSubmission,
      authorship: { author: 'Acme Software Ltd', authorUrl: 'https://acme.com' },
    })

    expect(merged.authorship?.author).toBe('Acme Software Ltd')
    expect(merged.provenance!.authorship!.source).toBe(VENDOR_SOURCE)
  })
})

describe('a submission with no crawled counterpart', () => {
  const offDirectory: Submission = {
    name: 'joomla/jt-pagebuilder',
    platform: 'joomla',
    slug: 'jt-pagebuilder',
    title: 'JT PageBuilder',
    kind: ['component', 'module', 'plugin'],
    listingUrl: null,
    declaredAt: '2026-08-04T00:00:00Z',
    commercial: { businessModel: 'paid', pricingUrl: 'https://example.com/pricing' },
  }

  it('is a valid record on its own', () => {
    const merged = mergeRecord(null, offDirectory)

    expect(PlatformRecordSchema.safeParse(merged).success).toBe(true)
    expect(merged.kind).toEqual(['component', 'module', 'plugin'])
  })

  it('says at the root that nothing here was measured', () => {
    expect(mergeRecord(null, offDirectory).provenance).toEqual({
      '*': { source: VENDOR_SOURCE, evidence: 'declared', observedAt: '2026-08-04T00:00:00Z' },
    })
  })
})
