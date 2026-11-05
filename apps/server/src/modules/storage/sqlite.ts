// The only file that imports node:sqlite (CONV-055, ADR-012). Everything else in
// storage uses the small `Database` interface below, so the driver can be replaced
// here alone.
//
// `DatabaseSync` rather than `Database`: @types/node declares only the older names,
// and at runtime the two are the same class (ADR-012).
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/** A value SQLite can bind. Booleans are not among them: store 0 or 1. */
export type SqlValue = null | number | bigint | string | Uint8Array;

/**
 * Named parameters, written `:name` in the SQL and `{ name }` here. A parameter the
 * SQL names but this object leaves out binds as NULL, so pass every one.
 */
export type SqlParams = Readonly<Record<string, SqlValue>>;

/** A prepared statement. Rows come back as `unknown`, to be parsed (CONV-051). */
export type Statement = {
  run(params?: SqlParams): { changes: number };
  get(params?: SqlParams): unknown;
  all(params?: SqlParams): unknown[];
};

/** One open campaign database. */
export type Database = {
  /** The file this connection has open. */
  readonly path: string;
  /** False once `close` has run. */
  readonly isOpen: boolean;
  /** Runs one or more statements with no parameters, such as a migration. */
  exec(sql: string): void;
  prepare(sql: string): Statement;
  /**
   * Runs `fn` inside `BEGIN IMMEDIATE`: it commits if `fn` returns and rolls back if
   * it throws. `fn` must be synchronous, and transactions do not nest.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
};

// How long a write waits for another connection's lock before failing. Only one
// server holds a campaign, so this covers a stray tool such as the sqlite3 shell.
const BUSY_TIMEOUT_MS = 5000;

const JournalModeRowSchema = z.object({ journal_mode: z.string() });

function wrapStatement(statement: ReturnType<DatabaseSync['prepare']>): Statement {
  return {
    run: (params = {}) => ({ changes: Number(statement.run(params).changes) }),
    get: (params = {}): unknown => statement.get(params),
    all: (params = {}): unknown[] => statement.all(params),
  };
}

/**
 * Opens (or creates) the SQLite file at `file` in WAL mode with foreign keys on and a
 * busy timeout. `synchronous` stays at SQLite's default, FULL, so a committed turn
 * survives a power cut (TRN-011). Opening a missing file creates it: callers that
 * expect an existing campaign check first.
 */
export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    const mode = JournalModeRowSchema.parse(db.prepare('PRAGMA journal_mode = WAL').get());
    if (mode.journal_mode !== 'wal') {
      throw new Error(`${file}: SQLite would not use WAL mode (got "${mode.journal_mode}")`);
    }
    db.exec('PRAGMA foreign_keys = ON');
  } catch (error) {
    db.close();
    throw error;
  }

  function rollbackIfOpen(): void {
    // SQLite ends the transaction itself after some errors; a failed statement
    // otherwise leaves it open, so roll back here.
    if (db.isTransaction) db.exec('ROLLBACK');
  }

  // Implements ARCH-041: all or nothing.
  function transaction<T>(fn: () => T): T {
    if (db.isTransaction) {
      throw new Error('transaction: already inside a transaction; transactions do not nest');
    }
    db.exec('BEGIN IMMEDIATE');
    let result: T;
    try {
      result = fn();
    } catch (error) {
      rollbackIfOpen();
      throw error;
    }
    if (result instanceof Promise) {
      // Work after the first await would run outside the transaction.
      rollbackIfOpen();
      throw new Error('transaction: fn returned a Promise; it must be synchronous');
    }
    try {
      db.exec('COMMIT');
    } catch (error) {
      rollbackIfOpen();
      throw error;
    }
    return result;
  }

  return {
    path: file,
    get isOpen() {
      return db.isOpen;
    },
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    transaction,
    close: () => {
      db.close();
    },
  };
}
