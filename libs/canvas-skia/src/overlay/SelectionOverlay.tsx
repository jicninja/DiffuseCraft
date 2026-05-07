/**
 * `<SelectionOverlay />` — declarative marching-ants for `<CanvasView>`.
 *
 * Renders the current canvas-core {@link Selection} as a dashed Skia
 * `<Path>` so the host `<Canvas>` tree can include it inside the
 * document `<Group>` (and inherit the viewport transform). For `none`
 * and `mask` selections it returns `null`: the document itself
 * communicates the mask via the active-layer border / mask preview
 * overlays owned by other parts of the renderer.
 *
 * Marching-ants animation is intentionally optional. The overlay
 * accepts a `phase` prop (in path units) that the host can drive from a
 * Reanimated `useDerivedValue` if it wants the dashes to crawl. Static
 * dashes (the default `phase={0}`) match the legacy imperative
 * `drawSelectionOverlay` contract while still reading as a real
 * selection — the spec's UX polish lands when the host wires the
 * Reanimated shared value.
 */

import { useMemo } from 'react';
import {
  DashPathEffect,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';

import type { Selection } from '@diffusecraft/canvas-core';

export interface SelectionOverlayProps {
  /** Current selection from the editor store / canvas-core document. */
  readonly selection: Selection;
  /** Marching-ants stroke colour (Skia int, 0xAARRGGBB). */
  readonly color?: number;
  /** Stroke width in document-space pixels. */
  readonly strokeWidth?: number;
  /** Dash on/off interval lengths in document-space pixels. */
  readonly dashIntervals?: readonly [number, number];
  /**
   * Dash phase in document-space pixels. Static (`0`) by default;
   * pass an animated value via Reanimated to make the dashes crawl.
   * RN-Skia's `<DashPathEffect>` does not accept SharedValue directly
   * here — wrap this component in a parent that re-renders, or use
   * RN-Skia's reactive prop conversion if the host opts in.
   */
  readonly phase?: number;
}

const DEFAULT_COLOR = 0xff_00_aa_ff;
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_DASH_INTERVALS: readonly [number, number] = [6, 4];

const buildSelectionPath = (selection: Selection): SkPath | null => {
  if (selection.kind === 'rect') {
    const r = selection.rect;
    if (r.w <= 0 || r.h <= 0) return null;
    const path = Skia.Path.Make();
    path.addRect(Skia.XYWHRect(r.x, r.y, r.w, r.h));
    return path;
  }
  if (selection.kind === 'lasso') {
    if (selection.points.length < 2) return null;
    const path = Skia.Path.Make();
    const first = selection.points[0]!;
    path.moveTo(first.x, first.y);
    for (let i = 1; i < selection.points.length; i++) {
      const pt = selection.points[i]!;
      path.lineTo(pt.x, pt.y);
    }
    path.close();
    return path;
  }
  return null;
};

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selection,
  color = DEFAULT_COLOR,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  dashIntervals = DEFAULT_DASH_INTERVALS,
  phase = 0,
}) => {
  const path = useMemo(() => buildSelectionPath(selection), [selection]);
  if (!path) return null;
  return (
    <Path
      path={path}
      color={color}
      style="stroke"
      strokeWidth={strokeWidth}
      antiAlias
    >
      <DashPathEffect
        intervals={[dashIntervals[0], dashIntervals[1]]}
        phase={phase}
      />
    </Path>
  );
};

SelectionOverlay.displayName = 'SelectionOverlay';
