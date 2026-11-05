// Validating a pack (SCH-100): files, then references, then invariants, each pass reporting
// every issue it finds. Pure: every file is already in memory (SCH-103). The libraries are
// checked once, and a pack reports only the library problems it uses (owner decision).
import path from 'node:path';
import { cmp } from '@mythos/core';
import { defaultRulesetId, mergeDefinitions } from './resolve';
import type {
  DefinitionEntry,
  DefinitionSet,
  PackContent,
  PackIssue,
  PassIssues,
  Shadowing,
  SourceFiles,
} from './types';
import { parseDefinitions, parsePackFiles, type SourceLabel } from './validate-files';
import { definitionInvariants, invariantIssues } from './validate-invariants';
import { referenceIssues, toneProfileReferences } from './validate-references';

export const PACK: SourceLabel = { name: 'pack', prefix: '' };
export const USER_LIBRARY: SourceLabel = { name: 'user', prefix: 'library' };
export const BUILT_IN_LIBRARY: SourceLabel = { name: 'built-in', prefix: 'content-library' };

/** Both libraries, checked once for every pack that uses them. */
export type CheckedLibraries = {
  user: SourceFiles;
  builtIn: SourceFiles;
  /** User-library definitions, then the built-in ones they do not shadow (SCH-010). */
  definitions: DefinitionSet;
  /** Every problem in either library, by pass, reported under its library file. */
  issues: PassIssues;
  /** User-library definitions that replace built-in ones, for the caller to log. */
  shadowings: Shadowing[];
};

/** A pack's validation: what parsed, every issue in order, and its shadowings to log. */
export type PackValidation = {
  content: PackContent;
  /** Pass order, then file order (SCH-100, SCH-101). Empty means the pack can be used. */
  issues: PackIssue[];
  /** Pack definitions that replace library ones (SCH-010). */
  shadowings: Shadowing[];
};

function withUsable(
  set: DefinitionSet,
  usable: (entry: DefinitionEntry<unknown>) => boolean,
): DefinitionSet {
  const mark = <T>(entries: ReadonlyMap<string, DefinitionEntry<T>>) =>
    new Map([...entries].map(([id, entry]) => [id, { ...entry, usable: usable(entry) }]));
  return {
    calendars: mark(set.calendars),
    slotSchemas: mark(set.slotSchemas),
    toneProfiles: mark(set.toneProfiles),
    rulesets: mark(set.rulesets),
    themes: mark(set.themes),
  };
}

// A library tone profile must name library definitions that are usable themselves, or a
// pack would offer a tone profile it cannot apply.
function libraryToneReferences(
  set: DefinitionSet,
  usable: (entry: DefinitionEntry<unknown>) => boolean,
): PackIssue[] {
  return [...set.toneProfiles.values()].flatMap((entry) => {
    const tone = entry.definition;
    if (tone === null) return [];
    const issues = toneProfileReferences(entry.file, tone, set, 'the libraries');
    const targets = [
      {
        path: 'themeId',
        target: tone.themeId === undefined ? undefined : set.themes.get(tone.themeId),
      },
      {
        path: 'slotSchemaId',
        target:
          tone.slotSchemaId === undefined ? undefined : set.slotSchemas.get(tone.slotSchemaId),
      },
    ];
    for (const { path: at, target } of targets) {
      if (target === undefined || usable(target)) continue;
      issues.push({
        file: entry.file,
        path: at,
        message: `"${target.id}" has problems of its own, in ${target.file}`,
      });
    }
    return issues;
  });
}

/**
 * Checks both libraries: every file, `core`'s checks on each definition that is not shadowed,
 * and library tone profiles' references. A definition with any problem is not usable.
 */
export function checkLibraries(user: SourceFiles, builtIn: SourceFiles): CheckedLibraries {
  const userFiles = parseDefinitions(user, USER_LIBRARY);
  const builtInFiles = parseDefinitions(builtIn, BUILT_IN_LIBRARY);
  const merged = mergeDefinitions(userFiles.set, builtInFiles.set);
  const files = [...userFiles.issues, ...builtInFiles.issues];
  const invariants = definitionInvariants(merged.set, () => true);
  const broken = new Set([...files, ...invariants].map((issue) => issue.file));
  const usable = (entry: DefinitionEntry<unknown>) =>
    entry.definition !== null && !entry.files.some((file) => broken.has(file));
  const references = libraryToneReferences(merged.set, usable);
  for (const issue of references) broken.add(issue.file);
  return {
    user,
    builtIn,
    definitions: withUsable(merged.set, usable),
    issues: { files, references, invariants },
    shadowings: merged.shadowings,
  };
}

/** Every library file a pack depends on: its setting's definitions and its tone profiles'. */
function usedLibraryFiles(content: PackContent): Set<string> {
  const { setting, definitions } = content;
  const used = new Set<string>();
  const use = (entry: DefinitionEntry<unknown> | undefined) => {
    if (entry !== undefined && entry.source !== 'pack')
      for (const file of entry.files) used.add(file);
  };
  const tones = [...definitions.toneProfiles.values()].filter((entry) => entry.source === 'pack');
  if (setting !== null) {
    use(definitions.calendars.get(setting.calendarId));
    use(definitions.slotSchemas.get(setting.slotSchemaId));
    use(definitions.rulesets.get(defaultRulesetId(setting)));
    const toneId = setting.defaults.toneProfileId;
    const defaultTone = toneId === undefined ? undefined : definitions.toneProfiles.get(toneId);
    if (defaultTone !== undefined) tones.push(defaultTone);
  }
  for (const tone of tones) {
    use(tone);
    const { themeId, slotSchemaId } = tone.definition ?? {};
    if (themeId !== undefined) use(definitions.themes.get(themeId));
    if (slotSchemaId !== undefined) use(definitions.slotSchemas.get(slotSchemaId));
  }
  return used;
}

// Stable, so each file's issues keep the order they were found in.
function byFile(issues: readonly PackIssue[]): PackIssue[] {
  return [...issues].sort((a, b) => cmp(a.file, b.file));
}

/**
 * Validates a pack read into memory against the checked libraries: every file, then every
 * reference, then every invariant, with every issue found (SCH-100) at its file and JSON path
 * (SCH-101). Pure, so the same files always give the same result (SCH-103).
 */
export function validatePack(pack: SourceFiles, libraries: CheckedLibraries): PackValidation {
  const packId = path.basename(pack.root);
  const files = parsePackFiles(pack, packId);
  const merged = mergeDefinitions(files.definitions, libraries.definitions);
  const content: PackContent = {
    packId,
    manifest: files.manifest,
    setting: files.setting,
    definitions: merged.set,
    scenarios: files.scenarios,
    entities: files.entities,
    history: files.history,
    relationships: files.relationships,
    sources: { pack, user: libraries.user, 'built-in': libraries.builtIn },
  };
  const used = usedLibraryFiles(content);
  const fromLibraries = (issues: readonly PackIssue[]) =>
    issues.filter((issue) => used.has(issue.file));
  return {
    content,
    issues: [
      ...byFile([...files.issues, ...fromLibraries(libraries.issues.files)]),
      ...byFile([...referenceIssues(content), ...fromLibraries(libraries.issues.references)]),
      ...byFile([...invariantIssues(content), ...fromLibraries(libraries.issues.invariants)]),
    ],
    shadowings: merged.shadowings,
  };
}
