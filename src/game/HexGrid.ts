// ========================================
// Aeterna Hex Grid - 41 hexes
// ========================================
// Pointy-top hexes. Rows: 1, 4, 7, 6, 7, 6, 5, 4, 1
// Using axial coordinates (q, r) for adjacency math.

import type { HexId } from './types';

interface HexCoord {
  q: number;
  r: number;
}

// Pixel positions extracted from the SVG mockup
const HEX_PIXELS: Record<HexId, { x: number; y: number }> = {
  1:  { x: 314,   y: 75 },
  2:  { x: 194.8, y: 143 },
  3:  { x: 274.3, y: 143 },
  4:  { x: 353.8, y: 143 },
  5:  { x: 433.3, y: 143 },
  6:  { x: 75.5,  y: 211 },
  7:  { x: 155,   y: 211 },
  8:  { x: 234.5, y: 211 },
  9:  { x: 314,   y: 211 },
  10: { x: 393.5, y: 211 },
  11: { x: 473,   y: 211 },
  12: { x: 552.5, y: 211 },
  13: { x: 115.3, y: 279 },
  14: { x: 194.8, y: 279 },
  15: { x: 274.3, y: 279 },
  16: { x: 353.8, y: 279 },
  17: { x: 433.3, y: 279 },
  18: { x: 512.8, y: 279 },
  19: { x: 75.5,  y: 347 },
  20: { x: 155,   y: 347 },
  21: { x: 234.5, y: 347 },
  22: { x: 314,   y: 347 },
  23: { x: 393.5, y: 347 },
  24: { x: 473,   y: 347 },
  25: { x: 552.5, y: 347 },
  26: { x: 115.3, y: 415 },
  27: { x: 194.8, y: 415 },
  28: { x: 274.3, y: 415 },
  29: { x: 353.8, y: 415 },
  30: { x: 433.3, y: 415 },
  31: { x: 512.8, y: 415 },
  32: { x: 155,   y: 483 },
  33: { x: 234.5, y: 483 },
  34: { x: 314,   y: 483 },
  35: { x: 393.5, y: 483 },
  36: { x: 473,   y: 483 },
  37: { x: 194.8, y: 551 },
  38: { x: 274.3, y: 551 },
  39: { x: 353.8, y: 551 },
  40: { x: 433.3, y: 551 },
  41: { x: 314,   y: 619 },
};

// Axial coordinates for each hex (cube coordinates with s = -q-r)
// The board is a hex shape. Using offset rows approach mapped to axial.
// Row by row, assigning (q, r):
const HEX_AXIAL: Record<HexId, HexCoord> = {
  // Row 0 (1 hex)
  1:  { q: 0, r: -4 },
  // Row 1 (4 hexes)
  2:  { q: -2, r: -3 }, 3: { q: -1, r: -3 }, 4: { q: 0, r: -3 }, 5: { q: 1, r: -3 },
  // Row 2 (7 hexes)
  6:  { q: -4, r: -2 }, 7:  { q: -3, r: -2 }, 8:  { q: -2, r: -2 }, 9:  { q: -1, r: -2 },
  10: { q: 0, r: -2 },  11: { q: 1, r: -2 },  12: { q: 2, r: -2 },
  // Row 3 (6 hexes)
  13: { q: -3, r: -1 }, 14: { q: -2, r: -1 }, 15: { q: -1, r: -1 }, 16: { q: 0, r: -1 },
  17: { q: 1, r: -1 },  18: { q: 2, r: -1 },
  // Row 4 (7 hexes)
  19: { q: -4, r: 0 },  20: { q: -3, r: 0 },  21: { q: -2, r: 0 },  22: { q: -1, r: 0 },
  23: { q: 0, r: 0 },   24: { q: 1, r: 0 },    25: { q: 2, r: 0 },
  // Row 5 (6 hexes)
  26: { q: -3, r: 1 },  27: { q: -2, r: 1 },  28: { q: -1, r: 1 },  29: { q: 0, r: 1 },
  30: { q: 1, r: 1 },   31: { q: 2, r: 1 },
  // Row 6 (5 hexes)
  32: { q: -3, r: 2 },  33: { q: -2, r: 2 },  34: { q: -1, r: 2 },  35: { q: 0, r: 2 },
  36: { q: 1, r: 2 },
  // Row 7 (4 hexes)
  37: { q: -2, r: 3 },  38: { q: -1, r: 3 },  39: { q: 0, r: 3 },   40: { q: 1, r: 3 },
  // Row 8 (1 hex)
  41: { q: -1, r: 4 },
};

// Shore hexes: outer ring of the board
const SHORE_HEXES: Set<HexId> = new Set([
  1, 2, 5, 6, 12, 13, 18, 19, 25, 26, 31, 32, 36, 37, 40, 41
]);

// All valid hex IDs
export const ALL_HEX_IDS: HexId[] = Array.from({ length: 41 }, (_, i) => (i + 1) as HexId);

