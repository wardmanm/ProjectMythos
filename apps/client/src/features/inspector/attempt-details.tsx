import type { ModelCallAttempt } from '@mythos/contracts';
import type { ReactNode } from 'react';
import { duration, methodWords, tokens } from './call-words';
import { RecordText } from './record-text';

type AttemptDetailsProps = {
  attempt: ModelCallAttempt;
  /** The last attempt's output is shown above the attempts, so it isn't repeated here. */
  isLast: boolean;
};

/**
 * One attempt of a call (UI-090): its method, time, and tokens, and every issue it had:
 * the provider's error, with its code (UI-122 allows codes here), the parse error, and
 * the schema and semantic issues. An earlier attempt's output and thinking are folded
 * away in a disclosure.
 */
export function AttemptDetails({ attempt, isLast }: AttemptDetailsProps) {
  const usage = attempt.usage;
  const facts = [
    methodWords[attempt.method],
    duration(attempt.durationMs),
    tokens(usage?.inputTokens ?? null, usage?.outputTokens ?? null),
  ];
  return (
    <section
      aria-label={`Attempt ${String(attempt.attempt)}`}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <h4 className="font-medium">Attempt {attempt.attempt}</h4>
      <p className="text-sm text-text-muted">{facts.join(' · ')}</p>
      <AttemptIssues attempt={attempt} />
      {!isLast && (
        <details className="min-w-0">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm">
            Output of attempt {attempt.attempt}
          </summary>
          <div className="flex flex-col gap-2">
            <RecordText text={attempt.rawOutput} />
            {attempt.thinking !== null && (
              <>
                <p className="text-sm font-medium">Thinking</p>
                <RecordText text={attempt.thinking} />
              </>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

function AttemptIssues({ attempt }: { attempt: ModelCallAttempt }) {
  const { error, parseError, schemaIssues, semanticIssues } = attempt;
  const clean =
    error === null &&
    parseError === null &&
    schemaIssues.length === 0 &&
    semanticIssues.length === 0;
  if (clean) return <p className="text-sm">No issues</p>;
  return (
    <dl className="flex min-w-0 flex-col gap-2 text-sm wrap-anywhere">
      {error !== null && (
        <Issue term="Error">
          <code className="font-mechanics">{error.code}</code>: {error.message}
        </Issue>
      )}
      {parseError !== null && <Issue term="Parse error">{parseError}</Issue>}
      {schemaIssues.length > 0 && (
        <Issue term="Schema issues">
          <ul className="list-disc pl-6">
            {schemaIssues.map((issue, index) => (
              <li key={`${String(index)}:${issue}`}>{issue}</li>
            ))}
          </ul>
        </Issue>
      )}
      {semanticIssues.length > 0 && (
        <Issue term="Semantic issues">
          <ul className="list-disc pl-6">
            {semanticIssues.map((issue, index) => (
              <li key={`${String(index)}:${issue.path}`}>
                <code className="font-mechanics">{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </Issue>
      )}
    </dl>
  );
}

function Issue({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-l-4 border-l-negative pl-2">
      <dt className="font-medium">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
