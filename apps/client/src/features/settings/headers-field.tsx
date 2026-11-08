import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { addressOf, issuesAt, type FieldIssue } from './field-issues';
import { TextField } from './form-fields';
import { sameValue } from './settings-draft';

type Row = { name: string; value: string };

function rowsFrom(headers: Record<string, string>): Row[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

/** The headers a list of rows sends. A row with no name is left out; a later name wins. */
function headersFrom(rows: readonly Row[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) if (row.name.trim() !== '') headers[row.name] = row.value;
  return headers;
}

/**
 * An `openai-compatible` provider's extra headers, as name and value rows. Headers are
 * stored and shown as they are, unlike `apiKey` (PRV-005), so the field says where a key
 * belongs (05-providers Open). The rows are kept as typed, so a row being named does
 * not vanish; headers set from outside, as Discard does, replace them.
 */
export function HeadersField({
  headers,
  address,
  issues,
  onChange,
}: {
  headers: Record<string, string>;
  /** `providers.<key>.headers`. */
  address: string;
  issues: readonly FieldIssue[];
  onChange: (headers: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState(() => rowsFrom(headers));
  if (!sameValue(headersFrom(rows), headers)) setRows(rowsFrom(headers));
  const update = (next: Row[]) => {
    setRows(next);
    onChange(headersFrom(next));
  };
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="text-sm font-medium">Extra headers</legend>
      <p className="text-sm text-text-muted">
        Headers are stored and shown as they are. Put an API key under API key, not here.
      </p>
      {rows.map((row, index) => (
        <div key={String(index)} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField
            notes={{ label: 'Header name' }}
            value={row.name}
            onChange={(name) => {
              update(rows.map((r, i) => (i === index ? { ...r, name } : r)));
            }}
          />
          <TextField
            notes={{
              label: 'Header value',
              issues: row.name === '' ? [] : issuesAt(issues, addressOf(address, row.name)),
            }}
            value={row.value}
            onChange={(value) => {
              update(rows.map((r, i) => (i === index ? { ...r, value } : r)));
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove header ${row.name}`}
            onClick={() => {
              update(rows.filter((_, i) => i !== index));
            }}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        className="justify-self-start"
        onClick={() => {
          update([...rows, { name: '', value: '' }]);
        }}
      >
        <PlusIcon aria-hidden />
        Add a header
      </Button>
    </fieldset>
  );
}
