import type { ModelCallAttempt, ModelCallRecord } from '@mythos/contracts';
import { AttemptDetails } from './attempt-details';
import { RecordText } from './record-text';

/**
 * The parsed output to show, worked out from the last attempt for display only: the
 * record keeps no parsed output (14-ui Open). A structured call's raw output is parsed as
 * JSON and laid out; a text call has nothing to parse.
 */
export function parsedOutput(
  last: ModelCallAttempt,
): { kind: 'json'; text: string } | { kind: 'note'; text: string } {
  if (last.method === 'text') {
    return {
      kind: 'note',
      text: 'A text call has nothing to parse: its raw output is the result.',
    };
  }
  if (last.error !== null || last.parseError !== null || last.schemaIssues.length > 0) {
    return { kind: 'note', text: "The last attempt's output didn't parse, so there is none." };
  }
  try {
    return { kind: 'json', text: JSON.stringify(JSON.parse(last.rawOutput), null, 2) };
  } catch {
    return { kind: 'note', text: "The raw output isn't plain JSON, so it is shown only as sent." };
  }
}

/**
 * The Output tab (UI-090): the last attempt's raw output and thinking, the parsed
 * output, and every attempt with its issues.
 */
export function OutputTab({ record }: { record: ModelCallRecord }) {
  const last = record.attempts.at(-1);
  if (last === undefined) return <p className="text-text-muted">This call made no attempts.</p>;
  const parsed = parsedOutput(last);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Raw output" className="flex min-w-0 flex-col gap-2">
        <h3 className="font-display text-lg">Raw output</h3>
        <RecordText text={last.rawOutput} />
      </section>
      {last.thinking !== null && (
        <section aria-label="Thinking" className="flex min-w-0 flex-col gap-2">
          <h3 className="font-display text-lg">Thinking</h3>
          <RecordText text={last.thinking} />
        </section>
      )}
      <section aria-label="Parsed output" className="flex min-w-0 flex-col gap-2">
        <h3 className="font-display text-lg">Parsed output</h3>
        {parsed.kind === 'json' ? (
          <RecordText text={parsed.text} />
        ) : (
          <p className="text-text-muted">{parsed.text}</p>
        )}
      </section>
      <section aria-label="Attempts" className="flex min-w-0 flex-col gap-3">
        <h3 className="font-display text-lg">Attempts</h3>
        {record.attempts.map((attempt) => (
          <AttemptDetails key={attempt.attempt} attempt={attempt} isLast={attempt === last} />
        ))}
      </section>
    </div>
  );
}
