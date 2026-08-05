# Tracy platform registry

Extensions across three marketplaces — WordPress, Joomla and Shopify — in one record shape, served
as static JSON at **https://registry.tracy.ai/platform/**.

Every record says which of its fields were **observed** and which were **declared**, and when. That
distinction is the point of the dataset. A marketplace listing already tells you what a vendor says
about their own product; what it does not tell you is the day somebody outside went and checked.

```bash
# The manifest: which marketplaces are covered, how many records, measured when
curl -s https://registry.tracy.ai/platform/index.json | jq

# Every WordPress extension, slim enough to search offline (15 MB)
curl -s https://registry.tracy.ai/platform/wordpress/index.json | jq '.records[] | select(.activeInstalls > 1000000)'

# One full record
curl -s https://registry.tracy.ai/platform/wordpress/woocommerce.json | jq

# Every full record at once — 4.9 MB for all 69,052, instead of 69,052 fetches.
# Carries listingUrl, platformData and provenance, which the slim index does not.
curl -s https://registry.tracy.ai/platform/wordpress/records.ndjson.gz | gzip -dc | head -1 | jq
```

## What is in it today

| Marketplace | Records | Coverage | Measured |
|---|---|---|---|
| WordPress | 69,052 | 1.0 | 2026-08-04 — the whole wordpress.org plugin directory |
| Joomla | 5,604 | 0.9989 | 2026-08-04 — the whole Joomla Extensions Directory |
| Shopify | 23,581 | 0.9599 | 2026-08-05 — climbing; the App Store rate-limits, so the crawl runs in scheduled passes |

Read `coverageVsDirectory` before comparing the three. They are not equally complete, and the
manifest says so rather than leaving you to assume.

The WordPress census covers the directory completely: wordpress.org reported 69,053 plugins and
69,052 distinct ones came back, the difference being one duplicate dropped. `data/export-manifest.json`
records how that was established.

Two marketplaces are missing and the repository is built to stay the same shape when they arrive.
Nothing here assumes all three are present.

## Reading a record

```json
{
  "name": "wordpress/woocommerce",
  "platform": "wordpress",
  "slug": "woocommerce",
  "title": "WooCommerce",
  "kind": ["plugin"],
  "listingUrl": "https://wordpress.org/plugins/woocommerce/",
  "authorship": { "author": "Automattic", "authorUrl": "…", "contributors": ["…"] },
  "release": { "version": "10.9.4", "lastUpdated": "2026-07-07T14:16:00Z" },
  "adoption": {
    "activeInstalls": 7000000,
    "activeInstallsSource": "directory-reported",
    "rating": 90,
    "ratingScale": 100,
    "ratingCount": 4810
  },
  "commercial": { "businessModel": "freemium", "pricingUrl": null, "tiers": [] },
  "platformData": { "wordpress": { "requires": "6.9", "requiresPhp": "7.4", "tested": "7.0.2" } },
  "provenance": {
    "*": { "source": "wordpress.org", "evidence": "observed", "observedAt": "2026-08-04T06:00:50Z" }
  }
}
```

The record's `name` is its path: `wordpress/woocommerce` is served at
`/platform/wordpress/woocommerce.json`. There is no separate path field to get out of step with it,
and CI enforces the rule.

`provenance` is keyed by field path, most specific first, and `"*"` means the whole record. A record
that has been crawled and then declared on by its vendor carries both:

```json
"provenance": {
  "*":          { "source": "wordpress.org", "evidence": "observed", "observedAt": "2026-08-04T06:00:50Z" },
  "commercial": { "source": "vendor",        "evidence": "declared", "observedAt": "2026-08-04T00:00:00Z" }
}
```

### Five fields that look more complicated than they need to

Each was forced by something in the data. `src/record.ts` carries the observation next to the field.

| | Why |
|---|---|
| `kind` is a list | one Joomla release is routinely a Component *and* a Module *and* a Plugin |
| `release.version` and `release.lastUpdated` are nullable | Shopify publishes neither |
| `lastUpdated` is ISO 8601 | three marketplaces, three date formats |
| `activeInstallsSource` is never absent when `activeInstalls` is present | self-reported buckets and outside measurements are different kinds of number, and a column mixing them is broken data that still looks fine |
| `ratingScale` always travels with `rating` | wordpress.org rates out of 100; Joomla and Shopify out of 5 |

## Submitting

Anyone can add or correct a record: see **[registry/README.md](registry/README.md)**. The short
version is that the fields split by who is the authority on them — a vendor owns what their product
costs, the crawler owns what was counted — and a pull request that tries to write a measured field
is refused with the reason.

## How it is built

```
data/         one NDJSON file per marketplace, plus export-manifest.json. Pushing here publishes.
registry/     vendor submissions, one JSON file per extension
curation/     trust labels, maintainers only
src/          record.ts defines the record; merge.ts defines who may write what
schema/       generated from src/record.ts — never edited by hand
scripts/      build-dist.mjs, check-language.mjs
dist/         built by CI, never committed
```

```bash
pnpm install
pnpm test            # the merge rules, the schema, the ownership check
pnpm validate        # every file in registry/
pnpm build-dist      # data/ + registry/ -> dist/
pnpm build-dist --check   # build twice, compare sha256, write nothing
```

Four gates run before anything is published, and each exists because of something that has already
gone wrong once:

1. **Determinism** — `build-dist --check` builds twice in-process and compares a sha256 over every
   byte. A timestamp or a filesystem ordering that leaked in dies here rather than producing a deploy
   that differs from the last one for reasons nobody can explain.
2. **Schema drift** — `emit-schema` then `git diff --exit-code schema/`. A submitter must not be
   validating against one contract while CI enforces another.
3. **Record count** — the built index is cross-checked against `data/export-manifest.json` plus the
   number of files in `registry/`. A drop that lost records fails the publish.
4. **Language** — `check-language.mjs`, and it runs **after** the build, because the string that
   reaches consumers is generated into `dist/` rather than written in any source file.

`dist/` is never committed. It is a pure derivative, and a committed derivative eventually disagrees
with the source that produced it with no way to tell which one is right.

## Licence

Code is MIT. Data is CC BY 4.0 — see [LICENSE-DATA](LICENSE-DATA).

Extension names appear verbatim, in whatever language their authors wrote them. Vendor prose —
descriptions, changelogs, marketing copy — belongs to whoever wrote it and is not republished here.

## Open questions

Not decided yet, and deliberately not guessed:

- **Re-crawl rhythm.** By hand today. There is no `schedule:` in the publish workflow, for the same
  reason the sibling MCP registry has none: a cron would make the dataset look freshly updated while
  every `observedAt` stayed exactly the same, and that date is the only thing this data has.
- **Thresholds for the labels in `curation/`.**
- **Whether to serve the full `.ndjson.gz` alongside the slim index.** The router already has cache
  and content-type rules for it, so the cost is near zero — but nobody has asked for it yet.
