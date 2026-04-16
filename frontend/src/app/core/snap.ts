import { Injectable } from '@angular/core';

export interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ISnapLine {
  orientation: 'h' | 'v';
  type: 'edge' | 'gap';
  position: number;
  start: number;
  end: number;
}

export interface ISnapResult {
  x: number;
  y: number;
  lines: ISnapLine[];
}

export interface IResizeSnapResult {
  width: number;
  height: number;
  lines: ISnapLine[];
}

interface IAxisHit {
  offset: number;
  dist: number;
  lines: ISnapLine[];
}

function edgeAxisSnap(
  draggedEdges: number[],
  sibEdgeGroups: number[][],
  siblings: IRect[],
  dragged: IRect,
  axis: 'x' | 'y',
  threshold: number,
): IAxisHit | null {
  let bestDist = Infinity;
  let bestOffset = 0;
  let bestPos: number | null = null;

  for (const de of draggedEdges) {
    for (const edges of sibEdgeGroups) {
      for (const se of edges) {
        const dist = Math.abs(de - se);
        if (dist < bestDist && dist <= threshold) {
          bestDist = dist;
          bestOffset = se - de;
          bestPos = se;
        }
      }
    }
  }

  if (bestPos === null) return null;

  const isV = axis === 'x';
  let start = isV ? dragged.y : dragged.x + bestOffset;
  let end = isV ? dragged.y + dragged.height : dragged.x + bestOffset + dragged.width;

  for (let i = 0; i < siblings.length; i++) {
    for (const se of sibEdgeGroups[i]) {
      if (Math.abs(se - bestPos) < 0.5) {
        if (isV) {
          start = Math.min(start, siblings[i].y);
          end = Math.max(end, siblings[i].y + siblings[i].height);
        } else {
          start = Math.min(start, siblings[i].x);
          end = Math.max(end, siblings[i].x + siblings[i].width);
        }
      }
    }
  }

  return {
    offset: bestOffset,
    dist: bestDist,
    lines: [{ orientation: isV ? 'v' : 'h', type: 'edge', position: bestPos, start, end }],
  };
}

const DEFAULT_GAP = 10;

function collectGaps(siblings: IRect[], axis: 'x' | 'y'): number[] {
  const gaps = new Set<number>([DEFAULT_GAP]);
  for (let i = 0; i < siblings.length; i++) {
    for (let j = i + 1; j < siblings.length; j++) {
      const a = siblings[i], b = siblings[j];
      let gap: number;
      if (axis === 'x') {
        if (a.x + a.width <= b.x) gap = Math.round(b.x - (a.x + a.width));
        else if (b.x + b.width <= a.x) gap = Math.round(a.x - (b.x + b.width));
        else continue;
      } else {
        if (a.y + a.height <= b.y) gap = Math.round(b.y - (a.y + a.height));
        else if (b.y + b.height <= a.y) gap = Math.round(a.y - (b.y + b.height));
        else continue;
      }
      if (gap > 0) gaps.add(gap);
    }
  }
  return [...gaps];
}

function gapAxisSnap(
  dragged: IRect,
  siblings: IRect[],
  axis: 'x' | 'y',
  threshold: number,
): IAxisHit | null {
  const gaps = collectGaps(siblings, axis);
  if (gaps.length === 0) return null;

  let best: { offset: number; dist: number; sibIdx: number; side: 'before' | 'after'; gap: number } | null = null;

  for (let si = 0; si < siblings.length; si++) {
    const sib = siblings[si];
    for (const gap of gaps) {
      if (axis === 'x') {
        const afterX = sib.x + sib.width + gap;
        const dA = Math.abs(dragged.x - afterX);
        if (dA <= threshold && (!best || dA < best.dist)) {
          best = { offset: afterX - dragged.x, dist: dA, sibIdx: si, side: 'after', gap };
        }
        const beforeX = sib.x - gap - dragged.width;
        const dB = Math.abs(dragged.x - beforeX);
        if (dB <= threshold && (!best || dB < best.dist)) {
          best = { offset: beforeX - dragged.x, dist: dB, sibIdx: si, side: 'before', gap };
        }
      } else {
        const afterY = sib.y + sib.height + gap;
        const dA = Math.abs(dragged.y - afterY);
        if (dA <= threshold && (!best || dA < best.dist)) {
          best = { offset: afterY - dragged.y, dist: dA, sibIdx: si, side: 'after', gap };
        }
        const beforeY = sib.y - gap - dragged.height;
        const dB = Math.abs(dragged.y - beforeY);
        if (dB <= threshold && (!best || dB < best.dist)) {
          best = { offset: beforeY - dragged.y, dist: dB, sibIdx: si, side: 'before', gap };
        }
      }
    }
  }

  if (!best) return null;

  const sib = siblings[best.sibIdx];
  const lines: ISnapLine[] = [];

  if (axis === 'x') {
    const top = Math.min(dragged.y, sib.y);
    const bot = Math.max(dragged.y + dragged.height, sib.y + sib.height);
    if (best.side === 'after') {
      lines.push({ orientation: 'v', type: 'gap', position: sib.x + sib.width, start: top, end: bot });
      lines.push({ orientation: 'v', type: 'gap', position: sib.x + sib.width + best.gap, start: top, end: bot });
    } else {
      lines.push({ orientation: 'v', type: 'gap', position: sib.x, start: top, end: bot });
      lines.push({ orientation: 'v', type: 'gap', position: sib.x - best.gap, start: top, end: bot });
    }
  } else {
    const left = Math.min(dragged.x, sib.x);
    const right = Math.max(dragged.x + dragged.width, sib.x + sib.width);
    if (best.side === 'after') {
      lines.push({ orientation: 'h', type: 'gap', position: sib.y + sib.height, start: left, end: right });
      lines.push({ orientation: 'h', type: 'gap', position: sib.y + sib.height + best.gap, start: left, end: right });
    } else {
      lines.push({ orientation: 'h', type: 'gap', position: sib.y, start: left, end: right });
      lines.push({ orientation: 'h', type: 'gap', position: sib.y - best.gap, start: left, end: right });
    }
  }

  return { offset: best.offset, dist: best.dist, lines };
}

