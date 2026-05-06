// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/collapsible.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream: none. Upstream is a thin re-export of the
// `@rn-primitives/collapsible` primitives.

import * as CollapsiblePrimitive from '@rn-primitives/collapsible';

const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

const CollapsibleContent = CollapsiblePrimitive.Content;

export type CollapsibleProps = React.ComponentProps<typeof CollapsiblePrimitive.Root>;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
