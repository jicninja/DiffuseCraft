#!/usr/bin/env tsx
/**
 * Standalone tsx runner for `@diffusecraft/canvas-core`.
 *
 * Mirrors the pattern in `libs/core/src/__tests__/run-tests.ts`. Each case
 * is a function that throws on failure; the runner exits non-zero on any
 * failure. Run via `pnpm -F @diffusecraft/canvas-core test`.
 */
import { strict as assert } from 'node:assert';

import {
  // document + ops
  createDocument,
  ASPECT_PRESETS,
  assertCustomDims,
  addLayer,
  removeLayer,
  updateLayer,
  reorderLayer,
  duplicateLayer,
  mergeDown,
  flattenVisible,
  setActiveLayer,
  byPosition,
  defaultLayerName,
  // groups
  createGroup,
  ungroup,
  moveLayersIntoGroup,
  updateGroup,
  removeLayerFromGroup,
  groupDepth,
  // invariants
  checkInvariants,
  assertInvariants,
  // blend / compose
  blendChannel,
  blendRgb,
  compose,
  fillRaster,
  // viewport / hit-test
  identityViewport,
  zoomBy,
  panBy,
  setRotation,
  rotateBy,
  viewportToDocument,
  documentToViewport,
  hitTestModel,
  hitTestStackModel,
  // history
  createHistoryStack,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  clearHistory,
  DEFAULT_HISTORY_CAPACITY,
  // brush
  BRUSH_PRESETS,
  BRUSH_PRESET_ORDER,
  getBrushPreset,
  resolveStamp,
  samplePressureCurve,
  expandStrokeToStamps,
  smoothStrokePoints,
  stampsBoundingBox,
  composeStrokeIntoRaster,
  parseBrushColor,
  // selection-tools (geometry + ops)
  createMask,
  createFullMask,
  rectToMask,
  polygonToMask,
  pointInPolygon,
  maskBounds,
  isMaskEmpty,
  selectionToMask,
  composeMasks,
  applyOp,
  invertMask,
  selectAllMask,
  simplifyLassoPath,
  closeLassoPath,
  DEFAULT_RDP_EPSILON,
  magicWandSelect,
  sampleRgb,
  colorDistance,
  DEFAULT_TOLERANCE,
  growMask,
  shrinkMask,
  blurMask,
  featherMask,
  refineMask,
  polygonFromLasso,
  lassoFromPolygon,
  // mask-system (raw byte ops)
  invertMaskBytes,
  clearMaskBytes,
  fillMaskBytes,
  thresholdMaskBytes,
  refineMaskBytes,
  morphology,
  gaussianBlurBytes,
  selectionToMaskBytes,
  maskBytesToSelection,
  deriveFromLayer,
  buildTwoMasks,
  isMaskLayer,
  isPaintedMask,
  isFromLayerMask,
  // transform-tools (Phase A + B)
  IDENTITY_TRANSFORM,
  IDENTITY_MATRIX,
  matrixMultiply,
  matrixInvert,
  matrixApplyPoint,
  matrixApproxEqual,
  matrixRotate,
  matrixScale,
  matrixTranslate,
  composeMatrix,
  decomposeMatrix,
  decomposedApproxEqual,
  splitFlipFromScale,
  normalizeAngleDeg,
  identityDecomposed,
  translate as transformTranslate,
  scale as transformScale,
  rotate as transformRotate,
  flip as transformFlip,
  skew as transformSkew,
  setAnchor,
  reset as transformReset,
  distortFourCorner,
  clearDistort,
  mergeTransform,
  projectiveFromQuad,
  projectiveToLocal,
  isNonDegenerateQuad,
  findSnapTargets,
  pickClosestPerAxis,
  nearestRotationSnap,
  GRID_STEP_PX,
  DEFAULT_SNAP_THRESHOLD_PX,
  ROTATION_SNAP_STEP_DEG,
  type TransformDecomposed,
  type TransformPartial,
  type TransformDelta,
  type TransformPoint,
  // shared
  ulid,
  type Layer,
  type Document,
  type BlendMode,
  type BlobBlender,
  type DocumentId,
  type LayerId,
} from '../index';

// ----- Fixtures -----

let counter = 0;
const fakeNow = () => `2026-05-03T00:00:${(counter++).toString().padStart(2, '0')}.000Z`;

const newDoc = (): Document =>
  createDocument({
    preset: 'square',
    name: 'Test',
    now: fakeNow,
    id: ulid() as unknown as DocumentId,
  });

type Case = [name: string, run: () => void | Promise<void>];