function pickBest(edge: IAxisHit | null, gap: IAxisHit | null): IAxisHit | null {
  if (edge && (!gap || edge.dist <= gap.dist)) return edge;
  return gap;
}

export function computeSnap(dragged: IRect, siblings: IRect[], threshold: number): ISnapResult {
  const dxEdges = [dragged.x, dragged.x + dragged.width / 2, dragged.x + dragged.width];
  const dyEdges = [dragged.y, dragged.y + dragged.height / 2, dragged.y + dragged.height];
  const sxEdges = siblings.map((s) => [s.x, s.x + s.width / 2, s.x + s.width]);
  const syEdges = siblings.map((s) => [s.y, s.y + s.height / 2, s.y + s.height]);

  const bestX = pickBest(
    edgeAxisSnap(dxEdges, sxEdges, siblings, dragged, 'x', threshold),
    gapAxisSnap(dragged, siblings, 'x', threshold),
  );
  const bestY = pickBest(
    edgeAxisSnap(dyEdges, syEdges, siblings, dragged, 'y', threshold),
    gapAxisSnap(dragged, siblings, 'y', threshold),
  );

  return {
    x: dragged.x + (bestX?.offset ?? 0),
    y: dragged.y + (bestY?.offset ?? 0),
    lines: [...(bestX?.lines ?? []), ...(bestY?.lines ?? [])],
  };
}

export function computeResizeSnap(dragged: IRect, siblings: IRect[], threshold: number): IResizeSnapResult {
  const sxEdges = siblings.map((s) => [s.x, s.x + s.width / 2, s.x + s.width]);
  const syEdges = siblings.map((s) => [s.y, s.y + s.height / 2, s.y + s.height]);

  const bestX = pickBest(
    edgeAxisSnap([dragged.x + dragged.width], sxEdges, siblings, dragged, 'x', threshold),
    gapAxisSnap({ ...dragged, x: dragged.x + dragged.width, width: 0 }, siblings, 'x', threshold),
  );
  const bestY = pickBest(
    edgeAxisSnap([dragged.y + dragged.height], syEdges, siblings, dragged, 'y', threshold),
    gapAxisSnap({ ...dragged, y: dragged.y + dragged.height, height: 0 }, siblings, 'y', threshold),
  );

  return {
    width: dragged.width + (bestX?.offset ?? 0),
    height: dragged.height + (bestY?.offset ?? 0),
    lines: [...(bestX?.lines ?? []), ...(bestY?.lines ?? [])],
  };
}

@Injectable({ providedIn: 'root' })
export class SnapContext {
  private siblings: IRect[] = [];
  private onLines: ((lines: ISnapLine[]) => void) | null = null;
  private static readonly THRESHOLD = 5;

  activate(siblings: IRect[], onLines: (lines: ISnapLine[]) => void) {
    this.siblings = siblings;
    this.onLines = onLines;
  }

  deactivate() {
    this.siblings = [];
    if (this.onLines) this.onLines([]);
    this.onLines = null;
  }

  snapMove(rect: IRect): ISnapResult | null {
    if (!this.onLines) return null;
    const result = computeSnap(rect, this.siblings, SnapContext.THRESHOLD);
    this.onLines(result.lines);
    return result;
  }

  snapResize(rect: IRect): IResizeSnapResult | null {
    if (!this.onLines) return null;
    const result = computeResizeSnap(rect, this.siblings, SnapContext.THRESHOLD);
    this.onLines(result.lines);
    return result;
  }
}
