import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNoticeStore } from '@/stores/notice-store';

/**
 * The shell's notice line. The words carry the meaning; the icon and the negative or
 * accent color only add to them (UI-114). The live region exists before any notice, so
 * screen readers announce each one.
 */
export function Notice() {
  const notice = useNoticeStore((state) => state.notice);
  const dismiss = useNoticeStore((state) => state.dismiss);
  return (
    <div role="status" aria-live="polite" className="px-4 empty:hidden">
      {notice !== null && (
        <div
          data-tone={notice.tone}
          className="mx-auto my-2 flex max-w-2xl items-center gap-3 rounded-lg border border-l-4 bg-surface px-3 py-1 data-[tone=failure]:border-l-negative data-[tone=info]:border-l-accent"
        >
          {notice.tone === 'failure' ? (
            <CircleAlertIcon aria-hidden className="size-5 shrink-0 text-negative" />
          ) : (
            <InfoIcon aria-hidden className="size-5 shrink-0 text-accent" />
          )}
          <p className="min-w-0 flex-1 py-2">{notice.text}</p>
          <Button variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
