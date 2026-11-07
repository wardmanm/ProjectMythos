// The path parameters the routes take. Campaigns, turns, branches, and model calls are
// named by UUID; providers and profiles by their machine-config IDs. A parameter that
// fails its schema is `not_found` (`parseParams` in `errors.ts`).
import { IdSchema } from '@mythos/contracts';
import { z } from 'zod';

export const CampaignParamsSchema = z.object({ campaignId: IdSchema });

export const TurnParamsSchema = z.object({ campaignId: IdSchema, turnId: IdSchema });

export const BranchParamsSchema = z.object({ campaignId: IdSchema, branchId: IdSchema });

export const CallParamsSchema = z.object({ campaignId: IdSchema, callId: IdSchema });

export const ProviderParamsSchema = z.object({ providerId: z.string().min(1) });

export const ProfileParamsSchema = z.object({ profileId: z.string().min(1) });
