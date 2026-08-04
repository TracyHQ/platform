# Submit your extension

This folder is the submission queue. Add one JSON file, open a pull request, and once it merges your
extension appears in the public index at `https://registry.tracy.ai/platform/`.

You do not need to ask permission first, and you do not need a Tracy account.

## The file

One file per extension, at `registry/{platform}/{slug}.json`, where `platform` is `wordpress`,
`joomla` or `shopify`:

```
registry/wordpress/acme-checkout.json
```

```json
{
  "$schema": "https://registry.tracy.ai/platform/schema/platform-record.schema.json",
  "name": "wordpress/acme-checkout",
  "platform": "wordpress",
  "slug": "acme-checkout",
  "title": "Acme Checkout",
  "kind": ["plugin"],
  "listingUrl": "https://wordpress.org/plugins/acme-checkout/",
  "declaredAt": "2026-08-04T00:00:00Z",
  "commercial": {
    "businessModel": "freemium",
    "pricingUrl": "https://acme.example/pricing",
    "supportUrl": "https://acme.example/support",
    "tiers": [{ "name": "Pro", "price": "$99/yr", "url": "https://acme.example/pricing" }]
  }
}
```

| Field | |
|---|---|
| `name` | `{platform}/{slug}`, and it must match the file path |
| `platform` | `wordpress`, `joomla` or `shopify` |
| `slug` | how your extension is identified on that marketplace |
| `title` | its name |
| `kind` | a **list** — a Joomla release that is a Component, a Module and a Plugin says all three |
| `listingUrl` | the public listing, or `null` if it is not on any directory |
| `declaredAt` | the date your declaration was true — see below for why this is required |
| `commercial` | what it costs, where to buy it, where support lives |

Point your editor at the `$schema` line above and it will check the file as you type.

## What you own, and what you do not

Records here have two kinds of field, and the difference is not about trust. It is about who is the
authority on each fact.

| | Fields | Who writes them |
|---|---|---|
| **Measured** | `adoption.*`, `release.version`, `release.lastUpdated` | Only the crawler. A pull request touching these fails. |
| **Yours** | `commercial.*` — price, tiers, purchase and support links, an MCP endpoint if you have one | Only you. A crawl mostly cannot see any of it, and your declaration wins. |
| **Descriptive** | `title`, `kind`, `listingUrl`, `authorship`, `platformData` | You may fill these in where we found nothing. Where we did find something, ours wins — it is the same text the marketplace is showing. |

You are the authority on what your product costs. You are not the authority on how many people
installed it, because somebody else counted that. The one thing this dataset has that your own
listing does not is a date on which we went and looked; a pull request replacing a measurement with
a claim deletes exactly that, so CI refuses it and tells you which field it meant.

If a measured value is wrong, open an issue. We will re-check it and the correction will carry a
date, like every other number here.

### Why `declaredAt`

Every field in a merged record carries a provenance entry saying where it came from and when. The
build has to produce identical bytes twice — that is a CI gate — so the date on your half cannot be
read from the clock when your record merges. It comes from you instead, which is also what it
honestly is: a date you stated, on a record marked `declared` rather than `observed`.

You cannot write `provenance` yourself. It is generated at merge time; otherwise a claim could be
labelled as an observation.

## Proving the slug is yours

Two paths, and both are open at once.

### Path A — put a token on your own listing

If your extension is on a public directory, add a line like this anywhere in your listing that
visitors can see — `readme.txt` on wordpress.org, the description field on the Joomla Extensions
Directory or the Shopify app store:

```
tracy-verify-a1b2c3d4e5f60718
```

Pick your own token: `tracy-verify-` followed by 16 to 64 lowercase letters and digits. Then declare
it in your record:

```json
"ownership": { "method": "listing-token", "token": "tracy-verify-a1b2c3d4e5f60718" }
```

CI reads your listing back and looks for the token. Only somebody who can edit that listing can put
it there, which is the thing we actually needed to know. A green check means a maintainer can merge
without reading further. You can delete the token from your listing once the record has merged.

### Path B — a maintainer reads the pull request

If your extension is not on any public directory — and many commercial ones are not — there is no
page to read back, so Path A cannot apply. Leave `ownership` out and open the pull request. A
maintainer will look at it.

**A red ownership check is not a rejection.** Off-directory products can never go green there, and
they are a large part of why this registry exists. Path A only makes the common case mechanical.

## What CI checks, and what it does not

On every pull request, with no network access:

- the file parses and matches the schema
- the path matches the `name`, `platform` and `slug` inside it
- no measured field is being written
- no `provenance` is being submitted
- no unknown fields, so a typo is caught rather than ignored

Separately, and only if you declared a token, one job fetches your public listing and looks for it.
That is the only step that touches the network, and it is kept apart so "is this file well-formed"
never fails because a marketplace was slow.

Run the pure checks locally before opening the pull request:

```bash
pnpm install
pnpm validate
```

## After it merges

The index rebuilds and publishes automatically. Your record appears at:

```
https://registry.tracy.ai/platform/wordpress/index.json
https://registry.tracy.ai/platform/wordpress/acme-checkout.json
```

If we had already crawled your extension, the two are merged into one record: our measurements, your
commercial fields, and a `provenance` map naming both sources. Nothing you sent overwrote anything
we measured, and nothing we measured overwrote what you said about your own pricing.

To change or remove your record later, open another pull request against the same file. It is yours.

## Questions

Open an issue. If something on this page was unclear enough that you had to guess, that is worth an
issue too.
