// Pass 3 of SCH-100: every invariant. Definitions pass `core`'s checks; dates, stats, statuses,
// history, and relationships hold against the setting's calendar and default ruleset (SCH-114).
// A check whose input is missing or failed to parse is skipped: that is already an issue.
import type { CalendarDate, Ruleset, Setting } from '@mythos/contracts/content';
import { calendarIssues, dateIssues, fromDate, rulesetIssues, themeIssues } from '@mythos/core';
import { type PackDefaults, packDefaults } from './resolve';
import type {
  AuthoredStatus,
  DefinitionEntry,
  DefinitionSet,
  PackContent,
  PackIssue,
  SeedRelationship,
} from './types';
import { itemIssues } from './validate-items';

type DateCheck = (file: string, path: string, date: CalendarDate) => PackIssue[];

/**
 * `core`'s checks on the definitions `include` picks. Their messages name the field
 * themselves, so the path is the file's (''). Implements TIME-004, RUL-002, SCH-062, UI-031.
 */
export function definitionInvariants(
  definitions: DefinitionSet,
  include: (entry: DefinitionEntry<unknown>) => boolean,
): PackIssue[] {
  const check = <T>(
    entries: ReadonlyMap<string, DefinitionEntry<T>>,
    issuesOf: (definition: T) => string[],
  ): PackIssue[] =>
    [...entries.values()]
      .filter(include)
      .flatMap((entry) =>
        entry.definition === null
          ? []
          : issuesOf(entry.definition).map((message) => ({ file: entry.file, path: '', message })),
      );
  return [
    ...check(definitions.calendars, calendarIssues),
    ...check(definitions.rulesets, rulesetIssues),
    // A pack's own fonts are not read yet, so only bundled fonts are known (Open).
    ...check(definitions.themes, (theme) => themeIssues(theme)),
  ];
}

/** A date check against the setting's epoch, or one that checks nothing without a usable epoch. */
function dateChecker(setting: Setting | null, defaults: PackDefaults): DateCheck {
  const calendar = defaults.calendar;
  if (setting === null || calendar === null) return () => [];
  if (dateIssues(calendar, setting.epoch).length > 0) return () => [];
  return (file, path, date) => {
    const issues = dateIssues(calendar, date);
    if (issues.length > 0) return issues.map((message) => ({ file, path, message }));
    if (fromDate(calendar, setting.epoch, date) < 0) {
      return [{ file, path, message: "is before the setting's epoch" }];
    }
    return [];
  };
}

function epochIssues(setting: Setting | null, defaults: PackDefaults): PackIssue[] {
  if (setting === null || defaults.calendar === null) return [];
  const issues = dateIssues(defaults.calendar, setting.epoch);
  return issues.map((message) => ({ file: 'setting.json', path: 'epoch', message }));
}

// Implements CON-024: a stat block rates exactly the ruleset's stats, within its range.
function statIssues(file: string, stats: Record<string, number>, ruleset: Ruleset): PackIssue[] {
  const defined = ruleset.stats.list.map((stat) => stat.id);
  const { min, max } = ruleset.stats;
  const issues: PackIssue[] = [];
  const missing = defined.filter((id) => !(id in stats));
  if (missing.length > 0) {
    const message = `missing ${missing.join(', ')}; ${ruleset.id} rates ${defined.join(', ')}`;
    issues.push({ file, path: 'stats', message });
  }
  for (const [id, rating] of Object.entries(stats)) {
    const path = `stats.${id}`;
    if (!defined.includes(id)) {
      issues.push({ file, path, message: `"${id}" is not a stat in ${ruleset.id}` });
    } else if (rating < min || rating > max) {
      const message = `${String(rating)} is outside ${ruleset.id}'s range ${String(min)}..${String(max)}`;
      issues.push({ file, path, message });
    }
  }
  return issues;
}

// Implements SCH-072: a premade PC is one the player could have built.
function pcCreationIssues(
  file: string,
  stats: Record<string, number>,
  ruleset: Ruleset,
): PackIssue[] {
  const { statPoints, minStartingStat: low, maxStartingStat: high } = ruleset.pcCreation;
  const issues: PackIssue[] = [];
  const total = Object.values(stats).reduce((sum, rating) => sum + rating, 0);
  if (total !== statPoints) {
    const message = `the ratings add up to ${String(total)}; a new PC in ${ruleset.id} has ${String(statPoints)} points`;
    issues.push({ file, path: 'stats', message });
  }
  for (const [id, rating] of Object.entries(stats)) {
    if (rating < low || rating > high) {
      const message = `${String(rating)} is outside ${ruleset.id}'s starting range ${String(low)}..${String(high)}`;
      issues.push({ file, path: `stats.${id}`, message });
    }
  }
  return issues;
}

/** Starting statuses as P1-T17's strict fold will check them. Implements CON-020 and CON-024. */
function startingStatusIssues(
  file: string,
  statuses: readonly AuthoredStatus[],
  ruleset: Ruleset | null,
): PackIssue[] {
  return statuses.flatMap((status, index) => {
    const at = `startingStatuses.${String(index)}`;
    const issues: PackIssue[] = [];
    if (status.kind === 'harm' && status.level === undefined) {
      issues.push({ file, path: `${at}.level`, message: 'a harm needs a level' });
    }
    if (status.kind === 'condition' && status.level !== undefined) {
      issues.push({ file, path: `${at}.level`, message: 'a condition has no level' });
    }
    if (ruleset === null) return issues;
    const fatal = ruleset.harm.levels.length + 1;
    if (status.level !== undefined && status.level > fatal) {
      const message = `${String(status.level)} is above ${ruleset.id}'s fatal level, ${String(fatal)}`;
      issues.push({ file, path: `${at}.level`, message });
    }
    const tags = new Set(ruleset.harm.tags.map((tag) => tag.id));
    status.tags.forEach((tag, tagIndex) => {
      if (tags.has(tag)) return;
      const message = `"${tag}" is not a harm tag in ${ruleset.id}`;
      issues.push({ file, path: `${at}.tags.${String(tagIndex)}`, message });
    });
    return issues;
  });
}

