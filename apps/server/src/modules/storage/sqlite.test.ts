import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type Database, openDatabase } from './sqlite';
import { createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

function freshDatabase(): Database {
  const db = space.track(openDatabase(path.join(space.folder(), 'test.sqlite')));
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL) STRICT');
  return db;
}

const CountSchema = z.object({ count: z.int() });
function countNotes(db: Database): number {
  return CountSchema.parse(db.prepare('SELECT COUNT(*) AS count FROM notes').get()).count;
}
const insertNote = (db: Database, text: string) =>
  db.prepare('INSERT INTO notes (text) VALUES (:text)').run({ text });

describe('openDatabase', () => {
  it('CONV-055: opens in WAL mode with foreign keys on', () => {
    const db = freshDatabase();
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    // FULL, so a committed turn survives a power cut (TRN-011).
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
  });

  it('CONV-055: prepared statements bind named parameters and return plain rows', () => {
    const db = freshDatabase();
    expect(insertNote(db, 'first').changes).toBe(1);
    insertNote(db, 'second');
    expect(db.prepare('SELECT text FROM notes WHERE id = :id').get({ id: 2 })).toEqual({
      text: 'second',
    });
    expect(db.prepare('SELECT text FROM notes WHERE id = :id').get({ id: 9 })).toBeUndefined();
    expect(db.prepare('SELECT text FROM notes ORDER BY id').all()).toEqual([
      { text: 'first' },
      { text: 'second' },
    ]);
  });

  it('CONV-055: close ends the connection', () => {
    const db = freshDatabase();
    expect(db.isOpen).toBe(true);
    db.close();
    expect(db.isOpen).toBe(false);
  });
});

describe('transaction', () => {
  it('ARCH-041: commits everything when fn returns', () => {
    const db = freshDatabase();
    const result = db.transaction(() => {
      insertNote(db, 'one');
      insertNote(db, 'two');
      return 'done';
    });
    expect(result).toBe('done');
    expect(countNotes(db)).toBe(2);
  });

  it('ARCH-041: an error thrown inside leaves no rows behind', () => {
    const db = freshDatabase();
    expect(() =>
      db.transaction(() => {
        insertNote(db, 'one');
        throw new Error('stop here');
      }),
    ).toThrow('stop here');
    expect(countNotes(db)).toBe(0);
  });

  it('ARCH-041: a failing statement rolls back the writes before it', () => {
    const db = freshDatabase();
    expect(() => {
      db.transaction(() => {
        insertNote(db, 'one');
        db.prepare('INSERT INTO notes (id, text) VALUES (:id, :text)').run({ id: 1, text: 'x' });
      });
    }).toThrow(/UNIQUE/);
    expect(countNotes(db)).toBe(0);
    // The connection is usable afterwards: the rollback ended the transaction.
    insertNote(db, 'after');
    expect(countNotes(db)).toBe(1);
  });

  it('ARCH-041: a nested transaction throws, and the outer one rolls back', () => {
    const db = freshDatabase();
    expect(() => {
      db.transaction(() => {
        insertNote(db, 'outer');
        db.transaction(() => insertNote(db, 'inner'));
      });
    }).toThrow('transactions do not nest');
    expect(countNotes(db)).toBe(0);
  });

  it('ARCH-041: an async fn is refused and its writes are rolled back', () => {
    const db = freshDatabase();
    expect(() =>
      db.transaction(async () => {
        insertNote(db, 'before the first await');
        await Promise.resolve();
      }),
    ).toThrow('must be synchronous');
    expect(countNotes(db)).toBe(0);
  });
});
