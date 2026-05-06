// Internal helpers shared by pasted react-native-reusables components.
//
// `cn` mirrors the rnr canonical helper at
// `packages/registry/src/nativewind/lib/utils.ts` (clsx + tailwind-merge).
//
// `TextClassContext` is the context channel the rnr `Button` and other
// composite components use to push text classes onto descendant `<Text>`
// nodes without forcing every consumer to import a custom `<Text>` wrapper.
// Pasted intentionally to keep the rnr code uncorrupted; see notes in
// `Button.tsx`.
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Repo:   https://github.com/founded-labs/react-native-reusables
// Pasted: 2026-05-03

import { clsx, type ClassValue } from 'clsx';
import * as React from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// TextClassContext lets composite components (e.g. Button) declare the
// className that descendant Text nodes should inherit. The actual <Text>
// reader lives in a future Group 2 paste; until then this context is
// primarily consumed by `Icon` (see ./icon.tsx) so foreground colour
// follows the parent component's intent class.
export const TextClassContext = React.createContext<string | undefined>(undefined);
