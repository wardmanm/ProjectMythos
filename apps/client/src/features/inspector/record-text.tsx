/**
 * Text from a model call record, exactly as it was sent or received. It wraps anywhere,
 * so a long line or an unbroken JSON string never makes the screen scroll sideways
 * (UI-042).
 */
export function RecordText({ text }: { text: string }) {
  return (
    <pre className="max-w-full min-w-0 rounded-md border border-border bg-background p-2 font-mechanics text-sm whitespace-pre-wrap wrap-anywhere">
      {text === '' ? <span className="text-text-muted">(empty)</span> : text}
    </pre>
  );
}
