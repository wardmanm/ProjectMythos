# @mythos/core

Pure game logic: dice and results, harm, clocks, world-state reducers, commit
validation, calendar math, retrieval scoring, and context budget allocation
([01-architecture.md §2.1](../../spec/01-architecture.md)). It depends on
`@mythos/contracts` only.

## Layout

Files are grouped by the spec document that governs them, so a new file goes in the
folder of its document (01-architecture Decisions). Folders have no `index.ts` of their
own (CONV-015): `src/index.ts` is the only public entry point.

| Folder           | Governing spec                   | Holds                                                                     |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `src/`           |                                  | `index.ts`, `compare.ts` (used by every folder), and `theme.ts` (14-ui)   |
| `src/rules/`     | 07-rules, 11-gear                | Ruleset checks, gear, and appearance; dice, harm, and clocks to come      |
| `src/state/`     | 06-turn-engine, 03-contracts §10 | Turn logic, the fold, commit validation, and the setup set                |
| `src/knowledge/` | 08-memory, 10-journal            | Display names and common knowledge; retrieval and consolidation to come   |
| `src/prompts/`   | 09-context, 13-content-settings  | Budgets, transcript rolling, the hard floor, and content-settings wording |
| `src/time/`      | 12-time-world                    | Calendar math and display; world ticks to come                            |

## Public API

`@mythos/core`, exported from `src/index.ts` as TypeScript source (ARCH-005).

- **Ordering** (`compare.ts`): `cmp(a, b)` orders strings by code point. Use it for every
  sort that reaches stored data, prompts, or tests, never `localeCompare` or plain `<`
  (CONV-087, ADR-011).
- **Themes** (`theme.ts`): `contrast` gives the WCAG contrast ratio. `CONTRAST_RULES` lists
  the pairs every palette must meet, and `themeIssues` lists everything that stops a
  theme being applied (UI-031).

### `rules/`

- **Ruleset checks** (`ruleset-check.ts`): `rulesetIssues` lists every cross-field problem
  in a ruleset (RUL-002, SCH-062), and `rulingLimitsFor` narrows the model-facing ruling
  schema to a ruleset (RUL-065). Spec: 07-rules §4.5 and §12.
- **Gear** (`gear.ts`), for items in play:
  - `possessor` finds who has an item on them, through containers (GEAR-011);
  - `validateItemMove` lists every reason a move is illegal, in plain English (GEAR-053).
    It checks slots, layers, hands, containers, and the hard limit. Whether a character
    or place named by the move exists is left to commit validation;
  - `containerUse` and `loadOf` give the size points used in a container and a
    character's load and capacity (GEAR-041, GEAR-050, GEAR-051).

  Spec: 11-gear §2 to §5.

- **Appearance** (`gear-appearance.ts`): `appearanceOf` builds what others see of a
  character, and lists the items they can't see (GEAR-030, GEAR-060 to GEAR-065).
  Spec: 11-gear §6.

### `state/`

- **Turn logic** (`turn-logic.ts`), over commit sets:
  - `activeSets` keeps the sets nothing supersedes (CON-081), and `staleStages` lists the
    stages of a turn whose active set is based on an inactive one (CON-083);
  - `orderSets(sets, depthByTurnId)` puts sets in application order: turn depth, then
    stage, then `seq`. It is the only definition of that order (TRN-061, CON-084).
- **Folded state** (`folded-state.ts`): the `FoldedState` type (the world state,
  relationships keyed by `relationshipKey(fromId, toId)`, each knower's learned names, and
  the known observation IDs), the `FoldContext` type (ruleset and slot schema), and
  `initialState`, the state folding starts from (TRN-064, SCH-118).
- **Reducers** (`apply-commit.ts`): `applyCommit(state, payload)` returns the state after
  one commit, without changing its input. A type whose reducer arrives in a later phase
  throws, naming the phase (TRN-065, CON-085).
- **Validation** (`validate.ts`, `commit-allowlist.ts`): `commitIssues` lists every
  reason a commit cannot apply at a point: its stage (03-contracts §10.2), references
  and their kinds, the gear rules through `validateItemMove`, and each type's
  invariants (CON-005, CON-070, CON-073, CSET-044).
- **Fold** (`fold.ts`), over `CommitSetEntry` values (a set and its commits). Both step
  through a set commit by commit, so a commit sees the earlier ones in its set:
  - `fold(state, entries, context)` is lenient: it skips a commit that fails and records
    a `ReplayConflict`, and the rest of the set applies (TRN-065, TRN-071). Give it
    active sets in `orderSets` order;
  - `validateSet(state, entry, context)` is strict: any failure, or a witness without a
    `witnessed` grant, rejects the whole set with `illegal_state_change` and
    `details: { issues }` (CON-005, CON-071, TRN-070).

  Spec: 06-turn-engine §6 and 03-contracts §7 to §10.

