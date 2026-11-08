import type { ProviderHealth } from '@mythos/contracts';
import { cn } from 'cn';

/** What the settings screen knows of a provider's health (PRV-091). */
export type HealthView =
  | { kind: 'unsaved' }
  | { kind: 'checking' }
  | { kind: 'unknown' }
  | { kind: 'checked'; health: ProviderHealth };

function wordsFor(view: HealthView): string {
  switch (view.kind) {
    case 'unsaved':
      return 'Save to check';
    case 'checking':
      return 'Checking…';
    case 'unknown':
      return "Couldn't check";
    case 'checked':
      if (!view.health.reachable) return 'Not reachable';
      return view.health.latencyMs === null
        ? 'Reachable'
        : `Reachable, ${String(Math.round(view.health.latencyMs))} ms`;
  }
}

function toneOf(view: HealthView): 'positive' | 'negative' | 'none' {
  if (view.kind !== 'checked') return 'none';
  return view.health.reachable ? 'positive' : 'negative';
}

/**
 * A provider's status: a dot and the words for it, since color never carries meaning
 * alone (UI-114). Implements PRV-091's status indicator.
 */
export function HealthDot({ view }: { view: HealthView }) {
  const tone = toneOf(view);
  return (
    <span className="inline-flex items-center gap-2 text-sm" data-health={view.kind}>
      <span
        aria-hidden
        data-tone={tone}
        className={cn(
          'size-2.5 shrink-0 rounded-full border border-border',
          tone === 'positive' && 'border-positive bg-positive',
          tone === 'negative' && 'border-negative bg-negative',
        )}
      />
      {wordsFor(view)}
    </span>
  );
}
