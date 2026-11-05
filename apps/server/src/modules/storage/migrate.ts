// The migration runner (ARCH-050, CONV-052): numbered .sql files, forward-only, run
// automatically every time a campaign opens.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmp } from '@mythos/core';
import { z } from 'zod';
import { parseRow } from './rows';
import type { Database } from './sqlite';

/** The migrations that ship with this version of Mythos. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** One migration file: `0001-initial.sql` is version 1, named `initial`. */
export type Migration = { version: number; file: string; sql: string };

const MIGRATION_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;

/**
 * Reads every migration in `dir`, in order. Throws if a `.sql` file is misnamed or the
 * numbers have a gap, since either would silently skip a change.
 */
export function readMigrations(dir: string): Migration[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort(cmp);
  return files.map((file, index) => {
    const match = MIGRATION_FILE.exec(file);
    if (match?.[1] === undefined) {
      throw new Error(`migration ${file}: name it NNNN-words.sql, such as 0002-add-notes.sql`);
    }
    const version = Number(match[1]);
    if (version !== index + 1) {
      throw new Error(`migration ${file}: expected number ${String(index + 1).padStart(4, '0')}`);
    }
    return { version, file, sql: readFileSync(path.join(dir, file), 'utf8') };
  });
}

const AppliedRowSchema = z.object({ version: z.int().positive(), file: z.string() });

function appliedVersions(db: Database): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, file TEXT NOT NULL) STRICT',
  );
  return db
    .prepare('SELECT version, file FROM migrations ORDER BY version')
    .all()
    .map((row) => parseRow('migrations', AppliedRowSchema, row, ['version']).version);
}

/**
 * Brings `db` up to date with the migrations in `dir`. Each pending migration and its
 * `migrations` row commit together, so one that fails leaves the database as it was.
 * A database that holds a migration `dir` lacks was written by a newer Mythos and is
 * refused. Implements ARCH-050.
 */
export function migrate(db: Database, dir: string = MIGRATIONS_DIR): void {
  const migrations = readMigrations(dir);
  const applied = appliedVersions(db);
  const newest = applied.at(-1) ?? 0;
  if (applied.some((version, index) => version !== index + 1)) {
    throw new Error(`${db.path}: the migrations table has a gap: ${applied.join(', ')}`);
  }
  if (newest > migrations.length) {
    throw new Error(
      `${db.path} was last opened by a newer version of Mythos (database migration ` +
        `${String(newest)}; this version has ${String(migrations.length)}). ` +
        'Update Mythos to open this campaign.',
    );
  }
  for (const migration of migrations.slice(newest)) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO migrations (version, file) VALUES (:version, :file)').run({
        version: migration.version,
        file: migration.file,
      });
    });
  }
}
