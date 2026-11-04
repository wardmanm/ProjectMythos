import type { WorkflowMapping } from '@mythos/contracts';
import type { ContentSettings } from '@mythos/contracts/content';

// ================================================================ ComfyUI (MED §4)

export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type ImageParams = {
  prompt: string; negativePrompt: string; seed: number; width: number; height: number;
  loraName?: string; loraStrength?: number; referenceImage?: string; // uploaded file name
};

/** Every mapping problem against a workflow, so a broken mapping is reported once (MED-031). */
export function mappingIssues(w: ComfyWorkflow, m: WorkflowMapping): string[] {
  const out: string[] = [];
  for (const [param, target] of Object.entries(m.inputs)) {
    if (!target) continue;
    const node = w[target.node];
    if (!node) out.push(`${param}: node ${target.node} is not in the workflow`);
    else if (!(target.input in node.inputs)) out.push(`${param}: node ${target.node} (${node.class_type}) has no input "${target.input}"`);
    else if (Array.isArray(node.inputs[target.input])) out.push(`${param}: ${target.node}.${target.input} is a link to another node, not a value`);
  }
  if (!w[m.output.node]) out.push(`output: node ${m.output.node} is not in the workflow`);
  return out;
}

/** A copy of the workflow with parameters written into their mapped inputs. Never mutates. */
export function applyMapping(w: ComfyWorkflow, m: WorkflowMapping, p: ImageParams): ComfyWorkflow {
  const out: ComfyWorkflow = JSON.parse(JSON.stringify(w));
  const set = (param: keyof WorkflowMapping['inputs'], value: unknown) => {
    const t = m.inputs[param];
    if (t && value !== undefined) (out[t.node] as { inputs: Record<string, unknown> }).inputs[t.input] = value;
  };
  set('prompt', p.prompt); set('negativePrompt', p.negativePrompt); set('seed', p.seed);
  set('width', p.width); set('height', p.height); set('loraName', p.loraName);
  set('loraStrength', p.loraStrength); set('referenceImage', p.referenceImage);
  return out;
}

// ================================================================ content in images (MED §3.4)

/** Terms the engine adds to every negative prompt, by content settings; minors always get the full set. */
export function contentNegatives(s: ContentSettings, minorInImage: boolean): string[] {
  const out: string[] = [];
  if (minorInImage || s.sexual !== 'explicit') out.push('nsfw', 'nudity', 'sexual content', 'suggestive');
  if (minorInImage) out.push('revealing clothing', 'sexualized');
  if (s.gore === 'off' || s.gore === 'fade-to-black') out.push('gore', 'blood', 'open wounds');
  if (s.violence === 'off') out.push('violence', 'weapons drawn');
  if (s.disturbing === 'off') out.push('horror', 'body horror');
  return out;
}

// ================================================================ speech (MED §5)

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The segmentation must reproduce the narration exactly, split by speaker (MED-055). */
export function segmentIssues(narration: string, segments: { speaker: string; text: string }[], speakers: Set<string>): string[] {
  const out: string[] = [];
  segments.forEach((s, i) => { if (s.speaker !== 'narrator' && !speakers.has(s.speaker)) out.push(`segments[${i}]: ${s.speaker} is not present`); });
  const joined = norm(segments.map((s) => s.text).join(' ')), want = norm(narration);
  if (joined !== want) {
    let i = 0;
    while (i < Math.min(joined.length, want.length) && joined[i] === want[i]) i++;
    out.push(`segments do not reproduce the narration exactly; they differ at character ${i}: "${want.slice(i, i + 30)}" vs "${joined.slice(i, i + 30)}"`);
  }
  return out;
}

const ABBREVIATIONS = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Mt|Capt|Sgt|Lt|Col|Gen|Rev|Prof|vs|etc)\.|\b[A-Z]\.)$/;

/** Splits streamed text into complete sentences for narrator speech (MED-054). */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer))) {
    const end = m.index + m[1]!.length + m[2]!.length;
    const next = buffer[end + m[3]!.length];
    if (next === undefined) break; // can't tell yet: an ellipsis, a closing quote, or a tag may follow
    if (/\p{Ll}/u.test(next)) continue; // "Who's there?" he asks. / She hesitates... then nods.
    const candidate = buffer.slice(start, end);
    if (ABBREVIATIONS.test(candidate.trimEnd())) continue;
    if (candidate.trim()) sentences.push(candidate.trim());
    start = end + m[3]!.length;
  }
  return { sentences, rest: buffer.slice(start) };
}

/** Deterministic voice for a speaker: an explicit choice, else an unused voice picked by hash (MED-052). */
export function assignVoice(speakerId: string, catalog: string[], chosen: Record<string, string>): string | null {
  if (chosen[speakerId] && catalog.includes(chosen[speakerId] as string)) return chosen[speakerId] as string;
  if (!catalog.length) return null;
  let h = 2166136261;
  for (const ch of speakerId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const used = new Set(Object.values(chosen));
  const free = catalog.filter((v) => !used.has(v));
  const pool = free.length ? free : catalog;
  return pool[h % pool.length] as string;
}
