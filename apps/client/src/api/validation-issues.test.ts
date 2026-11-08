import { describe, expect, it } from 'vitest';
import { apiError } from './api-failure';
import { validationIssuesOf } from './validation-issues';

const issues = [
  { path: 'providers.0.baseUrl', message: 'Invalid URL' },
  { path: 'modelProfiles.1.contextWindow', message: 'Too small' },
];

function serverFailure(code: 'validation_failed' | 'conflict', details?: unknown): Error {
  const error = details === undefined ? { code, message: 'x' } : { code, message: 'x', details };
  return apiError({ kind: 'server', status: 400, error });
}

describe('validationIssuesOf', () => {
  it('CON-091: every issue of a validation_failed answer is read, with its dotted path', () => {
    expect(validationIssuesOf(serverFailure('validation_failed', { issues }))).toEqual(issues);
  });

  it('CON-091: another code, missing details, or malformed details give no issues', () => {
    expect(validationIssuesOf(serverFailure('conflict', { issues }))).toEqual([]);
    expect(validationIssuesOf(serverFailure('validation_failed'))).toEqual([]);
    expect(validationIssuesOf(serverFailure('validation_failed', { issues: 'x' }))).toEqual([]);
    expect(validationIssuesOf(apiError({ kind: 'unreachable', detail: 'down' }))).toEqual([]);
    expect(validationIssuesOf(new Error('not an API failure'))).toEqual([]);
  });
});