function characterIssues(content: PackContent, ruleset: Ruleset | null): PackIssue[] {
  return [...content.entities.values()].flatMap(({ file, entity }) => {
    if (entity.kind !== 'pc' && entity.kind !== 'npc') return [];
    const issues = startingStatusIssues(file, entity.startingStatuses, ruleset);
    if (ruleset === null) return issues;
    issues.unshift(...statIssues(file, entity.stats, ruleset));
    if (entity.kind === 'pc') issues.push(...pcCreationIssues(file, entity.stats, ruleset));
    return issues;
  });
}

// A place whose parents lead back to it. Each place in the cycle is reported once.
function placeCycles(entities: PackContent['entities']): PackIssue[] {
  const issues: PackIssue[] = [];
  for (const { file, entity } of entities.values()) {
    if (entity.kind !== 'place') continue;
    const chain = [entity.id];
    let parentId = entity.parentPlaceId;
    while (parentId !== null && !chain.includes(parentId)) {
      chain.push(parentId);
      const parent = entities.get(parentId)?.entity;
      parentId = parent?.kind === 'place' ? parent.parentPlaceId : null;
    }
    if (parentId === entity.id) {
      const message = `places form a cycle: ${[...chain, entity.id].join(' → ')}`;
      issues.push({ file, path: 'parentPlaceId', message });
    }
  }
  return issues;
}

function historyIssues(content: PackContent, dates: DateCheck): PackIssue[] {
  const history = content.history;
  if (history === null) return [];
  const { file } = history;
  const firstIndex = new Map<string, number>();
  return history.value.flatMap((entry, index) => {
    const at = `entries.${String(index)}`;
    const issues: PackIssue[] = [];
    // Implements SCH-090: refs are unique.
    const first = firstIndex.get(entry.ref);
    if (first === undefined) firstIndex.set(entry.ref, index);
    else {
      const message = `"${entry.ref}" is already the ref of entries.${String(first)}`;
      issues.push({ file, path: `${at}.ref`, message });
    }
    // Implements CON-070.
    if (entry.kind === 'claim' && entry.claim === undefined) {
      issues.push({ file, path: `${at}.claim`, message: 'a claim entry needs "claim"' });
    }
    if (entry.kind !== 'claim' && entry.claim !== undefined) {
      issues.push({ file, path: `${at}.claim`, message: 'only a claim entry has "claim"' });
    }
    // Implements SCH-091: undated entries are background at game time 0.
    if (entry.when !== undefined) issues.push(...dates(file, `${at}.when`, entry.when));
    return issues;
  });
}

// Implements SCH-092 at load time, against the setting's default ruleset (SCH-114).
function dimensionIssues(
  file: string,
  at: string,
  relationship: SeedRelationship,
  ruleset: Ruleset,
): PackIssue[] {
  const { dimensions, min, max } = ruleset.relationships;
  return Object.entries(relationship.dimensions).flatMap(([id, value]) => {
    const path = `${at}.dimensions.${id}`;
    if (!dimensions.some((dimension) => dimension.id === id)) {
      return [{ file, path, message: `"${id}" is not a dimension in ${ruleset.id}` }];
    }
    if (value < min || value > max) {
      const message = `${String(value)} is outside ${ruleset.id}'s range ${String(min)}..${String(max)}`;
      return [{ file, path, message }];
    }
    return [];
  });
}

function relationshipIssues(content: PackContent, ruleset: Ruleset | null): PackIssue[] {
  const relationships = content.relationships;
  if (relationships === null) return [];
  const { file } = relationships;
  const firstIndex = new Map<string, number>();
  return relationships.value.flatMap((relationship, index) => {
    const at = `relationships.${String(index)}`;
    const issues: PackIssue[] = [];
    // Implements CON-073.
    if (relationship.fromId === relationship.toId) {
      const message = 'a relationship runs between two different characters';
      issues.push({ file, path: `${at}.toId`, message });
    }
    const pair = `${relationship.fromId} → ${relationship.toId}`;
    const first = firstIndex.get(pair);
    if (first === undefined) firstIndex.set(pair, index);
    else
      issues.push({ file, path: at, message: `${pair} is already relationships.${String(first)}` });
    if (ruleset !== null) issues.push(...dimensionIssues(file, at, relationship, ruleset));
    return issues;
  });
}

/** Pass 3: every invariant of the pack's own files. Implements SCH-100's third pass. */
export function invariantIssues(content: PackContent): PackIssue[] {
  const defaults = packDefaults(content.setting, content.definitions);
  const dates = dateChecker(content.setting, defaults);
  return [
    ...definitionInvariants(content.definitions, (entry) => entry.source === 'pack'),
    ...epochIssues(content.setting, defaults),
    // Implements SCH-070: a scenario starts at or after the epoch.
    ...[...content.scenarios.values()].flatMap(({ file, value }) =>
      dates(file, 'start', value.start),
    ),
    ...characterIssues(content, defaults.ruleset),
    ...placeCycles(content.entities),
    ...itemIssues(content, defaults),
    ...historyIssues(content, dates),
    ...relationshipIssues(content, defaults.ruleset),
  ];
}
