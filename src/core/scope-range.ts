import type { ReaderBlock } from './types';

/** Pure range filtering, shared by search/retrieval/analysis. Never return hidden suffix text or HTML. */
export function filterBlocksToRange(
  blocks: ReaderBlock[],
  start: number,
  end: number
): ReaderBlock[] {
  return blocks
    .filter((block) => block.endOffset > start && block.startOffset < end)
    .map((block) => {
      const left = Math.max(start, block.startOffset),
        right = Math.min(end, block.endOffset);
      return {
        ...block,
        originalStartOffset: block.originalStartOffset ?? block.startOffset,
        text: block.text.slice(
          left - block.startOffset,
          right - block.startOffset
        ),
        html: '',
        startOffset: left,
        endOffset: right,
      };
    })
    .filter((block) => block.text.trim().length > 0);
}
