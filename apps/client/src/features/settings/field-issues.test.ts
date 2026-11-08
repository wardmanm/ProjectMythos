import { describe, expect, it } from 'vitest';
import { machineConfig } from '@/test/settings-fixtures';
import { fieldIssuesOf, issuesAt, issuesExactlyAt } from './field-issues';
import { draftFrom, newProvider, removeItem } from './settings-draft';

const lmStudio = {
  id: 'lm-studio',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  deviceId: 'macbook-gpu',
} as const;

describe('fieldIssuesOf', () => {
  it("CON-091: an index in an issue's path becomes its item's key", () => {
    const draft = draftFrom(machineConfig());
    const [issue] = fieldIssuesOf([{ path: 'providers.0.baseUrl', message: 'Invalid URL' }], draft);
    const key = draft.providers[0]?.key ?? '';
    expect(issue).toEqual({
      address: `providers.${key}.baseUrl`,
      where: 'Provider ollama-local, baseUrl',
      message: 'Invalid URL',
    });
  });

  it('CON-091: an issue stays on its item after an earlier item is removed', () => {
    const config = machineConfig({
      providers: [
        { id: 'ollama-local', type: 'ollama', baseUrl: 'http://x', deviceId: 'macbook-gpu' },
        lmStudio,
      ],
    });
    const sent = draftFrom(config);
    const issues = fieldIssuesOf([{ path: 'providers.1.baseUrl', message: 'Invalid URL' }], sent);
    const studioKey = sent.providers[1]?.key ?? '';
    const ollamaKey = sent.providers[0]?.key ?? '';

    const after = removeItem(sent.providers, ollamaKey);
    expect(after[0]?.key).toBe(studioKey);
    expect(issuesAt(issues, `providers.${studioKey}.baseUrl`)).toHaveLength(1);
    expect(issuesAt(issues, `providers.${ollamaKey}`)).toHaveLength(0);
  });

  it('CON-091: an issue that names no item keeps its path, and the whole body has words', () => {
    const draft = draftFrom(machineConfig());
    const issues = fieldIssuesOf(
      [
        { path: '', message: 'Expected an object' },
        { path: 'roles.narrator.profileId', message: 'Unknown profile' },
        { path: 'providers.7.id', message: 'No such item' },
        { path: 'devices', message: 'Too small' },
      ],
      draft,
    );
    expect(issues.map((issue) => [issue.address, issue.where])).toEqual([
      ['', 'The settings as a whole'],
      ['roles.narrator.profileId', 'roles.narrator.profileId'],
      ['providers.7.id', 'providers.7.id'],
      ['devices', 'devices'],
    ]);
  });

  it('CON-091: an item new in the draft is named by its id, or as having none', () => {
    const base = draftFrom(machineConfig());
    const added = { ...newProvider(base), value: { ...newProvider(base).value, id: '' } };
    const draft = { ...base, providers: [...base.providers, added] };
    const [issue] = fieldIssuesOf([{ path: 'providers.1.id', message: 'Invalid' }], draft);
    expect(issue?.where).toBe('Provider with no id, id');
    expect(issue?.address).toBe(`providers.${added.key}.id`);
  });

  it('CON-091: a field shows the issues at and below it; a card only its own', () => {
    const issues = [
      { address: 'providers.k1', where: '', message: 'a' },
      { address: 'providers.k1.apiKey.value', where: '', message: 'b' },
      { address: 'providers.k10', where: '', message: 'c' },
    ];
    expect(issuesAt(issues, 'providers.k1').map((issue) => issue.message)).toEqual(['a', 'b']);
    expect(issuesExactlyAt(issues, 'providers.k1').map((issue) => issue.message)).toEqual(['a']);
  });
});
