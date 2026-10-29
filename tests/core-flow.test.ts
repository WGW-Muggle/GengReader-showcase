import assert from "node:assert/strict";
import test from "node:test";

import { chatStreamResponse } from "../src/core/ai-chat-stream";
import {
  blockCitation,
  citationInBlocks,
  evidenceText,
  filterCharacters,
  nodeVisibility,
  rangesContained,
  resolveAnswerCitations,
  retrieveBlocks,
  sourceRanges,
  validatedCitations,
} from "../src/core/ai-evidence";
import type {
  CharacterRelation,
  MindMapNode,
  ReaderCharacter,
  ReaderCitation,
} from "../src/core/ai-types";
import { filterBlocksToRange } from "../src/core/scope-range";
import type { ReaderBlock } from "../src/core/types";

function block(id: string, text: string, startOffset = 0): ReaderBlock {
  return {
    id,
    bookId: "test-book",
    chapterId: "chapter-1",
    order: startOffset,
    text,
    html: `<p>${text}</p>`,
    page: null,
    startOffset,
    endOffset: startOffset + text.length,
  };
}

function character(
  id: string,
  firstAppearance: ReaderCitation,
): ReaderCharacter {
  return {
    id,
    name: id,
    aliases: [],
    summary: [],
    appearance: [],
    personality: [],
    group: "",
    generation: null,
    firstAppearance,
    ambiguous: false,
    candidateIds: [],
    corrected: false,
  };
}

test("range filtering excludes unread suffix and HTML while retaining original UTF-16 coordinates", () => {
  const text = "序言🙂祖父是一名钟表匠。后文才会揭晓信件的署名。";
  const original = block("paragraph", text, 100);
  const start = original.startOffset + text.indexOf("祖父");
  const end = original.startOffset + text.indexOf("后文");
  const first = filterBlocksToRange([original], start, end);
  assert.equal(first.length, 1);
  assert.equal(first[0].text, "祖父是一名钟表匠。");
  assert.equal(first[0].html, "");
  assert.equal(first[0].originalStartOffset, 100);
  assert.equal(original.text, text);
  assert.equal(original.html, `<p>${text}</p>`);

  const narrowed = filterBlocksToRange(first, start + 2, end);
  const citation = blockCitation(narrowed[0], "version-1", 0);
  assert.equal(citation.location.offset, start + 2 - 100);
  assert.equal(citation.location.globalOffset, start + 2);
  assert.equal(citation.location.version, "version-1");
  assert.equal(citation.quote, "是一名钟表匠。");
  assert.equal(citation.endOffset, end);
  assert.deepEqual(filterBlocksToRange([original], end, end), []);
});

test("retrieval budget truncates evidence and its citation to the same boundary", () => {
  const original = block("long", "祖父和孙子在河岸修钟。".repeat(40), 100);
  const unread = block("unread", "只有下一章才揭晓的身份。", 900);
  const readable = filterBlocksToRange([original, unread], 100, 350);
  const retrieved = retrieveBlocks(readable, "祖父和孙子", 150);
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].text.length, 150);
  const citation = blockCitation(retrieved[0], "version-1", 0);
  assert.equal(citation.quote.length, 150);
  assert.equal(citation.endOffset, 250);
  assert.ok(citationInBlocks(citation, readable));
  const prompt = JSON.parse(evidenceText(retrieved, [citation]));
  assert.equal(prompt[0].text, retrieved[0].text);
  assert.ok(!JSON.stringify(prompt).includes("下一章"));
});

test("unknown source IDs, unsupported long quotations and invented page numbers are marked", () => {
  const original = {
    ...block("known", "祖父是一名钟表匠，孙子还在学校读书。"),
    page: 3,
  };
  const citation = blockCitation(original, "version-1", 0);
  const result = resolveAnswerCitations(
    `“${original.text}”[S1]；“从未出现在原文里的这一整段话”[S404]，见第 3 页和第 9 页。`,
    [citation],
  );
  assert.ok(result.text.includes(`“${original.text}”[S1]`));
  assert.ok(result.text.includes("第 3 页"));
  assert.ok(result.text.includes("[引用未验证]"));
  assert.ok(result.text.includes("[页码未验证]"));
  assert.ok(!result.text.includes("从未出现在原文里的这一整段话"));
  assert.deepEqual(
    result.citations.map((item) => item.id),
    ["S1"],
  );
  assert.deepEqual(validatedCitations(["S1", "S1", "S404", null], [citation]), [
    citation,
  ]);
});

test("an allowed maximum offset does not authorize citations spanning gaps in selected text", () => {
  const selected = [
    block("a", "河岸的钟表铺", 0),
    block("b", "第二处已选段落", 100),
  ];
  const ranges = sourceRanges(selected);
  assert.equal(ranges.length, 2);
  assert.equal(rangesContained([{ start: 0, end: 4 }], ranges), true);
  assert.equal(rangesContained([{ start: 0, end: 102 }], ranges), false);
  const crossing = { ...blockCitation(selected[0], "v1", 0), endOffset: 102 };
  assert.equal(citationInBlocks(crossing, selected), false);
});

