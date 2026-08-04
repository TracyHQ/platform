#!/usr/bin/env node
/**
 * Fail the build if Tracy-authored text in this public repo is not in English.
 *
 *   node scripts/check-language.mjs
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-03 the MCP registry shipped with a Vietnamese `note` string inside
 * `findings/index.json` — a file served to every consumer of the public API. The
 * prose had been reviewed several times and nobody caught it, because a reviewer
 * fluent in the language does not perceive it as the wrong language.
 *
 * That is exactly the class of mistake to hand to a machine: mechanical,
 * invisible to the person best placed to notice it, and only embarrassing once
 * an outside reader hits it. The rule is ADR 0016 in TracyHQ/tracy-docs.
 *
 * WHY IT RUNS AFTER THE BUILD
 *
 * The string that reached consumers last time existed in no source file. It was
 * generated. Checking only the sources would have missed it, which is why CI
 * runs this step after `build-dist` rather than before.
 *
 * WHAT IS AND IS NOT CHECKED — THE HARDER HALF
 *
 * This repo makes the distinction sharper than the MCP one did, because here the
 * two kinds of text share a file. `dist/platform/wordpress/index.json` holds one
 * Tracy-authored `note` and 69,052 third-party extension titles, in whatever
 * language their authors wrote them. Scanning the whole file would flag real
 * plugin names; exempting the whole file would hide the `note`. So generated
 * files are scanned through an extractor that returns only the strings this repo
 * wrote.
 *
 * Translating a vendor's product name is a data-corruption bug, not a language
 * fix. `data/` and the record files derived from it are never scanned.
 *
 * WHY CODE POINTS INSTEAD OF LITERAL CHARACTERS
 *
 * The MCP version of this file wrote the alphabet out literally and therefore
 * failed its own check. A self-exemption would leave a hole big enough to hide a
 * real violation in, so the pattern is built from escapes and the comments name
 * characters instead of showing them. This file is scanned by the same rule as
 * every other.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Letters unique to Vietnamese:
 *   U+0102/0103  A-breve
 *   U+0110/0111  D-stroke
 *   U+01A0/01A1  O-horn
 *   U+01AF/01B0  U-horn
 *   U+1EA0-1EF9  the Vietnamese tone-mark block (hook-above and dot-below)
 *
 * Deliberately EXCLUDES the acute, grave and circumflex forms in Latin-1
 * Supplement that Vietnamese shares with Portuguese, French, Spanish and
 * Hungarian — real vendor names in this dataset use those, and flagging them
 * would train everyone to ignore this check.
 *
 * It cannot catch Vietnamese typed without diacritics. The written rule in
 * ADR 0016 covers what a regex cannot.
 */
const VIETNAMESE = /[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/u

/** Tracy-authored source. Anything added here must be prose we control. */
const SOURCE = [
  'README.md',
  'registry/README.md',
  'LICENSE',
  'LICENSE-DATA',
  'CODEOWNERS',
  'src',
  'bin',
  'scripts',
  '.github',
]

/**
 * Generated files, each with the extractor that returns only our own strings.
 *
 * `null` means the whole file is ours.
 */
const GENERATED = [
  { file: 'data/export-manifest.json', extract: null },
  { file: 'schema/platform-record.schema.json', extract: null },
  { file: 'dist/platform/index.json', extract: null },
  // Every platform index: the header is ours, `records` is theirs.
  ...['wordpress', 'joomla', 'shopify'].map((platform) => ({
    file: `dist/platform/${platform}/index.json`,
    extract: (text) => {
      const { records, ...header } = JSON.parse(text)
      return JSON.stringify(header, null, 2)
    },
  })),
]

function walk(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((entry) => walk(path.join(rel, entry)))
}

const offenders = []
let scanned = 0

function scan(rel, text) {
  scanned += 1
  text.split('\n').forEach((line, i) => {
    if (VIETNAMESE.test(line)) offenders.push({ rel, line: i + 1, text: line.trim().slice(0, 110) })
  })
}

for (const rel of SOURCE.flatMap(walk)) {
  scan(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
}

for (const { file, extract } of GENERATED) {
  const abs = path.join(ROOT, file)
  if (!fs.existsSync(abs)) continue
  const text = fs.readFileSync(abs, 'utf8')
  scan(file, extract ? extract(text) : text)
}

if (offenders.length) {
  console.error('Non-English text in a public repo. Everything Tracy writes here must be English.')
  console.error('Rule: ADR 0016 in TracyHQ/tracy-docs.\n')
  for (const offender of offenders) console.error(`  ${offender.rel}:${offender.line}\n    ${offender.text}`)
  console.error(`\n${offenders.length} line(s). Third-party extension names are data, are exempt, and are not scanned.`)
  process.exit(1)
}

console.log(`OK English — scanned ${scanned} files`)
