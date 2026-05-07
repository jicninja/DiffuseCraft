// Editor/RightPanel/Layers — wired to editorStore + canvas-core.
//
// Reads layers and activeLayerId from the editor store (FR-8, FR-9).
// Wires visibility toggle (FR-10), opacity slider (FR-11), add layer
// (FR-12), swipe-then-tap delete (FR-13, FR-13a), drag-to-reorder (FR-14).
//
// Uses FlatList for virtualization per NFR-4 (up to 50 layers at 60 FPS).
// Requirements: FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-13a, FR-14.

import { Eye, EyeOff, Plus } from 'lucide-react-native';
import { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { useEditorStore, type LayerSnapshot } from '@diffusecraft/core';
import { Button, Card, Slider, Switch, tokens } from '@diffusecraft/ui';

import { useEditorDocument } from '../EditorDocumentContext';
import { EDITOR_STRINGS } from '../../_strings/Editor';

export interface LayersProps {
  // Props reserved for future use (e.g., external callbacks).
}

/**
 * Map a LayerSnapshot to a row-level view model. The store's LayerSnapshot
 * does not carry `kind` — that field lived only in the mock fixture. We
 * render all store layers uniformly; kind badges will return when the store
 * snapshot type is extended.
 */
interface LayerRowItem {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
}

const toRowItem = (s: LayerSnapshot): LayerRowItem => ({
  id: s.id,
  name: s.name,
  visible: s.visible,
  opacity: s.opacity,
  locked: s.locked,
});

export function Layers(_props: LayersProps = {}) {
  // FR-8: read layer list from store (the snapshot is derived from the
  // canvas-core Document by EditorDocumentProvider on every mutation).
  const layers = useEditorStore((s) => s.layers);
  // FR-9: read active layer from store instead of hardcoded rows[0]?.id.
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  // Document-aware mutations — these update both the canvas-core Document
  // (the source of truth for the visible <Image> chain in <CanvasView>)
  // and the store snapshot in one step. Using the store-only setters here
  // would silently desync the document, leaving newly-created or modified
  // layers invisible on the canvas.
  const {
    addPaintLayer,
    removeLayerById,
    reorderLayer: reorderDocLayer,
    patchLayer: patchDocLayer,
  } = useEditorDocument();

  // FR-9: tap to select — call editorStore.setActiveLayer(layerId).
  const handleTapLayer = useCallback(
    (layerId: string) => {
      setActiveLayer(layerId);
    },
    [setActiveLayer],
  );

  // FR-10: toggle visibility — propagate to both the document and the store.
  const handleToggleVisible = useCallback(
    (layerId: string, next: boolean) => {
      patchDocLayer(layerId, { visible: next });
    },
    [patchDocLayer],
  );

  // FR-11: adjust opacity — propagate to both the document and the store.
  const handleOpacityChange = useCallback(
    (layerId: string, next: number) => {
      patchDocLayer(layerId, { opacity: next });
    },
    [patchDocLayer],
  );

  // FR-12: add layer — append a paint layer to the document. The provider
  // mints the layer id, syncs the snapshot, and selects the new layer.
  const handleAddLayer = useCallback(() => {
    addPaintLayer();
  }, [addPaintLayer]);

  // FR-13 / FR-13a: swipe-then-tap delete — the swipe only reveals the
  // action; the user must tap the revealed Delete button to actually
  // remove the layer. Guards against accidental deletions (in-pocket
  // scroll, stray pencil flick during canvas zoom, etc.). The provider
  // resyncs the snapshot and falls the active selection back to the
  // topmost remaining layer when needed. FR-13b defense-in-depth: the
  // bottom-most layer (FlatList index 0 / canvas-core position 0) is never
  // wrapped in a Swipeable, AND `removeLayerById` rejects removing it.
  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      removeLayerById(layerId);
    },
    [removeLayerById],
  );

  // FR-14: drag-to-reorder — translate FlatList indices into a position
  // change on the document. Full drag-to-reorder requires a drag library
  // (e.g., react-native-draggable-flatlist); the wiring is ready.
  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderDocLayer(fromIndex, toIndex);
    },
    [reorderDocLayer],
  );

  // FlatList renderItem — each layer row is a Pressable for tap-to-select.
  // The bottom-most layer (index 0) renders WITHOUT a Swipeable wrapper so
  // its swipe gesture surface is reserved for canvas / scroll, and there is
  // no path to delete it (FR-13b).
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LayerRowItem>) => {
      const isActive = item.id === activeLayerId;
      const isFirstLayer = index === 0;

      const cardContent = (
        <Pressable
          onPress={() => handleTapLayer(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}
        >
          <Card
            className={
              'p-2 gap-2 rounded-md ' +
              (isActive
                ? 'bg-accent-muted border-l-2 border-l-accent-default'
                : 'bg-surface')
            }
          >
            <View className="flex-row items-center gap-3">
              {/* 40×40 thumbnail placeholder. */}
              <View className="w-10 h-10 bg-inset rounded-sm" />

              {/* Layer name. */}
              <View className="flex-1 gap-1">
                <Text
                  className="text-body-strong text-text-primary"
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </View>

              {/* Visibility eye icon (decorative — Switch owns the a11y). */}
              <View className="pr-1">
                {item.visible ? (
                  <Eye size={16} color={tokens.colors.text.secondary} />
                ) : (
                  <EyeOff size={16} color={tokens.colors.text.tertiary} />
                )}
              </View>

              {/* FR-10: Visibility Switch — wired to patchLayer. */}
              <Switch
                checked={item.visible}
                onCheckedChange={(next) => handleToggleVisible(item.id, next)}
                accessibilityLabel={EDITOR_STRINGS.layersPanel.visibilityA11yLabel}
              />
            </View>

            {/* FR-11: Opacity slider — visible for the active layer. */}
            {isActive ? (
              <View className="px-1 pt-1 gap-1">
                <View className="flex-row justify-between">
                  <Text className="text-caption text-text-tertiary">
                    {EDITOR_STRINGS.layersPanel.opacityLabel}
                  </Text>
                  <Text className="text-caption text-text-secondary">
                    {Math.round(item.opacity * 100)}%
                  </Text>
                </View>
                <Slider
                  value={item.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(v) => handleOpacityChange(item.id, v)}
                  accessibilityLabel={EDITOR_STRINGS.layersPanel.opacityLabel}
                />
              </View>
            ) : null}
          </Card>
        </Pressable>
      );

      // FR-13b: first layer is undeletable — render without Swipeable.
      if (isFirstLayer) {
        return cardContent;
      }

      // FR-13a: swipe reveals the Delete action; tapping the action commits
      // the deletion. The third arg of renderRightActions is the Swipeable
      // instance — calling close() collapses the row when the user backs
      // out (no tap on Delete) is handled by the user swiping it back; on
      // tap-to-delete we close it before mutating so the row animates out
      // cleanly with the rest of the FlatList.
      return (
        <Swipeable
          renderRightActions={(_progress, _dragX, swipeable) => (
            <Pressable
              onPress={() => {
                swipeable.close();
                handleDeleteLayer(item.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={EDITOR_STRINGS.layersPanel.deleteLayerA11yLabel}
              className="justify-center px-4 bg-destructive rounded-md ml-2"
            >
              <Text className="text-body text-white">
                {EDITOR_STRINGS.layersPanel.deleteLayer}
              </Text>
            </Pressable>
          )}
          overshootRight={false}
        >
          {cardContent}
        </Swipeable>
      );
    },
    [
      activeLayerId,
      handleTapLayer,
      handleToggleVisible,
      handleOpacityChange,
      handleDeleteLayer,
    ],
  );

  const keyExtractor = useCallback((item: LayerRowItem) => item.id, []);

  const rows = layers.map(toRowItem);

  return (
    <View className="flex-1 p-3 gap-2">
      {/* Section title — small caption, matches sibling panels. */}
      <Text className="text-caption text-text-tertiary uppercase px-1 pb-1">
        {EDITOR_STRINGS.layersPanel.sectionTitle}
      </Text>

      {/* NFR-4: FlatList for virtualized layer rendering (up to 50 layers). */}
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{ gap: 8 }}
        windowSize={5}
        showsVerticalScrollIndicator={false}
      />

      {/* FR-12: + Add layer — ghost button. */}
      <View className="pt-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={handleAddLayer}
          accessibilityLabel={EDITOR_STRINGS.layersPanel.addLayerA11yLabel}
        >
          <Plus size={16} color={tokens.colors.text.secondary} />
          <Text className="text-body text-text-secondary">
            {EDITOR_STRINGS.layersPanel.addLayer}
          </Text>
        </Button>
      </View>
    </View>
  );
}
Layers.displayName = 'Layers';
