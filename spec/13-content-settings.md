---
doc: 13-content-settings
title: Mythos — Content Settings
status: draft
schemaVersion: 1
requirementPrefix: CSET
---

# Content Settings

> **For Claude:** content settings are data in the tone profile (`04-content-schemas.md` §6,
> `ContentSettingsSchema`). This document defines what each setting means, how settings
> reach prompts, how they can change during a campaign, and the hard floor. The hard
> floor and its triggers are code in `packages/core` (`content.ts`), validated with a
> reference implementation; nothing about the floor is template text.

Mythos is uncensored by default and shaped entirely by the player's choices: what
appears in their story, how graphically, and what never appears at all. One rule sits
beneath every setting and cannot be changed.

## 1. Principles

- **The player decides.** Intensity is per category and per campaign, and can change at
  any time. Nothing is assumed off-limits except the hard floor.
- **Settings shape the fiction, not the rules.** A gore setting changes how a wound is
  described, never whether it happens or how severe it is.
- **Defense in depth for the floor.** The hard floor is enforced by locked prompt text,
  by tightening settings automatically when a minor is involved, and by keeping
  characters' age categories fixed.

## 2. Categories and levels

Five categories, each at one of four intensity levels:

| Category | Covers |
|---|---|
| `violence` | Fighting, injury, death |
| `gore` | Blood, wounds, bodily harm in detail |
| `sexual` | Sexual content and intimacy |
| `language` | Profanity and slurs |
| `disturbing` | Torture, abuse, self-harm, cruelty, body horror, and similar themes |

| Level | Meaning |
|---|---|
| `off` | It does not happen in the story. If the fiction heads there, it goes elsewhere. |
| `fade-to-black` | It may happen, but off-page: the narration cuts away and resumes after. |
| `moderate` | It is shown, without graphic detail. |
| `explicit` | It may be shown in full detail. |

- **CSET-001** Romance is a story element, not a content category. A romance with
  `sexual: off` has courtship, affection, and kisses; `fade-to-black` lets intimacy
  happen off-page.
- **CSET-002** **Lines** are free-text topics that never appear, in any form. **Veils**
  are free-text topics that may happen in the story but are never described. Both are
  rendered verbatim (SCH-051) and apply on top of the levels.
- **CSET-003** The tone builder and tone parser (phase 8) start new profiles from:
  violence
  `moderate`, gore `fade-to-black`, sexual `fade-to-black`, language `moderate`,
  disturbing `moderate`, no lines or veils. Authored tone profiles state every
  category explicitly (the schema requires it).

## 3. In prompts

- **CSET-010** The `content-settings` partial (CTX-081) renders one plain instruction
  per category, then lines and veils. Its default wording:

| Category | off | fade-to-black | moderate | explicit |
|---|---|---|---|---|
| violence | Violence does not occur. Conflicts resolve without fighting or injury. | Violence may happen but is not shown: cut away, then show the aftermath briefly. | Violence is shown plainly and with consequence, without lingering on injury. | Violence may be shown in full, visceral detail. |
| gore | No blood, wounds, or bodily harm are described. | Injuries are named, not described ("a deep cut"), with no blood or detail. | Wounds and blood are described briefly and without dwelling. | Wounds, blood, and bodily harm may be described in graphic detail. |
| sexual | No sexual content. Affection (a hand held, a kiss) is fine unless a line says otherwise. | Intimacy may happen but always off-page: fade out before it begins, and resume after. | Intimacy may be shown with sensual, non-graphic description. | Sexual content between consenting adults may be described explicitly. |
| language | Characters do not swear. | Swearing is reported, not quoted ("he cursed"). | Mild and moderate profanity may be quoted. | Strong profanity may be quoted freely. |
| disturbing | Avoid disturbing themes such as torture, abuse, and self-harm entirely. | Disturbing themes may exist in the story but are only referred to, never shown. | Disturbing themes may be shown with restraint. | Disturbing themes may be shown directly and in detail. |

- **CSET-011** The partial is part of the template system: the player may reword it in
  any layer (CTX-004), because the settings are theirs. The hard floor is not part of
  the partial and cannot be reworded (§5).
- **CSET-012** Content settings are rendered for every role that writes or shapes
  fiction: adjudicator, narrator, NPC voice, world ticker, consolidator, and the
  transcript summary. The extractor gets them too, so it records events at the same
  level of detail. Suggestions get them so they don't propose what's off.
- **CSET-013** Settings never change mechanics. The adjudicator rules the same way
  under any setting; only how outcomes are described changes. With `violence: off`, the
  GM steers away from fights rather than resolving them gently.

## 4. Changing settings during a campaign

- **CSET-020** A campaign starts with its tone profile's settings (SCH-111). The player
  can change them at any time in campaign settings. Changes are stored in
  `campaign_state` with a version history (as CTX-005), apply campaign-wide on every
  branch from the next model call, and never regenerate past turns.
