import type {
  CharacterFact,
  CharacterRelation,
  ReaderCharacter,
  ReaderCitation,
} from './ai-types';
import type { ReaderBlock } from './types';

const genericNames = new Set([
  '他',
  '她',
  '它',
  '他们',
  '她们',
  '它们',
  '我',
  '我们',
  '你',
  '你们',
  '父亲',
  '母亲',
  '爸爸',
  '妈妈',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '先生',
  '小姐',
  '老师',
  '老人',
  '少年',
  '少女',
  '男人',
  '女人',
  'he',
  'she',
  'they',
  'him',
  'her',
  'them',
  'father',
  'mother',
  'mr',
  'mrs',
  'miss',
  'sir',
  'madam',
  'doctor',
  'professor',
]);
const normalize = (value: string) =>
  value.normalize('NFC').trim().toLowerCase();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cjk =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const word = /[\p{L}\p{M}\p{N}_]/u;
const continuesWord = (value: string | undefined) =>
  !!value && word.test(value) && !cjk.test(value);

type TokenTree = {
  children: Map<string, TokenTree>;
  terminal?: { token: string[]; owner?: string };
};
type Evidence = {
  character: ReaderCharacter;
  chapters: Set<string>;
  blocks: Set<string>;
  mentions: number;
  neighbors: Set<string>;
};

/**
 * A deterministic source-salience heuristic, not a literary identity judgment.
 * Score: 12 per distinct chapter, 3 per distinct block, one per unambiguous
 * name/alias mention (at most five per block), and 4 per supported neighbor.
 * Citations and mentions share sets, so repeated facts cannot inflate coverage.
 * Select before checking portraits; otherwise generating images would change
 * who is considered a main character and silently bring in lower-ranked people.
 */
export function rankMainCharacters(
  characters: ReaderCharacter[],
  relations: CharacterRelation[],
  blocks: ReaderBlock[],
  limit = 10
): ReaderCharacter[] {
  if (!Number.isFinite(limit) || limit <= 0 || !blocks.length) return [];
  const byBlock = new Map(blocks.map((block) => [block.id, block]));
  const allowedEnd = blocks.reduce(
    (end, block) => Math.max(end, block.endOffset),
    0
  );
  const allowed = (citation: ReaderCitation) => {
    const block = byBlock.get(citation.location.blockId || '');
    return (
      !!block &&
      citation.location.bookId === block.bookId &&
      citation.location.globalOffset >= block.startOffset &&
      citation.endOffset > citation.location.globalOffset &&
      citation.endOffset <= block.endOffset
    );
  };
  const visibleFact = (fact: CharacterFact) =>
    fact.revealedAt <= allowedEnd &&
    fact.citations.length > 0 &&
    fact.citations.every(allowed);
  const visible = [...characters]
    .filter(
      (character) =>
        character.firstAppearance &&
        allowed(character.firstAppearance) &&
        (character.nameRevealedAt ?? character.firstAppearance.endOffset) <=
          allowedEnd
    )
    .sort((a, b) => compare(a.id, b.id) || compare(a.name, b.name));
  const evidence = new Map<string, Evidence>();
  const tokenOwners = new Map<string, Set<string>>();
  for (const character of visible) {
    if (evidence.has(character.id)) continue;
    const item: Evidence = {
      character,
      chapters: new Set(),
      blocks: new Set(),
      mentions: 0,
      neighbors: new Set(),
    };
    evidence.set(character.id, item);
    const facts = [
      ...character.aliases,
      ...character.summary,
      ...character.appearance,
      ...character.personality,
    ].filter(visibleFact);
    const citations = [
      character.firstAppearance!,
      ...facts.flatMap((fact) => fact.citations),
    ];
    for (const citation of citations) {
      const block = byBlock.get(citation.location.blockId!)!;
      item.blocks.add(block.id);
      item.chapters.add(block.chapterId || block.id);
    }
    const aliases = character.aliases
      .filter(visibleFact)
      .map((alias) => alias.text);
    for (const candidate of new Set(
      [character.name, ...aliases].map(normalize)
    )) {
      if (
        Array.from(candidate).length < 2 ||
        candidate.length > 100 ||
        genericNames.has(candidate)
      )
        continue;
      const owners = tokenOwners.get(candidate) || new Set<string>();
      owners.add(character.id);
      tokenOwners.set(candidate, owners);
    }
  }

  // A trie scans source text without a regex whose size grows with every name.
  // Shared names remain in the trie as blockers: a shorter different person's
  // name must not receive credit from a longer ambiguous name.
  const tree: TokenTree = { children: new Map() };
  for (const [name, owners] of tokenOwners) {
    const token = Array.from(name);
    let node = tree;
    for (const character of token) {
      let child = node.children.get(character);
      if (!child) {
        child = { children: new Map() };
        node.children.set(character, child);
      }
      node = child;
    }
    node.terminal = {
      token,
      owner: owners.size === 1 ? [...owners][0] : undefined,
    };
  }
  for (const block of blocks) {
    const text = Array.from(normalize(block.text));
    const mentions = new Map<string, number>();
    for (let start = 0; start < text.length; start++) {
      let node = tree;
      let matched: { end: number; owner?: string } | undefined;
      for (let end = start; end < text.length; end++) {
        const child = node.children.get(text[end]);
        if (!child) break;
        node = child;
        if (
          node.terminal &&
          (cjk.test(text[start]) || !continuesWord(text[start - 1])) &&
          (cjk.test(text[end]) || !continuesWord(text[end + 1]))
        ) {
          matched = { end, owner: node.terminal.owner };
        }
      }
      if (!matched) continue;
      if (matched.owner)
        mentions.set(matched.owner, (mentions.get(matched.owner) || 0) + 1);
      start = matched.end;
    }
    for (const [id, count] of mentions) {
      const item = evidence.get(id)!;
      item.mentions += Math.min(5, count);
      item.blocks.add(block.id);
      item.chapters.add(block.chapterId || block.id);
    }
  }
  for (const relation of relations) {
    if (
      relation.sourceId === relation.targetId ||
      relation.revealedAt > allowedEnd ||
      !relation.citations.length ||
      !relation.citations.every(allowed)
    )
      continue;
    const source = evidence.get(relation.sourceId),
      target = evidence.get(relation.targetId);
    if (!source || !target) continue;
    source.neighbors.add(relation.targetId);
    target.neighbors.add(relation.sourceId);
    for (const citation of relation.citations) {
      const block = byBlock.get(citation.location.blockId!)!;
      for (const item of [source, target]) {
        item.blocks.add(block.id);
        item.chapters.add(block.chapterId || block.id);
      }
    }
  }
  const score = (item: Evidence) =>
    12 * item.chapters.size +
    3 * item.blocks.size +
    item.mentions +
    4 * item.neighbors.size;
  return [...evidence.values()]
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        a.character.firstAppearance!.location.globalOffset -
          b.character.firstAppearance!.location.globalOffset ||
        compare(a.character.name, b.character.name) ||
        compare(a.character.id, b.character.id)
    )
    .slice(0, Math.floor(limit))
    .map((item) => item.character);
}
