// Editor/WorkspaceTabs (snapshot preview missing — built from brief). v1.0.0
//
// Reusable horizontal segmented Tabs strip for the four Editor workspaces:
// Generate / Inpaint / Upscale / Live. Pulled out of `TopBar.tsx` so the same
// component can be embedded in (a) the floating top bar today and (b) any
// future surface that needs the same workspace switcher (e.g. a settings
// preview, an onboarding hand-hold, or the embedded MeshCraft host).
//
// This is purely presentational — workspace state lives in `useEditorState`.
//
// Strings: `EDITOR_STRINGS.workspaces.*`.

import { Text } from 'react-native';

import { Tabs, TabsList, TabsTrigger } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../_strings/Editor';
import type { EditorWorkspace } from './useEditorState';

export interface WorkspaceTabsProps {
  workspace: EditorWorkspace;
  onWorkspaceChange: (w: EditorWorkspace) => void;
}

// Tab order is verbatim from `EditorWorkspace` and the HERO brief
// (`05-Editor-Generate`): Generate / Inpaint / Upscale / Live.
const WORKSPACE_TABS: ReadonlyArray<{ value: EditorWorkspace; label: string }> = [
  { value: 'generate', label: EDITOR_STRINGS.workspaces.generate },
  { value: 'inpaint', label: EDITOR_STRINGS.workspaces.inpaint },
  { value: 'upscale', label: EDITOR_STRINGS.workspaces.upscale },
  { value: 'live', label: EDITOR_STRINGS.workspaces.live },
];

export function WorkspaceTabs({
  workspace,
  onWorkspaceChange,
}: WorkspaceTabsProps) {
  return (
    <Tabs
      value={workspace}
      onValueChange={(v) => onWorkspaceChange(v as EditorWorkspace)}
      accessibilityLabel={EDITOR_STRINGS.workspaces.a11yLabel}
    >
      {/* Small height so the strip fits inside the 40pt floating TopBar.
          `bg-inset` is the calm "recessed" surface that contrasts with the
          elevated bar background. */}
      <TabsList className="h-8 bg-inset">
        {WORKSPACE_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-3">
            <Text
              className={
                tab.value === workspace
                  ? 'text-body-strong text-text-primary'
                  : 'text-body text-text-secondary'
              }
            >
              {tab.label}
            </Text>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

WorkspaceTabs.displayName = 'WorkspaceTabs';
