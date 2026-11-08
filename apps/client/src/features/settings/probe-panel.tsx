import type { ProbeResult } from '@mythos/contracts';
import { useEffect, useRef } from 'react';
import { useProbe } from '@/api/settings';
import { FailureMessage } from '@/components/failure-message';
import { Button } from '@/components/ui/button';

const methods = [
  ['json-schema', 'JSON schema'],
  ['tool-call', 'Tool call'],
  ['prompt-only', 'Prompt only'],
] as const;

function methodWords(valid: boolean | undefined): string {
  if (valid === undefined) return 'Not tried';
  return valid ? 'Valid output' : 'No valid output';
}

function speedWords(tokensPerSecond: number | null): string {
  return tokensPerSecond === null
    ? 'Not measured'
    : `About ${String(Math.round(tokensPerSecond))} tokens a second`;
}

/** What a probe found, and the settings the server suggests from it (PRV-090). */
function ProbeReport({ result }: { result: ProbeResult }) {
  return (
    <div className="grid gap-3" aria-label="Probe result" role="group">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-text-muted">Provider</dt>
        <dd>{result.reachable ? 'Reachable' : 'Not reachable'}</dd>
        <dt className="text-text-muted">Model</dt>
        <dd>{result.modelPresent ? 'Found' : "The provider doesn't list it"}</dd>
        {methods.map(([method, name]) => (
          <div key={method} className="contents">
            <dt className="text-text-muted">{name}</dt>
            <dd>{methodWords(result.structuredMethods[method])}</dd>
          </div>
        ))}
        <dt className="text-text-muted">Reading the prompt</dt>
        <dd>{speedWords(result.promptTokensPerSecond)}</dd>
        <dt className="text-text-muted">Writing</dt>
        <dd>{speedWords(result.generationTokensPerSecond)}</dd>
        <dt className="text-text-muted">Thinking</dt>
        <dd>{result.emittedThinking ? 'The model thought before answering' : 'None'}</dd>
      </dl>
      {result.suggestions.length > 0 && (
        <div className="grid gap-1">
          <h4 className="text-sm font-medium">Suggestions</h4>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {result.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Probe for one profile (PRV-090). The server probes the saved profile, so the button
 * waits until the profile and its provider are saved. Cancel aborts the request, which
 * stops the probe on the server, and clears it here without a failure.
 */
export function ProbePanel({ profileId, ready }: { profileId: string; ready: boolean }) {
  const probe = useProbe();
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const start = () => {
    const next = new AbortController();
    controller.current = next;
    probe.mutate({ profileId, signal: next.signal });
  };
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    probe.reset();
  };

  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!ready || probe.isPending} onClick={start}>
          Probe
        </Button>
        {probe.isPending && (
          <>
            <p className="text-sm text-text-muted">Probing… this can take a minute.</p>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </>
        )}
        {!ready && (
          <p className="text-sm text-text-muted">Save your changes to probe this profile.</p>
        )}
      </div>
      {probe.isError && <FailureMessage error={probe.error} />}
      {probe.isSuccess && <ProbeReport result={probe.data} />}
    </div>
  );
}
