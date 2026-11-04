---
doc: 15-media
title: Mythos — Images and Voice
status: draft
schemaVersion: 1
requirementPrefix: MED
---

# Images and Voice

> **For Claude:** this document owns the `media` server module (phases 9 and 10).
> `media.ts` belongs in `packages/contracts/src/`; the media profile and HTTPS settings
> are in `machine-config.ts` (`05-providers.md`). Workflow mapping, content negatives,
> speech segmentation checks, sentence splitting, and voice assignment were validated
> with a reference implementation. The ComfyUI and audio APIs described here were
> checked against their current documentation and source.

Images and voice are optional layers on top of play. Portraits of the people the PC
meets, pictures of places and scenes, narration read aloud with a voice for each
character, and speaking instead of typing. None of it is required, none of it blocks
play, and all of it respects what the PC knows.

## 1. Principles

- **Never in the way.** Media runs at the lowest priority (ARCH-080), never delays a
  turn, and failure only means a missing picture or silence.
- **The PC's eyes.** An image shows what the PC could see: visible gear only, never
  concealed items; places and people only once the PC knows them.
- **Portable campaigns, local machines.** Campaigns carry descriptions (how someone
  looks, how they sound); each machine decides which image model and which voices
  realize them (OVR-006).
- **Every generation is a version.** Regenerate as often as you like; keep the one you
  want; nothing is deleted unless you delete it.
- **Content settings and the hard floor apply to images** exactly as to text (CSET-040).

## 2. Setup

Media is configured per machine in machine config (`05-providers.md` §2):

- **MED-001** **Providers:** `comfyui` for local image workflows; `openai-compatible`
  for image APIs (`/images/generations`), speech output (`/audio/speech`, as served by
  Kokoro-FastAPI, Speaches, or OpenAI), and speech input (`/audio/transcriptions`, as
  served by Speaches or OpenAI). A provider's device (ARCH-081) decides what it competes
  with: ComfyUI on the GPU that runs the narrator waits for it.
- **MED-002** **Media profiles** (`mediaProfiles`) describe one image, speech-output, or
  speech-input model each. The `media` section picks which profile this machine uses
  for each; `null` turns that feature off here.
- **MED-003** **Roles:** `illustrator` (optional) writes image prompts from the scene;
  without it, prompts come straight from templates. `speech-segmenter` splits narration
  by speaker; without it, the extractor's assignment is used.
- **MED-004** The settings screen's **Probe** (PRV-090) also tests media profiles:
  ComfyUI reachable and the mapping valid against its workflow (MED-031); an image API
  returning a test image; a speech profile speaking a test sentence and listing its
  voices; a transcription profile transcribing a bundled test clip.

## 3. Images

### 3.1 Assets

- **MED-010** Generated images and audio are **assets** (`media.ts`): campaign-level
  records, not commits and not branch-scoped, because no game state derives from them.
  Each asset has versions; one is active. An entity's portrait is the active version of
  its `portrait` asset.
- **MED-011** Files are stored at `<campaign>/assets/<assetId>/<versionId>.<ext>`, and
  served by the API with long cache lifetimes (a version's file never changes).
- **MED-012** Campaign exports include image assets by default and audio never
  (audio is regenerated on demand).

### 3.2 What can be illustrated, and when

| Purpose | Subject | Automatic trigger (campaign media settings) |
|---|---|---|
| `portrait` | A character the PC knows | `on-first-meeting`: when a character first becomes known (JRN-010) |
| `place` | A place the PC knows | `on-first-visit`: when the PC first starts a scene there |
| `scene` | The current scene | `on-scene-start`: at each new scene |
| `item` | An item the PC has seen | Manual only |

- **MED-020** Every trigger defaults to manual. Manual generation is a button on the
  subject wherever it appears: the scene panel, journal pages, gear, and the scene break
  in the story.
- **MED-021** Automatic generations are queued at media priority and skipped (not
  queued) when no image profile is configured on this machine.
- **MED-022** With `sceneImagesInStory` on, a scene's active image appears below its
  scene break (UI-052), sized to the story column.

### 3.3 Building the prompt

- **MED-023** Each purpose has a view model built in code from the **PC's point of
  view**: for a portrait, the character's display name withheld (names are not
  drawn), physical description, visible appearance (GEAR-060), visible harm, and the
  entity's `media.imagePrompt`; for a place, its description, the time of day, and the
  weather or light the latest narration mentions; for a scene, the place plus present
  characters' public appearances. Every view model includes the tone profile's
  `artStyle`.
