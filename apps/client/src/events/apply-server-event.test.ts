import { ResolutionDraftSchema, type TurnView } from '@mythos/contracts';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import type { Notice } from '@/stores/notice-store';
import { branchId, campaignId, otherCampaignId, turnId, turnView } from '@/test/fixtures';
import { applyServerEvent, type EventContext } from './apply-server-event';

const otherTurnId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e05';
const otherBranchId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e06';
const setId = '6f1c0b9e-3a52-4d7e-9a61-2b8f4c1d0e07';

let queryClient: QueryClient;
let notices: Notice[];
let context: EventContext;

beforeEach(() => {
  queryClient = new QueryClient();
  notices = [];
  context = { queryClient, campaignId, notify: (notice) => notices.push(notice) };
});

const turnKey = queryKeys.turn(campaignId, turnId);
const listKey = queryKeys.turns(campaignId, branchId);

/** Caches the turn on its own and in its branch's list, beside another turn. */
function cacheTurn(text: string | null): void {
  queryClient.setQueryData(turnKey, turnView(text));
  queryClient.setQueryData(listKey, [turnView('Earlier.', { id: otherTurnId }), turnView(text)]);
}

function cachedTurn(): TurnView | undefined {
  return queryClient.getQueryData<TurnView>(turnKey);
}

function listedTurn(id = turnId): TurnView | undefined {
  return queryClient.getQueryData<TurnView[]>(listKey)?.find((view) => view.turn.id === id);
}

function isInvalidated(key: QueryKey): boolean {
  return queryClient.getQueryState(key)?.isInvalidated === true;
}

/** Caches each key, so invalidating it can be seen. */
function cacheKeys(keys: QueryKey[]): void {
  for (const key of keys) queryClient.setQueryData(key, { cached: true });
}

