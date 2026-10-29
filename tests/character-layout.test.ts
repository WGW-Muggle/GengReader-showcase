import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARACTER_NODE_HEIGHT,
  CHARACTER_NODE_WIDTH,
  characterEdgeLabels,
  layoutCharacters,
  routeCharacterEdges,
  type CharacterLayout,
  type LayoutCharacter,
  type LayoutRelation,
} from '../src/core/character-layout';

const characters = (count: number): LayoutCharacter[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `person-${String(i).padStart(2, '0')}`,
    group: `group-${Math.floor(i / 6)}`,
    generation: null,
  }));
const relation = (
  source: LayoutCharacter,
  target: LayoutCharacter,
  index = 0
): LayoutRelation => ({
  id: `${source.id}-${target.id}-${index}`,
  sourceId: source.id,
  targetId: target.id,
  type: '亲属关系',
});
function assertNoOverlap(layout: CharacterLayout) {
  for (let i = 0; i < layout.nodes.length; i++) {
    const node = layout.nodes[i];
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(
      node.x - CHARACTER_NODE_WIDTH / 2 >= 0 &&
        node.x + CHARACTER_NODE_WIDTH / 2 <= layout.width
    );
    assert.ok(
      node.y - CHARACTER_NODE_HEIGHT / 2 >= 0 &&
        node.y + CHARACTER_NODE_HEIGHT / 2 <= layout.height
    );
    for (const other of layout.nodes.slice(i + 1)) {
      assert.ok(
        Math.abs(node.x - other.x) >= CHARACTER_NODE_WIDTH ||
          Math.abs(node.y - other.y) >= CHARACTER_NODE_HEIGHT,
        `${node.id} overlaps ${other.id}`
      );
    }
  }
}

test('24 characters with unknown generations form a readable balanced graph, even in generation mode', () => {
  const people = characters(24);
  const relations = people
    .slice(1)
    .map((person, index) => relation(people[index], person));
  const result = layoutCharacters(people, relations, true);
  assert.equal(result.mode, 'relationships');
  assert.equal(result.nodes.length, 24);
  assert.ok(new Set(result.nodes.map((node) => node.y)).size >= 4);
  assert.ok(result.width / result.height < 2.1);
  assert.ok(result.width < 1200);
  assertNoOverlap(result);
  assert.deepEqual(
    layoutCharacters([...people].reverse(), relations, true),
    result,
    'Input ordering does not move the graph'
  );
});

test('disconnected groups and isolated people remain visible without synthetic edges', () => {
  const people = characters(24);
  const relations = [
    relation(people[0], people[1]),
    relation(people[2], people[3]),
    relation(people[4], people[5]),
  ];
  const result = layoutCharacters(people, relations);
  assert.equal(result.nodes.length, people.length);
  assert.equal(
    new Set(result.nodes.map((node) => node.id)).size,
    people.length
  );
  assert.ok(result.width / result.height < 2.6);
  assertNoOverlap(result);
  assert.equal(routeCharacterEdges(result, relations).length, 3);
});

test('a 21-person component and three isolated people fit a desktop canvas without wasting rows', () => {
  const people = characters(24);
  const links = people
    .slice(1, 21)
    .map((person, index) => relation(people[index], person));
  const result = layoutCharacters(people, links, false, 1125 / 560);
  assert.equal(result.nodes.length, 24);
  assert.ok(new Set(result.nodes.map((node) => node.y)).size <= 4);
  const fittedUnit = Math.min(1125 / result.width, 560 / result.height);
  assert.ok(
    16 * fittedUnit >= 12,
    'Names remain readable in the complete desktop overview'
  );
  assertNoOverlap(result);
});

test('known generations retain their order, while unknown generations have a separate band', () => {
  const people = characters(25).map((person, i) => ({
    ...person,
    generation: i < 9 ? 0 : i < 18 ? 1 : i < 22 ? 3 : null,
  }));
  const result = layoutCharacters(people, [], true);
  assert.equal(result.mode, 'generation');
  assert.deepEqual(
    result.bands.map((band) => band.generation),
    [0, 1, 3, null]
  );
  for (const generation of [0, 1]) {
    const current = result.nodes.filter(
      (node) => people.find((p) => p.id === node.id)!.generation === generation
    );
    const later = result.nodes.filter(
      (node) =>
        (people.find((p) => p.id === node.id)!.generation ?? -1) > generation
    );
    assert.ok(
      Math.max(...current.map((node) => node.y)) <
        Math.min(...later.map((node) => node.y))
    );
  }
  assertNoOverlap(result);
});

test('dense hub routes have finite geometry and labels never cover names or each other', () => {
  const people = characters(24);
  const relations = people
    .slice(1)
    .map((person) => relation(people[0], person));
  relations.push(relation(people[1], people[0], 1));
  const layout = layoutCharacters(people, relations);
  assertNoOverlap(layout);
  const edges = routeCharacterEdges(layout, relations);
  assert.equal(edges.length, relations.length);
  for (const edge of edges) assert.ok(!/NaN|Infinity/.test(edge.path));
  const labels = characterEdgeLabels(layout, edges, people[1].id);
  assert.ok(labels.length > 0);
  for (const [index, label] of labels.entries()) {
    assert.ok(
      relations.some(
        (r) =>
          r.id === label.id &&
          (r.sourceId === people[1].id || r.targetId === people[1].id)
      )
    );
    for (const node of layout.nodes)
      assert.ok(
        Math.abs(node.x - label.x) >=
          (CHARACTER_NODE_WIDTH + label.width) / 2 ||
          Math.abs(node.y - label.y) >= CHARACTER_NODE_HEIGHT / 2 + 12
      );
    for (const other of labels.slice(index + 1))
      assert.ok(
        Math.abs(other.x - label.x) >= (other.width + label.width) / 2 ||
          Math.abs(other.y - label.y) >= 24
      );
  }
});

test('filtered endpoints, empty graphs and self-relations do not break routing', () => {
  assert.deepEqual(layoutCharacters([], [], true).nodes, []);
  const people = characters(2);
  const relations = [
    relation(people[0], people[1]),
    relation(people[0], people[0]),
  ];
  const layout = layoutCharacters([people[0]], relations);
  assertNoOverlap(layout);
  const edges = routeCharacterEdges(layout, relations);
  assert.equal(edges.length, 1);
  assert.ok(!/NaN|Infinity/.test(edges[0].path));
});
