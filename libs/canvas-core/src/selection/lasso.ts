/**
 * Lasso path simplification — Ramer-Douglas-Peucker (FR-4 / NFR-2).
 *
 * Touch lassos sample at ~120 Hz, producing dense paths (~600 points per
 * second). For storage and rendering we run RDP with a 1 px epsilon so
 * the simplified path stays visually identical at 100% zoom while
 * dropping ~85% of redundant points.
 */

import type { Point2D, ReadonlyPoint2D } from './types';

/** Default tolerance — 1 px keeps the simplified path indistinguishable
 * at 100% zoom (NFR-2). */
export const DEFAULT_RDP_EPSILON = 1.0;

/** Squared perpendicular distance from `p` to the segment `a → b`. */
const perpDistanceSq = (
  p: ReadonlyPoint2D,
  a: ReadonlyPoint2D,
  b: ReadonlyPoint2D,
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  const num = dy * p.x - dx * p.y + b.x * a.y - b.y * a.x;
  return (num * num) / (dx * dx + dy * dy);
};

const rdpRecurse = (
  points: ReadonlyArray<ReadonlyPoint2D>,
  start: number,
  end: number,
  epsilonSq: number,
  keep: boolean[],
): void => {
  if (end <= start + 1) return;
  let maxDistSq = 0;
  let maxIdx = -1;
  const a = points[start]!;
  const b = points[end]!;
  for (let i = start + 1; i < end; i++) {
    const distSq = perpDistanceSq(points[i]!, a, b);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxIdx = i;
    }
  }
  if (maxDistSq > epsilonSq && maxIdx > 0) {
    keep[maxIdx] = true;
    rdpRecurse(points, start, maxIdx, epsilonSq, keep);
    rdpRecurse(points, maxIdx, end, epsilonSq, keep);
  }
};

/**
 * Simplify a lasso path using Ramer-Douglas-Peucker.
 *
 * Returns a new array — the input is not mutated. Endpoints are always
 * kept; midpoints are dropped if their perpendicular distance to the
 * surviving polyline is ≤ `epsilon`. Linear in the number of segments
 * surviving the simplification (worst-case O(n²)).
 */
export const simplifyLassoPath = (
  rawPoints: ReadonlyArray<ReadonlyPoint2D>,
  epsilon: number = DEFAULT_RDP_EPSILON,
): Point2D[] => {
  if (rawPoints.length <= 2) return rawPoints.map((p) => ({ x: p.x, y: p.y }));
  const eps2 = epsilon * epsilon;
  const keep = new Array(rawPoints.length).fill(false) as boolean[];
  keep[0] = true;
  keep[rawPoints.length - 1] = true;
  rdpRecurse(rawPoints, 0, rawPoints.length - 1, eps2, keep);
  const out: Point2D[] = [];
  for (let i = 0; i < rawPoints.length; i++) {
    if (keep[i]) {
      const p = rawPoints[i]!;
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
};

/**
 * Close a lasso path: append the start vertex if it differs from the
 * tail. Pure — never mutates the input.
 */
export const closeLassoPath = (
  points: ReadonlyArray<ReadonlyPoint2D>,
): Point2D[] => {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  if (out.length < 2) return out;
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (first.x !== last.x || first.y !== last.y) {
    out.push({ x: first.x, y: first.y });
  }
  return out;
};
