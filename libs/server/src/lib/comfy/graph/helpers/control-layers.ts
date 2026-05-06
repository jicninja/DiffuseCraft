/**
 * Control-layer helper stub (H.6, FR-18 partial).
 *
 * The full implementation (14 control-layer types — Reference, Pose,
 * Depth, Canny, ScribbleSketch, Lineart, etc.) is owned by the
 * `control-layers` spec. This file ships the **signature** so the verb
 * builders compile and tests can exercise the dispatch path.
 *
 * When a verb builder calls `attachControlLayers([], graph, n, ctx)` with
 * an empty list, we return the graph unchanged — that's the v1 default
 * that ships with `comfyui-management`.
 */

import type { ComfyGraph } from '../../types.js';
import type { GraphContext } from '../types.js';

export interface AttachControlLayersResult {
  graph: ComfyGraph;
  /** Next free node id after attachment. */
  nextId: number;
  /**
   * Conditioning slot reference produced by the (eventual) control-layer
   * fan-in. Currently the helper passes the upstream slot through
   * unchanged because no layers are attached.
   */
  positive: readonly [string, number] | null;
}

export function attachControlLayers(
  control_layer_ids: ReadonlyArray<string>,
  graph: ComfyGraph,
  startId: number,
  _ctx: GraphContext,
): AttachControlLayersResult {
  // TODO(control-layers): port krita-ai-diffusion `ai_diffusion/control.py`.
  void control_layer_ids;
  return { graph, nextId: startId, positive: null };
}
