import fs from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { MEASURED_PATHS, SubmissionSchema } from '../src/record'

/**
 * Generate the JSON Schema a submitter's editor can validate against.
 *
 * The point is that a contributor finds out their record is wrong while typing
 * it, not after opening a pull request and waiting for CI.
 *
 * GENERATED FROM src/record.ts, NEVER HAND-WRITTEN. That file is what CI
 * enforces, so a hand-maintained copy would be a second description of one
 * contract, and the two would drift. CI runs this and then `git diff
 * --exit-code schema/`, so a change to the record that was not regenerated fails
 * the build rather than reaching a submitter.
 *
 * What cannot be expressed in JSON Schema stays in `src/validate.ts` and is
 * named in the description below, so nobody is surprised that a green editor can
 * still fail CI.
 */
const jsonSchema = z.toJSONSchema(SubmissionSchema, { io: 'input' })

const output = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://registry.tracy.ai/platform/schema/platform-record.schema.json',
  title: 'Tracy platform registry submission',
  description:
    'A record submitted to registry/{platform}/{slug}.json. Generated from src/record.ts — do not edit by hand. ' +
    'Three rules cannot be expressed here and are enforced by CI instead: the file path must match the name, the ' +
    `platform and the slug inside the record; these paths are written by the crawler and are refused in a ` +
    `submission (${MEASURED_PATHS.join(', ')}); and provenance is generated at merge time rather than submitted.`,
  ...jsonSchema,
}

const target = path.join(process.cwd(), 'schema', 'platform-record.schema.json')
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, JSON.stringify(output, null, 2) + '\n')

console.log(`wrote ${path.relative(process.cwd(), target)}`)
