/**
 * Code-point string comparison (CONV-087). Never use localeCompare for ordering that
 * reaches stored data or prompts: its result depends on the machine's locale.
 */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
