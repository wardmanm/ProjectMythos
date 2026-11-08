import type { ModelCallRecord, TurnView } from '@mythos/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sendEvent, turnAt, turnUrl } from '@/features/play/play-testing';
import { answer } from '@/test/fake-fetch';
import { setDeviceWidth } from '@/test/fake-match-media';
import { campaignId, campaignView } from '@/test/fixtures';
import { currentPath, renderApp } from '@/test/render-app';
import {
  narrationCall,
  narrationCallId,
  recordedCall,
  recordedCallId,
  summaryOf,
} from './inspector-testing';

const inspected = turnAt(1);
const turnId = inspected.turn.id;
const inspectorPath = `/c/${campaignId}/inspector/${turnId}`;
const callsUrl = `/api/campaigns/${campaignId}/turns/${turnId}/model-calls`;

/** Answers the inspector's requests for the turn and its model calls. */
function answerCalls(calls: ModelCallRecord[], view: TurnView = inspected): void {
  answer('GET', `/api/campaigns/${campaignId}`, { status: 200, body: campaignView() });
  answer('GET', turnUrl(turnId), { status: 200, body: view });
  answer('GET', callsUrl, { status: 200, body: calls.map(summaryOf) });
  for (const call of calls) {
    answer('GET', `/api/campaigns/${campaignId}/model-calls/${call.id}`, {
      status: 200,
      body: call,
    });
  }
}

async function openInspector(search = '') {
  answerCalls([recordedCall(turnId), narrationCall(turnId)]);
  const app = renderApp(inspectorPath + search);
  await screen.findByRole('heading', { level: 2, name: /call to/ });
  return app;
}

