import { wholeSentences } from './sentences';

type NarrationTextProps = {
  text: string;
  /** The narration is still arriving. */
  streaming: boolean;
  /** The device asks for reduced motion (UI-103). */
  reducedMotion: boolean;
};

/**
 * A turn's narration. Implements UI-051: the narration face at the theme's size and line
 * height, one paragraph per blank-line-separated block, single line breaks kept. And
 * UI-053: streamed text shows as it arrives, or with reduced motion a whole sentence at
 * a time, and all of it once the narration is done.
 */
export function NarrationText({ text, streaming, reducedMotion }: NarrationTextProps) {
  const shown = streaming && reducedMotion ? wholeSentences(text) : text;
  const paragraphs = shown.split(/\n[ \t]*\n/).filter((paragraph) => paragraph.trim() !== '');
  if (paragraphs.length === 0) return null;
  return (
    <div
      data-narration
      className="flex flex-col gap-[0.8em] font-narration text-(length:--narration-size) leading-(--narration-line-height) wrap-break-word"
    >
      {paragraphs.map((paragraph, index) => (
        // Paragraphs only ever grow at the end, so their place is their identity.
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
