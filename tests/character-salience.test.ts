import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CharacterFact,
  CharacterRelation,
  ReaderCharacter,
  ReaderCitation,
} from '../src/core/ai-types';
import { rankMainCharacters } from '../src/core/character-salience';
import type { ReaderBlock } from '../src/core/types';

function block(
  id: string,
  chapter: string,
  text: string,
  start: number
): ReaderBlock {
  return {
    id,
    bookId: 'book',
    chapterId: chapter,
    order: start,
    text,
    html: '',
    page: null,
    startOffset: start,
    endOffset: start + text.length,
  };
}
function cite(source: ReaderBlock): ReaderCitation {
  return {
    id: `cite-${source.id}`,
    label: '原文',
    quote: source.text,
    location: {
      bookId: source.bookId,
      version: 'v1',
      chapterId: source.chapterId,
      blockId: source.id,
      globalOffset: source.startOffset,
      offset: 0,
    },
    endOffset: source.endOffset,
  };
}
function character(
  id: string,
  name: string,
  source: ReaderBlock
): ReaderCharacter {
  return {
    id,
    name,
    firstAppearance: cite(source),
    nameRevealedAt: source.endOffset,
    aliases: [],
    summary: [],
    appearance: [],
    personality: [],
    group: '',
    generation: null,
    ambiguous: false,
    candidateIds: [],
    corrected: false,
  };
}
function fact(text: string, source: ReaderBlock): CharacterFact {
  return {
    text,
    kind: 'source',
    citations: [cite(source)],
    revealedAt: source.endOffset,
  };
}
function relation(
  id: string,
  sourceId: string,
  targetId: string,
  source: ReaderBlock
): CharacterRelation {
  return {
    id,
    sourceId,
    targetId,
    type: '朋友',
    description: '原文支持',
    kind: 'source',
    citations: [cite(source)],
    revealedAt: source.endOffset,
  };
}
const ids = (values: ReaderCharacter[]) => values.map((value) => value.id);

test('main ten are ranked from scoped chapters and mentions, independent of input array order', () => {
  const opening = block('opening', 'chapter-1', '十二个人物聚在一起。', 0);
  const people = Array.from({ length: 12 }, (_, index) =>
    character(
      `person-${index}`,
      `人物${String(index).padStart(2, '0')}`,
      opening
    )
  );
  const featured = people
    .slice(2)
    .map((person) => person.name)
    .join('，');
  const second = block('second', 'chapter-2', featured, 100);
  const third = block('third', 'chapter-3', featured, 200);
  const ranked = rankMainCharacters(people, [], [opening, second, third]);
  assert.equal(ranked.length, 10);
  assert.deepEqual(new Set(ids(ranked)), new Set(ids(people.slice(2))));
  assert.deepEqual(
    ids(
      rankMainCharacters([...people].reverse(), [], [third, second, opening])
    ),
    ids(ranked)
  );
  assert.deepEqual(
    ids(people),
    Array.from({ length: 12 }, (_, index) => `person-${index}`)
  );
});

test('unique alias mentions count once and shared aliases or generic titles receive no attribution', () => {
  const opening = block('opening', 'chapter-1', '人物在此出现。', 0);
  const first = character('a', '甲人物', opening),
    second = character('b', '乙人物', opening),
    third = character('c', '丙人物', opening);
  first.aliases = [fact('阿明', opening), fact('父亲', opening)];
  second.aliases = [fact('阿明', opening)];
  third.aliases = [fact('小岚', opening), fact('小岚', opening)];
  const later = block(
    'later',
    'chapter-2',
    '阿明阿明阿明阿明阿明。父亲父亲父亲。小岚。',
    100
  );
  const ranked = rankMainCharacters(
    [first, second, third],
    [],
    [opening, later]
  );
  assert.equal(ranked[0].id, 'c');
  const duplicate = structuredClone(third);
  duplicate.aliases.push(
    ...Array.from({ length: 50 }, () => fact('小岚', opening))
  );
  assert.deepEqual(
    ids(rankMainCharacters([first, second, duplicate], [], [opening, later])),
    ids(ranked)
  );
});

