// Token estimation (PRV-070) and its calibration from provider-reported usage (PRV-071).
// No tokenizer: counts differ between providers anyway, so the engine estimates from
// characters and lets each profile's ratio drift toward what its provider reports.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelProfile } from '@mythos/contracts';
import { z } from 'zod';

export const CALIBRATION_FILE = 'calibration.json';

/** How much one call moves the calibrated ratio: an exponential moving average. */
const SAMPLE_WEIGHT = 0.2;

/**
 * Estimated tokens for `text`: its length divided by the ratio, rounded up. It adds no
 * margin; the context module's input budget holds the margin (CTX-030, PRV-072).
 * Implements PRV-070.
 */
export function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}

/** Calibrated ratios, keyed by `calibrationKey`. */
const CalibrationFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profiles: z.record(
    z.string(),
    z.strictObject({ charsPerToken: z.number().positive(), samples: z.int().positive() }),
  ),
});
type CalibrationFile = z.infer<typeof CalibrationFileSchema>;

/** Each model profile's calibrated characters-per-token ratio (PRV-071). */
export type Calibration = {
  /** The ratio to estimate with: calibrated for the profile and its model, else its own. */
  charsPerToken(profile: ModelProfile): number;
  /**
   * Folds one call into the profile's ratio and saves it: `estimated` is what
   * `estimateTokens` gave for the prompt, `reported` the provider's `inputTokens`.
   */
  calibrate(profile: ModelProfile, estimated: number, reported: number): Promise<void>;
};

/**
 * The key a profile's ratio is stored under: its ID and its model, so changing the model
 * starts again from the profile's own ratio. IDs are slugs, so the first colon splits them.
 */
function calibrationKey(profile: ModelProfile): string {
  return `${profile.id}:${profile.model}`;
}

/**
 * Opens `<dataDir>/calibration.json`, never machine config, so editing config never
 * clobbers it. A missing file starts empty. A corrupt one also starts empty, and `problem`
 * says why, for the caller to log; the next save replaces it. Implements PRV-071.
 */
export async function openCalibration(
  dataDir: string,
): Promise<{ calibration: Calibration; problem: string | null }> {
  const file = path.join(dataDir, CALIBRATION_FILE);
  const loaded = await readCalibration(file);
  const state = loaded.state;
  let writing: Promise<void> = Promise.resolve();

  function charsPerToken(profile: ModelProfile): number {
    return state.profiles[calibrationKey(profile)]?.charsPerToken ?? profile.charsPerToken;
  }

  async function calibrate(profile: ModelProfile, estimated: number, reported: number) {
    // A zero on either side holds no ratio: an empty prompt, or no usage reported.
    if (estimated <= 0 || reported <= 0) return;
    const key = calibrationKey(profile);
    const current = charsPerToken(profile);
    // The estimate was made with `current`, so this is the ratio that would have hit
    // the reported count exactly.
    const sample = (current * estimated) / reported;
    state.profiles[key] = {
      // The same as 0.8 × current + 0.2 × sample, but exact when the sample agrees.
      charsPerToken: current + SAMPLE_WEIGHT * (sample - current),
      samples: (state.profiles[key]?.samples ?? 0) + 1,
    };
    await save();
  }

  // Writes one at a time, each a snapshot of the state when it was queued, so two
  // renames never race over the same file.
  function save(): Promise<void> {
    const text = `${JSON.stringify(state, null, 2)}\n`;
    const write = writing.then(() => writeFileAtomic(file, text));
    // The caller of this write gets its error; later writes only wait for it.
    writing = write.catch(() => undefined);
    return write;
  }

  return { calibration: { charsPerToken, calibrate }, problem: loaded.problem };
}

async function readCalibration(
  file: string,
): Promise<{ state: CalibrationFile; problem: string | null }> {
  const empty = (): CalibrationFile => ({ schemaVersion: 1, profiles: {} });
  const startsEmpty = 'calibration starts again from the charsPerToken in each profile';
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { state: empty(), problem: null };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { state: empty(), problem: `${file} is not valid JSON (${reason}); ${startsEmpty}.` };
  }
  const parsed = CalibrationFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { state: empty(), problem: `${file} has problems (${issues}); ${startsEmpty}.` };
  }
  return { state: parsed.data, problem: null };
}

/**
 * Replaces `file` without leaving it half written: the text goes to a temp file beside
 * it, which is renamed over it (the CONV-085 exception, so the rename stays on one volume).
 */
async function writeFileAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
