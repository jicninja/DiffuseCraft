/**
 * Catalog manifest — single source of truth for all tools, resources,
 * events, and prompts the MCP server registers.
 *
 * Server boot reads this manifest, asserts a handler exists for every
 * tool, and serves resource/prompt content schemas. The build script
 * walks the same manifest to emit `dist/catalog.json`.
 */
import { defineCatalog } from "./shared/define-tool";
import { CATALOG_VERSION } from "./version";
import * as serverTools from "./tools/server";
import * as documentTools from "./tools/documents";
import * as layerTools from "./tools/layers";
import * as maskTools from "./tools/masks";
import * as selectionTools from "./tools/selection";
import * as generationTools from "./tools/generation";
import * as historyTools from "./tools/history";
import * as controlLayerTools from "./tools/control-layers";
import * as regionTools from "./tools/regions";
import * as workspaceTools from "./tools/workspaces";
import * as upscaleTools from "./tools/upscale";
import * as modelTools from "./tools/models";
import * as speechTools from "./tools/speech-enhance";
import * as undoRedoTools from "./tools/undo-redo";
import * as imageReadTools from "./tools/image-read";
import * as imageEditTools from "./tools/image-edit";
import * as exportTools from "./tools/export";

import { resourceCatalog } from "./resources/manifest";
import { eventCatalog } from "./events/manifest";
import { promptCatalog } from "./prompts/manifest";

export const catalog = defineCatalog({
  version: CATALOG_VERSION,
  tools: [
    // Server / session (3)
    serverTools.getServerInfo,
    serverTools.revokeToken,
    serverTools.getAuditLog,
    // Documents (3)
    documentTools.createDocument,
    documentTools.setActiveDocument,
    documentTools.getDocumentState,
    // Layers (4) — `transform_layer` promoted from deferred to v1 by transform-tools.
    layerTools.addLayer,
    layerTools.removeLayer,
    layerTools.updateLayer,
    layerTools.transformLayer,
    // Selection (7)
    selectionTools.setSelection,
    selectionTools.getSelection,
    selectionTools.invertSelection,
    selectionTools.selectAll,
    selectionTools.refineSelection,
    selectionTools.autoSelectSubject,
    selectionTools.selectByPrompt,
    // Mask system (7) — mask-system spec §3.7
    maskTools.refineMask,
    maskTools.invertMask,
    maskTools.clearMask,
    maskTools.fillMask,
    maskTools.selectionToMask,
    maskTools.maskToSelection,
    maskTools.bakeMask,
    // Generation (3)
    generationTools.generateImage,
    generationTools.cancelJob,
    generationTools.getJobStatus,
    // History (3)
    historyTools.getHistoryItem,
    historyTools.applyHistoryItem,
    historyTools.discardHistoryItem,
    // Control layers (2)
    controlLayerTools.addControlLayer,
    controlLayerTools.removeControlLayer,
    // Regions (2)
    regionTools.defineRegion,
    regionTools.removeRegion,
    // Workspaces (2)
    workspaceTools.setWorkspace,
    workspaceTools.getWorkspace,
    // Upscale (1)
    upscaleTools.upscaleImage,
    // Models / presets (4)
    modelTools.downloadModel,
    modelTools.deleteModel,
    modelTools.setPreset,
    modelTools.deletePreset,
    // Speech / enhance (2)
    speechTools.transcribeAudio,
    speechTools.enhancePrompt,
    // Undo / redo (2)
    undoRedoTools.undo,
    undoRedoTools.redo,
    // Image read (2)
    imageReadTools.getImage,
    imageReadTools.getPixel,
    // Image edit (3)
    imageEditTools.paintStrokes,
    imageEditTools.paintArea,
    imageEditTools.uploadBlob,
    // Export (1)
    exportTools.exportImage,
  ],
  resources: resourceCatalog,
  events: eventCatalog,
  prompts: promptCatalog,
});