- **Setup** (`setup.ts`, `setup-history.ts`): `buildSetup(pack, choices, newId)` builds the
  root turn's one `setup` set, in SCH-117's order. `SetupPack` is what it needs of a
  loaded pack, which the content module's `LoadedPack` fits; `SetupChoices` holds the
  scenario, the chosen PC, the ruleset, and the root turn's ID. The `Setup` it returns
  has the first scene's ID, the scenario's start as game time, the payloads, and a
  warning for each change from the pack. It:
  - creates places, factions, characters, then items, each by ID with `cmp`, a
    later-sorting parent place or container moved up to just before the first entity
    inside it, with starting statuses given IDs and the start time (SCH-005);
  - advances time to the scenario's start, moves the PC and present characters there, and
    starts the first scene;
  - turns history into observations, each followed by one grant per knower (MEM-010,
    MEM-034, MEM-035), fits seed relationships to the ruleset (SCH-092), and names the
    characters the PC knows from history (JRN-022);
  - leaves out every premade PC but the chosen one, and everything that refers to it
    (SCH-113, SCH-116), in `setup-history.ts`.

  The caller checks the result with `validateSet` before writing it (TRN-070).
  Spec: 04-content-schemas §11.

`test-support.ts` holds builders for the state tests and is not exported.

### `knowledge/`

- **Journal names** (`journal.ts`): `displayName` gives the name a knower uses for an
  entity (JRN-020), and `commonKnowledge` takes the public section of an entity's canon
  (JRN-031). Spec: 10-journal §3 and §4.

### `prompts/`

- **Content settings and the hard floor** (`content.ts`):
  - `HARD_FLOOR` is the floor's normative text; never reword it (CSET-040, ADR-014);
  - `appendLocked` adds it to the end of the instructions tier for each role in
    `FLOOR_ROLES`, and `appendFloorToTask` repeats it at the end of the task tier while
    a minor is involved (CSET-042);
  - `minorInvolved`, `effectiveSettings`, and `usesExplicitRoles` apply automatic
    tightening (CSET-042, CSET-043);
  - `renderContentSettings` renders the default partial from `DEFAULT_WORDING`, one line
    per category in `CONTENT_CATEGORIES` under its name in `CATEGORY_LABELS`, then lines
    and veils (CSET-010). The context module's view model passes the same wording and
    names to the `content-settings` template.

  Spec: 13-content-settings §2, §3, §5.

- **Context budgets** (`context.ts`):
  - `estimateTokens(text, charsPerToken)` is `ceil(length / ratio)`, with no margin
    (PRV-070). The context module budgets with it and the providers module calibrates
    with it, and re-exports it, so both count alike;
  - `inputBudget` gives a prompt's input budget from a model profile (CTX-030);
  - `allocateBudgets` splits it among the tiers, or reports the fixed tiers that don't
    fit (CTX-031 to CTX-033);
  - `transcriptBoundary` finds where the verbatim transcript starts, rolling by whole
    chunks (CTX-041).

  Spec: 09-context §4 and §5, and 05-providers §7.

### `time/`

- **Calendars** (`calendar.ts`), for converting game time (minutes since the epoch):
  - `toDate` and `fromDate` convert between game time and dates;
  - `isLeap`, `monthDays`, `dayMinutes`, and `timeOfDay` describe a calendar;
  - `minutesUntil` gives the minutes to the next start of a named time of day;
  - `dateIssues` and `calendarIssues` list what's wrong with a date or a calendar;
  - the `ResolvedDate` type.

  Spec: 12-time-world §2, TIME-001 to TIME-004, TIME-011, and TIME-021.

- **Calendar display** (`calendar-display.ts`): `formatDate` and `formatDuration`, for
  showing time to the player (TIME-010, TIME-012).

## Rules

Every function is deterministic given its inputs (ARCH-010). Code here never does IO,
never imports a Node built-in, never touches Node globals such as `process`, `fetch`,
or the timers, and never calls `Date.now()`, `new Date()`, or `Math.random()`: time and
randomness are parameters (CONV-060). Lint enforces all of this outside test files.
Tests may use Node, for example to read fixtures, which is why the tsconfig includes
Node's types.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §2
- [02-conventions.md](../../spec/02-conventions.md) §8
- [03-contracts.md](../../spec/03-contracts.md) §7 to §10
- [04-content-schemas.md](../../spec/04-content-schemas.md) §11
- [06-turn-engine.md](../../spec/06-turn-engine.md) §6
- [05-providers.md](../../spec/05-providers.md) §7 (PRV-070)
- [07-rules.md](../../spec/07-rules.md) §4.5, §12
- [09-context.md](../../spec/09-context.md) §4, §5
- [10-journal.md](../../spec/10-journal.md) §3, §4
- [11-gear.md](../../spec/11-gear.md) §2 to §6
- [12-time-world.md](../../spec/12-time-world.md) §2
- [13-content-settings.md](../../spec/13-content-settings.md) §2, §3, §5
- [14-ui.md](../../spec/14-ui.md) §3.2
