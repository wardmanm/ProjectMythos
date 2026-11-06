// The context builder (09-context §10) for one open campaign. Phase 1 builds the
// narrator's prompt and previews templates; every other role's recipe arrives later.
import {
  type AppError,
  err,
  type ModelProfile,
  ok,
  type ReadPoint,
  type Result,
  type Tier,
} from '@mythos/contracts';
import { type CampaignStore, type Database, readState, readTemplates } from '../storage';
import { fitPrompt } from './budget';
import { NARRATOR_TIERS, NARRATOR_WEIGHTS, narratorRecipe } from './narrator';
import { type CampaignAtPoint, readAtPoint } from './read';
import {
  layeredLookup,
  type PreparedTemplate,
  prepareTemplate,
  TEMPLATE_PATH,
  type TemplateLookup,
} from './templates';
import { splitTiers, type TierTexts, withLockedContent } from './tiers';
import type { BuiltPrompt, ContextBuilder, ContextDependencies } from './types';

export type ContextBuilderOptions = {
  dependencies: ContextDependencies;
  store: CampaignStore;
  campaignId: string;
};

/** What the narrator's prompt is built from, besides the campaign at its point. */
export type NarratorInputs = {
  lookup: TemplateLookup;
  profile: ModelProfile;
  charsPerToken: number;
  chunkTurns: number;
};

/** A built prompt, and the tiers in each of its messages, for the preview. */
type NarratorPrompt = { prompt: BuiltPrompt; messageTiers: Tier[][] };

/** Renders the narrator's tiers for one view: markers checked, locked content added. */
function renderTiers(
  prepared: PreparedTemplate,
  view: object,
  minor: boolean,
): Result<TierTexts, AppError> {
  const rendered = prepared.render(view);
  if (!rendered.ok) return rendered;
  const split = splitTiers(rendered.value, NARRATOR_TIERS);
  if (!split.ok) return err(prepared.problem(split.error));
  return ok(withLockedContent(split.value, 'narrator', minor));
}

/**
 * The narrator's prompt for the point's turn: `narrator.md` from the layers, rendered
 * against the narrator's view, fitted to the profile. Nothing is reserved, because
 * streamed text has no format instruction (owner's decision on CTX-030).
 */
export async function narratorPrompt(
  at: CampaignAtPoint,
  inputs: NarratorInputs,
): Promise<Result<NarratorPrompt, AppError>> {
  const prepared = await prepareTemplate(inputs.lookup, 'narrator.md', at.ruleset);
  if (!prepared.ok) return prepared;
  const recipe = narratorRecipe(at);
  const fitted = fitPrompt({
    role: 'narrator',
    tiers: NARRATOR_TIERS,
    weights: NARRATOR_WEIGHTS,
    profile: inputs.profile,
    charsPerToken: inputs.charsPerToken,
    reservedTokens: 0,
    sceneTrims: recipe.trims.map(({ label }) => label),
    transcriptTurns: recipe.transcriptTurns,
    chunkTurns: inputs.chunkTurns,
    render: (choice) => renderTiers(prepared.value, recipe.view(choice), recipe.minor),
  });
  if (!fitted.ok) return fitted;
  return ok({
    prompt: {
      role: 'narrator',
      messages: fitted.value.messages,
      tiers: fitted.value.tiers,
      retrieved: [],
      templates: prepared.value.used,
    },
    messageTiers: fitted.value.messageTiers,
  });
}

/** A prompt as the preview shows it: each message under a line naming its role and tiers. */
function previewText({ prompt, messageTiers }: NarratorPrompt): string {
  return prompt.messages
    .map((message, index) => {
      const tiers = (messageTiers[index] ?? []).join(', ');
      const breakpoint = message.cacheBreakpoint === true ? ' (cache breakpoint)' : '';
      return `--- ${message.role}: ${tiers}${breakpoint} ---\n${message.content}\n`;
    })
    .join('\n');
}

/** A builder that arrives with a later phase. Implements CTX-110 (a failure, not a throw). */
function notYet(what: string, phase: number): Result<never, AppError> {
  return err({ code: 'internal_error', message: `${what} arrive in phase ${String(phase)}.` });
}

/**
 * The context module for one open campaign. It reads only the campaign's own database,
 * the model-profile template folder, and what `dependencies` gives it (CTX-110).
 * Implements CTX-008 and CTX-110.
 */
export function createContextBuilder(options: ContextBuilderOptions): ContextBuilder {
  const { dependencies, store, campaignId } = options;

  async function build(point: ReadPoint): Promise<Result<NarratorPrompt, AppError>> {
    const route = dependencies.profileFor('narrator', campaignId);
    if (!route.ok) return route;
    const opened = store.openCampaign(campaignId);
    if (!opened.ok) return opened;
    const db: Database = opened.value;
    const { profile, charsPerToken } = route.value;
    const lookup = layeredLookup({
      campaign: (filePath) => readState(db, `template:${filePath}`),
      profileDir: dependencies.profileTemplateDir(profile.id),
      snapshot: readTemplates(db),
    });
    const chunkTurns = dependencies.contextSettings().transcriptChunkTurns;
    return narratorPrompt(readAtPoint(store, db, point), {
      lookup,
      profile,
      charsPerToken,
      chunkTurns,
    });
  }

  return {
    adjudication: () => Promise.resolve(notYet('Adjudication prompts', 3)),
    keySpeakers: () => Promise.reject(new Error('Key speakers arrive in phase 4.')),
    npcVoice: () => Promise.resolve(notYet('NPC voice prompts', 4)),
    async narration(point, turnId, voiced, instruction) {
      if (point.turnId !== turnId) {
        throw new Error(`narration: the read point is for turn ${point.turnId}, not ${turnId}`);
      }
      if (voiced.length > 0) return notYet('Voiced lines in the narrator prompt', 4);
      if (instruction !== null) return notYet('Regeneration directions', 2);
      const built = await build(point);
      return built.ok ? ok(built.value.prompt) : built;
    },
    extraction: () => Promise.resolve(notYet('Extraction prompts', 4)),
    suggestions: () => Promise.resolve(notYet('Suggested actions', 3)),
    transcriptSummary: () => Promise.resolve(notYet('Transcript summaries', 2)),
    consolidation: () => Promise.resolve(notYet('Consolidation prompts', 4)),
    async preview(point, templateName) {
      // Implements CTX-008: the template a preview names never reaches outside its layer.
      if (!TEMPLATE_PATH.test(templateName)) {
        const message = `"${templateName}" is not a template name, such as narrator.md or partials/tone.md.`;
        return err({ code: 'validation_failed', message });
      }
      const built = await build(point);
      if (!built.ok) return built;
      const used = built.value.prompt.templates.some((file) => file.endsWith(`:${templateName}`));
      if (!used) {
        return err({ code: 'not_found', message: `No phase-1 prompt uses ${templateName}.` });
      }
      return ok(previewText(built.value));
    },
  };
}
