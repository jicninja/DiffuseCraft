// Pre-Wave-3 stub — publishes the EditorLocalState type signature so the 10
// parallel sub-component subagents can consume the prop shape before the
// orchestrator lands the real implementation in Editor/index.tsx.
//
// Spec reference: screens-implementation/design.md §4 Editor architecture.
// Real implementation slated for the convergence task (T-Final-1).

import { useState } from 'react';

export type EditorWorkspace = 'generate' | 'inpaint' | 'upscale' | 'live';
export type RightPanelTab = 'layers' | 'history' | 'controls' | 'regions' | 'chat';
export type InpaintMode = 'fill' | 'expand' | 'add' | 'remove' | 'replace-bg';

export interface EditorLocalState {
  workspace: EditorWorkspace;
  rightPanelTab: RightPanelTab;
  /** Mock — Inpaint workspace renders a sample marching-ants selection. */
  hasSelection: boolean;
  /** Active inpaint sub-mode when workspace === 'inpaint'. */
  inpaintMode: InpaintMode;
  /** Whether the chat panel is the active right-panel surface. */
  chatOpen: boolean;
  setWorkspace: (w: EditorWorkspace) => void;
  setRightPanelTab: (t: RightPanelTab) => void;
  setInpaintMode: (m: InpaintMode) => void;
  setChatOpen: (open: boolean) => void;
}

export interface EditorInitial {
  workspace?: EditorWorkspace;
  chat?: boolean;
}

export function useEditorState(initial: EditorInitial = {}): EditorLocalState {
  const [workspace, setWorkspace] = useState<EditorWorkspace>(initial.workspace ?? 'generate');
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(
    initial.chat ? 'chat' : 'layers',
  );
  const [hasSelection, _setHasSelection] = useState(workspace === 'inpaint');
  const [inpaintMode, setInpaintMode] = useState<InpaintMode>('fill');
  const [chatOpen, _setChatOpen] = useState(initial.chat ?? false);
  const setChatOpen = (open: boolean) => {
    _setChatOpen(open);
    setRightPanelTab(open ? 'chat' : 'layers');
  };

  return {
    workspace,
    rightPanelTab,
    hasSelection,
    inpaintMode,
    chatOpen,
    setWorkspace,
    setRightPanelTab,
    setInpaintMode,
    setChatOpen,
  };
}
