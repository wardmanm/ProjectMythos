import type {
  EntityId,
  EntityWikiPage,
  GameTime,
  KnowledgeGrant,
  Observation,
  ReadPoint,
  Relationship,
  RetrievedObservation,
} from '@mythos/contracts';

/** An observation as one entity knows it. */
export type KnownObservation = {
  observation: Observation; // amendments applied; conflicted commits excluded (TRN-072)
  via: KnowledgeGrant['via'];
  viaObservationId: string | null;
  knownSince: GameTime;
};

export type RetrievalRequest = {
  knowerId: EntityId; // whose memory to search
  queryText: string; // usually the player's input; embedded for relevance
  focusEntityIds: EntityId[]; // present or mentioned entities (MEM-077)
  pcId: EntityId; // memories involving the PC get the pc weight and pinning
  tokenBudget: number; // from the context tier (09-context)
};

/**
 * The memory module's read API (MEM §6). Every function is scoped to a read point
 * (ARCH-043, TRN-062). Results never include anything the point cannot see.
 */
export type MemoryQueries = {
  /** Observations an entity knows, newest first. */
  knownObservations(
    point: ReadPoint,
    entityId: EntityId,
    filter?: { involvingEntityId?: EntityId; since?: GameTime; limit?: number },
  ): KnownObservation[];

  /** How an entity knows an observation, or null if it does not. */
  knows(point: ReadPoint, entityId: EntityId, observationId: string): KnownObservation | null;

  /** Everyone who knows an observation (GM mode, consolidation). */
  knowersOf(
    point: ReadPoint,
    observationId: string,
  ): { entityId: EntityId; via: KnowledgeGrant['via'] }[];

  /** Truth-level page: canon plus learned sections (MEM §5). */
  wikiPage(point: ReadPoint, entityId: EntityId): EntityWikiPage;

  relationship(point: ReadPoint, fromId: EntityId, toId: EntityId): Relationship | null;
  relationshipsFrom(point: ReadPoint, fromId: EntityId): Relationship[];

  /** Ranked, budgeted memories for one knower (MEM §6.3–6.4). */
  retrieve(point: ReadPoint, request: RetrievalRequest): Promise<RetrievedObservation[]>;

  /**
   * Entities named in text by name or alias, limited to those the knower has encountered:
   * a name the PC has never heard is not matched (MEM-077).
   */
  resolveMentions(point: ReadPoint, text: string, knowerId: EntityId): EntityId[];
};
