// /editor/:documentId route. Reads `documentId` from the path and the
// optional `workspace` + `chat` from the query string. The boolean `chat`
// flag is encoded as `?chat=true` (deviation from the old
// /editor/:id/chat path-suffix form documented in design.md v0.2 addendum).

import { useLocalSearchParams } from 'expo-router';

import {
  EditorScreen,
  type EditorWorkspace,
} from '../../src/screens/Editor';

const WORKSPACES = new Set<EditorWorkspace>(['generate', 'inpaint', 'upscale', 'live']);

function asWorkspace(value: string | string[] | undefined): EditorWorkspace | undefined {
  if (typeof value !== 'string') return undefined;
  return WORKSPACES.has(value as EditorWorkspace) ? (value as EditorWorkspace) : undefined;
}

export default function EditorRoute() {
  const params = useLocalSearchParams<{
    documentId: string | string[];
    workspace?: string | string[];
    chat?: string | string[];
  }>();

  const documentIdRaw = Array.isArray(params.documentId)
    ? params.documentId[0]
    : params.documentId;
  // NFR-7: reject empty documentId so deep links like `/editor/` no-op cleanly.
  // expo-router won't even match the dynamic segment without a value, but we
  // belt-and-braces it here for runtime safety.
  if (documentIdRaw === undefined || documentIdRaw.length === 0) {
    return null;
  }

  const workspace = asWorkspace(params.workspace);
  const chatRaw = Array.isArray(params.chat) ? params.chat[0] : params.chat;
  const chat = chatRaw === 'true' || chatRaw === '1';

  return (
    <EditorScreen documentId={documentIdRaw} workspace={workspace} chat={chat} />
  );
}
