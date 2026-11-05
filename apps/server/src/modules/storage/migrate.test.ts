import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MIGRATIONS_DIR, migrate, readMigrations } from './migrate';
import { type Database, openDatabase } from './sqlite';
import { createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

function freshDatabase(): Database {
  return space.track(openDatabase(path.join(space.folder(), 'campaign.sqlite')));
}

/** A migrations folder holding the shipped 0001 plus `extra` files. */
function migrationsWith(extra: Record<string, string>): string {
  const dir = space.folder();
  copyFileSync(path.join(MIGRATIONS_DIR, '0001-initial.sql'), path.join(dir, '0001-initial.sql'));
  for (const [file, sql] of Object.entries(extra)) writeFileSync(path.join(dir, file), sql);
  return dir;
}

const AppliedSchema = z.array(z.object({ version: z.int(), file: z.string() }));
const applied = (db: Database) =>
  AppliedSchema.parse(db.prepare('SELECT version, file FROM migrations ORDER BY version').all());

const tableNames = (db: Database) =>
  z
    .array(z.object({ name: z.string() }))
    .parse(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all())
    .map((row) => row.name);

describe('migrate', () => {
  it('ARCH-050: opening a database twice runs each migration once', () => {
    const db = freshDatabase();
    migrate(db);
    migrate(db);
    expect(applied(db)).toEqual([{ version: 1, file: '0001-initial.sql' }]);
    expect(tableNames(db)).toContain('commits');
  });

  it('ARCH-050: a later migration runs on the next open, after the earlier ones', () => {
    const db = freshDatabase();
    migrate(db);
    migrate(db, migrationsWith({ '0002-add-notes.sql': 'CREATE TABLE notes (id TEXT) STRICT;' }));
    expect(applied(db).map((row) => row.version)).toEqual([1, 2]);
    expect(tableNames(db)).toContain('notes');
  });

  it('ARCH-050: a migration that fails rolls back, and so does its migrations row', () => {
    const db = freshDatabase();
    migrate(db);
    const broken = migrationsWith({
      '0002-broken.sql':
        'CREATE TABLE notes (id TEXT) STRICT; INSERT INTO no_such_table VALUES (1);',
    });
    expect(() => {
      migrate(db, broken);
    }).toThrow(/no such table/);
    expect(applied(db).map((row) => row.version)).toEqual([1]);
    expect(tableNames(db)).not.toContain('notes');
  });

  it('ARCH-050: a database from a newer Mythos is refused with a clear message', () => {
    const db = freshDatabase();
    migrate(db, migrationsWith({ '0002-add-notes.sql': 'CREATE TABLE notes (id TEXT) STRICT;' }));
    expect(() => {
      migrate(db);
    }).toThrow(/newer version of Mythos .*migration 2; this version has 1.*Update Mythos/);
  });
});

describe('readMigrations', () => {
  it('ARCH-050: reads the shipped migrations in order', () => {
    expect(readMigrations(MIGRATIONS_DIR).map((m) => [m.version, m.file])).toEqual([
      [1, '0001-initial.sql'],
    ]);
  });

  it('ARCH-050: a gap in the numbers or a misnamed file is refused', () => {
    expect(() => readMigrations(migrationsWith({ '0003-skip.sql': '' }))).toThrow(
      /0003-skip.sql: expected number 0002/,
    );
    expect(() => readMigrations(migrationsWith({ '2-notes.sql': '' }))).toThrow(
      /2-notes.sql: name it NNNN-words.sql/,
    );
  });
});
