import { useCallback, useState } from 'react';

/*
 * Implements UI-073 and UI-103: the input dock's draft is kept per campaign on this
 * device, in localStorage. Storage can be missing, full, or blocked (private browsing),
 * so every read and write is guarded and falls back to an empty draft.
 */

function draftKey(campaignId: string): string {
  return `mythos.draft.${campaignId}`;
}

/** The campaign's saved draft on this device, or '' when there is none or storage fails. */
export function readDraft(campaignId: string): string {
  try {
    return localStorage.getItem(draftKey(campaignId)) ?? '';
  } catch {
    return '';
  }
}

/** Saves the campaign's draft on this device; an empty draft removes it. */
export function writeDraft(campaignId: string, text: string): void {
  try {
    if (text === '') localStorage.removeItem(draftKey(campaignId));
    else localStorage.setItem(draftKey(campaignId), text);
  } catch {
    // Without storage, the draft lives only as long as the page.
  }
}

/** The campaign's draft as component state, saved on every change. */
export function useDraft(campaignId: string): [string, (text: string) => void] {
  const [draft, setDraftState] = useState(() => readDraft(campaignId));
  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);
      writeDraft(campaignId, text);
    },
    [campaignId],
  );
  return [draft, setDraft];
}
