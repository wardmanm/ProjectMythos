import { CircleAlertIcon } from 'lucide-react';
import { apiFailureOf } from '@/api/api-failure';
import { plainWords } from '@/api/plain-words';

/**
 * A failed query or command, in plain words (UI-122), with color and an icon as extras
 * only (UI-114). Anything thrown that is not an API failure is a bug in the page.
 */
export function FailureMessage({ error }: { error: unknown }) {
  const failure = apiFailureOf(error);
  const words =
    failure === null
      ? 'Something went wrong in this page. Reload it, and if it keeps happening, restart Mythos.'
      : plainWords(failure);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-l-4 border-l-negative bg-surface p-3"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-negative" />
      <p className="min-w-0">{words}</p>
    </div>
  );
}
