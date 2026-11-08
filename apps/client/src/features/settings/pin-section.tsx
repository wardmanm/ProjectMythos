import type { MachineConfig } from '@mythos/contracts';
import { useState, type SubmitEvent } from 'react';
import { useSetPin } from '@/api/settings';
import { validationIssuesOf } from '@/api/validation-issues';
import { FailureMessage } from '@/components/failure-message';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { FieldIssue } from './field-issues';
import { SwitchField, TextField } from './form-fields';
import { Section } from './section';

type Pin = MachineConfig['server']['pin'];

const SIGN_OUT_WORDS =
  "Applies at once, with no restart. Every device signs out, including this one unless it's exempt.";

function issue(address: string, message: string): FieldIssue {
  return { address, where: address, message };
}

/**
 * Set or change the PIN: the PIN twice and the localhost exemption (ARCH-111). The client
 * checks only that the two match; the server checks the PIN, and its issue shows at the
 * PIN field (CON-091).
 */
function PinForm({ pin, onDone }: { pin: Pin; onDone: () => void }) {
  const setPin = useSetPin();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [exempt, setExempt] = useState(pin?.localhostExempt ?? true);
  const [mismatch, setMismatch] = useState(false);
  const serverIssues = validationIssuesOf(setPin.error);
  const pinIssues = serverIssues
    .filter((i) => i.path === 'pin')
    .map((i) => issue('pin', i.message));
  const otherIssues = serverIssues.filter((i) => i.path !== 'pin');

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setMismatch(first !== second);
    if (first !== second) return;
    setPin.mutate({ pin: first, localhostExempt: exempt }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border border-border bg-surface p-4">
      <TextField
        notes={{ label: 'New PIN', hint: '4 to 12 digits.', issues: pinIssues }}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={first}
        onChange={setFirst}
      />
      <TextField
        notes={{
          label: 'The new PIN again',
          issues: mismatch ? [issue('pin-again', "The two PINs don't match.")] : [],
        }}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={second}
        onChange={setSecond}
      />
      <SwitchField
        notes={{ label: 'This computer can use Mythos without the PIN' }}
        checked={exempt}
        onChange={setExempt}
      />
      {otherIssues.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {otherIssues.map((other, index) => (
            <li key={String(index)}>{other.message}</li>
          ))}
        </ul>
      )}
      {setPin.isError && serverIssues.length === 0 && <FailureMessage error={setPin.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={setPin.isPending}>
          Save the PIN
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Remove the PIN, after asking: anyone on the network can then use Mythos. */
function RemovePin({ disabled }: { disabled: boolean }) {
  const setPin = useSetPin();
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={disabled || setPin.isPending}>
            Remove the PIN
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the PIN?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone on your network will be able to use Mythos. Every device signs out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the PIN</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPin.mutate({ pin: null, localhostExempt: true });
              }}
            >
              Remove the PIN
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {setPin.isError && <FailureMessage error={setPin.error} />}
    </>
  );
}

/**
 * The PIN lock (ARCH-110, ARCH-111): set, change, or remove it. It goes through
 * `PUT /settings/pin`, never through Save, and applies at once (PRV-004). Its buttons
 * wait while other changes are unsaved, since a device that is signed out loses them.
 */
export function PinSection({ pin, editsPending }: { pin: Pin; editsPending: boolean }) {
  const [editing, setEditing] = useState(false);
  const state =
    pin === null
      ? 'No PIN: anyone on your network can use Mythos.'
      : `A PIN is set. ${pin.localhostExempt ? 'This computer can use Mythos without it.' : 'This computer needs it too.'}`;
  return (
    <Section title="PIN" description={SIGN_OUT_WORDS}>
      <p>{state}</p>
      {editsPending && (
        <p className="text-sm text-text-muted">
          Save or discard your other changes first: changing the PIN signs devices out.
        </p>
      )}
      {editing ? (
        <PinForm
          pin={pin}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={editsPending}
            onClick={() => {
              setEditing(true);
            }}
          >
            {pin === null ? 'Set a PIN' : 'Change the PIN'}
          </Button>
          {pin !== null && <RemovePin disabled={editsPending} />}
        </div>
      )}
    </Section>
  );
}