describe('InspectorScreen', () => {
  it("UI-090: the call list shows each call's role, model, duration, tokens, and outcome", async () => {
    await openInspector();
    const rows = within(screen.getByRole('table', { name: 'Model calls' })).getAllByRole('row');
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole(row.querySelector('td') === null ? 'columnheader' : 'cell')
        .map((cell) => cell.textContent),
    );
    expect(cells[0]).toEqual(['Role', 'Model', 'Duration', 'Tokens', 'Outcome', 'Attempts']);
    expect(cells[1]).toEqual([
      'qwen2.5:32b-instruct-q4_K_M',
      '3.2 s',
      '6,420 in · 18 out',
      'Succeeded',
      '2',
    ]);
    expect(cells[2]).toEqual([
      'qwen2.5:32b-instruct-q4_K_M',
      '1 min 1 s',
      'Not reported',
      'Succeeded',
      '2',
    ]);
    expect(within(rows[1] as HTMLElement).getByRole('link').textContent).toBe('Adjudicator');
    expect(within(rows[2] as HTMLElement).getByRole('link').textContent).toBe('Narrator');
  });

  it('UI-042: on a phone the call list is stacked rows, not a table', async () => {
    setDeviceWidth(390);
    await openInspector();
    expect(screen.queryByRole('table')).toBeNull();
    const items = within(screen.getByRole('list', { name: 'Model calls' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(within(first).getByRole('link', { name: 'Adjudicator' })).toBeDefined();
    expect(within(first).getByText('Duration').tagName).toBe('DT');
    expect(within(first).getByText('6,420 in · 18 out').tagName).toBe('DD');
  });

  for (const width of [1440, 390]) {
    it(`UI-090: the Prompt tab shows each tier's budget bar, estimate, trims, and cache mark, at ${String(width)} px`, async () => {
      setDeviceWidth(width);
      await openInspector();
      expect(screen.getByRole('tab', { name: 'Prompt', selected: true })).toBeDefined();
      const tiers = ['Instructions', 'World', 'Transcript', 'Turn'].map((name) =>
        screen.getByRole('region', { name: `${name} tier` }),
      );
      const world = within(tiers[1] as HTMLElement);
      const meter = world.getByRole('meter');
      expect(meter.getAttribute('aria-valuenow')).toBe('1204');
      expect(meter.getAttribute('aria-valuemax')).toBe('1500');
      expect(world.getByText('1,204 of 1,500 tokens')).toBeDefined();
      expect(world.getByText('Nothing trimmed')).toBeDefined();
      const transcript = within(tiers[2] as HTMLElement);
      expect(transcript.getByText('turns 1 to 8, rolled into a summary')).toBeDefined();
      const turn = within(tiers[3] as HTMLElement);
      expect(turn.getByText('340 of 300 tokens, over budget')).toBeDefined();
      const cached = tiers.map((tier) => within(tier).queryByText('Cached prefix') !== null);
      expect(cached).toEqual([true, true, true, false]);
      expect(screen.getAllByText('Cache breakpoint after this message')).toHaveLength(1);
      expect(screen.getByText('I ask Varek what happened to the Merrow’s Luck.')).toBeDefined();
    });

    it(`UI-090: the Output tab shows raw output, thinking, parsed output, and both attempts with their issues, at ${String(width)} px`, async () => {
      setDeviceWidth(width);
      await openInspector(`?call=${recordedCallId}&tab=output`);
      const raw = screen.getByRole('region', { name: 'Raw output' });
      expect(within(raw).getByText('{"kind":"direct","outcome":"success"}')).toBeDefined();
      const thinking = screen.getByRole('region', { name: 'Thinking' });
      expect(within(thinking).getByText('Varek has no reason to hide this.')).toBeDefined();
      const parsed = screen.getByRole('region', { name: 'Parsed output' });
      expect(parsed.querySelector('pre')?.textContent).toBe(
        JSON.stringify({ kind: 'direct', outcome: 'success' }, null, 2),
      );
      const first = within(screen.getByRole('region', { name: 'Attempt 1' }));
      expect(first.getByText('JSON schema · 2.1 s · 6,346 in · 21 out')).toBeDefined();
      expect(first.getByText('stakes: expected an object')).toBeDefined();
      expect(first.getByText(/The ruleset has no stat "charm"\./)).toBeDefined();
      expect(first.getByText('Output of attempt 1')).toBeDefined();
      const second = within(screen.getByRole('region', { name: 'Attempt 2' }));
      expect(second.getByText('No issues')).toBeDefined();
    });
  }

  it("UI-090: a narration call has nothing parsed, and its timed-out attempt shows the provider's error", async () => {
    await openInspector(`?call=${narrationCallId}&tab=output`);
    const parsed = screen.getByRole('region', { name: 'Parsed output' });
    expect(parsed.textContent).toContain('A text call has nothing to parse');
    const first = within(screen.getByRole('region', { name: 'Attempt 1' }));
    expect(first.getByText('provider_timeout')).toBeDefined();
    expect(first.getByText(/No answer within 60 seconds\./)).toBeDefined();
  });

  it('UI-001: the chosen call and tab are in the address, and choosing either changes it', async () => {
    const app = await openInspector(`?call=${narrationCallId}&tab=output`);
    expect(screen.getByRole('heading', { level: 2, name: /^Narrator call/ })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Narrator' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Output', selected: true })).toBeDefined();

    await app.user.click(screen.getByRole('tab', { name: 'Prompt' }));
    expect(currentPath(app)).toBe(`${inspectorPath}?call=${narrationCallId}&tab=prompt`);
    await app.user.click(screen.getByRole('link', { name: 'Adjudicator' }));
    expect(currentPath(app)).toBe(`${inspectorPath}?call=${recordedCallId}&tab=prompt`);
    expect(
      await screen.findByRole('heading', { level: 2, name: /^Adjudicator call/ }),
    ).toBeDefined();
  });

  it('UI-042: text from a record wraps anywhere, so long lines never scroll the screen sideways', async () => {
    await openInspector(`?call=${recordedCallId}&tab=output`);
    const blocks = [...document.querySelectorAll('pre')];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.className.split(' ')).toEqual(
        expect.arrayContaining(['whitespace-pre-wrap', 'wrap-anywhere', 'min-w-0']),
      );
    }
  });

  it("UI-090: the call list is fetched again when the turn's status changes", async () => {
    const writing = turnAt(1, { status: 'narrating', narration: null });
    answerCalls([], writing);
    renderApp(inspectorPath);
    expect(await screen.findByText('This turn has no model calls yet.')).toBeDefined();
    answerCalls([narrationCall(turnId)], writing);
    await sendEvent({ type: 'turn.status', turnId, status: 'complete' });
    expect(await screen.findByRole('link', { name: 'Narrator' })).toBeDefined();
  });
});