describe('applyServerEvent', () => {
  it('ARCH-120, UI-101: turn.status patches the turn wherever it is cached, and nothing else', () => {
    cacheTurn('The fog ');
    applyServerEvent(context, { type: 'turn.status', turnId, status: 'complete' });
    expect(cachedTurn()?.turn.status).toBe('complete');
    expect(listedTurn()?.turn.status).toBe('complete');
    expect(listedTurn(otherTurnId)?.turn.status).toBe('narrating');
    expect(isInvalidated(turnKey)).toBe(false);
  });

  it('UI-101: resolution.ready puts the draft on the cached turn', () => {
    cacheTurn(null);
    const draft = ResolutionDraftSchema.parse({
      turnId,
      rulingSetId: setId,
      actionRoll: null,
      outcome: 'partial',
      effect: 'standard',
      consequences: [],
      resistanceRolls: [],
      harmResults: [],
      clockResults: [],
      statChanges: [],
      healing: [],
      invalidConsequences: [],
      elapsedMinutes: 5,
      overridden: false,
      requiresResponse: true,
    });
    applyServerEvent(context, { type: 'resolution.ready', draft });
    expect(cachedTurn()?.draft?.outcome).toBe('partial');
    expect(listedTurn()?.draft?.outcome).toBe('partial');
  });

  it("UI-101: turn.created refetches the branch's turns and the campaign", () => {
    const otherList = queryKeys.turns(campaignId, otherBranchId);
    cacheKeys([listKey, otherList, queryKeys.campaign(campaignId)]);
    applyServerEvent(context, { type: 'turn.created', branchId, turnId });
    expect(isInvalidated(listKey)).toBe(true);
    expect(isInvalidated(queryKeys.campaign(campaignId))).toBe(true);
    expect(isInvalidated(otherList)).toBe(false);
  });

  it("UI-101: branch.changed refetches the branch's turns and the campaign", () => {
    const otherList = queryKeys.turns(campaignId, otherBranchId);
    cacheKeys([listKey, otherList, queryKeys.campaign(campaignId)]);
    applyServerEvent(context, { type: 'branch.changed', branchId, headTurnId: turnId });
    expect(isInvalidated(listKey)).toBe(true);
    expect(isInvalidated(queryKeys.campaign(campaignId))).toBe(true);
    expect(isInvalidated(otherList)).toBe(false);
  });

  it('UI-101: narration.delta writes its text at its offset in every cached copy of the turn', () => {
    cacheTurn('The fog has');
    applyServerEvent(context, { type: 'narration.delta', turnId, offset: 8, text: 'has followed' });
    expect(cachedTurn()?.narration).toEqual({ text: 'The fog has followed', complete: false });
    expect(listedTurn()?.narration?.text).toBe('The fog has followed');
    expect(listedTurn(otherTurnId)?.narration?.text).toBe('Earlier.');
    expect(isInvalidated(turnKey)).toBe(false);
  });

  it('UI-132: a delta past the end of the cached text refetches the turn', () => {
    cacheTurn('The fog ');
    applyServerEvent(context, { type: 'narration.delta', turnId, offset: 21, text: 'you in.' });
    expect(cachedTurn()?.narration?.text).toBe('The fog ');
    expect(isInvalidated(turnKey)).toBe(true);
    expect(isInvalidated(listKey)).toBe(true);
  });

  it('UI-101: narration.done refetches the turn, and each list holding it', () => {
    cacheTurn('The fog has followed you in.');
    const otherList = queryKeys.turns(campaignId, otherBranchId);
    queryClient.setQueryData(otherList, [turnView('Elsewhere.', { id: otherTurnId })]);
    applyServerEvent(context, { type: 'narration.done', turnId });
    expect(isInvalidated(turnKey)).toBe(true);
    expect(isInvalidated(listKey)).toBe(true);
    expect(isInvalidated(otherList)).toBe(false);
  });

  it('UI-101: state.changed refetches the scene, the affected sheets, and the journal', () => {
    const scene = queryKeys.scene(campaignId, branchId);
    const varek = queryKeys.sheet(campaignId, 'npc.varek');
    const wren = queryKeys.sheet(campaignId, 'pc.wren');
    const journal = queryKeys.journal(campaignId, 'npc.varek');
    cacheKeys([scene, varek, wren, journal, turnKey]);
    applyServerEvent(context, {
      type: 'state.changed',
      turnId,
      commitSetId: setId,
      affectedEntityIds: ['npc.varek'],
    });
    expect([scene, varek, journal].map(isInvalidated)).toEqual([true, true, true]);
    expect(isInvalidated(wren)).toBe(false);
    expect(isInvalidated(turnKey)).toBe(false);
  });

  it('UI-101: error for a turn refetches it; one for no turn shows a notice in plain words', () => {
    cacheTurn('The fog ');
    const error = { code: 'provider_timeout' as const, message: 'timed out' };
    applyServerEvent(context, { type: 'error', turnId, error });
    expect(isInvalidated(turnKey)).toBe(true);
    expect(notices).toEqual([]);

    applyServerEvent(context, { type: 'error', turnId: null, error });
    expect(notices).toEqual([
      {
        tone: 'failure',
        text: 'The model took too long to answer. Try again, or choose a faster model in Settings.',
      },
    ]);
  });

  it('UI-101: job.updated changes nothing in phase 1', () => {
    cacheTurn('The fog ');
    const before = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state);
    applyServerEvent(context, {
      type: 'job.updated',
      job: {
        id: setId,
        type: 'extraction',
        priority: 'extraction',
        deviceId: 'local',
        status: 'running',
        attempts: 1,
        turnId,
        createdAt: '2026-11-05T10:00:00Z',
        updatedAt: '2026-11-05T10:00:01Z',
      },
    });
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state),
    ).toEqual(before);
  });

  it('UI-101, UI-132: resync.required refetches everything for the campaign, and nothing else', () => {
    const mine = [
      queryKeys.campaign(campaignId),
      listKey,
      turnKey,
      queryKeys.scene(campaignId, branchId),
      queryKeys.journal(campaignId),
    ];
    const others = [queryKeys.campaigns(), queryKeys.campaign(otherCampaignId)];
    cacheKeys([...mine, ...others]);
    applyServerEvent(context, { type: 'resync.required' });
    expect(mine.map(isInvalidated)).toEqual(mine.map(() => true));
    expect(others.map(isInvalidated)).toEqual([false, false]);
  });
});
