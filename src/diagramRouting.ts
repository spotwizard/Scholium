export type DiagramPoint = { x: number; y: number };
export type DiagramBox = { id: string; left: number; top: number; width: number; height: number };
export type DiagramConnection = { source: string; target: string };
type Side = "left" | "right" | "top" | "bottom";
type Port = { id: string; side: Side; edge: number; end: number };
type GridPort = DiagramPoint & { gx: number; gy: number; vertical: boolean };
type SearchNode = { x: number; y: number; direction: number; key: number; cost: number; estimate: number };

/** Route the approved reading layout with independent ports and no shared segments. */
export function routeDiagramConnections(
  boxes: DiagramBox[], connections: DiagramConnection[], obstacles: DiagramBox[],
  width: number, height: number,
): DiagramPoint[][] {
  const step = 8;
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  if (columns * rows > 500_000) throw new Error("Diagram routing area is too large");
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const blocked = new Set<number>();
  for (const box of [...boxes, ...obstacles]) {
    for (let x = Math.floor((box.left - 5) / step); x <= Math.ceil((box.left + box.width + 5) / step); x++) {
      for (let y = Math.floor((box.top - 5) / step); y <= Math.ceil((box.top + box.height + 5) / step); y++) {
        blocked.add(y * columns + x);
      }
    }
  }
  const ports = new Map<string, Port[]>();
  function unobstructedSide(box: DiagramBox, other: DiagramBox, preferred: Side): Side {
    const toward: Side = other.left + other.width / 2 < box.left + box.width / 2 ? "left" : "right";
    const outside: Side = box.left + box.width / 2 < width / 2 ? "left" : "right";
    const candidates: Side[] = [preferred, outside, toward, outside === "left" ? "right" : "left", "bottom", "top"];
    return candidates.find((side) => {
      // A close heading must not force the title away from its own content.
      // Use a free side of the node for the port's lead instead.
      const lane = side === "top" ? { left: box.left, top: box.top - 32, width: box.width, height: 32 }
        : side === "bottom" ? { left: box.left, top: box.top + box.height, width: box.width, height: 32 }
        : side === "left" ? { left: box.left - 32, top: box.top, width: 32, height: box.height }
        : { left: box.left + box.width, top: box.top, width: 32, height: box.height };
      return ![...boxes, ...obstacles].some((obstacle) => obstacle.id !== box.id &&
        lane.left < obstacle.left + obstacle.width + 5 && lane.left + lane.width > obstacle.left - 5 &&
        lane.top < obstacle.top + obstacle.height + 5 && lane.top + lane.height > obstacle.top - 5);
    }) ?? preferred;
  }
  const ends = connections.map(({ source, target }, edge) => {
    const a = byId.get(source), b = byId.get(target);
    if (!a || !b) throw new Error("Missing diagram connection endpoint");
    const sides: Side[] = Math.abs(a.top - b.top) < 4
      ? a.left < b.left ? ["right", "left"] : ["left", "right"]
      : a.top < b.top ? ["bottom", "top"] : ["top", "bottom"];
    return [source, target].map((id, end) => {
      const port = { id, side: unobstructedSide(end ? b : a, end ? a : b, sides[end]), edge, end };
      const key = `${id}:${port.side}`;
      const list = ports.get(key) ?? [];
      list.push(port);
      ports.set(key, list);
      return port;
    });
  });
  for (const list of ports.values()) {
    list.sort((a, b) => {
      const other = (port: Port) => byId.get(connections[port.edge][port.end ? "source" : "target"])!;
      const ar = other(a), br = other(b);
      return ar.left - br.left || ar.top - br.top || a.edge - b.edge;
    });
  }
  function position(port: Port): GridPort {
    const box = byId.get(port.id)!;
    const list = ports.get(`${port.id}:${port.side}`)!;
    const fraction = (list.indexOf(port) + 1) / (list.length + 1);
    const vertical = port.side === "top" || port.side === "bottom";
    const x = vertical
      ? Math.round((box.left + 18 + (box.width - 36) * fraction) / step) * step
      : box.left + (port.side === "right" ? box.width : 0);
    const y = vertical
      ? box.top + (port.side === "bottom" ? box.height : 0)
      : Math.round((box.top + 18 + (box.height - 36) * fraction) / step) * step;
    return {
      x, y, vertical,
      gx: Math.round((x + (port.side === "left" ? -24 : port.side === "right" ? 24 : 0)) / step),
      gy: Math.round((y + (port.side === "top" ? -24 : port.side === "bottom" ? 24 : 0)) / step),
    };
  }
  const endpoints = ends.map((pair) => pair.map(position));
  // Reserve each short port lead as well as the node interior.
  for (const pair of endpoints) for (const p of pair) {
    blocked.add(p.gy * columns + p.gx);
    if (p.vertical) {
      const y = Math.round(p.y / step);
      for (let row = Math.min(y, p.gy); row <= Math.max(y, p.gy); row++) {
        if (row !== p.gy) blocked.add(row * columns + p.gx);
      }
    } else {
      const x = Math.round(p.x / step);
      for (let column = Math.min(x, p.gx); column <= Math.max(x, p.gx); column++) {
        if (column !== p.gx) blocked.add(p.gy * columns + column);
      }
    }
  }
  const usedSegments = new Set<string>(), usedPoints = new Set<number>();
  function route(start: GridPort, end: GridPort) {
    const queue: SearchNode[] = [];
    function push(value: SearchNode) {
      let index = queue.length;
      queue.push(value);
      while (index) {
        const parent = (index - 1) >> 1;
        if (queue[parent].estimate <= value.estimate) break;
        queue[index] = queue[parent]; index = parent;
      }
      queue[index] = value;
    }
    function pop() {
      const first = queue[0], last = queue.pop()!;
      if (queue.length) {
        let index = 0;
        while (index * 2 + 1 < queue.length) {
          let child = index * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1].estimate < queue[child].estimate) child++;
          if (queue[child].estimate >= last.estimate) break;
          queue[index] = queue[child]; index = child;
        }
        queue[index] = last;
      }
      return first;
    }
    const key = (x: number, y: number, direction: number) => (y * columns + x) * 3 + direction;
    const distances = new Map<number, number>(), parents = new Map<number, number>();
    const first = key(start.gx, start.gy, 0);
    distances.set(first, 0);
    push({ x: start.gx, y: start.gy, direction: 0, key: first, cost: 0, estimate: 0 });
    let last: number | undefined;
    while (queue.length) {
      const current = pop();
      if (current.cost !== distances.get(current.key)) continue;
      if (current.x === end.gx && current.y === end.gy) { last = current.key; break; }
      for (const [dx, dy, direction] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]]) {
        const x = current.x + dx, y = current.y + dy, point = y * columns + x;
        if (x < 1 || y < 1 || x >= columns - 1 || y >= rows - 1 ||
          (blocked.has(point) && !(x === end.gx && y === end.gy))) continue;
        const previous = current.y * columns + current.x;
        const segment = `${Math.min(previous, point)}:${Math.max(previous, point)}`;
        if (usedSegments.has(segment)) continue;
        const cost = current.cost + 10 + (current.direction && current.direction !== direction ? 5 : 0) + (usedPoints.has(point) ? 12 : 0);
        const nextKey = key(x, y, direction);
        if (cost >= (distances.get(nextKey) ?? Infinity)) continue;
        distances.set(nextKey, cost); parents.set(nextKey, current.key);
        push({ x, y, direction, key: nextKey, cost, estimate: cost + (Math.abs(x - end.gx) + Math.abs(y - end.gy)) * 10 });
      }
    }
    if (last === undefined) throw new Error("No independent diagram route");
    const points: DiagramPoint[] = [];
    for (let k: number | undefined = last; k !== undefined; k = parents.get(k)) {
      const point = Math.floor(k / 3);
      points.unshift({ x: point % columns, y: Math.floor(point / columns) });
    }
    points.forEach((p, index) => {
      const point = p.y * columns + p.x;
      usedPoints.add(point);
      if (index) {
        const previous = points[index - 1].y * columns + points[index - 1].x;
        usedSegments.add(`${Math.min(previous, point)}:${Math.max(previous, point)}`);
      }
    });
    return points.filter((p, index) => !index || index === points.length - 1 ||
      ((points[index - 1].x === p.x) !== (points[index + 1].x === p.x)))
      .map(({ x, y }) => ({ x: x * step, y: y * step }));
  }
  const result: DiagramPoint[][] = new Array(connections.length);
  const order = endpoints.map(([start, end], index) => ({ index, start, end }))
    .sort((a, b) => (Math.abs(b.start.x - b.end.x) + Math.abs(b.start.y - b.end.y)) - (Math.abs(a.start.x - a.end.x) + Math.abs(a.start.y - a.end.y)));
  for (const { start, end, index } of order) {
    let middle: DiagramPoint[];
    try { middle = route(start, end); }
    catch { throw new Error(`Unable to route diagram connection ${index + 1}`); }
    const first = middle[0], last = middle[middle.length - 1];
    result[index] = [
      { x: start.x, y: start.y },
      start.vertical ? { x: start.x, y: first.y } : { x: first.x, y: start.y },
      ...middle,
      end.vertical ? { x: end.x, y: last.y } : { x: last.x, y: end.y },
      { x: end.x, y: end.y },
    ];
  }
  return result;
}
