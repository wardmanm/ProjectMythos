import type { PackSummary } from '@mythos/contracts';
import { useId } from 'react';

type PackIssue = PackSummary['issues'][number];

/** Where an issue is: its file, then its JSON path when it is not about the whole file. */
function issueWhere(issue: PackIssue): string {
  return issue.path === '' ? issue.file : `${issue.file} at ${issue.path}`;
}

/**
 * Every pack that has issues, with each issue's file, path, and message (SCH-101), so the
 * player can fix them. Shown only when some pack has an issue.
 */
// Implements UI-083 and SCH-102: packs with errors are listed with their errors.
export function PackErrors({ packs }: { packs: readonly PackSummary[] }) {
  const headingId = useId();
  const broken = packs.filter((pack) => pack.issues.length > 0);
  if (broken.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-10">
      <h2 id={headingId} className="font-display text-xl">
        Packs with errors
      </h2>
      <p className="mt-1 text-text-muted">
        Campaigns can't start from these packs until they're fixed.
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {broken.map((pack) => (
          <li key={pack.packId} className="rounded-lg border border-l-4 border-l-negative p-3">
            <h3 className="font-medium">{pack.name}</h3>
            <p className="text-sm text-text-muted">Folder {pack.packId}</p>
            <ul aria-label={`Errors in ${pack.name}`} className="mt-2 flex flex-col gap-2">
              {pack.issues.map((issue, index) => (
                // Issues are listed as the server found them; two may be identical.
                <li key={`${String(index)} ${issue.file}`} className="break-words">
                  <code className="font-mechanics">{issueWhere(issue)}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
