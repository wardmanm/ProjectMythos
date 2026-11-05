import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonColumn, parseRow, sqliteBoolean, TurnRowSchema } from './rows';
import { TEST_NOW } from './testing';

describe('row parsing', () => {
  const turnRow = {
    id: randomUUID(),
    parent_turn_id: null,
    depth: 0,
    status: 'complete',
    game_time_start: 0,
    copied_from_turn_id: null,
    created_at: TEST_NOW.toISOString(),
  };

  it('CONV-051: a row maps its snake_case columns to the contract type', () => {
    expect(parseRow('turns', TurnRowSchema, turnRow, ['id'])).toEqual({
      id: turnRow.id,
      parentTurnId: null,
      depth: 0,
      status: 'complete',
      gameTimeStart: 0,
      copiedFromTurnId: null,
      createdAt: turnRow.created_at,
    });
  });

  it('CONV-051: a bad row fails with the table, the row, and each problem', () => {
    expect(() =>
      parseRow('turns', TurnRowSchema, { ...turnRow, status: 'paused', depth: -1 }, ['id']),
    ).toThrow(
      new RegExp(`^turns row id=${turnRow.id} is invalid: depth: .*; status: Invalid option`),
    );
  });

  it('CONV-051: a JSON column is parsed with its schema, and bad JSON is a clear problem', () => {
    const column = z.object({ tags: jsonColumn(z.array(z.string())) });
    expect(parseRow('t', column, { tags: '["a","b"]' }, [])).toEqual({ tags: ['a', 'b'] });
    expect(() => parseRow('t', column, { id: 7, tags: '["a",' }, ['id'])).toThrow(
      /^t row id=7 is invalid: tags: not valid JSON/,
    );
    expect(() => parseRow('t', column, { id: 7, tags: '[1]' }, ['id'])).toThrow(
      /^t row id=7 is invalid: tags.0: Invalid input: expected string/,
    );
  });

  it('CONV-051: a boolean column holds 0 or 1 only', () => {
    expect(sqliteBoolean.parse(1)).toBe(true);
    expect(sqliteBoolean.parse(0)).toBe(false);
    expect(sqliteBoolean.safeParse(2).success).toBe(false);
  });
});