test("unread aliases, identity details, portraits and relation endpoints are removed", () => {
  const earlyBlock = block("early", "祖父和孙子都叫耿宁。");
  const lateBlock = block("late", "以后才揭示的身份线索。", 100);
  const early = blockCitation(earlyBlock, "v1", 0);
  const late = blockCitation(lateBlock, "v1", 1);
  const grandfather = character("grandfather", early);
  grandfather.aliases = [
    {
      text: "老耿",
      citations: [early],
      kind: "source",
      revealedAt: early.endOffset,
    },
    {
      text: "未读身份",
      citations: [late],
      kind: "source",
      revealedAt: late.endOffset,
    },
  ];
  grandfather.group = "后文才揭示的组织";
  grandfather.groupRevealedAt = late.endOffset;
  grandfather.generation = 4;
  grandfather.generationRevealedAt = late.endOffset;
  grandfather.portrait = {
    id: "portrait",
    url: "/test-portrait.png",
    modelId: "test-model",
    prompt: "测试画像",
    source: "ai-imagined",
    version: 1,
    revealedAt: late.endOffset,
  };
  const grandson = character("grandson", early);
  const stranger = character("stranger", late);
  const relation: CharacterRelation = {
    id: "family",
    sourceId: "grandfather",
    targetId: "grandson",
    type: "祖孙",
    description: "",
    citations: [early],
    revealedAt: early.endOffset,
    kind: "source",
  };
  const result = filterCharacters(
    [grandfather, grandson, stranger],
    [
      relation,
      {
        ...relation,
        id: "later",
        targetId: "stranger",
        citations: [late],
        revealedAt: late.endOffset,
      },
    ],
    early.endOffset,
    [earlyBlock],
  );
  assert.deepEqual(
    result.characters.map((item) => item.id),
    ["grandfather", "grandson"],
  );
  assert.deepEqual(
    result.characters[0].aliases.map((item) => item.text),
    ["老耿"],
  );
  assert.equal(result.characters[0].group, "");
  assert.equal(result.characters[0].generation, null);
  assert.equal(result.characters[0].portrait, undefined);
  assert.deepEqual(
    result.relations.map((item) => item.id),
    ["family"],
  );
  assert.equal(
    grandfather.aliases.length,
    2,
    "filtering must not erase the stored record",
  );

  const selectionOnly = filterCharacters([grandfather, stranger], [], 200, [
    earlyBlock,
  ]);
  assert.deepEqual(
    selectionOnly.characters.map((item) => item.id),
    ["grandfather"],
  );
  assert.deepEqual(
    selectionOnly.characters[0].aliases.map((item) => item.text),
    ["老耿"],
  );
});

test("a mind-map branch is hidden when its parent or citation has not been revealed", () => {
  const node = (
    id: string,
    parentId: string | null,
    revealedAt = 10,
  ): MindMapNode => ({
    id,
    parentId,
    title: id,
    description: "",
    kind: "source",
    citations: [],
    order: 0,
    revealedAt,
  });
  const lateCitation = blockCitation(block("late", "后续情节", 100), "v1", 0);
  const nodes = [
    node("root", null),
    node("visible", "root"),
    node("hidden-parent", "root", 100),
    node("hidden-child", "hidden-parent"),
    { ...node("late-citation", "root"), citations: [lateCitation] },
    node("orphan", "missing-parent"),
  ];
  assert.deepEqual(
    nodeVisibility(nodes, 50).map((item) => item.id),
    ["root", "visible"],
  );
});

test(
  "SSE emits deltas before completion instead of buffering the entire answer",
  { timeout: 3000 },
  async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const response = chatStreamResponse({
      run: async (emit) => {
        emit("delta", { text: "先到达的片段" });
        await gate;
        emit("delta", { text: "后到达的片段" });
        emit("done", { id: "example-message" });
      },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      assert.match(response.headers.get("Content-Type")!, /text\/event-stream/);
      assert.equal(response.headers.get("X-Accel-Buffering"), "no");
      assert.equal(
        decoder.decode((await reader.read()).value),
        ": connected\n\n",
      );
      const first = decoder.decode((await reader.read()).value);
      assert.match(first, /event: delta/);
      assert.ok(first.includes("先到达的片段"));
      assert.ok(!first.includes("后到达的片段"));
      release();
      assert.ok(
        decoder.decode((await reader.read()).value).includes("后到达的片段"),
      );
      assert.match(decoder.decode((await reader.read()).value), /event: done/);
      assert.equal((await reader.read()).done, true);
    } finally {
      release();
      await reader.cancel();
    }
  },
);

test(
  "cancelling the response stream aborts its producer",
  { timeout: 3000 },
  async () => {
    const aborter = new AbortController();
    let producerStopped = false;
    const response = chatStreamResponse({
      aborter,
      run: () =>
        new Promise<void>((resolve) => {
          aborter.signal.addEventListener(
            "abort",
            () => {
              producerStopped = true;
              resolve();
            },
            { once: true },
          );
        }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(aborter.signal.aborted, true);
    assert.equal(producerStopped, true);
  },
);

test(
  "producer failures send a generic SSE error instead of internal details",
  { timeout: 3000 },
  async () => {
    const response = chatStreamResponse({
      run: async () => {
        throw new Error("INTERNAL_DIAGNOSTIC_NOT_FOR_CLIENT");
      },
    });
    const body = await response.text();
    assert.match(body, /event: error/);
    assert.match(body, /STREAM_FAILED/);
    assert.ok(!body.includes("INTERNAL_DIAGNOSTIC_NOT_FOR_CLIENT"));
  },
);
