// Prompt templates (09-context §2): Markdown files found in six layers and rendered with
// Handlebars in strict mode, with two helpers and nothing else, so a template can only
// read its view model (CTX-001, CTX-002, CTX-004).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type AppError, err, ok, type Result } from '@mythos/contracts';
import type { Ruleset } from '@mythos/contracts/content';
import { cmp } from '@mythos/core';
import Handlebars from 'handlebars';
import type { CanonTemplate } from '../storage';

/** Where a template file comes from, highest priority first (CTX-004). */
export const TEMPLATE_LAYERS = [
  'campaign',
  'model-profile',
  'tone-profile',
  'pack',
  'ruleset',
  'engine',
] as const;
export type TemplateLayer = (typeof TEMPLATE_LAYERS)[number];

/** One template or partial file, as the layer that won holds it. */
export type TemplateFile = { layer: TemplateLayer; path: string; text: string };

/** The file at `filePath` in the highest-priority layer that has one, or null. */
export type TemplateLookup = (filePath: string) => Promise<TemplateFile | null>;

/** What each layer holds. The snapshot holds the tone-profile, pack, ruleset, and engine layers. */
export type LayerSources = {
  /** The campaign's override of a file (`template:<path>` in campaign_state), or null. */
  campaign: (filePath: string) => string | null;
  /** The model profile's template folder, or null if it has none. */
  profileDir: string | null;
  snapshot: readonly CanonTemplate[];
};

/** A file path a template may have: lowercase words, `/` between folders, `.md` (ARCH-031). */
export const TEMPLATE_PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.md$/;
/** What `{{> name}}` may name; it resolves to `partials/<name>.md`. */
const PARTIAL_NAME = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

// The snapshot's layers in priority order. readTemplates sorts them by name instead.
const SNAPSHOT_ORDER = ['tone-profile', 'pack', 'ruleset', 'engine'] as const;

/** Text as every OS should see it: LF line endings and no BOM (CONV-083). */
function normalizeText(text: string): string {
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

async function readProfileFile(dir: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, ...filePath.split('/')), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Finds each file in the campaign's overrides, then the model profile's folder, then the
 * snapshot's tone-profile, pack, ruleset, and engine layers. Implements CTX-004.
 */
export function layeredLookup(sources: LayerSources): TemplateLookup {
  return async (filePath) => {
    // Paths come from template names and partial names, never from the player as is.
    if (!TEMPLATE_PATH.test(filePath)) throw new Error(`not a template path: ${filePath}`);
    const override = sources.campaign(filePath);
    if (override !== null)
      return { layer: 'campaign', path: filePath, text: normalizeText(override) };
    if (sources.profileDir !== null) {
      const text = await readProfileFile(sources.profileDir, filePath);
      if (text !== null)
        return { layer: 'model-profile', path: filePath, text: normalizeText(text) };
    }
    for (const layer of SNAPSHOT_ORDER) {
      const found = sources.snapshot.find((file) => file.layer === layer && file.path === filePath);
      if (found !== undefined) return { layer, path: filePath, text: found.text };
    }
    return null;
  };
}

// Implements CTX-001 and CTX-002: a missing variable is an error, prompts are not HTML,
// and only `join`, `label`, and the block helpers exist. `lookup` and `log` are removed.
const COMPILE_OPTIONS: CompileOptions = {
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
  ruleset.harm.levels.forEach((level, index) =>
    labels.set(`harm.${String(index + 1)}`, level.name),
  );
  // One above the last level is fatal (07-rules).
  labels.set(`harm.${String(ruleset.harm.levels.length + 1)}`, ruleset.harm.fatalName);
  return labels;
}

/** `{{label "result.partial"}}`: a ruleset label. An unknown key fails rendering. */
function labelHelper(ruleset: Ruleset): (...args: unknown[]) => string {
  const labels = rulesetLabels(ruleset);
  return (...args) => {
    const [key] = args;
    const text = typeof key === 'string' ? labels.get(key) : undefined;
    if (args.length !== 2 || text === undefined) {
      const known = [...labels.keys()].sort(cmp).join(', ');
      throw new Error(`label takes one of these keys: ${known}; got ${JSON.stringify(key)}`);
    }
    return text;
  };
}

/** Partial names a template uses, or what in it CTX-002 does not allow. */
type Scan = { partials: string[]; problems: string[] };

function scan(program: hbs.AST.Program, found: Scan): void {
  for (const statement of program.body) {
    if (statement.type === 'BlockStatement') {
      const block = statement as hbs.AST.BlockStatement;
      // Absent at run time for a block without that part, whatever the types say.
      const parts: (hbs.AST.Program | undefined)[] = [block.program, block.inverse];
      for (const part of parts) if (part !== undefined) scan(part, found);
    } else if (statement.type === 'PartialStatement') {
      const partial = statement as hbs.AST.PartialStatement;
      if (partial.name.type !== 'PathExpression') {
        found.problems.push('a partial must be named, as {{> name}}');
        continue;
      }
      const name = partial.name.original;
      if (PARTIAL_NAME.test(name)) found.partials.push(name);
      else found.problems.push(`"${name}" is not a partial name: use lowercase words and -`);
    } else if (
      statement.type === 'PartialBlockStatement' ||
      statement.type === 'DecoratorBlock' ||
      statement.type === 'Decorator'
    ) {
      found.problems.push('partial blocks and inline partials are not supported; use {{> name}}');
    }
  }
}

/** A template ready to render, with every file it uses. */
export type PreparedTemplate = {
  /** The top-level file. */
  file: TemplateFile;
  /** Every file used, as `<layer>:<path>`, sorted. */
  used: string[];
  /** Renders `view`; an override that fails is `validation_failed`, an engine one throws. */
  render(view: object): Result<string, AppError>;
};

/**
 * Handlebars' message, without the "[object Object]" it names as the context, and with
 * its "- line:column" (columns from 0) as a line and a column counted from 1.
 */
function problemText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/ in (\[object Object\]|undefined|null)/g, '')
    .replace(
      / - (\d+):(\d+)$/,
      (_, line: string, column: string) => ` (line ${line}, column ${String(Number(column) + 1)})`,
    );
}