- **MED-024** Templates `image-portrait.md`, `image-place.md`, `image-scene.md`, and
  `image-item.md` render the view model (CTX §2). If the `illustrator` role is assigned,
  it receives the rendered text and returns an `IllustrationPrompt` in the profile's
  `promptStyle` (prose for modern image models, tags for older ones); otherwise the
  rendered text is the prompt.
- **MED-025** The player can edit the prompt before generating, and edits are kept as
  the asset version's prompt.

### 3.4 Content settings in images

- **MED-026** The engine appends **content negatives** to every negative prompt, from
  the campaign's content settings (`contentNegatives`): NSFW terms unless sexual
  content is `explicit`; gore terms unless gore is `moderate` or `explicit`; and so on.
  The profile's own `negativePrompt` and the illustrator's are kept.
- **MED-027** **The hard floor in images.** If any character in the image is a minor,
  the full NSFW and sexualization negatives are added whatever the settings, the
  illustrator's prompt carries `HARD_FLOOR`, and the illustrator is told to describe the
  character's clothing as fully covering. These are added by code after templates
  (CSET-040).
- **MED-028** Image APIs without negative prompts receive the negatives as a final
  sentence of the prompt ("Do not include: …").

### 3.5 Consistent characters

- **MED-029** An entity's `media.referenceImage` (a pack file) is uploaded to ComfyUI
  and passed to the workflow's mapped `referenceImage` input; `media.loraName` and
  `loraStrength` go to mapped LoRA inputs. A workflow without those mapped inputs
  ignores them. This is where a trained character LoRA plugs in.
- **MED-030** Each portrait asset remembers its last seed. "Regenerate" uses a new seed;
  "Vary prompt" reuses the seed with the edited prompt, for small changes to the same
  composition.

## 4. ComfyUI

A ComfyUI workflow is exported in **API format** (a JSON object of nodes by ID, each
with `class_type` and `inputs`) and paired with a **mapping file** saying where each
engine parameter goes. Both live in `<dataDir>/library/workflows/`; the image profile
names the mapping.

```json
{
  "schemaVersion": 1,
  "name": "SDXL portrait with LoRA",
  "workflowFile": "portrait.api.json",
  "inputs": {
    "prompt": { "node": "6", "input": "text" },
    "negativePrompt": { "node": "7", "input": "text" },
    "seed": { "node": "3", "input": "seed" },
    "width": { "node": "5", "input": "width" },
    "height": { "node": "5", "input": "height" },
    "loraName": { "node": "10", "input": "lora_name" },
    "loraStrength": { "node": "10", "input": "strength_model" }
  },
  "output": { "node": "9" }
}
```

- **MED-031** `mappingIssues` checks a mapping against its workflow: every mapped node
  exists, has the named input, and that input is a value rather than a link to another
  node; the output node exists. Every problem is reported at once, at load and on probe.
- **MED-032** `applyMapping` writes the prompt, negative prompt, seed, size, LoRA, and
  uploaded reference image into a copy of the workflow. Unmapped parameters are left as
  the workflow has them.
- **MED-033** The adapter: uploads a reference image with `POST /upload/image`
  (multipart field `image`, plus `type: input` and `overwrite: true`) and uses the
  returned `name`; queues with `POST /prompt` (`prompt`, `client_id`), getting a
  `prompt_id`; follows progress on the `/ws?clientId=` websocket, and falls back to
  polling `GET /history/{prompt_id}`; downloads each output image of the output node
  with `GET /view` (`filename`, `subfolder`, `type`).
- **MED-034** Cancelling removes a queued prompt from ComfyUI's queue, or interrupts it if
  it is the one running. Progress is reported as `job.updated` events, so the UI can show
  a progress ring on the subject.
- **MED-035** The `spec/fixtures/test/workflows/` files are a minimal SDXL-style example used
  by tests; real workflows come from the player.

## 5. Voice

### 5.1 Speech output

The campaign's media settings choose a **speech mode**:

| Mode | What is spoken |
|---|---|
| `off` | Nothing |
| `narrator` | All narration, in the narrator's voice, starting as it streams |
| `character-voices` | Narration in the narrator's voice; dialogue in each speaker's voice |

- **MED-050** Whether new narration plays automatically, and at what speed, are device
  preferences (UI-103). Every narration has a play control either way.

### 5.2 Voices

- **MED-051** A speech profile's voice catalog is its `voices` list, or, when empty, the
  provider's voice list (`GET /audio/voices` where supported).
- **MED-052** Characters carry a portable `voice` description (how they sound, an
  optional speed), authored in the pack or set by the player. Each machine keeps its own
  **voice assignments** per speech profile, in `campaign_state`: the narrator and each
  speaker to a voice ID. A speaker without an assignment gets one automatically
  (`assignVoice`): deterministic, and avoiding voices already in use where the catalog
  allows. A campaign moved to another machine is reassigned there; its descriptions
  come along.
