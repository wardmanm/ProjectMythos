import type { TierReport } from '@mythos/contracts';
import { Badge } from '@/components/ui/badge';
import { BudgetBar } from './budget-bar';
import { tierWords } from './call-words';

/**
 * One tier of a built prompt (UI-090, CTX-090): its name, its budget bar and estimate,
 * what was trimmed to fit, and a mark when it is in the cached prefix.
 */
export function TierSection({ report }: { report: TierReport }) {
  return (
    <section
      aria-label={`${tierWords[report.tier]} tier`}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{tierWords[report.tier]}</h4>
        {report.cachedPrefix && <Badge variant="outline">Cached prefix</Badge>}
      </div>
      <BudgetBar estimate={report.estimatedTokens} budget={report.budget} />
      {report.trimmed.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing trimmed</p>
      ) : (
        <div className="text-sm">
          <p>Trimmed to fit:</p>
          <ul className="list-disc pl-6 wrap-anywhere">
            {report.trimmed.map((item, index) => (
              <li key={`${String(index)}:${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
