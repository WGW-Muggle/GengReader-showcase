import {
  blockCitation,
  evidenceText,
  filterCharacters,
  resolveAnswerCitations,
  retrieveBlocks,
} from "../src/core/ai-evidence";
import type {
  CharacterRelation,
  ReaderCharacter,
  ReaderCitation,
} from "../src/core/ai-types";
import { layoutCharacters } from "../src/core/character-layout";
import { filterBlocksToRange } from "../src/core/scope-range";
import type { ReaderBlock } from "../src/core/types";

// 自编演示文字；没有读取文件、用户书库、环境变量或模型服务。
const passages = [
  "河岸小镇住着两位耿宁。祖父耿宁是一名钟表匠，孙子耿宁在学校读书。镇上的人称祖父为老耿，称孙子为小宁。",
  "祖父说：“相同的名字，不代表相同的命运。”小宁把这句话记进笔记本。",
  "第二章里，陈遇来到小镇，带来一封还没有打开的信。这一段暂时不在读者的已读范围内。",
];

let cursor = 0;
const blocks: ReaderBlock[] = passages.map((text, index) => {
  const startOffset = cursor;
  cursor += text.length + 1;
  return {
    id: `river-paragraph-${index + 1}`,
    bookId: "river-family-demo",
    chapterId: index < 2 ? "chapter-1" : "chapter-2",
    order: index,
    text,
    html: `<p>${text}</p>`,
    page: null,
    startOffset,
    endOffset: startOffset + text.length,
  };
});

// 1. 先按已读位置裁切，再检索；不能先检索全文再隐藏界面中的剧透。
const maxReadOffset = blocks[1].endOffset;
const readable = filterBlocksToRange(blocks, 0, maxReadOffset);
const question = "祖父和孙子都叫耿宁，该怎样区分？";
const evidence = retrieveBlocks(readable, question, 1200);

// 2. 每条引用保留书籍版本、段落 ID 和 UTF-16 坐标，可回到原文。
const version = "river-family-demo-v1";
const citations = evidence.map((block, index) =>
  blockCitation(block, version, index),
);

// 3. 这里只校验预写回答；它既不是实时 AI 输出，也不证明解读语义正确。
const answer = resolveAnswerCitations(
  "可以从称呼和身份区分：老耿是祖父，也是钟表匠；小宁是孙子，还在读书。[S1]",
  citations,
  evidence.map((block) => block.text),
);

const firstAppearance = blockCitation(blocks[0], version, 0);
const unreadAppearance = blockCitation(blocks[2], version, 2);
function person(
  id: string,
  name: string,
  alias: string,
  generation: number,
  citation: ReaderCitation,
): ReaderCharacter {
  return {
    id,
    name,
    aliases: [
      {
        text: alias,
        kind: "source",
        citations: [citation],
        revealedAt: citation.endOffset,
      },
    ],
    summary: [],
    appearance: [],
    personality: [],
    group: "河岸小镇",
    generation,
    groupRevealedAt: citation.endOffset,
    generationRevealedAt: citation.endOffset,
    firstAppearance: citation,
    ambiguous: false,
    candidateIds: [],
    corrected: false,
  };
}

// 此处人物与关系也是明确编写的演示输入，不是假装完成了模型分析。
const people = [
  person("grandfather", "耿宁", "老耿 · 祖父", 0, firstAppearance),
  person("grandson", "耿宁", "小宁 · 孙子", 2, firstAppearance),
  person("chen", "陈遇", "第二章才出现", 1, unreadAppearance),
];
const relations: CharacterRelation[] = [
  {
    id: "grandfather-grandson",
    sourceId: "grandfather",
    targetId: "grandson",
    type: "祖孙",
    description: "第一章已经明示的祖孙关系",
    citations: [firstAppearance],
    revealedAt: firstAppearance.endOffset,
    kind: "source",
  },
];

// 4. 人物事实也按来源过滤；不可见人物不会进入后续布局。
const visible = filterCharacters(people, relations, maxReadOffset, readable);
const layout = layoutCharacters(visible.characters, visible.relations, true);

console.log("GengReader 核心流程演示（纯本地，不调用 AI 或数据库）");
console.log(
  JSON.stringify(
    {
      question,
      readingScope: {
        inputParagraphs: blocks.length,
        visibleParagraphs: readable.length,
        maxReadOffset,
        coordinateUnit: "UTF-16 code units",
      },
      evidence: JSON.parse(evidenceText(evidence, citations)),
      checkedExampleAnswer: answer,
      visiblePeople: visible.characters.map((character) => ({
        id: character.id,
        name: character.name,
        aliases: character.aliases.map((alias) => alias.text),
      })),
      layout,
    },
    null,
    2,
  ),
);
