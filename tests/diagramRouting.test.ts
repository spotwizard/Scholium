import assert from "node:assert/strict";
import test from "node:test";
import { routeDiagramConnections, type DiagramBox, type DiagramPoint } from "../src/diagramRouting.ts";

function checkRoutes(boxes: DiagramBox[], edges: { source: string; target: string }[], routes: DiagramPoint[][]) {
  assert.equal(routes.length, edges.length);
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const segments: { edge: number; a: DiagramPoint; b: DiagramPoint }[] = [];
  function onBoundary(point: DiagramPoint, box: DiagramBox) {
    const right = box.left + box.width, bottom = box.top + box.height;
    return (Math.abs(point.x - box.left) < 0.01 || Math.abs(point.x - right) < 0.01) && point.y >= box.top && point.y <= bottom ||
      (Math.abs(point.y - box.top) < 0.01 || Math.abs(point.y - bottom) < 0.01) && point.x >= box.left && point.x <= right;
  }
  routes.forEach((points, index) => {
    assert.ok(onBoundary(points[0], byId.get(edges[index].source)!));
    assert.ok(onBoundary(points[points.length - 1], byId.get(edges[index].target)!));
    points.slice(1).forEach((b, i) => {
      const a = points[i];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) return;
      assert.ok(a.x === b.x || a.y === b.y, "all segments must be orthogonal");
      segments.push({ edge: index, a, b });
      for (const box of boxes) {
        const enters = a.x === b.x
          ? a.x > box.left && a.x < box.left + box.width && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.top + box.height
          : a.y > box.top && a.y < box.top + box.height && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.left + box.width;
        assert.equal(enters, false, `edge ${index} crosses node ${box.id}`);
      }
    });
  });
  segments.forEach((a, index) => segments.slice(index + 1).forEach((b) => {
    if (a.edge === b.edge || (a.a.x === a.b.x) !== (b.a.x === b.b.x)) return;
    const fixed = a.a.x === a.b.x ? "x" : "y", varying = fixed === "x" ? "y" : "x";
    if (a.a[fixed] !== b.a[fixed]) return;
    const overlap = Math.min(Math.max(a.a[varying], a.b[varying]), Math.max(b.a[varying], b.b[varying])) -
      Math.max(Math.min(a.a[varying], a.b[varying]), Math.min(b.a[varying], b.b[varying]));
    assert.ok(overlap <= 0, `edges ${a.edge} and ${b.edge} share a segment`);
  }));
}

test("grouped reading chart preserves 22 independent connections around headings and nodes", () => {
  const placements = [
    [64, 148.5, 102], [341.328125, 148.5, 102], [618.65625, 148.5, 102], [64, 330.5, 81],
    [64, 588, 98], [341.328125, 588, 98],
    [64, 862.5, 98], [341.328125, 862.5, 98], [618.65625, 862.5, 98],
    [64, 1040.5, 98], [341.328125, 1040.5, 98],
    [64, 1315, 105], [341.328125, 1315, 105],
    [64, 1596.5, 77], [341.328125, 1596.5, 77], [618.65625, 1596.5, 77],
    [64, 1753.5, 101], [341.328125, 1753.5, 101],
  ];
  const nodes = placements.map(([left, top, height], i) => ({ id: `n${i}`, left, top, height, width: 213.328125 }));
  const headings = [[40, 318.765625], [479.5, 188], [754, 283.84375], [1206.5, 241.09375], [1488, 173]]
    .map(([top, width], i) => ({ id: `g${i}`, left: 64, top, width, height: 28.5 }));
  const edges = [[1, 2], [2, 0], [0, 3], [0, 4], [0, 5], [5, 4], [5, 6], [5, 7], [5, 8], [5, 9],
    [6, 11], [7, 11], [8, 11], [6, 10], [8, 10], [9, 10], [10, 12], [10, 13], [10, 14], [6, 15], [6, 16], [5, 17]]
    .map(([from, to]) => ({ source: `n${from}`, target: `n${to}` }));
  checkRoutes([...nodes, ...headings], edges, routeDiagramConnections(nodes, edges, headings, 896, 1930.5));
  const groupForNode = [0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4];
  const closeNodes = nodes.map((node, i) => ({ ...node, top: node.top - 56 * (groupForNode[i] + 1) }));
  const closeHeadings = headings.map((heading, i) => ({ ...heading, top: heading.top - 56 * i }));
  checkRoutes([...closeNodes, ...closeHeadings], edges, routeDiagramConnections(closeNodes, edges, closeHeadings, 896, 1930.5 - 56 * 5));
  const twoColumnPlacements = [[64,92.5,98],[382,92.5,98],[64,270.5,81],[382,270.5,81],
    [64,472,98],[382,472,98],[64,690.5,77],[382,690.5,77],[64,847.5,77],[382,847.5,77],
    [64,1004.5,77],[64,1202,81],[382,1202,81],[64,1403.5,77],[382,1403.5,77],
    [64,1560.5,101],[382,1560.5,101],[64,1741.5,77]];
  const twoColumnNodes = twoColumnPlacements.map(([left, top, height], i) => ({ id: `n${i}`, left, top, height, width: 254 }));
  const twoColumnHeadings = headings.map((heading, i) => ({ ...heading, top: [40,419.5,638,1149.5,1351][i] }));
  checkRoutes([...twoColumnNodes, ...twoColumnHeadings], edges, routeDiagramConnections(twoColumnNodes, edges, twoColumnHeadings, 700, 1894.5));
});

test("parallel and self connections keep separate ports", () => {
  const nodes = [{ id: "a", left: 80, top: 80, width: 180, height: 100 }, { id: "b", left: 360, top: 80, width: 180, height: 100 }];
  const edges = [{ source: "a", target: "b" }, { source: "a", target: "b" }, { source: "a", target: "a" }];
  checkRoutes(nodes, edges, routeDiagramConnections(nodes, edges, [], 640, 360));
  assert.throws(() => routeDiagramConnections(nodes, [{ source: "missing", target: "a" }], [], 640, 360), /Missing/);
});
