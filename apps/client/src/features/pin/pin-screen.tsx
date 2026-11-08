import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { apiFailureOf } from '@/api/api-failure';
import { wordsForCode } from '@/api/plain-words';
import { useLogin, useSession } from '@/api/session';
import { FailureMessage } from '@/components/failure-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeNext } from './safe-next';

const RetryDetailsSchema = z.object({ retryAfterSeconds: z.number().nonnegative() });

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/** The wait a `rate_limited` answer gives in `details.retryAfterSeconds` (03-contracts Decisions). */
function waitWords(details: unknown): string {
  const parsed = RetryDetailsSchema.safeParse(details);
  if (!parsed.success) return wordsForCode('rate_limited');
  const seconds = Math.ceil(parsed.data.retryAfterSeconds);
  const wait = seconds < 60 ? plural(seconds, 'second') : plural(Math.ceil(seconds / 60), 'minute');
  return `Too many wrong PINs. Try again in ${wait}.`;
}

/** The words for a failed login, or null for a failure `FailureMessage` explains. */
function loginWords(error: unknown): string | null {
  const failure = apiFailureOf(error);
  if (failure?.kind !== 'server') return null;
  switch (failure.error.code) {
    case 'auth_failed':
      return wordsForCode('auth_failed');
    case 'rate_limited':
      return waitWords(failure.error.details);
    case 'auth_required':
      // The server refuses every other device while machine config fails to load
      // (01-architecture Decisions).
      return "Mythos's settings have a problem, so only the computer it runs on can use it. Fix them in Settings there.";
    default:
      return null;
  }
}

/**
 * The PIN screen (ARCH-110), at `/pin?next=<address>`. A device that needs no PIN, or
 * already has a session, goes straight on. Once the PIN is accepted, every query
 * refetches and the player returns to `next`, if it is an address within the app
 * (`safeNext`), else to the library.
 */
export function PinScreen() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const session = useSession();
  const login = useLogin();
  const [pin, setPin] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // With no PIN set, on an exempt localhost (ARCH-111), or with a live session, never ask.
  const free =
    session.data !== undefined && (!session.data.pinRequired || session.data.authenticated);
  useEffect(() => {
    if (free) void navigate(next, { replace: true });
  }, [free, next, navigate]);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    login.mutate(pin, {
      onSuccess: () => {
        void navigate(next, { replace: true });
      },
      onError: (error) => {
        if (apiFailureOf(error)?.kind === 'server') {
          setPin('');
          input.current?.focus();
        }
      },
    });
  };

  const words = login.isError ? loginWords(login.error) : null;
  return (
    <section className="mx-auto grid max-w-sm gap-6 px-4 py-8">
      <h1 className="font-display text-2xl">Enter the PIN</h1>
      <p className="text-text-muted">This device needs the PIN to use Mythos.</p>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={inputId}>PIN</Label>
          <Input
            id={inputId}
            ref={input}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(event) => {
              setPin(event.target.value);
            }}
          />
        </div>
        {words !== null && (
          <p role="alert" className="flex items-start gap-2">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-negative" />
            {words}
          </p>
        )}
        {login.isError && words === null && <FailureMessage error={login.error} />}
        <Button type="submit" disabled={pin === '' || login.isPending}>
          Unlock
        </Button>
      </form>
    </section>
  );
}