// Pre-compute adjacency map
// In axial coordinates, 6 neighbors: (q+1,r), (q-1,r), (q,r+1), (q,r-1), (q+1,r-1), (q-1,r+1)
const AXIAL_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 }, { q: -1, r: 0 },
  { q: 0, r: 1 }, { q: 0, r: -1 },
  { q: 1, r: -1 }, { q: -1, r: 1 },
];

// Build reverse lookup: axial -> hexId
const axialToId = new Map<string, HexId>();
for (const [idStr, coord] of Object.entries(HEX_AXIAL)) {
  axialToId.set(`${coord.q},${coord.r}`, Number(idStr) as HexId);
}

const ADJACENCY: Map<HexId, HexId[]> = new Map();
for (const [idStr, coord] of Object.entries(HEX_AXIAL)) {
  const id = Number(idStr) as HexId;
  const neighbors: HexId[] = [];
  for (const dir of AXIAL_DIRECTIONS) {
    const nq = coord.q + dir.q;
    const nr = coord.r + dir.r;
    const nId = axialToId.get(`${nq},${nr}`);
    if (nId !== undefined) neighbors.push(nId);
  }
  ADJACENCY.set(id, neighbors);
}

export function getNeighbors(hexId: HexId): HexId[] {
  return ADJACENCY.get(hexId) ?? [];
}

export function isShore(hexId: HexId): boolean {
  return SHORE_HEXES.has(hexId);
}

export function getPixelPos(hexId: HexId): { x: number; y: number } {
  return HEX_PIXELS[hexId];
}

export function getAxial(hexId: HexId): HexCoord {
  return HEX_AXIAL[hexId];
}

export function hexDistance(a: HexId, b: HexId): number {
  const ac = HEX_AXIAL[a];
  const bc = HEX_AXIAL[b];
  return Math.max(
    Math.abs(ac.q - bc.q),
    Math.abs(ac.r - bc.r),
    Math.abs((ac.q + ac.r) - (bc.q + bc.r))
  );
}

/** Check if two hexes are in a straight line (same q, same r, or same s where s=-q-r) */
export function isStraightLine(a: HexId, b: HexId): boolean {
  const ac = HEX_AXIAL[a];
  const bc = HEX_AXIAL[b];
  const as = -ac.q - ac.r;
  const bs = -bc.q - bc.r;
  return ac.q === bc.q || ac.r === bc.r || as === bs;
}

/** Get all hexes along a straight line from `from` to `to` (exclusive of `from`, inclusive of `to`). Returns null if not a straight line. */
export function getLinePath(from: HexId, to: HexId): HexId[] | null {
  if (!isStraightLine(from, to)) return null;
  const ac = HEX_AXIAL[from];
  const bc = HEX_AXIAL[to];
  const dq = Math.sign(bc.q - ac.q);
  const dr = Math.sign(bc.r - ac.r);
  if (dq === 0 && dr === 0) return [];

  const path: HexId[] = [];
  let cq = ac.q + dq;
  let cr = ac.r + dr;
  const dist = hexDistance(from, to);
  for (let i = 0; i < dist; i++) {
    const id = axialToId.get(`${cq},${cr}`);
    if (id === undefined) return null; // off board
    path.push(id);
    cq += dq;
    cr += dr;
  }
  return path;
}

/** Get hexes reachable within `range` steps using BFS. `canEnter` filter decides passability. */
export function getReachableHexes(
  start: HexId,
  range: number,
  canEnter: (hexId: HexId) => boolean,
  canPassThrough?: (hexId: HexId) => boolean,
): Set<HexId> {
  const visited = new Map<HexId, number>(); // hexId -> distance
  visited.set(start, 0);
  const queue: [HexId, number][] = [[start, 0]];
  const reachable = new Set<HexId>();

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!;
    if (dist >= range) continue;

    for (const neighbor of getNeighbors(current)) {
      if (visited.has(neighbor)) continue;
      if (!canEnter(neighbor)) continue;

      visited.set(neighbor, dist + 1);
      reachable.add(neighbor);

      // Can only continue pathfinding through this hex if passable
      const passable = canPassThrough ? canPassThrough(neighbor) : true;
      if (passable) {
        queue.push([neighbor, dist + 1]);
      }
    }
  }

  return reachable;
}

/** Get all hexes in the 6 straight-line directions from a hex, up to `range` hexes. */
export function getLineHexes(from: HexId, range: number): { direction: HexCoord; hexes: HexId[] }[] {
  const result: { direction: HexCoord; hexes: HexId[] }[] = [];
  const ac = HEX_AXIAL[from];

  for (const dir of AXIAL_DIRECTIONS) {
    const hexes: HexId[] = [];
    for (let i = 1; i <= range; i++) {
      const id = axialToId.get(`${ac.q + dir.q * i},${ac.r + dir.r * i}`);
      if (id === undefined) break; // off board
      hexes.push(id);
    }
    if (hexes.length > 0) {
      result.push({ direction: dir, hexes });
    }
  }

  return result;
}

export function hexIdFromAxial(q: number, r: number): HexId | undefined {
  return axialToId.get(`${q},${r}`);
}
