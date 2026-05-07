/**
 * `<SelectionClipBoundary />` — declarative clip wrapper for `<CanvasView>`
 * preview render trees (selection-tools FR-34/FR-37).
 *
 * Wraps brush / transform / paste preview layers in a Skia `<Group clip={...}>`
 * so client-side previews honor the active selection identically to the
 * server-side compositor. When the selection is `none`, the wrapper is a
 * pass-through (no clip applied) — children render normally and there is no
 * runtime overhead.
 *
 * Coverage by selection kind:
 *   - `rect`   → SkPath rect → `<Group clip={path}>` (hard edge).
 *   - `lasso`  → SkPath polygon → `<Group clip={path}>` (anti-aliased edge).
 *   - `mask`   → currently NOT clipped on the client preview path; server-
 *                side composition (paint_strokes' captured SelectionClip)
 *                still enforces FR-34. A future v0.3 task will add per-pixel
 *                alpha clip for mask-kind via an alpha-image ImageShader so
 *                soft-edged masks (FR-37) get visible falloff in the preview
 *                too. Until then, the marching-ants overlay (FR-27) and the
 *                protected-region overlay (FR-28) communicate the selection
 *                shape to the user.
 *   - `none`   → no clip; children render normally.
 *
 * The marching-ants and protected-region overlays render OUTSIDE this
 * boundary in `CanvasView` so they remain visible regardless of the clip.
 *
 * Per the saved Skia version-aware-API memory, this component targets
 * `@shopify/react-native-skia` 2.x where `<Group clip={SkPath}>` is the
 * documented declarative clip API; do not back-port to 1.x without API
 * verification.
 */

import { useMemo } from 'react';
import { Group, Skia, type SkPath } from '@shopify/react-native-skia';

import type { Selection } from '@diffusecraft/canvas-core';

export interface SelectionClipBoundaryProps {
  /** Current selection from the editor store / canvas-core document. */
  readonly selection: Selection | undefined;
  /** Children rendered inside the clipped Group. */
  readonly children: React.ReactNode;
}

const buildClipPath = (selection: Selection): SkPath | null => {
  if (selection.kind === 'rect') {
    const r = selection.rect;
    if (r.w <= 0 || r.h <= 0) return null;
    const path = Skia.Path.Make();
    path.addRect(Skia.XYWHRect(r.x, r.y, r.w, r.h));
    return path;
  }
  if (selection.kind === 'lasso') {
    if (selection.points.length < 3) return null;
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
  // `mask` and `none` → no client-side clip path; see header comment for
  // the v0.3 mask-clip follow-up.
  return null;
};

export const SelectionClipBoundary: React.FC<SelectionClipBoundaryProps> = ({
  selection,
  children,
}) => {
  const clipPath = useMemo(
    () => (selection ? buildClipPath(selection) : null),
    [selection],
  );
  if (!clipPath) {
    // No-op pass-through. Wrapping in a fragment avoids inserting an
    // extra `<Group>` into the Skia render tree when no clip applies.
    return <>{children}</>;
  }
  return <Group clip={clipPath}>{children}</Group>;
};

SelectionClipBoundary.displayName = 'SelectionClipBoundary';
