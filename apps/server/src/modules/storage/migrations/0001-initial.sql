-- The first campaign schema (P1-T07). Applied migrations are never edited (CONV-052):
-- a change is a new numbered file.
--
-- Every table is STRICT. Times are WallTime strings (ISO 8601 UTC) except
-- model_calls.created_at, which is INTEGER milliseconds so retention can compare it.
-- Ordering uses explicit seq columns, never IDs or times (CONV-054). JSON columns hold
-- the contract schema named beside them and are parsed on every read (CONV-030).

-- The campaign record: exactly one row.
CREATE TABLE campaign (
  only_row INTEGER PRIMARY KEY CHECK (only_row = 1),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  setting_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  tone_profile_id TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  pc_id TEXT NOT NULL,
  first_scene_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_played_at TEXT NOT NULL
) STRICT;

-- The content snapshot (SCH-111, ARCH-045): definitions, runtime entities with their
-- canon Markdown, history, and relationships, each as JSON.
CREATE TABLE canon (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  markdown TEXT,
  PRIMARY KEY (kind, id)
) STRICT;

-- Snapshotted template files by layer (CTX-005). Campaign overrides live in
-- campaign_state instead.
CREATE TABLE canon_templates (
  layer TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (layer, path)
) STRICT;

-- The event log (06-turn-engine §2). Append-only: see the triggers at the end.
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  parent_turn_id TEXT REFERENCES turns (id),
  depth INTEGER NOT NULL CHECK (depth >= 0),
  status TEXT NOT NULL,
  game_time_start INTEGER NOT NULL CHECK (game_time_start >= 0),
  copied_from_turn_id TEXT REFERENCES turns (id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX turns_by_parent ON turns (parent_turn_id);

CREATE TABLE commit_sets (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns (id),
  stage TEXT NOT NULL,
  origin TEXT NOT NULL,
  supersedes_set_id TEXT REFERENCES commit_sets (id),
  based_on_set_ids TEXT NOT NULL, -- JSON array of set IDs
  copied_from_set_id TEXT REFERENCES commit_sets (id),
  schema_version INTEGER NOT NULL,
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0), -- campaign-wide creation order (CON-084)
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)) -- derived from supersession (TRN-001)
) STRICT;
CREATE INDEX commit_sets_by_turn ON commit_sets (turn_id);
CREATE INDEX commit_sets_by_supersedes ON commit_sets (supersedes_set_id);

CREATE TABLE commits (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES commit_sets (id),
  seq INTEGER NOT NULL CHECK (seq >= 0), -- position in its set
  type TEXT NOT NULL,
  payload TEXT NOT NULL, -- CommitPayload
  UNIQUE (set_id, seq)
) STRICT;

-- Mutable state, not commits (TRN-002).
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  head_turn_id TEXT NOT NULL REFERENCES turns (id),
  forked_from_turn_id TEXT REFERENCES turns (id),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0) -- creation order, for listing
) STRICT;

-- Projection: every turn in each branch's ancestry (TRN-003). Rebuildable (ARCH-042).
CREATE TABLE branch_turns (
  branch_id TEXT NOT NULL REFERENCES branches (id),
  turn_id TEXT NOT NULL REFERENCES turns (id),
  depth INTEGER NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (branch_id, turn_id),
  UNIQUE (branch_id, depth)
) STRICT;
CREATE INDEX branch_turns_by_turn ON branch_turns (turn_id);

-- Per-campaign state with version history: the current value of a key is its highest
-- version (CSET-020, CTX-005, TRN-101).
CREATE TABLE campaign_state (
  key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  value TEXT NOT NULL, -- JSON, by key
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, version)
) STRICT;

-- Tables later phases fill. Each has its key columns and the contract's JSON, so
-- filling it needs no new columns.
CREATE TABLE resolution_drafts (
  turn_id TEXT PRIMARY KEY REFERENCES turns (id),
  draft TEXT NOT NULL -- ResolutionDraft
) STRICT;