- **MED-053** The voice picker lists the catalog with a "Preview" button that speaks the
  character's voice description in that voice, and shows the description beside it.

### 5.3 Splitting narration by speaker

- **MED-054** In `narrator` mode, narration is spoken a sentence at a time as it streams:
  `takeSentences` releases complete sentences, keeping dialogue tags and ellipses
  attached ("Who's there?" he asks.) and waiting at the end of the buffer until it can
  tell; the remainder is spoken when narration completes.
- **MED-055** In `character-voices` mode, once narration completes, the
  `speech-segmenter` role splits it into `SpeechSegments` (speaker and text). The output
  must **reproduce the narration exactly**: `segmentIssues` compares the joined segments
  with the narration (whitespace aside) and names the first difference; every speaker
  must be present in the scene. Issues are fed back for a retry; if it still fails, that
  turn is spoken in `narrator` mode.
- **MED-056** Key speakers' voiced lines (CTX-066) are known in advance, and are given to
  the segmenter as hints.

### 5.4 Audio caching

- **MED-057** Each turn's speech is a `speech` asset whose versions record the narration
  set they were made from (`sourceSetId`) and the voices used. Replaying a turn reuses
  the audio; editing or regenerating the narration, or changing a voice, makes a new
  version on next play.
- **MED-058** Speech for playback runs at interactive priority (the player is listening);
  pre-generation of the latest turn, when autoplay is on, runs at media priority.
- **MED-059** Audio older than the machine's model-call retention (ARCH-061) may be
  deleted to save space; it is regenerated when played.

### 5.5 Speech input

- **MED-060** Modes (machine config `media.speechInput`): `off`; `browser`, using the
  browser's speech recognition where available (some browsers send audio to an online
  service, and the settings screen says so); `server`, sending recorded audio to the
  speech-input profile's transcription endpoint.
- **MED-061** The input dock gets a microphone button: hold to talk (or tap to start and
  stop). The transcript fills the input box for review; a device preference sends it
  immediately instead. It works in both input modes.
- **MED-062** Browsers allow microphone access only on secure pages, or on `localhost`
  (OVR-011). For other devices on the LAN, `server.https` must be on: `self-signed`
  generates a certificate into `<dataDir>/tls/` (each device trusts it once), or `files`
  uses the player's own. When a device can't use the microphone, the button explains
  why and links to the setting.

## 6. API

All under `/api/campaigns/:campaignId`.

| Method & path | Body | Returns |
|---|---|---|
| `GET /media-settings`, `PUT /media-settings` | `CampaignMediaSettings` | Current settings |
| `GET /assets?subjectId=&purpose=` | — | `Asset[]` with versions (subjects the PC knows, unless GM mode) |
| `POST /assets/generate` | `GenerateImageCommand` | `{ jobId, assetId }` |
| `GET /assets/:assetId/versions/:versionId/file` | — | The file |
| `PUT /assets/:assetId/active` | `{ versionId }` | `Asset` |
| `DELETE /assets/:assetId/versions/:versionId` | — | `204`; deletes the file |
| `POST /turns/:turnId/speech` | — | Audio for the turn's narration (streamed in `narrator` mode) |
| `GET /voices`, `PUT /voices` | `VoiceAssignment` | This machine's assignments and catalog |
| `POST /transcribe` | Audio (multipart) | `{ text }` |

- **MED-070** Assets for subjects the PC doesn't know are not returned outside GM mode
  (JRN-010).

## 7. Contracts — `media.ts`

