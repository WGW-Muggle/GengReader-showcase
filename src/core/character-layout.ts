/** Deterministic, browser-independent geometry for the character relationship map. */
export interface LayoutCharacter {
  id: string;
  group: string;
  generation: number | null;
}

export interface LayoutRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
}

export interface CharacterPoint {
  id: string;
  x: number;
  y: number;
}

export interface CharacterBand {
  generation: number | null;
  y: number;
}

export interface CharacterLayout {
  nodes: CharacterPoint[];
  width: number;
  height: number;
  mode: 'relationships' | 'generation';
  bands: CharacterBand[];
}

export const CHARACTER_NODE_WIDTH = 164;
export const CHARACTER_NODE_HEIGHT = 68;
const X_STEP = 216;
const Y_STEP = 132;
const MARGIN = 48;

type Point = { x: number; y: number };

function columnsFor(count: number, aspectRatio: number) {
  let best = 1;
  let bestSize = Infinity;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const width =
      (columns - 1) * X_STEP +
      CHARACTER_NODE_WIDTH +
      MARGIN * 2 +
      (rows > 1 ? 20 : 0);
    const height = (rows - 1) * Y_STEP + CHARACTER_NODE_HEIGHT + MARGIN * 2;
    const size = Math.max(width / aspectRatio, height);
    if (size < bestSize) {
      best = columns;
      bestSize = size;
    }
  }
  return best;
}