/**
 * The failure of `file` while using `used`: `validation_failed` naming the file and its
 * layer, or, when every file used is the engine's, a thrown error, because the shipped
 * templates are then broken. Implements CTX-106 (a failure is never silent).
 */
function failure(file: TemplateFile, problem: string, used: readonly TemplateFile[]): AppError {
  const message = `Template ${file.path} (${file.layer} layer) cannot be rendered: ${problem}`;
  if (used.every((each) => each.layer === 'engine')) throw new Error(message);
  return { code: 'validation_failed', message, details: { layer: file.layer, path: file.path } };
}

type Loaded = { files: Map<string, TemplateFile>; partialOf: Map<string, TemplateFile> };

/** Loads `file` and, depth first, every partial it uses. A cycle or a missing partial fails. */
async function loadTree(
  lookup: TemplateLookup,
  file: TemplateFile,
  loaded: Loaded,
  stack: readonly string[],
): Promise<Result<void, AppError>> {
  loaded.files.set(file.path, file);
  const used = () => [...loaded.files.values()];
  let program: hbs.AST.Program;
  try {
    program = Handlebars.parse(file.text);
    // Compiling here finds an unknown helper before anything renders.
    Handlebars.precompile(program, COMPILE_OPTIONS);
  } catch (error) {
    return err(failure(file, problemText(error), used()));
  }
  const found: Scan = { partials: [], problems: [] };
  scan(program, found);
  const [problem] = found.problems;
  if (problem !== undefined) return err(failure(file, problem, used()));

  for (const name of found.partials) {
    const partialPath = `partials/${name}.md`;
    if ([...stack, file.path].includes(partialPath)) {
      return err(failure(file, `{{> ${name}}} includes itself`, used()));
    }
    if (loaded.partialOf.has(name)) continue;
    const partial = await lookup(partialPath);
    if (partial === null) {
      return err(failure(file, `{{> ${name}}} names ${partialPath}, which no layer has`, used()));
    }
    loaded.partialOf.set(name, partial);
    const result = await loadTree(lookup, partial, loaded, [...stack, file.path]);
    if (!result.ok) return result;
  }
  return ok(undefined);
}

/**
 * Loads the template at `filePath` and its partials from the layers, in a Handlebars
 * environment of its own with the `join` helper and the ruleset's `label` helper.
 * `not_found` when no layer has the file. Implements CTX-001 to CTX-004.
 */
export async function prepareTemplate(
  lookup: TemplateLookup,
  filePath: string,
  ruleset: Ruleset,
): Promise<Result<PreparedTemplate, AppError>> {
  const file = await lookup(filePath);
  if (file === null)
    return err({ code: 'not_found', message: `No layer has template ${filePath}.` });
  const loaded: Loaded = { files: new Map(), partialOf: new Map() };
  const tree = await loadTree(lookup, file, loaded, []);
  if (!tree.ok) return tree;
  const usedFiles = [...loaded.files.values()];

  const hb = Handlebars.create();
  hb.unregisterHelper('lookup');
  hb.unregisterHelper('log');
  hb.registerHelper('join', join);
  hb.registerHelper('label', labelHelper(ruleset));
  // Which file an error came from: the innermost partial that saw it first.
  const sourceOf = new WeakMap<Error, TemplateFile>();
  const attributed = (error: unknown, from: TemplateFile): Error => {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    if (!sourceOf.has(wrapped)) sourceOf.set(wrapped, from);
    return wrapped;
  };
  for (const [name, partial] of loaded.partialOf) {
    const compiled = hb.compile(partial.text, COMPILE_OPTIONS);
    hb.registerPartial(name, (context: unknown, options?: RuntimeOptions) => {
      try {
        return compiled(context, options);
      } catch (error) {
        throw attributed(error, partial);
      }
    });
  }
  const top = hb.compile(file.text, COMPILE_OPTIONS);

  return ok({
    file,
    used: usedFiles.map((each) => `${each.layer}:${each.path}`).sort(cmp),
    render(view) {
      try {
        return ok(top(view));
      } catch (error) {
        const wrapped = attributed(error, file);
        return err(failure(sourceOf.get(wrapped) ?? file, problemText(wrapped), usedFiles));
      }
    },
  });
}
