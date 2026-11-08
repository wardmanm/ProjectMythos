import { budgetWords } from './call-words';

/**
 * A tier's estimated tokens against its budget, as a bar and in words (UI-090, UI-114).
 * Its fill is the one inline style, a width no utility class can name (CONV-101). A tier
 * over its budget, which only a fixed tier can be (CTX-031), fills the bar in the
 * caution color and says so.
 */
export function BudgetBar({ estimate, budget }: { estimate: number; budget: number }) {
  const over = estimate > budget;
  const share = budget === 0 ? (estimate > 0 ? 1 : 0) : Math.min(estimate / budget, 1);
  const words = budgetWords(estimate, budget);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label="Estimated tokens"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={estimate}
        aria-valuetext={words}
        className="h-2 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          data-over={over}
          className="h-full rounded-full bg-accent data-[over=true]:bg-caution"
          style={{ width: `${String(Math.round(share * 100))}%` }}
        />
      </div>
      <p className="text-sm text-text-muted">{words}</p>
    </div>
  );
}
