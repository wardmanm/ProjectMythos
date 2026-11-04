/*
 * Proves the spec documents and the reference code agree (OVR-033):
 *
 * - every TypeScript block in a spec document equals exactly one file in contracts/ or
 *   server-types/, and every such file except an index appears in a document;
 * - every JSON block equals a fixture, or is a prefix excerpt of one (same keys, arrays
 *   shortened);
 * - every Markdown block equals a fixture's canon file.
 *
 * Usage: tsx scripts/check-drift.ts [specDir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { cmp } from '../core/compare';

const here = fileURLToPath(new URL('..', import.meta.url));
const specDir = process.argv[2] ?? join(here, '..');
const problems: string[] = [];
const rel = (p: string) => relative(specDir, p).split('\\').join('/');

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir)
    .sort(cmp)
    .flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p, ext) : name.endsWith(ext) ? [p] : [];
    });
}

const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();

// ---- code blocks in the documents
type Block = { doc: string; line: number; lang: string; body: string };
const blocks: Block[] = [];
for (const doc of readdirSync(specDir).filter((f) => f.endsWith('.md')).sort(cmp)) {
  const text = readFileSync(join(specDir, doc), 'utf8').replace(/\r\n/g, '\n');
  for (const m of text.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)) {
    blocks.push({ doc, line: text.slice(0, m.index).split('\n').length, lang: m[1] ?? '', body: m[2] ?? '' });
  }
}

// ---- TypeScript: blocks ⇄ reference files
const sources = [...walk(join(here, 'contracts'), '.ts'), ...walk(join(here, 'server-types'), '.ts')].filter((f) => !f.endsWith('.test.ts'));
const sourceText = new Map(sources.map((f) => [f, normalize(readFileSync(f, 'utf8'))]));
const shown = new Set<string>();
for (const b of blocks.filter((x) => x.lang === 'ts' || x.lang === 'typescript')) {
  const body = normalize(b.body);
  const hits = sources.filter((f) => sourceText.get(f) === body);
  if (hits.length === 0) problems.push(`${b.doc}:${b.line}: TypeScript block matches no file in reference/contracts or reference/server-types`);
  if (hits.length > 1) problems.push(`${b.doc}:${b.line}: TypeScript block matches several files: ${hits.map(rel).join(', ')}`);
  for (const h of hits) shown.add(h);
}
for (const f of sources) {
  if (!shown.has(f) && basename(f) !== 'index.ts') problems.push(`${rel(f)}: not shown in any spec document`);
}

// ---- JSON: blocks ⇄ fixtures
const fixtureJson = walk(join(specDir, 'fixtures'), '.json').map((f) => ({ f, data: JSON.parse(readFileSync(f, 'utf8')) as unknown }));

/** True if `excerpt` equals `full`, allowing arrays in the excerpt to be a leading part of the fixture's. */
function isExcerpt(excerpt: unknown, full: unknown): boolean {
  if (Array.isArray(excerpt) && Array.isArray(full)) {
    return excerpt.length <= full.length && excerpt.every((x, i) => isDeepStrictEqual(x, full[i]));
  }
  if (excerpt && full && typeof excerpt === 'object' && typeof full === 'object') {
    const a = Object.keys(excerpt).sort(cmp), b = Object.keys(full).sort(cmp);
    return a.join() === b.join() && a.every((k) => isExcerpt((excerpt as Record<string, unknown>)[k], (full as Record<string, unknown>)[k]));
  }
  return isDeepStrictEqual(excerpt, full);
}

for (const b of blocks.filter((x) => x.lang === 'json')) {
  let data: unknown;
  try {
    data = JSON.parse(b.body);
  } catch {
    problems.push(`${b.doc}:${b.line}: JSON block does not parse`);
    continue;
  }
  if (fixtureJson.some((x) => isExcerpt(data, x.data))) continue;
  const id = (data as { id?: unknown }).id;
  const sameId = fixtureJson.find((x) => (x.data as { id?: unknown }).id === id && id !== undefined);
  problems.push(sameId
    ? `${b.doc}:${b.line}: JSON block differs from ${rel(sameId.f)}`
    : `${b.doc}:${b.line}: JSON block matches no fixture`);
}

// ---- Markdown: blocks ⇄ canon files
const fixtureMd = walk(join(specDir, 'fixtures'), '.md').map((f) => normalize(readFileSync(f, 'utf8')));
for (const b of blocks.filter((x) => x.lang === 'md')) {
  if (!fixtureMd.includes(normalize(b.body))) problems.push(`${b.doc}:${b.line}: Markdown block matches no fixture .md file`);
}

if (problems.length) {
  for (const p of problems) console.log(p);
  console.log(`\n${problems.length} drift problem${problems.length === 1 ? '' : 's'}`);
  process.exit(1);
}
const count = (l: string[]) => blocks.filter((b) => l.includes(b.lang)).length;
console.log(`No drift: ${count(['ts', 'typescript'])} TypeScript, ${count(['json'])} JSON, and ${count(['md'])} Markdown blocks match the reference code and fixtures.`);