- **CSET-021** An OOC request ("describe that in more detail") cannot exceed the
  settings. The GM's OOC reply says which setting limits it and offers to open content
  settings.
- **CSET-022** **The X control.** Every narration, voiced line, and journal entry has an
  **X** control for "I don't want this in my story". It offers, together or separately:
  regenerate that output without the unwanted content (a regeneration with an
  instruction, TRN-083), and add a line or a veil, with the topic suggested from what
  the player selects. Using X never asks for a reason.
- **CSET-023** The campaign library shows each campaign's content settings, so a
  campaign's intensity is visible before opening it.

## 5. The hard floor

**Never any sexual content involving a minor.** This holds in every campaign, under
every setting, for every role, and cannot be configured, overridden, or reworded.

- **CSET-040** The floor text (`HARD_FLOOR` in `core`) is appended by code to the
  instructions tier of every prompt for the adjudicator, narrator, NPC voice, extractor,
  consolidator, world ticker, and illustrator, after all template layers have been
  rendered (CTX-007). Images also get content negatives (MED-026, MED-027).
- **CSET-041** It covers anyone **under 18, or described or presented as a child or
  teenager, whatever age is claimed**, so an "ancient being in a child's body" is
  covered.
- **CSET-042** **Automatic tightening.** When any present or involved character is a
  minor (`ageCategory: 'minor'`), the prompt renders `sexual: off` whatever the
  campaign setting, and the floor text is repeated at the end of the task tier, nearest
  the output.
- **CSET-043** While a minor is involved, `explicitContentRoles` routing (PRV-006) is not
  used for that call.
- **CSET-044** **Age categories are fixed.** Every character has an `ageCategory` from
  the moment it exists (CON-040), and no commit can change it: it is set only by
  `entity.create`, which is rejected for an ID that already exists (CON-011), and
  `entity.update-narrative` has no age field. A character who comes
  of age during a campaign is still treated as a minor by the floor. This is deliberate:
  it closes the most obvious way around the floor.
- **CSET-045** When the fiction is unclear about a new character's age, extraction and
  world ticks set `ageCategory: 'minor'` (MEM-057). Pack authors set it explicitly for
  every authored character (SCH schema requires it).
- **CSET-046** Tests assert that the floor text is present in a rendered prompt of
  every listed role for a fixture campaign, under every combination of template
  overrides the fixtures provide, and that `sexual` is `off` in every prompt where a
  minor is present.

## 6. Models and refusals

- **CSET-050** Cloud models have their own content policies and may refuse content the
  settings allow. A refusal surfaces as `provider_rejected` or a `refusal` finish
  reason, and the turn's stage fails like any other (TRN-034, TRN-052).
- **CSET-051** When a stage fails by refusal and the campaign has any `explicit`
  category, the failure card offers to regenerate with another model (PRV-007) and
  explains that `explicitContentRoles` in machine config can route explicit campaigns
  to a local model automatically.

## 7. API

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/campaigns/:campaignId/content-settings` | — | Current `ContentSettings` and version history |
| `PUT /api/campaigns/:campaignId/content-settings` | `ContentSettings` | The new version |

## 8. Phase delivery and tests

| Phase | Scope |
|---|---|
| 1 | The hard floor in every prompt; content settings rendered from the tone profile; automatic tightening (CSET-042); the library summary (CSET-023) |
| 3 | Explicit routing (CSET-043, PRV-006) |
| 5 | The X control |
| 8 | Campaign content settings UI and history |

- **CSET-060** Every category renders at every level, with lines and veils verbatim.
- **CSET-061** With a minor present: sexual is off, the floor appears twice, and explicit
  routing is not used; with only adults present, settings are unchanged.
- **CSET-062** The floor survives every template override in the fixtures (CSET-046).
- **CSET-063** No commit type changes `ageCategory` (a schema test over every commit
  payload type).

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| What repeats the floor in the task tier while a minor is involved (CSET-042)? | `appendFloorToTask(task, role, minor)` in `core`, called last on the rendered task tier, so the floor is the prompt's last text. The output-format instruction is a system message of its own, right after the leading system messages (PRV-050), so nothing follows the floor. All floor text is appended by `core`: `appendLocked` adds it to the instructions tier. | The context module appending `HARD_FLOOR` itself: the floor's rules would live in two packages. | Claude (ruling) |
| What does the library's content summary say (CSET-023)? | One sentence: every category's level in the glossary's words, in §2's order, then how many lines and veils there are, e.g. "Violence moderate, gore fade to black, sexual content off, language moderate, disturbing themes moderate; 1 line, 2 veils". The counts are left out when both are zero, and the topics are never shown. The sentence wraps on the card and is never cut. | Listing the lines and veils: their topics can be the very content the player wants kept off the screen, and they can be long. Naming only the categories above `off`: a reader couldn't tell `off` from left out. | Claude (ruling) |