test('hidden characters, aliases, facts and relations cannot influence visible ranking', () => {
  const opening = block('opening', 'chapter-1', '人物登场。', 0);
  const later = block('later', 'chapter-2', '河岸居民提到蓝先生。', 100);
  const hidden = block(
    'hidden',
    'chapter-3',
    '蓝先生其实是甲人物，有许多亲属。',
    1000
  );
  const first = character('a', '甲人物', opening),
    second = character('b', '乙人物', opening),
    third = character('c', '丙人物', opening);
  second.aliases = [fact('蓝先生', opening)];
  const baseline = ids(
    rankMainCharacters([first, second, third], [], [opening, later])
  );
  const altered = structuredClone(first);
  altered.aliases.push(fact('蓝先生', hidden));
  altered.summary.push(fact('重要人物', hidden));
  const secret = character('secret', '蓝先生', hidden);
  const hiddenRelations = [
    relation('r1', first.id, second.id, hidden),
    relation('r2', first.id, third.id, hidden),
  ];
  assert.deepEqual(
    ids(
      rankMainCharacters([altered, second, third, secret], hiddenRelations, [
        opening,
        later,
      ])
    ),
    baseline
  );
  assert.equal(baseline[0], second.id);
});

test('supported relationships contribute once per neighbor while unsupported or repeated relations do not', () => {
  const opening = block('opening', 'chapter-1', '众人出现。', 0);
  const people = ['甲人物', '乙人物', '丙人物', '丁人物'].map((name, index) =>
    character(String(index), name, opening)
  );
  const supported = [
    relation('r1', '3', '0', opening),
    relation('r2', '3', '1', opening),
    relation('r3', '3', '2', opening),
  ];
  assert.equal(rankMainCharacters(people, supported, [opening])[0].id, '3');
  const repeated = Array.from({ length: 30 }, (_, index) => ({
    ...supported[0],
    id: `duplicate-${index}`,
  }));
  assert.deepEqual(
    ids(rankMainCharacters(people, [...supported, ...repeated], [opening])),
    ids(rankMainCharacters(people, supported, [opening]))
  );
  assert.deepEqual(
    ids(
      rankMainCharacters(
        people,
        supported.map((entry) => ({ ...entry, citations: [] })),
        [opening]
      )
    ),
    ids(rankMainCharacters(people, [], [opening]))
  );
});

test('Latin names use word boundaries and longest matching names prevent overlapping mention inflation', () => {
  const opening = block('opening', 'chapter-1', 'The cast appears.', 0);
  const ann = character('ann', 'Ann', opening),
    anna = character('anna', 'Annabelle', opening),
    john = character('john', 'John', opening);
  john.aliases = [fact('John Smith', opening)];
  const later = block(
    'later',
    'chapter-2',
    'Annabelle met John Smith. Annabelle spoke.',
    100
  );
  assert.deepEqual(
    ids(rankMainCharacters([ann, anna, john], [], [opening, later])),
    ['anna', 'john', 'ann']
  );
});

test('evidence breadth is deduplicated, ties are stable, and portrait state does not affect selection', () => {
  const firstBlock = block('a', 'chapter-1', '人物首次出现。', 0);
  const laterBlock = block('b', 'chapter-2', '后来的章节。', 100);
  const a = character('a', '甲人物', firstBlock),
    b = character('b', '乙人物', firstBlock),
    c = character('c', '丙人物', laterBlock);
  b.summary = Array.from({ length: 100 }, () => fact('相同证据', firstBlock));
  const baseline = rankMainCharacters([a, b, c], [], [firstBlock, laterBlock]);
  a.portrait = {
    id: 'portrait',
    url: '',
    modelId: '',
    prompt: '',
    source: 'ai-imagined',
    version: 1,
    revealedAt: firstBlock.endOffset,
  };
  assert.deepEqual(
    ids(rankMainCharacters([c, b, a], [], [laterBlock, firstBlock])),
    ids(baseline)
  );
  assert.equal(
    baseline.at(-1)!.id,
    'c',
    'Equal salience prefers earlier evidence before names'
  );
  assert.deepEqual(rankMainCharacters([a], [], [firstBlock], 0), []);
});