const cases: Case[] = [
  // ---- Phase A: document ----
  [
    'createDocument(preset) returns sRGB doc with canonical dimensions',
    () => {
      const doc = createDocument({ preset: 'square', now: fakeNow });
      assert.equal(doc.width, ASPECT_PRESETS.square.width);
      assert.equal(doc.height, ASPECT_PRESETS.square.height);
      assert.equal(doc.color_mode, 'srgb');
      assert.equal(doc.layers.length, 0);
    },
  ],
  [
    'createDocument(custom) accepts multiples-of-8 within range',
    () => {
      const doc = createDocument({ width: 2048, height: 1024, now: fakeNow });
      assert.equal(doc.width, 2048);
      assert.equal(doc.height, 1024);
    },
  ],
  [
    'assertCustomDims rejects non-multiples-of-8',
    () => {
      assert.throws(() => assertCustomDims(1023, 1024));
    },
  ],
  [
    'assertCustomDims rejects out-of-range',
    () => {
      assert.throws(() => assertCustomDims(8192, 1024));
    },
  ],
  [
    'createDocument throws when neither preset nor dims provided',
    () => {
      assert.throws(() => createDocument({ now: fakeNow }));
    },
  ],
  [
    'ulid produces a 26-character Crockford string',
    () => {
      const id = ulid();
      assert.equal(id.length, 26);
      assert.ok(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id), `bad ulid: ${id}`);
    },
  ],

  // ---- Phase B: operations ----
  [
    'addLayer appends at end when position omitted',
    () => {
      let doc = newDoc();
      ({ doc } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      assert.equal(doc.layers.length, 2);
      assert.equal(doc.layers[0]!.position, 0);
      assert.equal(doc.layers[1]!.position, 1);
    },
  ],
  [
    'addLayer with explicit position shifts existing layers up',
    () => {
      let doc = newDoc();
      let added: Layer;
      ({ doc, layer: added } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc } = addLayer(doc, { kind: 'paint', position: 0, now: fakeNow }));
      // The original layer should now be at position 1.
      const moved = doc.layers.find((l) => l.id === added.id)!;
      assert.equal(moved.position, 1);
      // Both positions are unique.
      const positions = doc.layers.map((l) => l.position).sort();
      assert.deepEqual(positions, [0, 1]);
    },
  ],
  [
    'defaultLayerName increments per kind',
    () => {
      let doc = newDoc();
      const a = defaultLayerName('paint', doc);
      ({ doc } = addLayer(doc, { kind: 'paint', name: a, now: fakeNow }));
      const b = defaultLayerName('paint', doc);
      assert.equal(a, 'Layer 1');
      assert.equal(b, 'Layer 2');
    },
  ],
  [
    'removeLayer compacts positions',
    () => {
      let doc = newDoc();
      const ids: LayerId[] = [];
      for (let i = 0; i < 3; i++) {
        let layer: Layer;
        ({ doc, layer } = addLayer(doc, { kind: 'paint', now: fakeNow }));
        ids.push(layer.id);
      }
      ({ doc } = removeLayer(doc, ids[1]!));
      assert.equal(doc.layers.length, 2);
      assert.deepEqual(
        doc.layers.map((l) => l.position).sort((a, b) => a - b),
        [0, 1],
      );
    },
  ],
  [
    'updateLayer applies non-position patches',
    () => {
      let doc = newDoc();
      let layer: Layer;
      ({ doc, layer } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc } = updateLayer(doc, layer.id, { name: 'Renamed', opacity: 0.5 }));
      const updated = doc.layers.find((l) => l.id === layer.id)!;
      assert.equal(updated.name, 'Renamed');
      assert.equal(updated.opacity, 0.5);
    },
  ],
  [
    'updateLayer changing position triggers reorder',
    () => {
      let doc = newDoc();
      const ids: LayerId[] = [];
      for (let i = 0; i < 3; i++) {
        let layer: Layer;
        ({ doc, layer } = addLayer(doc, { kind: 'paint', now: fakeNow }));
        ids.push(layer.id);
      }
      ({ doc } = updateLayer(doc, ids[2]!, { position: 0 }));
      const top = doc.layers.find((l) => l.id === ids[2]!)!;
      assert.equal(top.position, 0);
      // No duplicate positions.
      const positions = doc.layers.map((l) => l.position).sort();
      assert.deepEqual(positions, [0, 1, 2]);
    },
  ],
  [
    'reorderLayer is idempotent at same position',
    () => {
      let doc = newDoc();
      let layer: Layer;
      ({ doc, layer } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const before = doc;
      const after = reorderLayer(doc, layer.id, layer.position).doc;
      assert.equal(before, after, 'returns same reference when no-op');
    },
  ],
  [
    'duplicateLayer adds a copy directly above the original',
    () => {
      let doc = newDoc();
      let layer: Layer;
      ({ doc, layer } = addLayer(doc, { kind: 'paint', name: 'Sky', now: fakeNow }));
      let dup: Layer;
      ({ doc, layer: dup } = duplicateLayer(doc, layer.id, { now: fakeNow }));
      assert.equal(dup.name, 'Sky copy');
      assert.equal(dup.position, layer.position + 1);
      assert.equal(doc.layers.length, 2);
    },
  ],
  [
    'mergeDown blends top into bottom and removes the top layer',
    async () => {
      let doc = newDoc();
      let bottom: Layer;
      let top: Layer;
      ({ doc, layer: bottom } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: top } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const blender: BlobBlender = {
        blend: async () => 'blob-merged',
      };
      const result = await mergeDown(doc, top.id, blender, { now: fakeNow });
      assert.equal(result.doc.layers.length, 1);
      assert.equal(result.merged_layer.content_blob_id, 'blob-merged');
      assert.equal(result.doc.layers[0]!.position, 0);
      assert.equal(result.doc.layers[0]!.name, bottom.name);
    },
  ],
  [
    'flattenVisible collapses visible paint layers, hides preserved',
    async () => {
      let doc = newDoc();
      let visibleA: Layer;
      let hidden: Layer;
      ({ doc, layer: visibleA } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: hidden } = addLayer(doc, { kind: 'paint', visible: false, now: fakeNow }));
      let visibleB: Layer;
      ({ doc, layer: visibleB } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      void visibleA;
      void visibleB;
      const blender: BlobBlender = { blend: async () => 'flat' };
      const result = await flattenVisible(doc, blender, { now: fakeNow });
      // Hidden layer survives.
      assert.equal(result.doc.layers.length, 2);
      // Flattened sits at position 0.
      assert.equal(result.doc.layers[0]!.id, result.flattened_layer.id);
      assert.equal(result.doc.layers[0]!.position, 0);
      // The hidden one moved up to position 1.
      const hiddenAfter = result.doc.layers.find((l) => l.id === hidden.id)!;
      assert.equal(hiddenAfter.position, 1);
    },
  ],
  [
    'setActiveLayer ignores unknown ids',
    () => {
      let doc = newDoc();
      const out = setActiveLayer(doc, 'unknown-id' as unknown as LayerId);
      assert.equal(out.doc, doc);
    },
  ],
  [
    'byPosition tiebreaker uses created_at',
    () => {
      const a: Layer = {
        id: 'a' as unknown as LayerId,
        document_id: 'd' as unknown as DocumentId,
        kind: 'paint',
        name: 'a',
        position: 0,
        opacity: 1,
        visible: true,
        locked: false,
        blend_mode: 'normal',
        created_at: '2026-01-01T00:00:00.000Z',
      };
      const b: Layer = { ...a, id: 'b' as unknown as LayerId, name: 'b', created_at: '2026-01-02T00:00:00.000Z' };
      // Same position — earlier created_at wins.
      assert.ok(byPosition(a, b) < 0);
      assert.ok(byPosition(b, a) > 0);
    },
  ],

  // ---- Phase B (groups) ----
  [
    'createGroup adds members and updates layer.group_id',
    () => {
      let doc = newDoc();
      let l1: Layer;
      let l2: Layer;
      ({ doc, layer: l1 } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: l2 } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const result = createGroup(doc, {
        member_layer_ids: [l1.id, l2.id],
        name: 'Refs',
        now: fakeNow,
      });
      assert.equal(result.doc.groups.length, 1);
      assert.equal(result.group.child_layer_ids.length, 2);
      const a = result.doc.layers.find((l) => l.id === l1.id)!;
      assert.equal(a.group_id, result.group.id);
    },
  ],
  [
    'ungroup re-parents children and removes the group',
    () => {
      let doc = newDoc();
      let l1: Layer;
      ({ doc, layer: l1 } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const g = createGroup(doc, { member_layer_ids: [l1.id], now: fakeNow });
      doc = g.doc;
      ({ doc } = ungroup(doc, g.group.id));
      assert.equal(doc.groups.length, 0);
      const layer = doc.layers.find((l) => l.id === l1.id)!;
      assert.equal(layer.group_id, undefined);
    },
  ],
  [
    'moveLayersIntoGroup moves layers between groups',
    () => {
      let doc = newDoc();
      let l1: Layer;
      ({ doc, layer: l1 } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const g1 = createGroup(doc, { now: fakeNow });
      doc = g1.doc;
      const g2 = createGroup(doc, { member_layer_ids: [l1.id], now: fakeNow });
      doc = g2.doc;
      ({ doc } = moveLayersIntoGroup(doc, g1.group.id, [l1.id]));
      const layer = doc.layers.find((l) => l.id === l1.id)!;
      assert.equal(layer.group_id, g1.group.id);
      const oldGroup = doc.groups.find((g) => g.id === g2.group.id)!;
      assert.equal(oldGroup.child_layer_ids.length, 0);
    },
  ],
  [
    'updateGroup applies opacity / visibility patches',
    () => {
      let doc = newDoc();
      const g = createGroup(doc, { now: fakeNow });
      doc = g.doc;
      ({ doc } = updateGroup(doc, g.group.id, { opacity: 0.4, visible: false }));
      const updated = doc.groups.find((x) => x.id === g.group.id)!;
      assert.equal(updated.opacity, 0.4);
      assert.equal(updated.visible, false);
    },
  ],
  [
    'createGroup nesting beyond MAX_GROUP_DEPTH throws',
    () => {
      let doc = newDoc();
      let parent_group_id: string | undefined;
      // Build chain depth 0..4 (5 nodes — at the cap).
      for (let i = 0; i < 5; i++) {
        const g = createGroup(doc, { parent_group_id, now: fakeNow });
        doc = g.doc;
        parent_group_id = g.group.id;
      }
      // Sixth would exceed cap.
      assert.throws(() => createGroup(doc, { parent_group_id, now: fakeNow }));
    },
  ],
  [
    'groupDepth detects cycles defensively',
    () => {
      let doc = newDoc();
      const g = createGroup(doc, { now: fakeNow });
      doc = g.doc;
      // Manually plant a cycle (would be caught by invariants in real code).
      const cyclic: Document = {
        ...doc,
        groups: doc.groups.map((x) =>
          x.id === g.group.id ? { ...x, parent_group_id: g.group.id } : x,
        ),
      };
      assert.throws(() => groupDepth(cyclic, g.group.id));
    },
  ],
  [
    'removeLayerFromGroup unlinks layer without deleting it',
    () => {
      let doc = newDoc();
      let layer: Layer;
      ({ doc, layer } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const g = createGroup(doc, { member_layer_ids: [layer.id], now: fakeNow });
      doc = g.doc;
      ({ doc } = removeLayerFromGroup(doc, layer.id));
      const after = doc.layers.find((l) => l.id === layer.id)!;
      assert.equal(after.group_id, undefined);
      const grp = doc.groups.find((x) => x.id === g.group.id)!;
      assert.equal(grp.child_layer_ids.length, 0);
    },
  ],

  // ---- Invariants ----
  [
    'checkInvariants returns no violations on a clean document',
    () => {
      let doc = newDoc();
      ({ doc } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const v = checkInvariants(doc);
      assert.equal(v.length, 0);
    },
  ],
  [
    'checkInvariants detects orphan group reference',
    () => {
      const doc = newDoc();
      const broken: Document = {
        ...doc,
        layers: [
          {
            id: 'x' as unknown as LayerId,
            document_id: doc.id,
            kind: 'paint',
            name: 'x',
            position: 0,
            opacity: 1,
            visible: true,
            locked: false,
            blend_mode: 'normal',
            group_id: 'no-such-group',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      const v = checkInvariants(broken);
      assert.ok(v.some((x) => x.code === 'ORPHAN_LAYER_GROUP_REF'));
    },
  ],
  [
    'assertInvariants throws on duplicate layer id',
    () => {
      const doc = newDoc();
      const broken: Document = {
        ...doc,
        layers: [
          {
            id: 'dup' as unknown as LayerId,
            document_id: doc.id,
            kind: 'paint',
            name: 'a',
            position: 0,
            opacity: 1,
            visible: true,
            locked: false,
            blend_mode: 'normal',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'dup' as unknown as LayerId,
            document_id: doc.id,
            kind: 'paint',
            name: 'b',
            position: 1,
            opacity: 1,
            visible: true,
            locked: false,
            blend_mode: 'normal',
            created_at: '2026-01-02T00:00:00.000Z',
          },
        ],
      };
      assert.throws(() => assertInvariants(broken));
    },
  ],

  // ---- Phase C: blend / compose ----
  [
    'blendChannel: multiply identity / inverse cases',
    () => {
      assert.equal(blendChannel('multiply', 1, 0.5), 0.5);
      assert.equal(blendChannel('multiply', 0, 0.7), 0);
      assert.equal(blendChannel('screen', 0, 0.4), 0.4);
      assert.equal(blendChannel('screen', 1, 0.4), 1);
    },
  ],
  [
    'blendChannel: difference is symmetric absolute',
    () => {
      assert.equal(blendChannel('difference', 0.7, 0.2), Math.abs(0.7 - 0.2));
      assert.equal(blendChannel('difference', 0.1, 0.9), Math.abs(0.1 - 0.9));
    },
  ],
  [
    'blendChannel covers all 20 modes without throwing',
    () => {
      const modes: BlendMode[] = [
        'normal',
        'multiply',
        'screen',
        'overlay',
        'darken',
        'lighten',
        'color_dodge',
        'color_burn',
        'hard_light',
        'soft_light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity',
        'linear_burn',
        'linear_dodge',
        'linear_light',
        'pin_light',
      ];
      for (const m of modes) {
        const v = blendChannel(m, 0.4, 0.6);
        assert.ok(Number.isFinite(v), `${m} produced non-finite ${v}`);
        assert.ok(v >= 0 && v <= 1, `${m} out of range: ${v}`);
      }
    },
  ],
  [
    'blendRgb HSL modes preserve target luminance for color/hue',
    () => {
      const src = { r: 0.8, g: 0.1, b: 0.1 };
      const dst = { r: 0.2, g: 0.5, b: 0.7 };
      const colored = blendRgb('color', src, dst);
      const lum = (c: { r: number; g: number; b: number }) =>
        0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
      assert.ok(Math.abs(lum(colored) - lum(dst)) < 1e-3);
    },
  ],
  [
    'compose blends two opaque rasters via multiply',
    () => {
      const dst = fillRaster(2, 2, [200, 200, 200, 255]);
      const src = fillRaster(2, 2, [128, 128, 128, 255]);
      const out = compose(src, dst, 'multiply', 1);
      assert.equal(out.width, 2);
      assert.equal(out.height, 2);
      // 128/255 * 200/255 ≈ 0.502 * 0.784 ≈ 0.394 -> 100ish.
      const r = out.data[0]!;
      assert.ok(r > 80 && r < 120, `multiply red expected mid-low, got ${r}`);
    },
  ],
  [
    'compose throws on dim mismatch',
    () => {
      const dst = fillRaster(2, 2, [0, 0, 0, 255]);
      const src = fillRaster(3, 3, [0, 0, 0, 255]);
      assert.throws(() => compose(src, dst, 'normal', 1));
    },
  ],
  [
    'compose with normal mode + global opacity dims source',
    () => {
      const dst = fillRaster(1, 1, [0, 0, 0, 255]);
      const src = fillRaster(1, 1, [255, 255, 255, 255]);
      const out = compose(src, dst, 'normal', 0.5);
      // Output should be ~50% gray because src covers half.
      assert.ok(out.data[0]! > 100 && out.data[0]! < 160);
    },
  ],

  // ---- Phase D: viewport ----
  [
    'identityViewport is zoom 1, no pan/rot',
    () => {
      const v = identityViewport();
      assert.equal(v.zoom, 1);
      assert.equal(v.pan_x, 0);
      assert.equal(v.pan_y, 0);
      assert.equal(v.rotation_degrees, 0);
    },
  ],
  [
    'zoomBy clamps to bounds',
    () => {
      const v = identityViewport();
      const tooBig = zoomBy(v, 1000, { min: 0.5, max: 4 });
      assert.equal(tooBig.zoom, 4);
      const tooSmall = zoomBy(v, 0.001, { min: 0.5, max: 4 });
      assert.equal(tooSmall.zoom, 0.5);
    },
  ],
  [
    'panBy + setRotation compose intuitively',
    () => {
      let v = identityViewport();
      v = panBy(v, 10, 20);
      v = setRotation(v, 90);
      assert.equal(v.pan_x, 10);
      assert.equal(v.rotation_degrees, 90);
      v = rotateBy(v, 91);
      // 90 + 91 = 181 which normalizes to -179.
      assert.ok(Math.abs(v.rotation_degrees - -179) < 1e-6);
    },
  ],
  [
    'viewportToDocument inverts documentToViewport',
    () => {
      const v = identityViewport();
      const moved = panBy(v, 50, -25);
      const zoomed = zoomBy(moved, 2);
      const rotated = setRotation(zoomed, 30);
      const docPt = { x: 100, y: 200 };
      const round = viewportToDocument(rotated, documentToViewport(rotated, docPt));
      assert.ok(Math.abs(round.x - docPt.x) < 1e-6);
      assert.ok(Math.abs(round.y - docPt.y) < 1e-6);
    },
  ],

  // ---- Phase D: hit-test ----
  [
    'hitTestModel returns top visible layer',
    () => {
      let doc = newDoc();
      let lower: Layer;
      let upper: Layer;
      ({ doc, layer: lower } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: upper } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      void lower;
      const v = identityViewport();
      const hit = hitTestModel(doc, v, { x: 10, y: 10 });
      assert.equal(hit, upper.id);
    },
  ],
  [
    'hitTestModel returns null outside canvas bounds',
    () => {
      let doc = newDoc();
      ({ doc } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const v = identityViewport();
      assert.equal(hitTestModel(doc, v, { x: -10, y: 10 }), null);
      assert.equal(hitTestModel(doc, v, { x: doc.width + 1, y: 10 }), null);
    },
  ],
  [
    'hitTestModel skips invisible / locked / mask / control / region layers',
    () => {
      let doc = newDoc();
      ({ doc } = addLayer(doc, { kind: 'paint', visible: false, now: fakeNow }));
      ({ doc } = addLayer(doc, { kind: 'mask', now: fakeNow }));
      ({ doc } = addLayer(doc, { kind: 'control', control_type: 'reference', now: fakeNow }));
      const v = identityViewport();
      assert.equal(hitTestModel(doc, v, { x: 5, y: 5 }), null);
    },
  ],
  [
    'hitTestStackModel returns top→bottom visible paint layers',
    () => {
      let doc = newDoc();
      let a: Layer;
      let b: Layer;
      let c: Layer;
      ({ doc, layer: a } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: b } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      ({ doc, layer: c } = addLayer(doc, { kind: 'paint', now: fakeNow }));
      const v = identityViewport();
      const stack = hitTestStackModel(doc, v, { x: 1, y: 1 });
      // Top first.
      assert.deepEqual([...stack], [c.id, b.id, a.id]);
    },
  ],

  // ---- History ----
  [
    'history push / undo / redo round-trip',
    () => {
      let h = createHistoryStack<string>();
      assert.equal(canUndo(h), false);
      h = pushHistory(h, {
        id: '1',
        label: 'add',
        forward: 'do',
        inverse: 'undo',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      assert.equal(canUndo(h), true);
      assert.equal(canRedo(h), false);
      const undone = undoHistory(h);
      assert.equal(undone.entry?.id, '1');
      h = undone.state;
      assert.equal(canUndo(h), false);
      assert.equal(canRedo(h), true);
      const redone = redoHistory(h);
      assert.equal(redone.entry?.id, '1');
    },
  ],
  [
    'history push after undo discards the redo branch',
    () => {
      let h = createHistoryStack<string>();
      h = pushHistory(h, {
        id: 'a',
        label: 'a',
        forward: 'a',
        inverse: 'a',
        created_at: '',
      });
      h = pushHistory(h, {
        id: 'b',
        label: 'b',
        forward: 'b',
        inverse: 'b',
        created_at: '',
      });
      h = undoHistory(h).state;
      assert.equal(canRedo(h), true);
      h = pushHistory(h, {
        id: 'c',
        label: 'c',
        forward: 'c',
        inverse: 'c',
        created_at: '',
      });
      assert.equal(canRedo(h), false);
      assert.equal(h.entries.length, 2);
      assert.equal(h.entries.at(-1)!.id, 'c');
    },
  ],
  [
    'history capacity bounds the stack',
    () => {
      let h = createHistoryStack<string>(3);
      for (let i = 0; i < 5; i++) {
        h = pushHistory(h, {
          id: `${i}`,
          label: `${i}`,
          forward: `${i}`,
          inverse: `${i}`,
          created_at: '',
        });
      }
      assert.equal(h.entries.length, 3);
      assert.equal(h.entries[0]!.id, '2');
    },
  ],
  [
    'clearHistory empties the stack',
    () => {
      let h = createHistoryStack<string>();
      h = pushHistory(h, {
        id: 'a',
        label: '',
        forward: 'a',
        inverse: 'a',
        created_at: '',
      });
      h = clearHistory(h);
      assert.equal(h.entries.length, 0);
      assert.equal(h.cursor, -1);
    },
  ],
  [
    'DEFAULT_HISTORY_CAPACITY is 50',
    () => {
      assert.equal(DEFAULT_HISTORY_CAPACITY, 50);
    },
  ],

  // ---- Brush ----
  [
    'BRUSH_PRESETS exposes the five canonical presets',
    () => {
      const ids = Object.keys(BRUSH_PRESETS).sort();
      assert.deepEqual(ids, ['eraser', 'marker', 'pen', 'pencil', 'smooth']);
      assert.equal(BRUSH_PRESET_ORDER.length, 5);
      const eraser = getBrushPreset('eraser');
      assert.equal(eraser.erase, true);
    },
  ],
  [
    'samplePressureCurve interpolates linearly',
    () => {
      const curve = [
        [0, 0],
        [1, 1],
      ] as const;
      assert.equal(samplePressureCurve(curve, 0.5), 0.5);
      assert.equal(samplePressureCurve(curve, 0), 0);
      assert.equal(samplePressureCurve(curve, 1), 1);
    },
  ],
  [
    'resolveStamp scales by pressure',
    () => {
      const eff = resolveStamp(BRUSH_PRESETS.pen, { x: 0, y: 0, pressure: 0.25 });
      assert.equal(eff.size, BRUSH_PRESETS.pen.size * 0.25);
      assert.equal(eff.opacity, BRUSH_PRESETS.pen.opacity * 0.25);
    },
  ],

  // ---- Brush-system Phase B: stroke → stamp expansion ----
  [
    'expandStrokeToStamps emits one stamp for a single point',
    () => {
      const stamps = expandStrokeToStamps(BRUSH_PRESETS.pen, [{ x: 10, y: 10, pressure: 1 }], {
        smoothing: 0,
      });
      assert.equal(stamps.length, 1);
      assert.equal(stamps[0]!.x, 10);
      assert.equal(stamps[0]!.y, 10);
      assert.equal(stamps[0]!.erase, false);
    },
  ],
  [
    'expandStrokeToStamps respects spacing fraction along a long segment',
    () => {
      // Pen has spacing 0.05, default size 6 → spacing = 0.3 px. Stretch to 30 px.
      const stamps = expandStrokeToStamps(
        BRUSH_PRESETS.pen,
        [
          { x: 0, y: 0, pressure: 1 },
          { x: 30, y: 0, pressure: 1 },
        ],
        { smoothing: 0 },
      );
      // Should have many stamps. Pen spacing of 0.3 is below the MIN_SPACING_PX=0.5 floor,
      // so effective spacing is ~0.5 px → ~60 stamps + first.
      assert.ok(stamps.length >= 50, `expected many stamps, got ${stamps.length}`);
      // Last stamp should be very close to (30, 0).
      const last = stamps[stamps.length - 1]!;
      assert.ok(Math.abs(last.x - 30) <= 1, `last stamp x=${last.x}`);
      assert.equal(last.y, 0);
    },
  ],
  [
    'expandStrokeToStamps with marker preset honors larger spacing',
    () => {
      // Marker spacing 0.15, size 32 → ~4.8px between stamps. 32px segment → ~7 stamps.
      const stamps = expandStrokeToStamps(
        BRUSH_PRESETS.marker,
        [
          { x: 0, y: 0, pressure: 1 },
          { x: 32, y: 0, pressure: 1 },
        ],
        { smoothing: 0 },
      );
      assert.ok(
        stamps.length >= 5 && stamps.length <= 10,
        `marker stamps count=${stamps.length}`,
      );
    },
  ],
  [
    'expandStrokeToStamps eraser propagates erase=true',
    () => {
      const stamps = expandStrokeToStamps(
        BRUSH_PRESETS.eraser,
        [{ x: 5, y: 5, pressure: 1 }],
        { smoothing: 0 },
      );
      assert.equal(stamps[0]!.erase, true);
    },
  ],
  [
    'expandStrokeToStamps applies pressure curve via preset',
    () => {
      // Slow-start curve on pencil → low pressure produces small stamps.
      const lowP = expandStrokeToStamps(
        BRUSH_PRESETS.pencil,
        [{ x: 0, y: 0, pressure: 0.1 }],
        { smoothing: 0 },
      );
      const highP = expandStrokeToStamps(
        BRUSH_PRESETS.pencil,
        [{ x: 0, y: 0, pressure: 1.0 }],
        { smoothing: 0 },
      );
      assert.ok(lowP[0]!.size < highP[0]!.size);
      assert.ok(lowP[0]!.opacity < highP[0]!.opacity);
    },
  ],
  [
    'expandStrokeToStamps overrides honor sizeOverride / opacityOverride',
    () => {
      const stamps = expandStrokeToStamps(
        BRUSH_PRESETS.pen,
        [{ x: 0, y: 0, pressure: 0.25 }],
        { smoothing: 0, sizeOverride: 24, opacityOverride: 0.5 },
      );
      assert.equal(stamps[0]!.size, 24);
      assert.equal(stamps[0]!.opacity, 0.5);
    },
  ],
  [
    'expandStrokeToStamps returns empty for empty input',
    () => {
      assert.deepEqual(expandStrokeToStamps(BRUSH_PRESETS.pen, []), []);
    },
  ],
  [
    'smoothStrokePoints with factor 0 is identity',
    () => {
      const points = [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 5, pressure: 0.8 },
      ];
      const out = smoothStrokePoints(points, 0);
      assert.equal(out.length, 2);
      assert.equal(out[0]!.x, 0);
      assert.equal(out[1]!.x, 10);
      assert.equal(out[1]!.y, 5);
    },
  ],
  [
    'smoothStrokePoints high factor pulls points toward the start',
    () => {
      const points = [
        { x: 0, y: 0, pressure: 1 },
        { x: 100, y: 0, pressure: 1 },
        { x: 200, y: 0, pressure: 1 },
      ];
      const out = smoothStrokePoints(points, 0.9);
      // Heavy smoothing → second point moves toward 0.
      assert.ok(out[1]!.x < 50);
      assert.ok(out[2]!.x < 150);
    },
  ],
  [
    'smoothStrokePoints clamps factor at 0.95 to guarantee progress',
    () => {
      const points = [
        { x: 0, y: 0, pressure: 1 },
        { x: 100, y: 0, pressure: 1 },
      ];
      const out = smoothStrokePoints(points, 5); // way over the cap
      assert.ok(out[1]!.x > 0, 'second point must advance even with extreme factor');
    },
  ],
  [
    'stampsBoundingBox includes half-size halo',
    () => {
      const bbox = stampsBoundingBox([
        { x: 10, y: 10, size: 4, opacity: 1, hardness: 1, erase: false },
        { x: 20, y: 14, size: 6, opacity: 1, hardness: 1, erase: false },
      ]);
      assert.ok(bbox);
      assert.equal(bbox!.x, 8);
      assert.equal(bbox!.y, 8);
      // (20+3) - 8 = 15, ceil-floor → 15. (14+3) - 8 = 9.
      assert.equal(bbox!.w, 15);
      assert.equal(bbox!.h, 9);
    },
  ],
  [
    'stampsBoundingBox returns null for empty list',
    () => {
      assert.equal(stampsBoundingBox([]), null);
    },
  ],

  // ---- Brush-system server-side compositor seam ----
  [
    'composeStrokeIntoRaster paints color into transparent raster',
    () => {
      const target = fillRaster(8, 8, [0, 0, 0, 0]);
      const stamps = [
        { x: 4, y: 4, size: 4, opacity: 1, hardness: 1, erase: false },
      ];
      const out = composeStrokeIntoRaster(target, stamps, {
        color: { r: 1, g: 0, b: 0 },
      });
      const idx = (4 * 8 + 4) * 4;
      assert.equal(out.data[idx], 255);
      assert.equal(out.data[idx + 1], 0);
      assert.equal(out.data[idx + 2], 0);
      assert.equal(out.data[idx + 3], 255);
    },
  ],
  [
    'composeStrokeIntoRaster respects hardness falloff',
    () => {
      const target = fillRaster(16, 16, [0, 0, 0, 0]);
      const stamps = [
        { x: 8, y: 8, size: 8, opacity: 1, hardness: 0, erase: false },
      ];
      const out = composeStrokeIntoRaster(target, stamps, {
        color: { r: 1, g: 1, b: 1 },
      });
      const center = (8 * 16 + 8) * 4;
      const edge = (8 * 16 + 11) * 4;
      // Soft brush: center alpha > edge alpha.
      assert.ok(out.data[center + 3]! > out.data[edge + 3]!);
    },
  ],
  [
    'composeStrokeIntoRaster eraser reduces destination alpha only',
    () => {
      const target = fillRaster(8, 8, [255, 100, 50, 255]);
      const stamps = [
        { x: 4, y: 4, size: 4, opacity: 1, hardness: 1, erase: true },
      ];
      const out = composeStrokeIntoRaster(target, stamps, {});
      const idx = (4 * 8 + 4) * 4;
      // Color preserved, alpha cleared.
      assert.equal(out.data[idx], 255);
      assert.equal(out.data[idx + 1], 100);
      assert.equal(out.data[idx + 2], 50);
      assert.equal(out.data[idx + 3], 0);
    },
  ],
  [
    'composeStrokeIntoRaster mask-only writes alpha from luminance',
    () => {
      const target = fillRaster(8, 8, [0, 0, 0, 0]);
      const whiteStamp = [
        { x: 4, y: 4, size: 4, opacity: 1, hardness: 1, erase: false },
      ];
      const out = composeStrokeIntoRaster(target, whiteStamp, {
        color: { r: 1, g: 1, b: 1 },
        maskOnly: true,
      });
      const idx = (4 * 8 + 4) * 4;
      // White luminance = 1, sa = 1 → alpha → 255.
      assert.equal(out.data[idx + 3], 255);
      // RGB untouched.
      assert.equal(out.data[idx], 0);
    },
  ],
  [
    'composeStrokeIntoRaster mask-only uses black brush as zero alpha',
    () => {
      const target = fillRaster(4, 4, [0, 0, 0, 128]);
      const blackStamp = [
        { x: 2, y: 2, size: 2, opacity: 1, hardness: 1, erase: false },
      ];
      const out = composeStrokeIntoRaster(target, blackStamp, {
        color: { r: 0, g: 0, b: 0 },
        maskOnly: true,
      });
      const idx = (2 * 4 + 2) * 4;
      // Black luminance = 0 → alpha unchanged.
      assert.equal(out.data[idx + 3], 128);
    },
  ],
  [
    'composeStrokeIntoRaster clips stamps that lie outside the raster',
    () => {
      const target = fillRaster(4, 4, [0, 0, 0, 0]);
      const stamps = [
        { x: -100, y: -100, size: 4, opacity: 1, hardness: 1, erase: false },
        { x: 200, y: 200, size: 4, opacity: 1, hardness: 1, erase: false },
      ];
      const out = composeStrokeIntoRaster(target, stamps, { color: { r: 1, g: 0, b: 0 } });
      // No pixel changed.
      for (let i = 0; i < out.data.length; i += 4) {
        assert.equal(out.data[i + 3], 0);
      }
    },
  ],
  [
    'parseBrushColor handles #rrggbb',
    () => {
      const parsed = parseBrushColor('#FF8000');
      assert.ok(Math.abs(parsed.color.r - 1) < 1e-6);
      assert.ok(Math.abs(parsed.color.g - 128 / 255) < 1e-6);
      assert.equal(parsed.color.b, 0);
      assert.equal(parsed.opacity, 1);
    },
  ],
  [
    'parseBrushColor handles #rrggbbaa',
    () => {
      const parsed = parseBrushColor('#00ff0080');
      assert.equal(parsed.color.r, 0);
      assert.equal(parsed.color.g, 1);
      assert.equal(parsed.color.b, 0);
      assert.ok(Math.abs(parsed.opacity - 128 / 255) < 1e-6);
    },
  ],
  [
    'parseBrushColor rejects malformed strings',
    () => {
      assert.throws(() => parseBrushColor('red'));
      assert.throws(() => parseBrushColor('#abc'));
    },
  ],

  // ---- Selection-tools Phase A: raster + types ----
  [
    'createMask allocates a zero-filled bitmap of the requested dims',
    () => {
      const m = createMask(4, 3);
      assert.equal(m.width, 4);
      assert.equal(m.height, 3);
      assert.equal(m.data.length, 12);
      assert.ok(m.data.every((v) => v === 0));
    },
  ],
  [
    'createFullMask allocates a 255-filled bitmap',
    () => {
      const m = createFullMask(2, 2);
      assert.ok(m.data.every((v) => v === 255));
    },
  ],
  [
    'rectToMask sets the rectangle and clamps to canvas bounds',
    () => {
      const m = rectToMask({ x: 1, y: 1, w: 2, h: 2 }, 4, 4);
      // Inside the rect → 255
      assert.equal(m.data[1 * 4 + 1], 255);
      assert.equal(m.data[2 * 4 + 2], 255);
      // Outside → 0
      assert.equal(m.data[0], 0);
      assert.equal(m.data[3 * 4 + 3], 0);
    },
  ],
  [
    'rectToMask clamps coordinates that overflow the canvas',
    () => {
      const m = rectToMask({ x: -2, y: -2, w: 10, h: 10 }, 3, 3);
      assert.ok(m.data.every((v) => v === 255));
    },
  ],
  [
    'polygonToMask rasterizes a triangle via even-odd fill',
    () => {
      // Big triangle covering most of a 5x5 canvas.
      const tri = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ];
      const m = polygonToMask(tri, 5, 5);
      // (0,0) is inside the corner.
      assert.equal(m.data[0], 255);
      // (3,3) is outside the diagonal.
      assert.equal(m.data[3 * 5 + 3], 0);
    },
  ],
  [
    'pointInPolygon agrees with polygonToMask on a square',
    () => {
      const sq = [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 1, y: 3 },
      ];
      assert.equal(pointInPolygon({ x: 2, y: 2 }, sq), true);
      assert.equal(pointInPolygon({ x: 0, y: 0 }, sq), false);
    },
  ],
  [
    'maskBounds returns null on an empty mask',
    () => {
      assert.equal(maskBounds(createMask(4, 4)), null);
      assert.equal(isMaskEmpty(createMask(4, 4)), true);
    },
  ],
  [
    'maskBounds returns the tight bbox of set pixels',
    () => {
      const m = rectToMask({ x: 2, y: 1, w: 3, h: 2 }, 8, 8);
      const bb = maskBounds(m);
      assert.deepEqual(bb, { x: 2, y: 1, w: 3, h: 2 });
      assert.equal(isMaskEmpty(m), false);
    },
  ],

  // ---- Selection-tools Phase A: selectionToMask + boolean ops ----
  [
    'selectionToMask: none → empty mask',
    () => {
      const m = selectionToMask({ kind: 'none' }, 4, 4);
      assert.equal(isMaskEmpty(m), true);
    },
  ],
  [
    'selectionToMask: rect → rectToMask equivalent',
    () => {
      const m = selectionToMask(
        { kind: 'rect', rect: { x: 0, y: 0, w: 2, h: 2 } },
        4,
        4,
      );
      assert.deepEqual(maskBounds(m), { x: 0, y: 0, w: 2, h: 2 });
    },
  ],
  [
    'selectionToMask: lasso → polygonToMask equivalent',
    () => {
      const m = selectionToMask(
        {
          kind: 'lasso',
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 3 },
            { x: 0, y: 3 },
          ],
        },
        4,
        4,
      );
      assert.equal(m.data[0], 255);
      assert.equal(m.data[(3 * 4) + 3], 0);
    },
  ],
  [
    'selectionToMask throws when mask kind has no resolver',
    () => {
      assert.throws(() =>
        selectionToMask(
          { kind: 'mask', layer_id: 'X' as unknown as LayerId },
          4,
          4,
        ),
      );
    },
  ],
  [
    'composeMasks: replace returns the incoming mask',
    () => {
      const a = rectToMask({ x: 0, y: 0, w: 2, h: 2 }, 4, 4);
      const b = rectToMask({ x: 2, y: 2, w: 2, h: 2 }, 4, 4);
      const out = composeMasks(a, b, 'replace');
      assert.strictEqual(out, b);
    },
  ],
  [
    'composeMasks: add takes the brighter pixel',
    () => {
      const a = rectToMask({ x: 0, y: 0, w: 2, h: 4 }, 4, 4);
      const b = rectToMask({ x: 2, y: 0, w: 2, h: 4 }, 4, 4);
      const out = composeMasks(a, b, 'add');
      // Both halves selected.
      assert.equal(out.data[0], 255);
      assert.equal(out.data[3], 255);
    },
  ],
  [
    'composeMasks: subtract removes the second mask from the first',
    () => {
      const a = rectToMask({ x: 0, y: 0, w: 4, h: 4 }, 4, 4);
      const b = rectToMask({ x: 1, y: 1, w: 2, h: 2 }, 4, 4);
      const out = composeMasks(a, b, 'subtract');
      // Center punched out
      assert.equal(out.data[1 * 4 + 1], 0);
      // Corner survives
      assert.equal(out.data[0], 255);
    },
  ],
  [
    'composeMasks: intersect keeps only overlap',
    () => {
      const a = rectToMask({ x: 0, y: 0, w: 3, h: 3 }, 4, 4);
      const b = rectToMask({ x: 1, y: 1, w: 3, h: 3 }, 4, 4);
      const out = composeMasks(a, b, 'intersect');
      assert.equal(out.data[0], 0);
      assert.equal(out.data[1 * 4 + 1], 255);
      assert.equal(out.data[2 * 4 + 2], 255);
    },
  ],
  [
    'composeMasks: dim mismatch throws',
    () => {
      const a = createMask(4, 4);
      const b = createMask(3, 4);
      assert.throws(() => composeMasks(a, b, 'add'));
    },
  ],
  [
    'applyOp: replace ignores the prior selection',
    () => {
      const cur = { kind: 'rect' as const, rect: { x: 0, y: 0, w: 2, h: 2 } };
      const inc = { kind: 'rect' as const, rect: { x: 2, y: 2, w: 2, h: 2 } };
      const out = applyOp(cur, inc, 'replace', 4, 4);
      assert.equal(out.data[0], 0);
      assert.equal(out.data[3 * 4 + 3], 255);
    },
  ],
  [
    'applyOp: add unions the two selections',
    () => {
      const cur = { kind: 'rect' as const, rect: { x: 0, y: 0, w: 2, h: 4 } };
      const inc = { kind: 'rect' as const, rect: { x: 2, y: 0, w: 2, h: 4 } };
      const out = applyOp(cur, inc, 'add', 4, 4);
      assert.deepEqual(maskBounds(out), { x: 0, y: 0, w: 4, h: 4 });
    },
  ],
  [
    'invertMask flips 0 ↔ 255',
    () => {
      const m = rectToMask({ x: 0, y: 0, w: 2, h: 2 }, 4, 4);
      const inv = invertMask(m);
      assert.equal(inv.data[0], 0);
      assert.equal(inv.data[3 * 4 + 3], 255);
    },
  ],
  [
    'selectAllMask covers the whole canvas',
    () => {
      const m = selectAllMask(4, 3);
      assert.equal(m.width, 4);
      assert.equal(m.height, 3);
      assert.ok(m.data.every((v) => v === 255));
    },
  ],

  // ---- Selection-tools Phase A: lasso simplification (RDP) ----
  [
    'simplifyLassoPath returns input verbatim when ≤2 points',
    () => {
      const p = [{ x: 0, y: 0 }];
      assert.deepEqual(simplifyLassoPath(p), [{ x: 0, y: 0 }]);
    },
  ],
  [
    'simplifyLassoPath drops collinear interior points',
    () => {
      const path = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ];
      const simplified = simplifyLassoPath(path);
      // Endpoints survive; interior collinear points are pruned.
      assert.equal(simplified.length, 2);
      assert.deepEqual(simplified[0], { x: 0, y: 0 });
      assert.deepEqual(simplified[1], { x: 4, y: 0 });
    },
  ],
  [
    'simplifyLassoPath keeps points outside the epsilon corridor',
    () => {
      const path = [
        { x: 0, y: 0 },
        { x: 1, y: 5 }, // far off the line
        { x: 2, y: 0 },
      ];
      const simplified = simplifyLassoPath(path, 1.0);
      assert.equal(simplified.length, 3);
    },
  ],
  [
    'closeLassoPath appends the start vertex when needed',
    () => {
      const open = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ];
      const closed = closeLassoPath(open);
      assert.equal(closed.length, 4);
      assert.deepEqual(closed[3], closed[0]);
    },
  ],
  [
    'DEFAULT_RDP_EPSILON is 1 px (NFR-2)',
    () => {
      assert.equal(DEFAULT_RDP_EPSILON, 1.0);
    },
  ],

  // ---- Selection-tools Phase A: magic wand ----
  [
    'sampleRgb returns the pixel at the requested coords',
    () => {
      const bytes = new Uint8Array(2 * 2 * 4);
      // Pixel (1,0) = magenta-ish.
      bytes[4] = 200;
      bytes[5] = 50;
      bytes[6] = 100;
      bytes[7] = 255;
      const s = sampleRgb(bytes, 2, 2, { x: 1, y: 0 });
      assert.deepEqual(s, { r: 200, g: 50, b: 100 });
    },
  ],
  [
    'colorDistance is Chebyshev/L∞',
    () => {
      assert.equal(
        colorDistance({ r: 0, g: 0, b: 0 }, { r: 10, g: 30, b: 50 }),
        50,
      );
    },
  ],
  [
    'magicWandSelect (contiguous) flood-fills a connected colour region',
    () => {
      const w = 4;
      const h = 4;
      const bytes = new Uint8Array(w * h * 4);
      // Fill left half with white, right half with black.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const v = x < 2 ? 255 : 0;
          bytes[i] = v;
          bytes[i + 1] = v;
          bytes[i + 2] = v;
          bytes[i + 3] = 255;
        }
      }
      const m = magicWandSelect({
        imageBytes: bytes,
        width: w,
        height: h,
        tapPoint: { x: 0, y: 0 },
        tolerance: 10,
      });
      // Left half selected, right half not.
      assert.equal(m.data[0], 255);
      assert.equal(m.data[1], 255);
      assert.equal(m.data[2], 0);
      assert.equal(m.data[3], 0);
    },
  ],
  [
    'magicWandSelect (non-contiguous) ignores connectivity',
    () => {
      const w = 4;
      const h = 1;
      const bytes = new Uint8Array(w * h * 4);
      // Two separated red pixels at x=0 and x=3.
      bytes[0] = 255;
      bytes[3] = 255;
      bytes[12] = 255;
      bytes[15] = 255;
      const m = magicWandSelect({
        imageBytes: bytes,
        width: w,
        height: h,
        tapPoint: { x: 0, y: 0 },
        tolerance: 5,
        contiguous: false,
      });
      assert.equal(m.data[0], 255);
      assert.equal(m.data[3], 255);
    },
  ],
  [
    'magicWandSelect rejects a tap outside the canvas',
    () => {
      const bytes = new Uint8Array(4);
      bytes[3] = 255;
      const m = magicWandSelect({
        imageBytes: bytes,
        width: 1,
        height: 1,
        tapPoint: { x: 5, y: 5 },
        tolerance: 0,
      });
      assert.equal(isMaskEmpty(m), true);
    },
  ],
  [
    'magicWandSelect throws on byte-length mismatch',
    () => {
      assert.throws(() =>
        magicWandSelect({
          imageBytes: new Uint8Array(3),
          width: 1,
          height: 1,
          tapPoint: { x: 0, y: 0 },
        }),
      );
    },
  ],
  [
    'DEFAULT_TOLERANCE is 32 (FR-7)',
    () => {
      assert.equal(DEFAULT_TOLERANCE, 32);
    },
  ],

  // ---- Selection-tools Phase A: refine (grow / shrink / blur / feather) ----
  [
    'growMask dilates a single-pixel selection into a Chebyshev disc',
    () => {
      const m = createMask(5, 5);
      m.data[2 * 5 + 2] = 255;
      const grown = growMask(m, 1);
      // 3x3 around the centre is set.
      for (let y = 1; y <= 3; y++) {
        for (let x = 1; x <= 3; x++) {
          assert.equal(grown.data[y * 5 + x], 255);
        }
      }
      assert.equal(grown.data[0], 0);
    },
  ],
  [
    'shrinkMask erodes a 3x3 selection to a single pixel',
    () => {
      const m = rectToMask({ x: 1, y: 1, w: 3, h: 3 }, 5, 5);
      const shrunk = shrinkMask(m, 1);
      // Only the centre pixel survives the 1-px erosion.
      assert.equal(shrunk.data[2 * 5 + 2], 255);
      assert.equal(shrunk.data[1 * 5 + 1], 0);
    },
  ],
  [
    'blurMask softens a hard edge into gradient values',
    () => {
      const m = rectToMask({ x: 0, y: 0, w: 4, h: 8 }, 8, 8);
      const blurred = blurMask(m, 1);
      // The pixel just outside the original rect should now have non-zero coverage.
      assert.ok(blurred.data[4]! > 0);
      assert.ok(blurred.data[4]! < 255);
    },
  ],
  [
    'featherMask is an alias for blurMask',
    () => {
      const m = rectToMask({ x: 0, y: 0, w: 4, h: 8 }, 8, 8);
      const a = featherMask(m, 2);
      const b = blurMask(m, 2);
      assert.deepEqual(Array.from(a.data), Array.from(b.data));
    },
  ],
  [
    'refineMask applies grow → shrink → feather → blur → threshold',
    () => {
      const base = rectToMask({ x: 2, y: 2, w: 4, h: 4 }, 8, 8);
      const refined = refineMask(base, { grow_px: 1, threshold: 128 });
      // Threshold returns a binary mask.
      for (const v of refined.data) {
        assert.ok(v === 0 || v === 255, `expected binary, got ${v}`);
      }
      // The refined mask should be larger than the input.
      const orig = maskBounds(base)!;
      const after = maskBounds(refined)!;
      assert.ok(after.w >= orig.w);
      assert.ok(after.h >= orig.h);
    },
  ],
  [
    'refineMask is a no-op when no params are set',
    () => {
      const base = rectToMask({ x: 0, y: 0, w: 2, h: 2 }, 4, 4);
      const out = refineMask(base, {});
      assert.deepEqual(Array.from(out.data), Array.from(base.data));
    },
  ],

  // ---- Polygon ↔ lasso adapters ----
  [
    'polygonFromLasso / lassoFromPolygon are no-op identities',
    () => {
      const lasso = {
        kind: 'lasso' as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      };
      assert.strictEqual(polygonFromLasso(lasso), lasso);
      assert.strictEqual(lassoFromPolygon(lasso), lasso);
    },
  ],

  // ---- transform-tools Phase A: matrix math (A.2) ----
  [
    'IDENTITY_MATRIX maps every point to itself',
    () => {
      const p = matrixApplyPoint(IDENTITY_MATRIX, { x: 7.5, y: -3.25 });
      assert.equal(p.x, 7.5);
      assert.equal(p.y, -3.25);
    },
  ],
  [
    'matrixMultiply: T * R * S applies in expected order',
    () => {
      const t = matrixTranslate(10, 20);
      const r = matrixRotate(90);
      const s = matrixScale(2, 3);
      // Compose: M = T * R * S, applied to (1, 0): scale → (2, 0); rotate 90° → (0, 2); translate → (10, 22).
      const m = matrixMultiply(matrixMultiply(t, r), s);
      const p = matrixApplyPoint(m, { x: 1, y: 0 });
      assert.ok(Math.abs(p.x - 10) < 1e-9, `x=${p.x}`);
      assert.ok(Math.abs(p.y - 22) < 1e-9, `y=${p.y}`);
    },
  ],
  [
    'matrixInvert produces a true inverse for a non-degenerate affine',
    () => {
      const m = matrixMultiply(matrixTranslate(50, -25), matrixMultiply(matrixRotate(35), matrixScale(2, 0.5)));
      const inv = matrixInvert(m);
      const round = matrixMultiply(m, inv);
      assert.ok(matrixApproxEqual(round, IDENTITY_MATRIX, 1e-9));
    },
  ],
  [
    'matrixInvert throws on a singular matrix',
    () => {
      const singular = matrixScale(0, 1);
      assert.throws(() => matrixInvert(singular));
    },
  ],

  // ---- transform-tools Phase A: decompose / recompose (A.6) ----
  [
    'composeMatrix(IDENTITY) is the identity',
    () => {
      const m = composeMatrix(IDENTITY_TRANSFORM, 1024, 1024);
      assert.ok(matrixApproxEqual(m, IDENTITY_MATRIX, 1e-9));
    },
  ],
  [
    'composeMatrix translate places anchor at expected location',
    () => {
      const t: TransformDecomposed = { ...IDENTITY_TRANSFORM, tx: 100, ty: 50 };
      const m = composeMatrix(t, 1024, 768);
      const p = matrixApplyPoint(m, { x: 512, y: 384 });
      assert.ok(Math.abs(p.x - 612) < 1e-9, `x=${p.x}`);
      assert.ok(Math.abs(p.y - 434) < 1e-9, `y=${p.y}`);
    },
  ],
  [
    'composeMatrix scale scales around anchor (centre by default)',
    () => {
      const t: TransformDecomposed = { ...IDENTITY_TRANSFORM, sx: 2, sy: 2 };
      const m = composeMatrix(t, 1000, 1000);
      // Centre stays put.
      const c = matrixApplyPoint(m, { x: 500, y: 500 });
      assert.ok(Math.abs(c.x - 500) < 1e-9);
      assert.ok(Math.abs(c.y - 500) < 1e-9);
      // (1000, 1000) maps to (1500, 1500) after 2x around centre 500.
      const corner = matrixApplyPoint(m, { x: 1000, y: 1000 });
      assert.ok(Math.abs(corner.x - 1500) < 1e-9);
      assert.ok(Math.abs(corner.y - 1500) < 1e-9);
    },
  ],
  [
    'composeMatrix rotate 90° around centre maps top-left to top-right',
    () => {
      const t: TransformDecomposed = { ...IDENTITY_TRANSFORM, rotation_deg: 90 };
      const m = composeMatrix(t, 100, 100);
      // (0,0) is the top-left of the local rect with anchor at (50, 50). After 90° CCW…
      // (Note: matrixRotate uses standard math convention; +Y is down so visual feel may differ.)
      const tl = matrixApplyPoint(m, { x: 0, y: 0 });
      // sanity: rotation by 90° around (50,50): (0,0) -> (50 - (0 - 50)·sin90°·… ) — confirm round-trip via inverse instead.
      const inv = matrixInvert(m);
      const round = matrixApplyPoint(inv, tl);
      assert.ok(Math.abs(round.x) < 1e-6);
      assert.ok(Math.abs(round.y) < 1e-6);
    },
  ],
  [
    'decomposeMatrix round-trips translate + scale + rotate (no float drift)',
    () => {
      const original: TransformDecomposed = {
        ...IDENTITY_TRANSFORM,
        tx: 123.5,
        ty: -45,
        sx: 1.5,
        sy: 0.8,
        rotation_deg: 35,
      };
      const m = composeMatrix(original, 1024, 1024);
      const recovered = decomposeMatrix(m, 1024, 1024, original.anchor);
      assert.ok(decomposedApproxEqual(original, recovered, 1e-6),
        `recovered=${JSON.stringify(recovered)}`);
    },
  ],
  [
    'decomposeMatrix round-trips with skew_x',
    () => {
      const original: TransformDecomposed = {
        ...IDENTITY_TRANSFORM,
        sx: 1.2,
        sy: 0.9,
        rotation_deg: -22,
        skew_x_deg: 12,
      };
      const m = composeMatrix(original, 512, 512);
      const recovered = decomposeMatrix(m, 512, 512, original.anchor);
      assert.ok(decomposedApproxEqual(original, recovered, 1e-5),
        `recovered=${JSON.stringify(recovered)}`);
    },
  ],
  [
    'splitFlipFromScale moves negative sign from scale into flip booleans',
    () => {
      const t: TransformDecomposed = { ...IDENTITY_TRANSFORM, sx: -2, sy: 1.5 };
      const out = splitFlipFromScale(t);
      assert.equal(out.sx, 2);
      assert.equal(out.sy, 1.5);
      assert.equal(out.flip_h, true);
      assert.equal(out.flip_v, false);
    },
  ],
  [
    'normalizeAngleDeg wraps to (-180, 180]',
    () => {
      assert.equal(normalizeAngleDeg(0), 0);
      assert.equal(normalizeAngleDeg(180), 180);
      assert.equal(normalizeAngleDeg(-180), 180);
      assert.equal(normalizeAngleDeg(540), 180);
      assert.ok(Math.abs(normalizeAngleDeg(361) - 1) < 1e-9);
    },
  ],

  // ---- transform-tools Phase A: pure operations (A.4) ----
  [
    'translate is additive on tx/ty and immutable',
    () => {
      const a = identityDecomposed();
      const b = transformTranslate(a, 10, 20);
      assert.equal(b.tx, 10);
      assert.equal(b.ty, 20);
      // Immutability.
      assert.equal(a.tx, 0);
      assert.notStrictEqual(a, b);
    },
  ],
  [
    'scale multiplies; preserve_aspect forces sy = sx',
    () => {
      const a: TransformDecomposed = { ...IDENTITY_TRANSFORM, sx: 2, sy: 3 };
      const b = transformScale(a, 1.5, 1.1);
      assert.ok(Math.abs(b.sx - 3) < 1e-9);
      assert.ok(Math.abs(b.sy - 3.3) < 1e-9);
      const c = transformScale(a, 1.5, 999, { preserve_aspect: true });
      assert.ok(Math.abs(c.sx - 3) < 1e-9);
      assert.ok(Math.abs(c.sy - 4.5) < 1e-9);
    },
  ],
  [
    'rotate normalises into (-180, 180]',
    () => {
      const a = identityDecomposed();
      const b = transformRotate(a, 200);
      assert.ok(Math.abs(b.rotation_deg - -160) < 1e-9, `${b.rotation_deg}`);
      const c = transformRotate(b, 720);
      assert.ok(Math.abs(c.rotation_deg - -160) < 1e-9, `${c.rotation_deg}`);
    },
  ],
  [
    'flip toggles the requested axis',
    () => {
      const a = identityDecomposed();
      const h = transformFlip(a, 'h');
      assert.equal(h.flip_h, true);
      const v = transformFlip(h, 'v');
      assert.equal(v.flip_h, true);
      assert.equal(v.flip_v, true);
      const back = transformFlip(v, 'h');
      assert.equal(back.flip_h, false);
    },
  ],
  [
    'skew is additive on each axis',
    () => {
      const a = identityDecomposed();
      const b = transformSkew(a, 5, -3);
      assert.equal(b.skew_x_deg, 5);
      assert.equal(b.skew_y_deg, -3);
    },
  ],
  [
    'setAnchor returns a new transform with the new anchor',
    () => {
      const a = identityDecomposed();
      const b = setAnchor(a, { x: 0, y: 0 });
      assert.deepEqual(b.anchor, { x: 0, y: 0 });
      assert.deepEqual(a.anchor, { x: 0.5, y: 0.5 });
    },
  ],
  [
    'reset returns the identity transform',
    () => {
      const a: TransformDecomposed = { ...IDENTITY_TRANSFORM, tx: 99, sx: 2 };
      void a;
      const r = transformReset();
      assert.equal(r.tx, 0);
      assert.equal(r.sx, 1);
      assert.deepEqual(r.anchor, { x: 0.5, y: 0.5 });
    },
  ],
  [
    'distortFourCorner sets corners; clearDistort drops them',
    () => {
      const corners: [TransformPoint, TransformPoint, TransformPoint, TransformPoint] = [
        { x: 10, y: 10 }, { x: 90, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 95 },
      ];
      const a = distortFourCorner(identityDecomposed(), corners);
      assert.deepEqual(a.distort_corners, corners);
      const b = clearDistort(a);
      assert.equal(b.distort_corners, undefined);
      // Idempotent on a transform with no distort.
      assert.equal(clearDistort(b), b);
    },
  ],

  // ---- transform-tools Phase A: mergeTransform (A.5) ----
  [
    'mergeTransform absolute partial overrides only provided fields',
    () => {
      const prev: TransformDecomposed = {
        ...IDENTITY_TRANSFORM,
        tx: 10,
        ty: 20,
        sx: 1.5,
      };
      const partial: TransformPartial = { tx: 99 };
      const next = mergeTransform(prev, partial);
      assert.equal(next.tx, 99);
      assert.equal(next.ty, 20);
      assert.equal(next.sx, 1.5);
    },
  ],
  [
    'mergeTransform delta input applies relative changes',
    () => {
      const prev: TransformDecomposed = { ...IDENTITY_TRANSFORM, tx: 10, sx: 2 };
      const delta: TransformDelta = {
        translate: { dx: 5, dy: -3 },
        scale: { sx: 1.5, sy: 2 },
        rotate_deg: 45,
      };
      const next = mergeTransform(prev, delta);
      assert.equal(next.tx, 15);
      assert.equal(next.ty, -3);
      assert.ok(Math.abs(next.sx - 3) < 1e-9);
      assert.ok(Math.abs(next.sy - 2) < 1e-9);
      assert.ok(Math.abs(next.rotation_deg - 45) < 1e-9);
    },
  ],
  [
    'mergeTransform passing distort_corners=null clears the projective override',
    () => {
      const prev = distortFourCorner(identityDecomposed(), [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
      ]);
      const next = mergeTransform(prev, { distort_corners: null });
      assert.equal(next.distort_corners, undefined);
    },
  ],
  [
    'mergeTransform with undefined input returns prev unchanged',
    () => {
      const prev: TransformDecomposed = { ...IDENTITY_TRANSFORM, tx: 7 };
      assert.strictEqual(mergeTransform(prev, undefined), prev);
    },
  ],

  // ---- transform-tools Phase A: 4-point projective (A.3) ----
  [
    'projectiveFromQuad maps the layer rect onto the destination quad',
    () => {
      const corners: [TransformPoint, TransformPoint, TransformPoint, TransformPoint] = [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
      ];
      const m = projectiveFromQuad(corners, 100, 100);
      // For a unit-aligned quad, the matrix should reduce to identity.
      const tl = matrixApplyPoint(m, { x: 0, y: 0 });
      const tr = matrixApplyPoint(m, { x: 100, y: 0 });
      const br = matrixApplyPoint(m, { x: 100, y: 100 });
      const bl = matrixApplyPoint(m, { x: 0, y: 100 });
      assert.ok(Math.abs(tl.x - 0) < 1e-6 && Math.abs(tl.y - 0) < 1e-6);
      assert.ok(Math.abs(tr.x - 100) < 1e-6 && Math.abs(tr.y - 0) < 1e-6);
      assert.ok(Math.abs(br.x - 100) < 1e-6 && Math.abs(br.y - 100) < 1e-6);
      assert.ok(Math.abs(bl.x - 0) < 1e-6 && Math.abs(bl.y - 100) < 1e-6);
    },
  ],
  [
    'projectiveFromQuad maps to a sheared trapezoid; round-trip via inverse',
    () => {
      const corners: [TransformPoint, TransformPoint, TransformPoint, TransformPoint] = [
        { x: 20, y: 10 }, { x: 90, y: 5 }, { x: 100, y: 110 }, { x: 5, y: 95 },
      ];
      const fwd = projectiveFromQuad(corners, 100, 100);
      const inv = projectiveToLocal(corners, 100, 100);
      // Round-trip: fwd then inv should land back at local rect coords.
      const probes = [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
        { x: 50, y: 50 }, { x: 25, y: 75 },
      ];
      for (const p of probes) {
        const out = matrixApplyPoint(inv, matrixApplyPoint(fwd, p));
        assert.ok(Math.abs(out.x - p.x) < 1e-4, `x: expected ${p.x}, got ${out.x}`);
        assert.ok(Math.abs(out.y - p.y) < 1e-4, `y: expected ${p.y}, got ${out.y}`);
      }
    },
  ],
  [
    'isNonDegenerateQuad rejects collinear quads',
    () => {
      const flat: [TransformPoint, TransformPoint, TransformPoint, TransformPoint] = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      ];
      assert.equal(isNonDegenerateQuad(flat), false);
      const ok: [TransformPoint, TransformPoint, TransformPoint, TransformPoint] = [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      ];
      assert.equal(isNonDegenerateQuad(ok), true);
    },
  ],

  // ---- transform-tools Phase B: snap detection (B.1, B.2, B.3) ----
  [
    'findSnapTargets detects canvas left edge within threshold',
    () => {
      const targets = findSnapTargets(
        { x: 3, y: 200, w: 100, h: 100 },
        { canvas_width: 1024, canvas_height: 1024, other_layers: [] },
        DEFAULT_SNAP_THRESHOLD_PX,
      );
      const left = targets.find((t) => t.kind === 'canvas-edge' && t.value === 0 && t.snap_to === 'start');
      assert.ok(left, `expected left-edge snap; got ${JSON.stringify(targets)}`);
      assert.equal(left!.distance, 3);
    },
  ],
  [
    'findSnapTargets returns empty when no targets are within threshold',
    () => {
      // Rect is far from any canvas edge AND from canvas centre (512, 512).
      const targets = findSnapTargets(
        { x: 200, y: 200, w: 50, h: 50 },
        { canvas_width: 1024, canvas_height: 1024, other_layers: [] },
        2,
      );
      assert.equal(targets.length, 0);
    },
  ],
  [
    'findSnapTargets surfaces other-layer edges',
    () => {
      const targets = findSnapTargets(
        { x: 100, y: 100, w: 50, h: 50 },
        {
          canvas_width: 1024,
          canvas_height: 1024,
          other_layers: [
            { layer_id: 'L1' as never, x: 152, y: 200, w: 50, h: 50 },
          ],
        },
        DEFAULT_SNAP_THRESHOLD_PX,
      );
      const layerSnap = targets.find((t) => t.kind === 'layer-edge' && t.source_id === 'L1');
      assert.ok(layerSnap);
    },
  ],
  [
    'findSnapTargets with grid_enabled snaps to multiples of GRID_STEP_PX',
    () => {
      const targets = findSnapTargets(
        { x: 14, y: 30, w: 10, h: 10 },
        { canvas_width: 1024, canvas_height: 1024, other_layers: [], grid_enabled: true },
        DEFAULT_SNAP_THRESHOLD_PX,
      );
      const gridV = targets.find((t) => t.kind === 'grid' && t.axis === 'v');
      assert.ok(gridV);
      assert.equal(gridV!.value % GRID_STEP_PX, 0);
    },
  ],
  [
    'pickClosestPerAxis returns the smallest-distance target on each axis',
    () => {
      const targets = findSnapTargets(
        { x: 4, y: 8, w: 10, h: 10 },
        { canvas_width: 1024, canvas_height: 1024, other_layers: [], grid_enabled: true },
        DEFAULT_SNAP_THRESHOLD_PX,
      );
      const closest = pickClosestPerAxis(targets);
      // Both axes should have a target (canvas edges and grid are reachable).
      assert.ok(closest.vertical !== null);
      assert.ok(closest.horizontal !== null);
      // Distances must be ≤ threshold.
      assert.ok(closest.vertical!.distance <= DEFAULT_SNAP_THRESHOLD_PX);
      assert.ok(closest.horizontal!.distance <= DEFAULT_SNAP_THRESHOLD_PX);
    },
  ],
  [
    'nearestRotationSnap snaps inside the window and passes through outside it',
    () => {
      assert.equal(nearestRotationSnap(0), 0);
      assert.equal(nearestRotationSnap(14), ROTATION_SNAP_STEP_DEG); // within ±3° of 15°
      assert.ok(Math.abs(nearestRotationSnap(20) - 20) < 1e-9, 'outside window passes through');
      assert.equal(nearestRotationSnap(31), 30);
    },
  ],

  // ---- mask-system Phase A: pure ops ----
  [
    'invertMaskBytes flips 0↔255 and is reversible',
    () => {
      const m = new Uint8Array([0, 64, 128, 255]);
      const inv = invertMaskBytes(m);
      assert.deepEqual(Array.from(inv), [255, 191, 127, 0]);
      const round = invertMaskBytes(inv);
      assert.deepEqual(Array.from(round), [0, 64, 128, 255]);
    },
  ],
  [
    'clearMaskBytes returns zeros at the requested length',
    () => {
      const m = clearMaskBytes(16);
      assert.equal(m.length, 16);
      assert.ok(m.every((v) => v === 0));
    },
  ],
  [
    'fillMaskBytes clamps and rounds the value',
    () => {
      assert.equal(fillMaskBytes(4, -10)[0], 0);
      assert.equal(fillMaskBytes(4, 256)[0], 255);
      assert.equal(fillMaskBytes(4, 127.6)[0], 128);
    },
  ],
  [
    'thresholdMaskBytes binarizes at the cut-off',
    () => {
      const m = new Uint8Array([0, 100, 127, 128, 200, 255]);
      const t = thresholdMaskBytes(m, 128);
      assert.deepEqual(Array.from(t), [0, 0, 0, 255, 255, 255]);
    },
  ],
  [
    'morphology dilate widens a single pixel',
    () => {
      const m = new Uint8Array(25);
      m[12] = 255;
      const dil = morphology(m, 5, 5, 'dilate', 1);
      const set = Array.from(dil).filter((v) => v === 255).length;
      assert.equal(set, 9);
    },
  ],
  [
    'morphology erode shrinks around a corner hole',
    () => {
      const m = new Uint8Array(25).fill(255);
      m[0] = 0;
      const eroded = morphology(m, 5, 5, 'erode', 1);
      assert.equal(eroded[0], 0);
      assert.equal(eroded[1], 0);
      assert.equal(eroded[5], 0);
      assert.equal(eroded[6], 0);
      assert.equal(eroded[12], 255);
    },
  ],
  [
    'gaussianBlurBytes preserves uniform regions',
    () => {
      const flat = new Uint8Array(64).fill(128);
      const blurred = gaussianBlurBytes(flat, 8, 8, 2);
      for (const v of blurred) assert.ok(Math.abs(v - 128) <= 2);
    },
  ],
  [
    'refineMaskBytes returns a defensive copy when ops are empty',
    () => {
      const m = new Uint8Array([10, 20, 30, 40]);
      const out = refineMaskBytes(m, 2, 2, {});
      assert.deepEqual(Array.from(out), [10, 20, 30, 40]);
      assert.notEqual(out, m, 'out must not be the same reference as input');
    },
  ],
  [
    'refineMaskBytes composes threshold → grow',
    () => {
      const m = new Uint8Array(25);
      m[12] = 200;
      const out = refineMaskBytes(m, 5, 5, { threshold: 128, grow_px: 1 });
      const set = Array.from(out).filter((v) => v === 255).length;
      assert.equal(set, 9);
    },
  ],
  [
    'selectionToMaskBytes rasterizes a rect',
    () => {
      const sel = { kind: 'rect' as const, rect: { x: 1, y: 1, w: 2, h: 2 } };
      const m = selectionToMaskBytes(sel, { width: 4, height: 4 });
      const set = Array.from(m).filter((v) => v === 255).length;
      assert.equal(set, 4);
      assert.equal(m[1 * 4 + 1], 255);
      assert.equal(m[2 * 4 + 2], 255);
    },
  ],
  [
    'selectionToMaskBytes rasterizes a closed lasso polygon',
    () => {
      const sel = {
        kind: 'lasso' as const,
        points: [
          { x: 0.5, y: 0.5 },
          { x: 4.5, y: 0.5 },
          { x: 4.5, y: 4.5 },
          { x: 0.5, y: 4.5 },
        ],
      };
      const m = selectionToMaskBytes(sel, { width: 5, height: 5 });
      const set = Array.from(m).filter((v) => v === 255).length;
      assert.ok(set >= 16, `expected >=16 set pixels, got ${set}`);
    },
  ],
  [
    'selectionToMaskBytes returns empty for kind: none',
    () => {
      const m = selectionToMaskBytes({ kind: 'none' }, { width: 2, height: 2 });
      assert.ok(m.every((v) => v === 0));
    },
  ],
  [
    'selectionToMaskBytes resolves mask selection through resolver',
    () => {
      const bytes = new Uint8Array([255, 0, 0, 255]);
      const sel = { kind: 'mask' as const, layer_id: 'L1' as unknown as LayerId };
      const m = selectionToMaskBytes(sel, { width: 2, height: 2 }, () => bytes);
      assert.deepEqual(Array.from(m), [255, 0, 0, 255]);
      assert.notEqual(m, bytes, 'returned array must be a copy');
    },
  ],
  [
    'selection ↔ mask roundtrip is lossless at threshold=128 (FR-14)',
    () => {
      const original = new Uint8Array(16);
      for (let i = 0; i < 16; i++) original[i] = i % 3 === 0 ? 255 : 0;
      const r = maskBytesToSelection(original, 128);
      assert.deepEqual(Array.from(r.binary), Array.from(original));
      const sel = r.buildSelection('LAYER' as unknown as LayerId);
      const replayed = selectionToMaskBytes(sel, { width: 4, height: 4 }, () => r.binary);
      assert.deepEqual(Array.from(replayed), Array.from(original));
    },
  ],
  [
    'maskBytesToSelection respects the threshold parameter',
    () => {
      const m = new Uint8Array([0, 100, 200, 255]);
      const r = maskBytesToSelection(m, 150);
      assert.deepEqual(Array.from(r.binary), [0, 0, 255, 255]);
    },
  ],
  [
    'deriveFromLayer alpha mode copies the alpha channel',
    () => {
      const rgba = new Uint8Array([
        100, 100, 100, 0,
        100, 100, 100, 64,
        100, 100, 100, 128,
        100, 100, 100, 255,
      ]);
      const out = deriveFromLayer(rgba, 2, 2, { channel: 'alpha', invert: false });
      assert.deepEqual(Array.from(out), [0, 64, 128, 255]);
    },
  ],
  [
    'deriveFromLayer luminance mode honours alpha modulation',
    () => {
      const rgba = new Uint8Array([255, 255, 255, 255]);
      const out = deriveFromLayer(rgba, 1, 1, { channel: 'luminance', invert: false });
      assert.equal(out[0], 255);
      const rgba2 = new Uint8Array([255, 255, 255, 0]);
      const out2 = deriveFromLayer(rgba2, 1, 1, { channel: 'luminance', invert: false });
      assert.equal(out2[0], 0);
    },
  ],
  [
    'deriveFromLayer invert flag flips the result',
    () => {
      const rgba = new Uint8Array([0, 0, 0, 100, 0, 0, 0, 200]);
      const a = deriveFromLayer(rgba, 1, 2, { channel: 'alpha', invert: false });
      const b = deriveFromLayer(rgba, 1, 2, { channel: 'alpha', invert: true });
      for (let i = 0; i < a.length; i++) assert.equal(b[i], 255 - a[i]!);
    },
  ],
  [
    'deriveFromLayer rejects mismatched buffer length',
    () => {
      const rgba = new Uint8Array(10);
      assert.throws(() =>
        deriveFromLayer(rgba, 2, 2, { channel: 'alpha', invert: false }),
      );
    },
  ],
  [
    'buildTwoMasks produces denoising and blend with expected geometry',
    () => {
      const w = 16;
      const h = 16;
      const mask = new Uint8Array(w * h);
      for (let y = 4; y < 12; y++) {
        for (let x = 4; x < 12; x++) mask[y * w + x] = 255;
      }
      const { denoising, blend } = buildTwoMasks(mask, { width: w, height: h }, {
        denoise_offset_px: 1,
        denoise_feather_px: 1,
        blend_grow_px: 3,
        blend_feather_pct: 10,
      });
      assert.equal(denoising.length, mask.length);
      assert.equal(blend.length, mask.length);
      const denCount = Array.from(denoising).filter((v) => v > 0).length;
      const blendCount = Array.from(blend).filter((v) => v > 0).length;
      assert.ok(blendCount > denCount, `blend ${blendCount} should be wider than denoising ${denCount}`);
    },
  ],
  [
    'buildTwoMasks rejects mismatched mask length',
    () => {
      const m = new Uint8Array(10);
      assert.throws(() =>
        buildTwoMasks(m, { width: 4, height: 4 }, {
          denoise_offset_px: 1,
          blend_feather_pct: 5,
        }),
      );
    },
  ],
  [
    'isMaskLayer / isPaintedMask / isFromLayerMask narrow correctly',
    () => {
      const base = {
        id: 'L' as unknown as LayerId,
        document_id: 'D' as unknown as DocumentId,
        name: 'Mask 1',
        position: 0,
        opacity: 1,
        visible: true,
        locked: false,
        blend_mode: 'normal' as BlendMode,
        created_at: '2026-01-01T00:00:00.000Z',
      };
      const painted: Layer = {
        ...base,
        kind: 'mask',
        mask_data: { subkind: 'painted' },
      };
      const fromLayer: Layer = {
        ...base,
        kind: 'mask',
        mask_data: {
          subkind: 'from_layer',
          source_layer_id: 'SRC' as unknown as LayerId,
          channel: 'luminance',
          invert: true,
        },
      };
      const paint: Layer = { ...base, kind: 'paint' };
      assert.ok(isMaskLayer(painted));
      assert.ok(isMaskLayer(fromLayer));
      assert.ok(!isMaskLayer(paint));
      assert.ok(isPaintedMask(painted));
      assert.ok(!isPaintedMask(fromLayer));
      assert.ok(isFromLayerMask(fromLayer));
      assert.ok(!isFromLayerMask(painted));
    },
  ],
];

let failed = 0;

async function main() {
  for (const [name, run] of cases) {
    try {
      await run();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} test(s) passed.`);
  }
}

void main();
