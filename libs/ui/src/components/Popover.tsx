// Popover — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/popover.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/popover.tsx
// Pasted: 2026-05-03
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).
//   - `@/registry/nativewind/components/ui/text` -> `./_internal/utils`
//     (TextClassContext).
//   - rnr's `NativeOnlyAnimatedView` and `react-native-screens`
//     `FullWindowOverlay` are not on the peer-dep list; the Reanimated
//     enter/exit transition is dropped here (the rn-primitive layer
//     still handles open/close + focus management).
//   - shadcn-style class names preserved as-is.
//   - Web-only `Platform.select({ web: ... })` branches kept verbatim.

import * as PopoverPrimitive from '@rn-primitives/popover';
import * as React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { TextClassContext, cn } from './_internal/utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalHost,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  portalHost?: string;
}) {
  return (
    <PopoverPrimitive.Portal hostName={portalHost}>
      <PopoverPrimitive.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
        <TextClassContext.Provider value="text-popover-foreground">
          <PopoverPrimitive.Content
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'bg-popover border-border outline-hidden z-50 w-72 rounded-md border p-4 shadow-md shadow-black/5',
              Platform.select({
                web: cn(
                  'animate-in fade-in-0 zoom-in-95 origin-(--radix-popover-content-transform-origin) cursor-auto',
                  props.side === 'bottom' && 'slide-in-from-top-2',
                  props.side === 'top' && 'slide-in-from-bottom-2'
                ),
              }),
              className
            )}
            {...props}
          />
        </TextClassContext.Provider>
      </PopoverPrimitive.Overlay>
    </PopoverPrimitive.Portal>
  );
}

Popover.displayName = 'Popover';

export { Popover, PopoverContent, PopoverTrigger };

export type PopoverProps = React.ComponentProps<typeof Popover>;
export type PopoverContentProps = React.ComponentProps<typeof PopoverContent>;
