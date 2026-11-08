import type { ModelCallSummary } from '@mythos/contracts';
import { Link } from 'react-router';
import { useIsPhone } from '@/lib/use-media-query';
import { duration, outcomeWords, roleWords, tokens } from './call-words';

type CallListProps = {
  calls: readonly ModelCallSummary[];
  chosenId: string | null;
  /** The address that chooses a call, keeping the open tab (UI-001). */
  searchFor: (callId: string) => string;
};

/** What the list says of each call after its role (UI-090), in column order. */
const columns = ['Model', 'Duration', 'Tokens', 'Outcome', 'Attempts'] as const;

function facts(call: ModelCallSummary): Record<(typeof columns)[number], string> {
  return {
    Model: call.model,
    Duration: duration(call.durationMs),
    Tokens: tokens(call.inputTokens, call.outputTokens),
    Outcome: outcomeWords[call.outcome],
    Attempts: String(call.attempts),
  };
}

/**
 * A turn's model calls, oldest first (UI-090). A table on wider screens; on a phone,
 * each call is a row of its own, stacked (UI-042). Each call's role links to it, and the
 * chosen one is marked as the current one.
 */
export function CallList({ calls, chosenId, searchFor }: CallListProps) {
  const isPhone = useIsPhone();
  const link = (call: ModelCallSummary) => (
    <Link
      to={{ search: searchFor(call.id) }}
      aria-current={call.id === chosenId ? 'true' : undefined}
      className="inline-flex min-h-11 items-center rounded-md font-medium text-accent underline-offset-4 hover:underline aria-[current=true]:text-text aria-[current=true]:underline"
    >
      {roleWords[call.role]}
    </Link>
  );
  if (isPhone) {
    return (
      <ul aria-label="Model calls" className="flex flex-col gap-2">
        {calls.map((call) => (
          <li key={call.id} className="rounded-lg border border-border bg-surface px-3 py-1">
            {link(call)}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 pb-2 text-sm">
              {columns.map((label) => (
                <div key={label} className="contents">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="min-w-0 wrap-anywhere">{facts(call)[label]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Model calls</caption>
      <thead className="text-text-muted">
        <tr>
          <th scope="col" className="py-1 pr-3 font-normal">
            Role
          </th>
          {columns.map((label) => (
            <th key={label} scope="col" className="py-1 pr-3 font-normal">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calls.map((call) => (
          <tr key={call.id} className="border-t border-border">
            <th scope="row" className="pr-3 font-normal">
              {link(call)}
            </th>
            {columns.map((label) => (
              <td key={label} className="py-1 pr-3 wrap-anywhere">
                {facts(call)[label]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
