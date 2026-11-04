import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/*
 * The reference tests were first written as plain scripts with an `eq(name, actual,
 * expected)` helper. These versions register one Vitest test per call, so the test
 * files read the same way. Ported tests in the real repository use `it` and `expect`
 * directly, with names that start with a requirement ID (CONV-111).
 */

/** JSON round trip: compares the way the original scripts did, ignoring undefined fields. */
const plain = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** One test: `actual` equals `expected` as JSON. */
export function eq(name: string, actual: unknown, expected: unknown): void {
  it(name, () => {
    expect(plain(actual)).toEqual(plain(expected));
  });
}

/** One test: two numbers are equal to within floating-point noise. */
export function near(name: string, actual: number, expected: number): void {
  it(name, () => {
    expect(actual).toBeCloseTo(expected, 9);
  });
}

/** Absolute path of a file under `spec/fixtures/`. */
export function fixturePath(relativePath: string): string {
  return fileURLToPath(new URL(`../../fixtures/${relativePath}`, import.meta.url));
}
