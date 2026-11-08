import { CircleAlertIcon } from 'lucide-react';
import type { FieldIssue } from './field-issues';

/**
 * Every issue of the last save, with where it is in words. The fields show theirs too;
 * this list also holds the issues no field shows, such as one about the whole config.
 * Implements CON-091: no issue is lost.
 */
export function IssueSummary({ issues }: { issues: readonly FieldIssue[] }) {
  if (issues.length === 0) return null;
  const count = issues.length === 1 ? '1 problem' : `${String(issues.length)} problems`;
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-lg border border-l-4 border-l-negative bg-surface p-3"
    >
      <p className="flex items-center gap-2 font-medium">
        <CircleAlertIcon aria-hidden className="size-5 shrink-0 text-negative" />
        Not saved: {count} to fix.
      </p>
      <ul className="grid gap-1 pl-7 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.address}-${String(index)}`}>
            <span className="font-medium">{issue.where}:</span> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
