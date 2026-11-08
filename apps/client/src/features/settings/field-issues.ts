// Where each issue of a failed save belongs (CON-091). The server's paths index into the
// lists it was sent (`providers.2.baseUrl`); the form addresses list items by key
// (`providers.<key>.baseUrl`), so an issue stays on its item when an earlier one is
// removed before the next save.
import type { SemanticIssue } from '@mythos/contracts';
import { LIST_NAMES, type ListName, type SettingsDraft } from './settings-draft';

/** One issue of a failed save: the field it concerns, where that is in words, and why. */
export type FieldIssue = { address: string; where: string; message: string };

const itemNames = {
  devices: 'Device',
  providers: 'Provider',
  modelProfiles: 'Model profile',
} as const satisfies Record<ListName, string>;

function isListName(part: string | undefined): part is ListName {
  return LIST_NAMES.some((name) => name === part);
}

/** A field's address in the form: a list item's key in place of its index. */
export function addressOf(...parts: string[]): string {
  return parts.join('.');
}

/**
 * Maps each issue's path into `sent`, the draft the save was made from. A path that
 * names no list item keeps its path as its address.
 */
// Implements CON-091: every issue is kept, each at the field its path names.
export function fieldIssuesOf(issues: SemanticIssue[], sent: SettingsDraft): FieldIssue[] {
  return issues.map(({ path, message }) => {
    const [list, index, ...rest] = path === '' ? [] : path.split('.');
    const item =
      isListName(list) && index !== undefined && /^\d+$/.test(index)
        ? sent[list][Number(index)]
        : undefined;
    if (item === undefined || !isListName(list)) {
      return { address: path, where: path === '' ? 'The settings as a whole' : path, message };
    }
    const name = item.value.id === '' ? 'with no id' : item.value.id;
    const field = rest.length > 0 ? `, ${rest.join('.')}` : '';
    return {
      address: addressOf(list, item.key, ...rest),
      where: `${itemNames[list]} ${name}${field}`,
      message,
    };
  });
}

/** The issues at `address` and at every field below it. */
export function issuesAt(issues: readonly FieldIssue[], address: string): FieldIssue[] {
  return issues.filter(
    (issue) => issue.address === address || issue.address.startsWith(`${address}.`),
  );
}

/** The issues at exactly `address`, such as a list item's own. */
export function issuesExactlyAt(issues: readonly FieldIssue[], address: string): FieldIssue[] {
  return issues.filter((issue) => issue.address === address);
}
