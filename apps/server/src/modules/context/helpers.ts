// The Handlebars environment templates render in (CTX-001, CTX-002): strict, unescaped,
// and with only the `join` and `label` helpers beside the block helpers.
import type { Ruleset } from '@mythos/contracts/content';
import { cmp } from '@mythos/core';
import Handlebars from 'handlebars';

// Implements CTX-001 and CTX-002: a missing variable is an error, prompts are not HTML,
// and only `join`, `label`, and the block helpers exist. `lookup` and `log` are removed.
export const COMPILE_OPTIONS: CompileOptions = {
  strict: true,
  noEscape: true,
  knownHelpersOnly: true,
  knownHelpers: { join: true, label: true, lookup: false, log: false },
};

/** `{{join list ", "}}`: a list of strings or numbers, joined. */
function join(...args: unknown[]): string {
  const [list, separator] = args;
  const items = Array.isArray(list) ? (list as unknown[]) : null;
  if (
    items === null ||
    typeof separator !== 'string' ||
    !items.every((item) => typeof item === 'string' || typeof item === 'number')
  ) {
    throw new Error('join takes a list of strings and a separator, e.g. {{join themes ", "}}');
  }
  return items.map(String).join(separator);
}

/** The ruleset's labels by key: `result.<tier>`, `effect.<level>`, and `harm.<n>`. */
function rulesetLabels(ruleset: Ruleset): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [tier, text] of Object.entries(ruleset.results.labels)) {
    labels.set(`result.${tier}`, text);
  }
  for (const [level, text] of Object.entries(ruleset.effect.labels)) {
    labels.set(`effect.${level}`, text);
  }
  ruleset.harm.levels.forEach((level, index) => {
    labels.set(`harm.${String(index + 1)}`, level.name);
  });
  // One above the last level is fatal (07-rules).
  labels.set(`harm.${String(ruleset.harm.levels.length + 1)}`, ruleset.harm.fatalName);
  return labels;
}

/** `{{label "result.partial"}}`: a ruleset label. An unknown key fails rendering. */
function labelHelper(ruleset: Ruleset): (...args: unknown[]) => string {
  const labels = rulesetLabels(ruleset);
  return (...args) => {
    // Handlebars passes its options last, so {{label "result.partial"}} gives two arguments.
    const key = args.length === 2 ? args[0] : undefined;
    const text = typeof key === 'string' ? labels.get(key) : undefined;
    if (text === undefined) {
      const known = [...labels.keys()].sort(cmp).join(', ');
      const given = typeof key === 'string' ? `"${key}"` : 'no key';
      throw new Error(`label takes one of these keys: ${known}; got ${given}`);
    }
    return text;
  };
}

/**
 * A Handlebars environment of its own, so nothing registered for one prompt leaks into
 * another, with `join`, the ruleset's `label`, and `lookup` and `log` removed.
 * Implements CTX-002.
 */
export function environment(ruleset: Ruleset): typeof Handlebars {
  const hb = Handlebars.create();
  hb.unregisterHelper('lookup');
  hb.unregisterHelper('log');
  hb.registerHelper('join', join);
  hb.registerHelper('label', labelHelper(ruleset));
  return hb;
}
