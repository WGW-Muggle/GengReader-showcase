import type {
  CharacterIdentityConflict,
  CharacterRelation,
  ReaderCharacter,
  ReaderCitation,
} from './ai-types';

export const identityName = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/[\s·•・.，,。:：()（）“”"'‘’_-]/g, '')
    .toLowerCase();
export const identityNames = (character: ReaderCharacter) =>
  new Set(
    [
      character.name,
      ...character.aliases
        .filter((f) => f.kind === 'source')
        .map((f) => f.text),
    ]
      .map(identityName)
      .filter(
        (name) =>
          !!name &&
          !/^(他|她|父亲|母亲|爸爸|妈妈|祖父|祖母|儿子|女儿|哥哥|弟弟|姐姐|妹妹|老人|孩子|男人|女人|father|mother|son|daughter|man|woman)$/i.test(
            name
          )
      )
  );
export const sharedName = (a: ReaderCharacter, b: ReaderCharacter) =>
  [...identityNames(a)].some((name) => identityNames(b).has(name));
function sharedNameRevealedAt(a: ReaderCharacter, b: ReaderCharacter) {
  const appearances = (character: ReaderCharacter) => {
    const allowed = identityNames(character);
    const entries: [string, number][] = [
      [
        identityName(character.name),
        character.nameRevealedAt ??
          character.firstAppearance?.endOffset ??
          Number.POSITIVE_INFINITY,
      ],
      ...character.aliases
        .filter((fact) => fact.kind === 'source')
        .map((fact): [string, number] => [
          identityName(fact.text),
          Math.max(
            fact.revealedAt,
            ...fact.citations.map((source) => source.endOffset)
          ),
        ]),
    ];
    const result = new Map<string, number>();
    for (const [name, revealedAt] of entries)
      if (allowed.has(name))
        result.set(
          name,
          Math.min(result.get(name) ?? Number.POSITIVE_INFINITY, revealedAt)
        );
    return result;
  };
  const left = appearances(a),
    right = appearances(b);
  return Math.min(
    ...[...left]
      .filter(([name]) => right.has(name))
      .map(([name, at]) => Math.max(at, right.get(name)!))
  );
}
const facts = (c: ReaderCharacter) => [
  ...c.aliases,
  ...c.summary,
  ...c.appearance,
  ...c.personality,
];
export function characterSources(c: ReaderCharacter) {
  return [
    ...new Map(
      [
        ...(c.firstAppearance ? [c.firstAppearance] : []),
        ...facts(c).flatMap((f) => f.citations),
      ].map((citation) => [
        `${citation.location.blockId}:${citation.location.globalOffset}:${citation.endOffset}`,
        citation,
      ])
    ).values(),
  ];
}
function parentFacts(
  c: ReaderCharacter,
  people: ReaderCharacter[],
  relations: CharacterRelation[]
) {
  return relations.flatMap((relation) => {
    const forward =
      /^(父亲|母亲|父|母|father|mother|parent)$/i.test(relation.type) &&
      relation.targetId === c.id;
    const backward =
      /^(儿子|女儿|子女|son|daughter|child)$/i.test(relation.type) &&
      relation.sourceId === c.id;
    if (
      relation.kind !== 'source' ||
      (!forward && !backward) ||
      !relation.citations.length
    )
      return [];
    const parent = people.find(
      (person) =>
        person.id === (forward ? relation.sourceId : relation.targetId)
    );
    if (!parent) return [];
    return [
      {
        name: identityName(parent.name),
        type: forward
          ? relation.type
              .toLowerCase()
              .replace(/^父$/, '父亲')
              .replace(/^母$/, '母亲')
          : 'parent',
        citations: relation.citations,
        revealedAt: Math.max(
          relation.revealedAt,
          parent.nameRevealedAt ??
            parent.firstAppearance?.endOffset ??
            Number.POSITIVE_INFINITY,
          ...relation.citations.map((source) => source.endOffset)
        ),
      },
    ];
  });
}
function generationEvidence(character: ReaderCharacter) {
  if (character.generation === null) return [];
  const numerals = [
    '',
    '一',
    '二',
    '三',
    '四',
    '五',
    '六',
    '七',
    '八',
    '九',
    '十',
  ];
  const numeral = numerals[character.generation];
  const marker = new RegExp(
    `(?:第\\s*(?:${character.generation}${numeral ? `|${numeral}` : ''})\\s*代|generation\\s*${character.generation}\\b)`,
    'i'
  );
  return characterSources(character).filter((source) =>
    marker.test(source.quote)
  );
}
/** Only evidence of a contradiction creates a user-facing conflict. Mere names do not. */
export function identityConflict(
  a: ReaderCharacter,
  b: ReaderCharacter,
  people: ReaderCharacter[],
  relations: CharacterRelation[]
): Omit<CharacterIdentityConflict, 'id' | 'otherId'> | null {
  if (!sharedName(a, b)) return null;
  const nameRevealedAt = sharedNameRevealedAt(a, b);
  const parentsA = parentFacts(a, people, relations),
    parentsB = parentFacts(b, people, relations);
  for (const pa of parentsA)
    for (const pb of parentsB) {
      if (pa.type === pb.type && pa.type !== 'parent' && pa.name !== pb.name)
        return {
          reason: `这两条记录姓名相同，但${pa.type === 'father' ? '父亲' : pa.type === 'mother' ? '母亲' : pa.type}不同。`,
          leftCitations: pa.citations,
          rightCitations: pb.citations,
          revealedAt: Math.max(
            nameRevealedAt,
            pa.revealedAt,
            pb.revealedAt,
            ...[...pa.citations, ...pb.citations].map((c) => c.endOffset)
          ),
        };
    }
  if (
    a.generation !== null &&
    b.generation !== null &&
    a.generation !== b.generation
  ) {
    const left = generationEvidence(a),
      right = generationEvidence(b);
    if (left.length && right.length)
      return {
        reason: `这两条记录姓名相同，但世代不同（第 ${a.generation} 代与第 ${b.generation} 代）。`,
        leftCitations: left.slice(0, 3),
        rightCitations: right.slice(0, 3),
        revealedAt: Math.max(
          nameRevealedAt,
          a.generationRevealedAt ?? 0,
          b.generationRevealedAt ?? 0,
          ...[...left, ...right].map((c) => c.endOffset)
        ),
      };
  }
  return null;
}
/** Conservative local match: names + independent source-backed biography/kinship. */
export function sameIdentity(
  a: ReaderCharacter,
  b: ReaderCharacter,
  people: ReaderCharacter[],
  relations: CharacterRelation[]
) {
  if (!sharedName(a, b)) return false;
  if (
    a.generation !== null &&
    b.generation !== null &&
    a.generation !== b.generation
  )
    return false;
  if (identityConflict(a, b, people, relations)) return false;
  const left = a.summary.filter(
    (f) =>
      f.kind === 'source' && f.citations.length && f.text.trim().length >= 20
  );
  const biography = left.some((f) =>
    b.summary.some(
      (g) =>
        g.kind === 'source' &&
        g.citations.length &&
        identityName(f.text) === identityName(g.text)
    )
  );
  const pa = parentFacts(a, people, relations),
    pb = parentFacts(b, people, relations);
  const kinship = pa.some((x) =>
    pb.some((y) => x.name === y.name && x.type === y.type)
  );
  // A shared parent alone still permits same-named siblings. Add explicit alias
  // equivalence or a corroborating biography instead of trusting the surname.
  const explicitAlias =
    (a.aliases.some(
      (f) =>
        f.kind === 'source' && identityName(f.text) === identityName(b.name)
    ) ||
      b.aliases.some(
        (f) =>
          f.kind === 'source' && identityName(f.text) === identityName(a.name)
      )) &&
    identityName(a.name) !== identityName(b.name);
  const multipleBiography =
    left.filter((f) =>
      b.summary.some(
        (g) =>
          g.kind === 'source' &&
          g.citations.length &&
          identityName(f.text) === identityName(g.text)
      )
    ).length > 1;
  // Matching names, independently recorded parents and an explicit generation
  // support continuity even when chapter summaries use different wording.
  const sameRecordedGeneration =
    a.generation !== null &&
    a.generation === b.generation &&
    generationEvidence(a).length > 0 &&
    generationEvidence(b).length > 0;
  return (
    multipleBiography ||
    (biography && (kinship || explicitAlias)) ||
    (kinship && (explicitAlias || sameRecordedGeneration))
  );
}
export function stableRegistryMatch(
  candidate: ReaderCharacter,
  prior: ReaderCharacter[]
) {
  const first = candidate.firstAppearance;
  if (!first) return undefined;
  const sameAnchor = prior.filter(
    (c) =>
      c.firstAppearance?.location.blockId === first.location.blockId &&
      c.firstAppearance?.location.globalOffset ===
        first.location.globalOffset &&
      sharedName(c, candidate) &&
      !(
        c.generation !== null &&
        candidate.generation !== null &&
        c.generation !== candidate.generation
      )
  );
  if (sameAnchor.length === 1) return sameAnchor[0];
  const exact = sameAnchor.filter((c) =>
    c.summary.some((f) =>
      candidate.summary.some(
        (g) => identityName(f.text) === identityName(g.text)
      )
    )
  );
  return exact.length === 1 ? exact[0] : undefined;
}
/** A model's declaration plus two valid citation IDs is not identity evidence. */
export function supportedIdentityMerge(
  a: ReaderCharacter,
  b: ReaderCharacter,
  citations: ReaderCitation[],
  reason: string,
  people: ReaderCharacter[],
  relations: CharacterRelation[]
) {
  if (
    identityConflict(a, b, people, relations) ||
    (a.generation !== null &&
      b.generation !== null &&
      a.generation !== b.generation)
  )
    return false;
  if (sameIdentity(a, b, people, relations)) return true;
  if (
    /同名|姓名|名字|same name/i.test(reason) &&
    !/别名|原名|又称|亲属|经历|alias|biograph|kinship/i.test(reason)
  )
    return false;
  return citations.some((citation) => {
    const text = identityName(citation.quote),
      left = identityName(a.name),
      right = identityName(b.name);
    if (
      !text.includes(left) ||
      !text.includes(right) ||
      /不是|并非|并不是|not|different/i.test(citation.quote)
    )
      return false;
    if (left !== right) {
      const escape = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const directAlias = (from: string, to: string) =>
        new RegExp(
          `${escape(from)}(?:的)?(?:原名|又名|又称|别名|也叫|真名|就是|化名|曾用名|alias|alsoknownas|realname)(?:是|为)?${escape(to)}`,
          'i'
        );
      return (
        directAlias(left, right).test(text) ||
        directAlias(right, left).test(text)
      );
    }
    return (
      /同一个人|同一人|same person/i.test(citation.quote) &&
      text.indexOf(left) !== text.lastIndexOf(left)
    );
  });
}
/** Include every supporting identity dependency, not only the proposal's refs. */
export function identityEvidenceRevealedAt(
  a: ReaderCharacter,
  b: ReaderCharacter,
  people: ReaderCharacter[],
  relations: CharacterRelation[]
) {
  return Math.max(
    a.nameRevealedAt ?? 0,
    b.nameRevealedAt ?? 0,
    a.generationRevealedAt ?? 0,
    b.generationRevealedAt ?? 0,
    ...[a, b].flatMap((person) => [
      ...facts(person).map((fact) => fact.revealedAt),
      ...characterSources(person).map((source) => source.endOffset),
      ...parentFacts(person, people, relations).map(
        (parent) => parent.revealedAt
      ),
    ])
  );
}
export function addIdentityConflict(
  a: ReaderCharacter,
  b: ReaderCharacter,
  value: Omit<CharacterIdentityConflict, 'id' | 'otherId'>
) {
  const id = [a.id, b.id].sort().join(':');
  const left: CharacterIdentityConflict = { ...value, id, otherId: b.id };
  const right: CharacterIdentityConflict = {
    ...value,
    id,
    otherId: a.id,
    leftCitations: value.rightCitations,
    rightCitations: value.leftCitations,
  };
  a.identityConflicts = [
    ...(a.identityConflicts || []).filter((c) => c.id !== id),
    left,
  ];
  b.identityConflicts = [
    ...(b.identityConflicts || []).filter((c) => c.id !== id),
    right,
  ];
}
