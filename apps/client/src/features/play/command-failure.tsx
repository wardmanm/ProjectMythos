import { errorCodeOf } from '@/api/api-failure';
import { FailureMessage } from '@/components/failure-message';

/**
 * A failed command's words, in place (UI-122). Nothing for `conflict` and
 * `auth_required`: the query client already handles both for every command, with the
 * shell's notice and the PIN screen (UI-102, ARCH-110).
 */
export function CommandFailure({ error }: { error: unknown }) {
  if (error === null) return null;
  const code = errorCodeOf(error);
  if (code === 'conflict' || code === 'auth_required') return null;
  return <FailureMessage error={error} />;
}