function adjacencyFor(
  characters: LayoutCharacter[],
  relations: LayoutRelation[]
) {
  const adjacency = new Map(characters.map((c) => [c.id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.sourceId === relation.targetId) continue;
    if (!adjacency.has(relation.sourceId) || !adjacency.has(relation.targetId))
      continue;
    adjacency.get(relation.sourceId)!.add(relation.targetId);
    adjacency.get(relation.targetId)!.add(relation.sourceId);
  }
  return adjacency;
}

/** Place close relationships and common groups together without moving on selection. */
function arrangeComponent(
  characters: LayoutCharacter[],
  adjacency: Map<string, Set<string>>,
  aspectRatio: number
) {
  const columns = columnsFor(characters.length, aspectRatio);
  const rows = Math.ceil(characters.length / columns);
  const slots = characters.map((_, i) => ({
    x: (i % columns) * X_STEP + (Math.floor(i / columns) % 2 ? 20 : 0),
    y: Math.floor(i / columns) * Y_STEP,
  }));
  const center = {
    x: ((columns - 1) * X_STEP) / 2,
    y: ((rows - 1) * Y_STEP) / 2,
  };
  slots.sort(
    (a, b) =>
      Math.hypot(a.x - center.x, a.y - center.y) -
      Math.hypot(b.x - center.x, b.y - center.y)
  );
  const sorted = [...characters].sort(
    (a, b) =>
      adjacency.get(b.id)!.size - adjacency.get(a.id)!.size ||
      a.id.localeCompare(b.id)
  );
  const weights = sorted.map((a) =>
    sorted.map(
      (b) =>
        (adjacency.get(a.id)!.has(b.id) ? 4 : 0) +
        (a.group && a.group === b.group ? 0.7 : 0)
    )
  );
  const distance = (a: Point, b: Point) =>
    Math.hypot((a.x - b.x) / X_STEP, (a.y - b.y) / Y_STEP);
  // A small discrete relaxation retains a compact, collision-free envelope. A free
  // force simulation can stretch a hub or a chain until every name becomes tiny.
  const passes = Math.min(8, Math.max(1, Math.floor(160 / sorted.length)));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let a = 0; a < sorted.length; a++) {
      for (let b = a + 1; b < sorted.length; b++) {
        // Large casts only exchange nearby slots; keep interaction responsive.
        if (sorted.length > 80 && distance(slots[a], slots[b]) > 2.1) continue;
        let before = 0;
        let after = 0;
        for (let other = 0; other < sorted.length; other++) {
          if (other === a || other === b) continue;
          before +=
            weights[a][other] * distance(slots[a], slots[other]) +
            weights[b][other] * distance(slots[b], slots[other]);
          after +=
            weights[a][other] * distance(slots[b], slots[other]) +
            weights[b][other] * distance(slots[a], slots[other]);
        }
        if (after + 0.01 < before) {
          [slots[a], slots[b]] = [slots[b], slots[a]];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return {
    nodes: sorted.map((c, i) => ({
      id: c.id,
      x: slots[i].x + CHARACTER_NODE_WIDTH / 2,
      y: slots[i].y + CHARACTER_NODE_HEIGHT / 2,
    })),
    width: Math.max(...slots.map((p) => p.x)) + CHARACTER_NODE_WIDTH,
    height: (rows - 1) * Y_STEP + CHARACTER_NODE_HEIGHT,
  };
}

export function layoutCharacters(
  characters: LayoutCharacter[],
  relations: LayoutRelation[],
  generation = false,
  aspectRatio = 1.55
): CharacterLayout {
  if (!characters.length)
    return {
      nodes: [],
      width: 640,
      height: 440,
      mode: 'relationships',
      bands: [],
    };
  const adjacency = adjacencyFor(characters, relations);
  const known = characters.filter(
    (c) => c.generation !== null && Number.isFinite(c.generation)
  );
  if (generation && known.length) {
    const columns = Math.max(2, columnsFor(characters.length, aspectRatio));
    const values = [...new Set(known.map((c) => c.generation!))].sort(
      (a, b) => a - b
    );
    const bands: CharacterBand[] = [];
    const nodes: CharacterPoint[] = [];
    let y = MARGIN;
    for (const value of [...values, null]) {
      const members = characters.filter((c) =>
        value === null
          ? c.generation === null || !Number.isFinite(c.generation)
          : c.generation === value
      );
      if (!members.length) continue;
      bands.push({ generation: value, y });
      y += 36;
      members.sort(
        (a, b) =>
          a.group.localeCompare(b.group) ||
          adjacency.get(b.id)!.size - adjacency.get(a.id)!.size ||
          a.id.localeCompare(b.id)
      );
      members.forEach((c, index) =>
        nodes.push({
          id: c.id,
          x: MARGIN + CHARACTER_NODE_WIDTH / 2 + (index % columns) * X_STEP,
          y:
            y +
            CHARACTER_NODE_HEIGHT / 2 +
            Math.floor(index / columns) * Y_STEP,
        })
      );
      y +=
        (Math.ceil(members.length / columns) - 1) * Y_STEP +
        CHARACTER_NODE_HEIGHT +
        56;
    }
    return {
      nodes,
      width: Math.max(
        640,
        ...nodes.map((p) => p.x + CHARACTER_NODE_WIDTH / 2 + MARGIN)
      ),
      height: Math.max(440, y),
      mode: 'generation',
      bands,
    };
  }

  const byId = new Map(characters.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const components: LayoutCharacter[][] = [];
  const isolated: LayoutCharacter[] = [];
  for (const character of [...characters].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    if (visited.has(character.id)) continue;
    if (!adjacency.get(character.id)!.size) {
      isolated.push(character);
      visited.add(character.id);
      continue;
    }
    const queue = [character.id];
    const component: LayoutCharacter[] = [];
    visited.add(character.id);
    for (let i = 0; i < queue.length; i++) {
      component.push(byId.get(queue[i])!);
      for (const neighbor of adjacency.get(queue[i])!) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  // Use the main component's spare peripheral cells for isolated people. Giving
  // three unconnected people a new rectangular block wastes two entire rows.
  // They still have no edges; group affinity places them near their actual group.
  components.sort((a, b) => b.length - a.length);
  if (isolated.length) {
    if (components.length) components[0].push(...isolated);
    else components.push(isolated);
  }
  const boxes = components
    .sort((a, b) => b.length - a.length)
    .map((component) => arrangeComponent(component, adjacency, aspectRatio));
  const targetWidth = Math.max(
    ...boxes.map((box) => box.width),
    Math.sqrt(
      boxes.reduce(
        (sum, box) => sum + (box.width + 64) * (box.height + 64),
        0
      ) * aspectRatio
    )
  );
  const nodes: CharacterPoint[] = [];
  let x = MARGIN;
  let y = MARGIN;
  let rowHeight = 0;
  for (const box of boxes) {
    if (x > MARGIN && x + box.width > targetWidth + MARGIN) {
      x = MARGIN;
      y += rowHeight + 64;
      rowHeight = 0;
    }
    nodes.push(
      ...box.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y }))
    );
    x += box.width + 64;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return {
    nodes,
    width: Math.max(
      640,
      ...nodes.map((p) => p.x + CHARACTER_NODE_WIDTH / 2 + MARGIN)
    ),
    height: Math.max(
      440,
      ...nodes.map((p) => p.y + CHARACTER_NODE_HEIGHT / 2 + MARGIN)
    ),
    mode: 'relationships',
    bands: [],
  };
}

function onBoundary(node: Point, toward: Point): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const ratio = Math.min(
    (CHARACTER_NODE_WIDTH / 2 + 4) / Math.max(Math.abs(dx), 0.001),
    (CHARACTER_NODE_HEIGHT / 2 + 4) / Math.max(Math.abs(dy), 0.001)
  );
  return { x: node.x + dx * ratio, y: node.y + dy * ratio };
}

export function curvePoint(
  start: Point,
  control: Point,
  end: Point,
  t: number
): Point {
  return {
    x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
    y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
  };
}

export interface CharacterEdge {
  relation: LayoutRelation;
  path: string;
  start: Point;
  control: Point;
  end: Point;
}

/** Curves stop at card boundaries and prefer lanes that avoid other people. */
export function routeCharacterEdges(
  layout: CharacterLayout,
  relations: LayoutRelation[]
): CharacterEdge[] {
  const points = new Map(layout.nodes.map((node) => [node.id, node]));
  const pairs = new Map<string, number>();
  return relations.flatMap((relation) => {
    const a = points.get(relation.sourceId);
    const b = points.get(relation.targetId);
    if (!a || !b) return [];
    if (a.id === b.id) {
      const start = { x: a.x + 44, y: a.y - CHARACTER_NODE_HEIGHT / 2 - 3 };
      const end = { x: a.x - 44, y: start.y };
      const control = { x: a.x, y: a.y - 112 };
      return [
        {
          relation,
          start,
          control,
          end,
          path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        },
      ];
    }
    const pair = [a.id, b.id].sort().join('|');
    const lane = pairs.get(pair) || 0;
    pairs.set(pair, lane + 1);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    let best:
      { start: Point; control: Point; end: Point; score: number } | undefined;
    for (const bend of [24, -24, 68, -68, 120, -120, 184, -184, 256, -256]) {
      const amount = bend + (bend > 0 ? 1 : -1) * lane * 24;
      const control = {
        x: (a.x + b.x) / 2 + normal.x * amount,
        y: (a.y + b.y) / 2 + normal.y * amount,
      };
      const start = onBoundary(a, control);
      const end = onBoundary(b, control);
      let score = Math.abs(amount);
      for (let step = 1; step < 20; step++) {
        const point = curvePoint(start, control, end, step / 20);
        if (
          point.x < 12 ||
          point.y < 12 ||
          point.x > layout.width - 12 ||
          point.y > layout.height - 12
        )
          score += 1000;
        for (const node of layout.nodes) {
          if (node.id === a.id || node.id === b.id) continue;
          if (
            Math.abs(node.x - point.x) < CHARACTER_NODE_WIDTH / 2 + 9 &&
            Math.abs(node.y - point.y) < CHARACTER_NODE_HEIGHT / 2 + 9
          )
            score += 10000;
        }
      }
      if (!best || score < best.score) best = { start, control, end, score };
    }
    const { start, control, end } = best!;
    return [
      {
        relation,
        start,
        control,
        end,
        path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      },
    ];
  });
}

export function characterEdgeLabels(
  layout: CharacterLayout,
  edges: CharacterEdge[],
  selected = ''
) {
  const labels: {
    id: string;
    x: number;
    y: number;
    width: number;
    text: string;
  }[] = [];
  const ordered = [...edges].sort(
    (a, b) =>
      Number(
        b.relation.sourceId === selected || b.relation.targetId === selected
      ) -
      Number(
        a.relation.sourceId === selected || a.relation.targetId === selected
      )
  );
  for (const edge of ordered) {
    const direct =
      edge.relation.sourceId === selected ||
      edge.relation.targetId === selected;
    if (selected && !direct) continue;
    const text =
      edge.relation.type.length > 12
        ? `${edge.relation.type.slice(0, 11)}…`
        : edge.relation.type;
    const width = Math.max(
      42,
      [...text].reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 255 ? 14 : 8),
        18
      )
    );
    for (const t of [0.5, 0.35, 0.65, 0.22, 0.78]) {
      const point = curvePoint(edge.start, edge.control, edge.end, t);
      if (
        point.x - width / 2 < 8 ||
        point.x + width / 2 > layout.width - 8 ||
        point.y < 16 ||
        point.y > layout.height - 16
      )
        continue;
      if (
        layout.nodes.some(
          (node) =>
            Math.abs(node.x - point.x) <
              (CHARACTER_NODE_WIDTH + width) / 2 + 6 &&
            Math.abs(node.y - point.y) < CHARACTER_NODE_HEIGHT / 2 + 20
        )
      )
        continue;
      if (
        labels.some(
          (label) =>
            Math.abs(label.x - point.x) < (label.width + width) / 2 + 8 &&
            Math.abs(label.y - point.y) < 30
        )
      )
        continue;
      labels.push({ id: edge.relation.id, ...point, width, text });
      break;
    }
  }
  return labels;
}
