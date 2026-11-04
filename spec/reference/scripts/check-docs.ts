/*
 * The docs check (OVR-038) and the trace report (OVR-037). Reads the spec, CLAUDE.md,
 * .claude/, and the test names and `Implements` comments under apps/, packages/, and
 * scripts/. Prints every problem, then exits non-zero if there were any.
 *
 * Usage: tsx scripts/check-docs.ts [--report] [specDir [repoRoot]]
 * By default the spec is the folder above this package, and the repository root the
 * folder above that.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocs } from './docs/read';
import { formatReport } from './docs/report';
import { checkDocs } from './docs/rules';

const args = process.argv.slice(2);
const report = args.includes('--report');
const [specArg, rootArg] = args.filter((a) => a !== '--report');
const specDir = specArg ?? fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = rootArg ?? join(specDir, '..');

const docs = readDocs(specDir, repoRoot);
const problems = checkDocs(docs);

if (report) console.log(`${formatReport(docs)}\n`);
for (const p of problems) console.log(p);
if (problems.length > 0) {
  console.log(
    `\nDocs check failed: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`,
  );
  process.exit(1);
}
const done = docs.tasks.filter((t) => t.status === 'Done').length;
const ids = new Set(docs.requirements.map((r) => r.id)).size;
console.log(
  `Docs check passed: ${ids} requirements, ${docs.tasks.length} tasks (${done} done), ` +
    `${docs.adrs.size} ADRs, ${docs.markdown.length} markdown files, ` +
    `${docs.citations.length} citations in code.`,
);
