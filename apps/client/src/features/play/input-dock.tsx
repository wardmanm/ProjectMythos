import { SendIcon, SquareIcon } from 'lucide-react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIsPhone } from '@/lib/use-media-query';
import { CommandFailure } from './command-failure';
import type { InputAvailability } from './turn-status';

type InputDockProps = {
  text: string;
  onTextChange: (text: string) => void;
  availability: InputAvailability;
  /** The head is narrating, so the dock offers Stop (UI-135). */
  canStop: boolean;
  stopping: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The last command's failure, shown in plain words. */
  error: unknown;
};

/**
 * The input dock, in character only in phase 1 (14-ui §15).
 * - UI-073: while input is unavailable the text box is read-only, keeps its text, and a
 *   line says why; Send is gone. The draft itself is kept by the play screen.
 * - UI-074: on desktop Enter sends and Shift+Enter adds a line. On a phone Enter adds a
 *   line and the button sends. Enter never sends while an input method is composing.
 * - UI-135: while the narration streams, Send is **Stop**.
 */
export function InputDock(props: InputDockProps) {
  const { text, onTextChange, availability, canStop, stopping, onSend, onStop, error } = props;
  const isPhone = useIsPhone();
  const inputId = useId();
  const reasonId = useId();
  const composing = useRef(false);
  const canSend = availability.available && text.trim() !== '';

  const send = () => {
    if (canSend) onSend(text.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isPhone) return;
    if (event.nativeEvent.isComposing || composing.current) return;
    event.preventDefault();
    send();
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2 font-interface text-base">
      <label htmlFor={inputId} className="px-1 text-sm text-text-muted">
        In character
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id={inputId}
          value={text}
          readOnly={!availability.available}
          aria-describedby={availability.available ? undefined : reasonId}
          placeholder="What do you do?"
          maxLength={8000}
          rows={1}
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none font-narration text-base"
          onChange={(event) => {
            onTextChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            // Safari sends the Enter that ends a composition just after compositionend.
            setTimeout(() => {
              composing.current = false;
            }, 0);
          }}
        />
        {canStop ? (
          <Button variant="outline" disabled={stopping} onClick={onStop}>
            <SquareIcon aria-hidden />
            Stop
          </Button>
        ) : (
          availability.available && (
            <Button disabled={!canSend} onClick={send}>
              <SendIcon aria-hidden />
              Send
            </Button>
          )
        )}
      </div>
      {!availability.available && (
        <p id={reasonId} className="px-1 text-sm text-text-muted">
          {availability.reason}
        </p>
      )}
      <CommandFailure error={error} />
    </div>
  );
}
