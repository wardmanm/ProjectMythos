import { readFileSync } from 'node:fs';
import { WorkflowMappingSchema, SpeechSegmentsSchema } from '@mythos/contracts';
import type { ContentSettings } from '@mythos/contracts/content';
import { applyMapping, assignVoice, contentNegatives, mappingIssues, segmentIssues, takeSentences, type ComfyWorkflow } from './media';
import { eq, fixturePath } from '../test-support/harness';

// ---- ComfyUI
const wf: ComfyWorkflow = JSON.parse(readFileSync(fixturePath('test/workflows/portrait.api.json'), 'utf8'));
const map = WorkflowMappingSchema.parse(JSON.parse(readFileSync(fixturePath('test/workflows/portrait.mapping.json'), 'utf8')));
eq('mapping fits the workflow', mappingIssues(wf, map), []);
const out = applyMapping(wf, map, { prompt: 'portrait of a lean harbor clerk', negativePrompt: 'nsfw', seed: 42, width: 832, height: 1216, loraName: 'varek.safetensors', loraStrength: 0.8 });
eq('parameters land in their nodes', [out['6']!.inputs.text, out['7']!.inputs.text, out['3']!.inputs.seed, out['5']!.inputs.width, out['10']!.inputs.lora_name, out['10']!.inputs.strength_model],
  ['portrait of a lean harbor clerk', 'nsfw', 42, 832, 'varek.safetensors', 0.8]);
eq('links are untouched and the original is not mutated', [out['3']!.inputs.positive, wf['6']!.inputs.text], [['6', 0], '']);
const broken = WorkflowMappingSchema.parse({ ...map, inputs: { ...map.inputs, prompt: { node: '6', input: 'clip' }, seed: { node: '30', input: 'seed' }, width: { node: '5', input: 'w' } }, output: { node: '99' } });
eq('a broken mapping reports every problem', mappingIssues(wf, broken), [
  'prompt: 6.clip is a link to another node, not a value',
  'seed: node 30 is not in the workflow',
  'width: node 5 (EmptyLatentImage) has no input "w"',
  'output: node 99 is not in the workflow']);

// ---- content in images
const s = (sexual: string, gore = 'moderate', violence = 'moderate', disturbing = 'moderate') =>
  ({ violence, gore, sexual, language: 'moderate', disturbing, lines: [], veils: [] }) as ContentSettings;
eq('fade-to-black sexual adds NSFW negatives', contentNegatives(s('fade-to-black'), false), ['nsfw', 'nudity', 'sexual content', 'suggestive']);
eq('explicit adult image: no sexual negatives', contentNegatives(s('explicit'), false), []);
eq('a minor in the image: full negatives even when the campaign is explicit', contentNegatives(s('explicit'), true),
  ['nsfw', 'nudity', 'sexual content', 'suggestive', 'revealing clothing', 'sexualized']);
eq('gore off adds gore negatives', contentNegatives(s('explicit', 'off'), false), ['gore', 'blood', 'open wounds']);

// ---- speech segmentation
const narration = 'He sets down his pen. "A squall off the point," he says. "Nothing more." Odette looks at her hands.';
const segs = SpeechSegmentsSchema.parse({ segments: [
  { speaker: 'narrator', text: 'He sets down his pen.' }, { speaker: 'npc.varek', text: '"A squall off the point,"' },
  { speaker: 'narrator', text: 'he says.' }, { speaker: 'npc.varek', text: '"Nothing more."' }, { speaker: 'narrator', text: 'Odette looks at her hands.' }] });
const present = new Set(['npc.varek', 'npc.odette', 'pc.wren']);
eq('an exact segmentation passes', segmentIssues(narration, segs.segments, present), []);
const paraphrased = segs.segments.map((x, i) => (i === 3 ? { ...x, text: '"That is all."' } : x));
const para = segmentIssues(narration, paraphrased, present)[0] ?? '';
eq('a paraphrase is caught, showing where it differs', [para.startsWith('segments do not reproduce the narration exactly'), para.includes('"Nothing more."'), para.includes('"That is all."')], [true, true, true]);
eq('an absent speaker is caught', segmentIssues(narration, [{ speaker: 'npc.tomas', text: narration }], present), ['segments[0]: npc.tomas is not present']);

// ---- sentence streaming
eq('complete sentences come out; the unfinished one waits', takeSentences('The fog rolls in. Mr. Holm waits by the door. "Who\'s there?" he asks. The lamp'),
  { sentences: ['The fog rolls in.', 'Mr. Holm waits by the door.', '"Who\'s there?" he asks.'], rest: 'The lamp' });
eq('a sentence at the very end waits for more (it may be an ellipsis or quote)', takeSentences('She hesitates.').sentences, []);
eq('ellipses and initials', takeSentences('She hesitates... then nods. J. R. Holm signed it. Done ').sentences, ['She hesitates... then nods.', 'J. R. Holm signed it.']);
eq('trailing punctuation and space at the end still waits', takeSentences('It is over. ').sentences, []);

// ---- voices
const catalog = ['af_bella', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'];
const v1 = assignVoice('npc.varek', catalog, {});
eq('voice assignment is deterministic', assignVoice('npc.varek', catalog, {}), v1);
eq('an explicit choice wins', assignVoice('npc.varek', catalog, { 'npc.varek': 'bm_george' }), 'bm_george');
eq('auto-assignment avoids voices already taken', assignVoice('npc.odette', catalog, { narrator: 'am_adam', 'npc.varek': 'bm_george', 'pc.wren': 'af_bella' }) !== 'am_adam', true);
eq('a choice missing from this machine falls back', catalog.includes(assignVoice('npc.varek', catalog, { 'npc.varek': 'voice-from-other-pc' })!), true);
