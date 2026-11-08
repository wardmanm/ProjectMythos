import type { ModelCallRecord } from '@mythos/contracts';
import { messageRoleWords } from './call-words';
import { RecordText } from './record-text';
import { TierSection } from './tier-section';

/**
 * The Prompt tab (UI-090): each tier's report, then the messages exactly as they were
 * sent. The record does not say which text came from which tier (14-ui Open), so the two
 * are shown apart.
 */
export function PromptTab({ record }: { record: ModelCallRecord }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="prompt-tiers" className="flex min-w-0 flex-col gap-3">
        <h3 id="prompt-tiers" className="font-display text-lg">
          Tiers
        </h3>
        {record.tiers.length === 0 ? (
          <p className="text-text-muted">This call's prompt has no tier reports.</p>
        ) : (
          record.tiers.map((report) => <TierSection key={report.tier} report={report} />)
        )}
      </section>
      <section aria-labelledby="prompt-messages" className="flex min-w-0 flex-col gap-3">
        <h3 id="prompt-messages" className="font-display text-lg">
          Messages as sent
        </h3>
        {record.messages.map((message, index) => (
          // Messages never change order within a record.
          <div key={index} className="flex min-w-0 flex-col gap-1">
            <h4 className="text-sm font-medium">{messageRoleWords[message.role]}</h4>
            <RecordText text={message.content} />
            {message.cacheBreakpoint === true && (
              <p className="border-t-2 border-dashed border-accent pt-1 text-sm text-text-muted">
                Cache breakpoint after this message
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
