/**
 * Public surface of the store layer.
 *
 * Apps import everything they need from `@diffusecraft/core` via this
 * barrel — factories, types, the provider, and consumer hooks.
 */
export {
  createEditorStore,
  type EditorStore,
  type EditorState,
} from './editor';
export type {
  ActiveDocument,
  ActiveToolSlice,
  BrushSettings,
  BrushSlice,
  CanvasSlice,
  EditorTool,
  LayersSlice,
  SelectionMode,
  SelectionSlice,
  SelectionState,
  TransformHandle,
  TransformSlice,
  TransformState,
} from './editor/types';

export {
  createConnectionStore,
  type ConnectionStore,
  type ConnectionStoreOptions,
  type ConnectionState,
} from './connection';
export type {
  ConnectionError,
  ConnectionStatus,
  DiscoveredBackend,
  NewPairedBackend,
  PairedBackend,
  PairedServerSummary,
  PersistedConnectionState,
  RouterConnectionStatus,
} from './connection/types';
export {
  createMemorySecureTokenAdapter,
  tokenKey,
  type SecureTokenAdapter,
} from './connection/secure-token';

export {
  createModelsStore,
  type ModelsStore,
  type ModelsState,
  type ModelsStoreOptions,
  type Model,
  type Preset,
  type PersistedModelsState,
  type ModelDownloadState,
} from './models';

export {
  createJobsStore,
  type JobsStore,
  type JobsState,
  type JobsStoreOptions,
  type Job,
} from './jobs';

export {
  createHistoryStore,
  type HistoryStore,
  type HistoryState,
} from './history';

export {
  createMcpCatalogStore,
  type McpCatalogStore,
  type McpCatalogState,
  type McpCatalogStoreOptions,
  type HandshakeResult,
  type PromptDescriptor,
  type ResourceDescriptor,
  type ServerCapabilities,
  type ToolDescriptor,
  type PersistedMcpCatalogState,
} from './mcp-catalog';

export {
  StoresProvider,
  type StoresProviderProps,
  type PreinstantiatedStores,
} from './provider';

export {
  EditorStoreContext,
  ConnectionStoreContext,
  ModelsStoreContext,
  JobsStoreContext,
  HistoryStoreContext,
  McpCatalogStoreContext,
} from './context';

export {
  useEditorStore,
  useSelection,
  useActiveLayer,
  useBrushSettings,
  useTransform,
  useActiveTool,
  useConnectionStore,
  useConnectionStatus,
  useModelsStore,
  useJobsStore,
  useActiveJob,
  useHistoryStore,
  useMcpCatalogStore,
  useHasTool,
  type EqualityFn,
} from './hooks';

export {
  buildPersistOptions,
  createMemoryStorage,
  type AsyncKvStorage,
  type PersistedSliceConfig,
} from './shared/persist-config';
export { PERSISTENCE_SCHEMA_VERSION } from './shared/version';
export {
  runOptimistic,
  type OptimisticOptions,
} from './shared/optimistic';
export type {
  AuditEntryPayload,
  DiffuseCraftClientLike,
  DocumentChange,
  DocumentChangedPayload,
  HistoryItemSnapshot,
  JobCompletedPayload,
  JobProgressPayload,
  LayerSnapshot,
  ModelDownloadProgressPayload,
  SelectionSnapshot,
  ServerEvent,
} from './shared/types';