CREATE TABLE turn_suggestions (
  turn_id TEXT PRIMARY KEY REFERENCES turns (id),
  narration_set_id TEXT NOT NULL REFERENCES commit_sets (id), -- discarded when it changes (TRN-059)
  suggestions TEXT NOT NULL -- Suggestions
) STRICT;

CREATE TABLE snapshots (
  turn_id TEXT PRIMARY KEY REFERENCES turns (id),
  format_version INTEGER NOT NULL, -- the folded state's format (TRN-064)
  state TEXT NOT NULL -- folded state, JSON
) STRICT;

CREATE TABLE replay_conflicts (
  commit_id TEXT PRIMARY KEY REFERENCES commits (id),
  turn_id TEXT NOT NULL REFERENCES turns (id),
  set_id TEXT NOT NULL REFERENCES commit_sets (id),
  conflict TEXT NOT NULL, -- ReplayConflict
  acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)) -- dismissed (TRN-073)
) STRICT;
CREATE INDEX replay_conflicts_by_turn ON replay_conflicts (turn_id);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns (id),
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
  bookmark TEXT NOT NULL -- Bookmark
) STRICT;

-- Model call records: not commits, pruned by retention (ARCH-060, ARCH-061).
CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
  turn_id TEXT REFERENCES turns (id),
  created_at INTEGER NOT NULL, -- milliseconds since 1970, UTC
  record TEXT NOT NULL -- ModelCallRecord
) STRICT;
CREATE INDEX model_calls_by_turn ON model_calls (turn_id);
CREATE INDEX model_calls_by_created_at ON model_calls (created_at);

-- Persisted background jobs (PRV-062).
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  device_id TEXT NOT NULL,
  turn_id TEXT REFERENCES turns (id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  payload TEXT NOT NULL, -- JSON, by job type
  last_error TEXT, -- AppError
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX jobs_by_status ON jobs (status);

-- Media assets: campaign-level state, not commits and not branch-scoped (MED-010,
-- ARCH-130). Files live in <campaign>/assets/<assetId>/<versionId>.<ext> (MED-011).
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
  subject_id TEXT,
  turn_id TEXT REFERENCES turns (id),
  asset TEXT NOT NULL -- Asset
) STRICT;
CREATE INDEX assets_by_subject ON assets (subject_id);

CREATE TABLE asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets (id),
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
  version TEXT NOT NULL -- AssetVersion
) STRICT;
CREATE INDEX asset_versions_by_asset ON asset_versions (asset_id);

-- TRN-001: the log is append-only. The only columns that change are turns.status and
-- commit_sets.active. A migration that adds a column to turns or commit_sets must
-- drop and recreate its update trigger to cover the new column.
CREATE TRIGGER commits_append_only_update BEFORE UPDATE ON commits
BEGIN
  SELECT RAISE(ABORT, 'commits are append-only (TRN-001)');
END;

CREATE TRIGGER commits_append_only_delete BEFORE DELETE ON commits
BEGIN
  SELECT RAISE(ABORT, 'commits are append-only (TRN-001)');
END;

CREATE TRIGGER commit_sets_append_only_update
BEFORE UPDATE OF id, turn_id, stage, origin, supersedes_set_id, based_on_set_ids,
  copied_from_set_id, schema_version, seq, created_at ON commit_sets
BEGIN
  SELECT RAISE(ABORT, 'commit sets are append-only; only active changes (TRN-001)');
END;

CREATE TRIGGER commit_sets_append_only_delete BEFORE DELETE ON commit_sets
BEGIN
  SELECT RAISE(ABORT, 'commit sets are append-only (TRN-001)');
END;

CREATE TRIGGER turns_append_only_update
BEFORE UPDATE OF id, parent_turn_id, depth, game_time_start, copied_from_turn_id,
  created_at ON turns
BEGIN
  SELECT RAISE(ABORT, 'turns are append-only; only status changes (TRN-001)');
END;

CREATE TRIGGER turns_append_only_delete BEFORE DELETE ON turns
BEGIN
  SELECT RAISE(ABORT, 'turns are append-only (TRN-001)');
END;
