/**
 * Type definitions for the editor store and its slices.
 *
 * Per FR-25, image bytes NEVER live in the store. All references are URIs or
 * server-issued ids; engines and surfaces (Skia, etc.) hold the actual pixel
 * data outside Zustand.
 */
import type {
  LayerSnapshot,
  SelectionSnapshot,
  DiffuseCraftClientLike,
} from '../shared/types';

/** Active document descriptor. Image bytes never enter the store (FR-25). */
export interface ActiveDocument {
  id: string;
  width: number;
  height: number;
  /**
   * Optional reference to the last-applied result (e.g., a server blob URI).
   * Strictly metadata — never the bytes themselves.
   */
  last_applied_result_uri: string | null;
}

/** Canvas slice — active document and dimensions. */
export interface CanvasSlice {
  document: ActiveDocument | null;
  setDocument(document: ActiveDocument | null): void;
}

/** Layers slice — ordered list and active id. */
export interface LayersSlice {
  layers: ReadonlyArray<LayerSnapshot>;
  activeLayerId: string | null;
  setLayers(layers: ReadonlyArray<LayerSnapshot>): void;
  setActiveLayer(id: string | null): void;
  /** Apply a partial update to a single layer. */
  patchLayer(id: string, patch: Partial<LayerSnapshot>): void;
}

/** Selection slice — current selection or none. */
export type SelectionState = SelectionSnapshot;

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface SelectionSlice {
  selection: SelectionState;
  selectionMode: SelectionMode;
  setSelection(selection: SelectionState): void;
  setSelectionMode(mode: SelectionMode): void;
}

/** Active-tool slice — current tool and tool-specific settings. */
export type EditorTool =
  | 'brush'
  | 'eraser'
  | 'lasso'
  | 'rect-select'
  | 'transform'
  | 'pan'
  | 'eyedropper';

export interface ActiveToolSlice {
  activeTool: EditorTool;
  /** Free-form per-tool settings. Specific shapes are defined by the tools. */
  activeToolSettings: Readonly<Record<string, unknown>>;
  setActiveTool(tool: EditorTool): void;
  setActiveToolSettings(settings: Record<string, unknown>): void;
}

/** Brush slice — size, hardness, opacity, color, pressure curve. */
export interface BrushSettings {
  size: number;
  hardness: number;
  opacity: number;
  /**
   * Color carrier — opaque token. Resolved to actual hex by the consumer
   * (e.g., theme tokens or a color picker). Stored as a string identifier
   * to satisfy the no-raw-hex lint rule for files in this layer.
   */
  color: string;
  /**
   * Pressure curve sample points — 0..1 input → 0..1 output. Default is a
   * linear curve.
   */
  pressureCurve: ReadonlyArray<readonly [number, number]>;
}

export interface BrushSlice {
  brush: BrushSettings;
  setBrush(patch: Partial<BrushSettings>): void;
}

/** Transform slice — handles, pivot, in-progress transform. */
export type TransformHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'rotate';

export interface TransformState {
  active: boolean;
  pivot: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
  translate: { x: number; y: number };
  activeHandle: TransformHandle | null;
}

export interface TransformSlice {
  transform: TransformState;
  beginTransform(pivot: { x: number; y: number }): void;
  setTransformHandle(handle: TransformHandle | null): void;
  patchTransform(patch: Partial<Omit<TransformState, 'active'>>): void;
  endTransform(): void;
}

/** Composed editor state — all slices plus orchestration actions. */
export type EditorState = CanvasSlice
  & LayersSlice
  & SelectionSlice
  & ActiveToolSlice
  & BrushSlice
  & TransformSlice
  & {
    /**
     * Inject a client SDK reference. Called by `StoresProvider`.
     */
    attachClient(client: DiffuseCraftClientLike): void;
    /** Tear down client subscriptions. */
    detachClient(): void;
    /**
     * Load a document from the server. Populates all slices in one update.
     * TODO(client-sdk): wire to `client.invokeTool('get_document_state', ...)`.
     */
    loadDocument(documentId: string): Promise<void>;
    /** Reset slices to their initial state. Used on disconnect or close. */
    clearDocument(): void;
    /**
     * Reconcile an incoming `document.changed` server event. Updates the
     * affected slice in-place without re-fetching.
     */
    applyDocumentChanged(payload: import('../shared/types').DocumentChangedPayload): void;
  };
