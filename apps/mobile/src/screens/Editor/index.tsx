// Implements 05-Editor from design-snapshot v1.0.0 (briefs from .pen since
// the 4 editor previews failed to export). Hero screen — assembles the 10
// sub-components into one route. Variants 05/05b/05c/05d are different
// internal states of this single screen.
//
// Architecture (per screens-implementation/design.md §4):
//   GestureHandler/SafeArea/ThemeProvider mount in app/_layout.tsx
//   This screen renders an absolute-positioned canvas + 4 floating UI clusters:
//     - LeftToolRail (vertical, left)
//     - TopBar (horizontal, top)
//     - RightPanel (vertical, right) — switches between Layers/History/Controls/Regions/Chat
//     - BottomPromptBar (horizontal, bottom-center)
//     + InpaintModeChips when workspace === 'inpaint'
//     + LiveSettingsCard rendered inside RightPanel when workspace === 'live'

import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { BottomPromptBar } from './BottomPromptBar';
import { CanvasArea } from './CanvasArea';
import { EditorDocumentProvider } from './EditorDocumentContext';
import { InpaintModeChips } from './InpaintModeChips';
import { LeftToolRail } from './LeftToolRail';
import { LiveSettingsCard } from './LiveSettingsCard';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { BrushSidebarSliders } from './brush-settings/BrushSidebarSliders';
import { ColorPickerPanel } from './brush-settings/ColorPickerPanel';
import { useDocumentBootstrap } from './useDocumentBootstrap';
import { useEditorState, type EditorWorkspace } from './useEditorState';

export type { EditorWorkspace };

export interface EditorScreenProps {
  documentId: string;
  workspace?: EditorWorkspace;
  chat?: boolean;
}

export function EditorScreen(props: EditorScreenProps) {
  // Wrap the editor in the document provider before any child renders so
  // `useDocumentBootstrap` (which writes into the context) and the layers
  // panel (which mutates via the same context) share one source of truth.
  return (
    <EditorDocumentProvider>
      <EditorScreenInner {...props} />
    </EditorDocumentProvider>
  );
}

function EditorScreenInner({ documentId, workspace, chat }: EditorScreenProps) {
  const router = useRouter();
  const state = useEditorState({ workspace, chat });
  const doc = useDocumentBootstrap(documentId);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);

  return (
    <View className="flex-1 bg-canvas">
      {/* Canvas viewport — full bleed */}
      <CanvasArea document={doc} />

      {/* Floating top bar */}
      <TopBar
        documentId={documentId}
        workspace={state.workspace}
        onWorkspaceChange={state.setWorkspace}
        onBack={() => router.back()}
      />

      {/* Floating left rail — reads activeTool from editorStore directly (task 7.1) */}
      <LeftToolRail
        onToggleLayers={() => state.setRightPanelTab('layers')}
        onColorSwatchPress={() => setColorPickerVisible(true)}
      />

      {/* Brush size + opacity sliders — floating alongside LeftToolRail (design §3.2, D6) */}
      <BrushSidebarSliders />

      {/* Floating right panel */}
      <View className="absolute right-3 top-14 bottom-3 w-80">
        {state.workspace === 'live' ? (
          <LiveSettingsCard />
        ) : (
          <RightPanel tab={state.rightPanelTab} onTabChange={state.setRightPanelTab} />
        )}
      </View>

      {/* Inpaint sub-mode chips above the prompt bar */}
      {state.workspace === 'inpaint' && (
        <View className="absolute bottom-28 left-1/2 -translate-x-1/2">
          <InpaintModeChips mode={state.inpaintMode} onModeChange={state.setInpaintMode} />
        </View>
      )}

      {/* Floating bottom prompt bar */}
      <BottomPromptBar workspace={state.workspace} />

      {/* Color picker panel — rendered last for correct z-ordering (above sliders and canvas) */}
      <ColorPickerPanel
        visible={colorPickerVisible}
        onClose={() => setColorPickerVisible(false)}
      />
    </View>
  );
}
EditorScreen.displayName = 'EditorScreen';
