import { createHash } from 'node:crypto';

import type {
  CharacterRelation,
  MindMapNode,
  ReaderCharacter,
  ReaderCitation,
} from './ai-types';
import type { ReaderBlock, ReaderScope, ScopeResult } from './types';

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function blockCitation(
  block: ReaderBlock,
  version: string,
  index: number
): ReaderCitation {
  return {
    id: `S${index + 1}`,
    label: block.page ? `第 ${block.page} 页` : `原文片段 ${index + 1}`,
    quote: block.text.slice(0, 500),
    endOffset: block.endOffset,
    location: {
      bookId: block.bookId,
      version,
      chapterId: block.chapterId,
      blockId: block.id,
      page: block.page ?? undefined,
      offset:
        block.startOffset - (block.originalStartOffset ?? block.startOffset),
      globalOffset: block.startOffset,
      quote: block.text.slice(0, 500),
      rects: block.rects,
    },
  };
}
export function lexicalScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const source = text.toLowerCase();
  const words = q.match(/[a-z0-9]{2,}|[\u3400-\u9fff]/g) || [];
  const terms = new Set(words);
  const chinese = q.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const seq of chinese)
    for (let i = 0; i < seq.length - 1; i++) terms.add(seq.slice(i, i + 2));
  let score = 0;
  for (const term of terms) {
    let i = source.indexOf(term),
      n = 0;
    while (i >= 0 && n < 8) {
      n++;
      i = source.indexOf(term, i + term.length);
    }
    score += n * (term.length > 1 ? 3 : 0.4);
  }
  return score / Math.sqrt(Math.max(text.length / 500, 1));
}
export function retrieveBlocks(
  blocks: ReaderBlock[],
  query: string,
  maxCharacters = 24000
): ReaderBlock[] {
  const ranked = blocks
    .map((b, i) => ({ b, i, score: lexicalScore(query, b.text) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  if (/比较|跨|不同章节|联系|全书|整体|主题|结构/.test(query)) {
    const chapters = new Set<string>();
    const representatives = ranked.filter((item) => {
      if (chapters.has(item.b.chapterId)) return false;
      chapters.add(item.b.chapterId);
      return true;
    });
    const first = new Set(representatives.map((r) => r.b.id));
    ranked.splice(
      0,
      ranked.length,
      ...representatives,
      ...ranked.filter((r) => !first.has(r.b.id))
    );
  }
  const chosen = new Map<string, ReaderBlock>();
  let total = 0;
  for (const item of ranked) {
    if (total >= maxCharacters) break;
    const b = item.b;
    if (chosen.has(b.id)) continue;
    const remaining = maxCharacters - total;
    if (remaining < 100) break;
    const text = b.text.slice(0, remaining);
    chosen.set(b.id, { ...b, text, endOffset: b.startOffset + text.length });
    total += text.length;
    for (const neighbor of [blocks[item.i - 1], blocks[item.i + 1]])
      if (
        neighbor &&
        neighbor.chapterId === b.chapterId &&
        !chosen.has(neighbor.id) &&
        total + neighbor.text.length <= maxCharacters
      ) {
        chosen.set(neighbor.id, neighbor);
        total += neighbor.text.length;
      }
  }
  return [...chosen.values()].sort((a, b) => a.order - b.order);
}
export function evidenceText(
  blocks: ReaderBlock[],
  citations: ReaderCitation[]
): string {
  return JSON.stringify(
    blocks.map((b, i) => ({
      sourceId: citations[i].id,
      blockId: b.id,
      page: b.page,
      text: b.text,
    }))
  );
}
export function validatedCitations(
  ids: unknown,
  allowed: ReaderCitation[]
): ReaderCitation[] {
  if (!Array.isArray(ids)) return [];
  const set = new Set(ids.filter((v) => typeof v === 'string'));
  return allowed.filter((c) => set.has(c.id));
}
export function resolveAnswerCitations(
  answer: string,
  citations: ReaderCitation[],
  sourceTexts?: string[]
) {
  const valid = new Set(citations.map((c) => c.id));
  const used = new Set<string>();
  let rejected = 0;
  let text = answer.replace(/\[(S\d+)\]/g, (_, id) => {
    if (valid.has(id)) {
      used.add(id);
      return `[${id}]`;
    }
    rejected++;
    return '[引用未验证]';
  });
  const sources = (sourceTexts || citations.map((c) => c.quote)).map((t) =>
    t.replace(/\s+/g, '')
  );
  text = text.replace(
    /“([^”\n]{8,})”|「([^」\n]{8,})」/g,
    (match, first, second) => {
      const quote = String(first || second).replace(/\s+/g, '');
      if (sources.some((s) => s.includes(quote))) return match;
      rejected++;
      return '[引文未在本次原文中核实，已移除]';
    }
  );
  const pages = new Set(citations.map((c) => c.location.page).filter(Boolean));
  text = text.replace(/第\s*(\d+)\s*页/g, (match, page) => {
    if (pages.has(Number(page))) return match;
    rejected++;
    return '[页码未验证]';
  });
  return {
    text: rejected
      ? `${text}\n\n部分引用未通过原文校验，已标记或移除；请勿将其视为原文依据。`
      : text,
    citations: citations.filter((c) => used.has(c.id)),
  };
}
export function scopeUpperBound(result: ScopeResult) {
  return result.blocks.reduce((max, b) => Math.max(max, b.endOffset), 0);
}
export type SourceRange = { start: number; end: number };
export function sourceRanges(blocks: ReaderBlock[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const block of [...blocks].sort(
    (a, b) => a.startOffset - b.startOffset
  )) {
    const last = ranges.at(-1);
    if (last && block.startOffset <= last.end)
      last.end = Math.max(last.end, block.endOffset);
    else ranges.push({ start: block.startOffset, end: block.endOffset });
  }
  return ranges;
}
export function rangesContained(
  required: SourceRange[],
  allowed: SourceRange[]
): boolean {
  return required.every((r) =>
    allowed.some((a) => r.start >= a.start && r.end <= a.end)
  );
}
export function citationInBlocks(
  citation: ReaderCitation,
  blocks: ReaderBlock[]
): boolean {
  return blocks.some(
    (b) =>
      b.id === citation.location.blockId &&
      citation.location.globalOffset >= b.startOffset &&
      citation.endOffset <= b.endOffset
  );
}
export function safeScopeKey(scope: ReaderScope, blocks: ReaderBlock[]) {
  return digest(
    JSON.stringify({
      scope,
      blocks: blocks.map((b) => [b.id, b.startOffset, b.endOffset]),
    })
  );
}
export function nodeVisibility(
  nodes: MindMapNode[],
  allowedEnd: number
): MindMapNode[] {
  const accepted = new Map(
    nodes
      .filter(
        (n) =>
          n.revealedAt <= allowedEnd &&
          n.citations.every((c) => c.endOffset <= allowedEnd)
      )
      .map((n) => [n.id, n])
  );
  return [...accepted.values()].filter((n) => {
    let p = n.parentId;
    const seen = new Set<string>();
    while (p) {
      if (seen.has(p) || !accepted.has(p)) return false;
      seen.add(p);
      p = accepted.get(p)!.parentId;
    }
    return true;
  });
}
export function filterCharacters(
  characters: ReaderCharacter[],
  relations: CharacterRelation[],
  allowedEnd: number,
  allowedBlocks?: ReaderBlock[]
) {
  const allowed = (c: ReaderCitation) =>
    c.endOffset <= allowedEnd &&
    (!allowedBlocks || citationInBlocks(c, allowedBlocks));
  const visible = characters
    .filter(
      (c) =>
        c.firstAppearance &&
        allowed(c.firstAppearance) &&
        (c.nameRevealedAt ?? c.firstAppearance.endOffset) <= allowedEnd
    )
    .map((c) => ({
      ...c,
      group: (c.groupRevealedAt ?? Infinity) <= allowedEnd ? c.group : '',
      generation:
        (c.generationRevealedAt ?? Infinity) <= allowedEnd
          ? c.generation
          : null,
      aliases: c.aliases.filter(
        (f) => f.revealedAt <= allowedEnd && f.citations.every(allowed)
      ),
      summary: c.summary.filter(
        (f) => f.revealedAt <= allowedEnd && f.citations.every(allowed)
      ),
      appearance: c.appearance.filter(
        (f) => f.revealedAt <= allowedEnd && f.citations.every(allowed)
      ),
      personality: c.personality.filter(
        (f) => f.revealedAt <= allowedEnd && f.citations.every(allowed)
      ),
      candidateIds: [] as string[],
      portrait:
        c.portrait && c.portrait.revealedAt <= allowedEnd
          ? c.portrait
          : undefined,
    }));
  const ids = new Set(visible.map((c) => c.id));
  for (const character of visible) {
    character.identityConflicts = (character.identityConflicts || []).filter(
      (conflict) =>
        ids.has(conflict.otherId) &&
        conflict.revealedAt <= allowedEnd &&
        conflict.leftCitations.length > 0 &&
        conflict.rightCitations.length > 0 &&
        [...conflict.leftCitations, ...conflict.rightCitations].every(allowed)
    );
    character.ambiguous = character.identityConflicts.length > 0;
    character.candidateIds = character.identityConflicts.map(
      (conflict) => conflict.otherId
    );
  }
  return {
    characters: visible,
    relations: relations.filter(
      (r) =>
        ids.has(r.sourceId) &&
        ids.has(r.targetId) &&
        r.revealedAt <= allowedEnd &&
        r.citations.every(allowed)
    ),
  };
}
export function validateTree(nodes: MindMapNode[]): void {
  if (!nodes.length || nodes.length > 1000)
    throw new Error('导图需要 1 至 1000 个节点。');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length) throw new Error('节点标识重复。');
  if (nodes.filter((n) => n.parentId === null).length !== 1)
    throw new Error('导图必须有且只有一个根节点。');
  for (const node of nodes) {
    if (
      !node.title.trim() ||
      node.title.length > 100 ||
      node.description.length > 10000
    )
      throw new Error('节点标题或说明长度不正确。');
    let p = node.parentId;
    const seen = new Set([node.id]);
    let depth = 0;
    while (p) {
      if (seen.has(p) || !byId.has(p))
        throw new Error('导图存在循环或不存在的父节点。');
      seen.add(p);
      p = byId.get(p)!.parentId;
      if (++depth > 20) throw new Error('导图层级过深。');
    }
  }
}
