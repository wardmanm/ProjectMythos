import { SemanticIssueSchema, type SemanticIssue } from '@mythos/contracts';
import { z } from 'zod';
import { apiFailureOf } from './api-failure';

const IssuesDetailsSchema = z.object({ issues: z.array(SemanticIssueSchema) });

/**
 * Every issue a `validation_failed` answer lists, each with its dotted path into the
 * request body, so a form can show each one at its field. Empty for any other failure,
 * and when the details are missing or malformed.
 */
// Implements CON-091 on the client: the issues are read from `details.issues`.
export function validationIssuesOf(thrown: unknown): SemanticIssue[] {
  const failure = apiFailureOf(thrown);
  if (failure?.kind !== 'server' || failure.error.code !== 'validation_failed') return [];
  const parsed = IssuesDetailsSchema.safeParse(failure.error.details);
  return parsed.success ? parsed.data.issues : [];
}
