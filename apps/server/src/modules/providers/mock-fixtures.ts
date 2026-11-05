// The mock provider's recorded fixtures (PRV-081): one `TextResponse` per file, named by
// the role's call sequence number and the role, in the folder of one test scenario.
// apps/server/test/fixtures/model/README.md describes the layout.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ModelRole, TokenUsageSchema } from '@mythos/contracts';
import { z } from 'zod';
import type { TextResponse } from './types';

/**
 * A fixture file, parsed strictly: it holds exactly a `TextResponse`, so a file in a
 * provider's wire format is rejected rather than half read (PRV-012).
 */
const TextResponseSchema = z.strictObject({
  text: z.string(),
  thinking: z.string().nullable(),
  usage: z.strictObject(TokenUsageSchema.shape),
  finishReason: z.enum(['stop', 'length', 'cancelled', 'refusal']),
}) satisfies z.ZodType<TextResponse>;

/**
 * The file name for a role's `call`th call (from 1): `001-narrator.json`. The number
 * counts that role's calls only, so interleaved background calls replay the same way.
 */
export function fixtureFileName(role: ModelRole, call: number): string {
  return `${String(call).padStart(3, '0')}-${role}.json`;
}

/**
 * Reads the fixture for a role's `call`th call from a scenario folder. A missing or
 * invalid file is a broken test, so it throws, naming the file (CONV-041).
 * Implements PRV-081 and PRV-012.
 */
export async function readFixture(
  fixturesDir: string,
  role: ModelRole,
  call: number,
): Promise<TextResponse> {
  const file = path.join(fixturesDir, fixtureFileName(role, call));
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `Mock fixture ${file} is missing: record it, or check the test's fixturesDir (PRV-081).`,
        { cause: error },
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Mock fixture ${file} is not valid JSON: ${reason}`, { cause: error });
  }

  const parsed = TextResponseSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Mock fixture ${file} is not a TextResponse, as fixtures must be (PRV-012): ${issues}`,
    );
  }
  return parsed.data;
}