```ts
import { z } from 'zod';
import { EntityIdSchema, IdSchema, WallTimeSchema } from './primitives';

/*
 * Media (15-media). Assets are campaign-level, not branch-scoped and not commits: no game
 * state derives from them (MED-010). Files live in <campaign>/assets/.
 */

export const AssetPurposeSchema = z.enum(['portrait', 'place', 'scene', 'item', 'speech']);

export const AssetSchema = z.object({
  id: IdSchema,
  kind: z.enum(['image', 'audio']),
  purpose: AssetPurposeSchema,
  subjectId: EntityIdSchema.nullable(), // the character, place, or item shown
  sceneId: IdSchema.nullable(), // scene illustrations
  turnId: IdSchema.nullable(), // speech: the turn whose narration it reads
  activeVersionId: IdSchema.nullable(),
  createdAt: WallTimeSchema,
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetVersionSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  file: z.string().regex(/^[a-z0-9\-/]+\.(png|jpg|webp|mp3|opus|wav)$/), // relative to the campaign's assets folder
  mime: z.string(),
  bytes: z.int().nonnegative(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  durationMs: z.int().positive().nullable(),
  prompt: z.string(), // image prompt, or the spoken text
  negativePrompt: z.string(),
  seed: z.int().nullable(),
  profileId: z.string(), // the machine's media profile that made it (informational)
  voiceId: z.string().nullable(), // speech
  sourceSetId: IdSchema.nullable(), // speech: the narration set it was made from (MED-056)
  createdAt: WallTimeSchema,
});
export type AssetVersion = z.infer<typeof AssetVersionSchema>;

// ------------------------------------------------------------------- ComfyUI (MED §4)

const NodeInputSchema = z.strictObject({ node: z.string().min(1), input: z.string().min(1) });

/**
 * Machine-level file in <dataDir>/library/workflows/<name>.mapping.json. Says where each
 * engine parameter goes in an API-format workflow exported from ComfyUI.
 */
export const WorkflowMappingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(80),
  workflowFile: z.string().regex(/^[\w\-.]+\.json$/), // API-format export, beside the mapping
  inputs: z.strictObject({
    prompt: NodeInputSchema,
    negativePrompt: NodeInputSchema.optional(),
    seed: NodeInputSchema.optional(),
    width: NodeInputSchema.optional(),
    height: NodeInputSchema.optional(),
    loraName: NodeInputSchema.optional(),
    loraStrength: NodeInputSchema.optional(),
    referenceImage: NodeInputSchema.optional(), // a LoadImage node's "image" input
  }),
  output: z.strictObject({ node: z.string().min(1) }), // the SaveImage node to read
});
export type WorkflowMapping = z.infer<typeof WorkflowMappingSchema>;

// ------------------------------------------------------------------- model-facing (CON-003)

/** Illustrator output (MED §3.3). */
export const IllustrationPromptSchema = z.object({
  prompt: z.string().min(1).max(1500),
  negativePrompt: z.string().max(500),
});

/** Speech segmenter output (MED §5.3): the narration, split by who is speaking. */
export const SpeechSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.union([z.literal('narrator'), EntityIdSchema]),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(80),
});
export type SpeechSegments = z.infer<typeof SpeechSegmentsSchema>;

// ------------------------------------------------------------------- campaign settings & commands

/** Stored in campaign_state, like content settings (CSET-020). */
export const CampaignMediaSettingsSchema = z.object({
  illustrate: z.object({
    portraits: z.enum(['manual', 'on-first-meeting']),
    places: z.enum(['manual', 'on-first-visit']),
    scenes: z.enum(['manual', 'on-scene-start']),
  }),
  sceneImagesInStory: z.boolean(),
  speech: z.enum(['off', 'narrator', 'character-voices']),
});
export type CampaignMediaSettings = z.infer<typeof CampaignMediaSettingsSchema>;

export const GenerateImageCommandSchema = z.object({
  purpose: z.enum(['portrait', 'place', 'scene', 'item']),
  subjectId: EntityIdSchema.nullable(),
  sceneId: IdSchema.nullable(),
  promptOverride: z.string().min(1).max(1500).optional(), // the player's edited prompt
  seed: z.int().nonnegative().optional(), // reuse a seed to vary only the prompt
});

/** A player's choice of voice for one speaker on this machine (MED-052). */
export const VoiceAssignmentSchema = z.object({
  speechProfileId: z.string(),
  speakerId: z.union([z.literal('narrator'), EntityIdSchema]),
  voiceId: z.string().min(1),
});
```

## 8. Phase delivery and tests

| Phase | Scope |
|---|---|
| 1 | Reserved: asset storage, media job priority, portable `media` and `voice` fields |
| 9 | Image providers, profiles, probe; assets and versions; portraits, places, scenes, items; triggers; illustrator; content negatives and the floor in images |
| 10 | Speech output (both modes), voices and assignments, audio caching; speech input (browser and server); HTTPS |

- **MED-080** `applyMapping` writes every mapped parameter, leaves links and the
  original workflow untouched; `mappingIssues` reports every problem at once.
- **MED-081** Content negatives follow the settings; a minor in the image always gets
  the full set, whatever the settings.
- **MED-082** An image prompt view model never contains a concealed item, an unknown
  character's name, or anything outside the PC's knowledge.
- **MED-083** `segmentIssues` passes an exact split and catches a paraphrase (showing
  where) and an absent speaker; a failed segmentation falls back to `narrator` mode.
- **MED-084** `takeSentences` keeps dialogue tags and ellipses attached and never
  releases a sentence at the end of the buffer.
- **MED-085** `assignVoice` is deterministic, prefers unused voices, honors explicit
  choices, and falls back when a choice isn't in this machine's catalog.
- **MED-086** The ComfyUI adapter against a mock server: upload, queue, progress,
  history, download, cancel while queued and while running.
