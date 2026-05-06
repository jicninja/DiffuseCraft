// Tooltip — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/tooltip.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/tooltip.tsx
// Pasted: 2026-05-03
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).
//   - `@/registry/nativewind/components/ui/text` -> `./_internal/utils`
//     (TextClassContext).
//   - rnr's `NativeOnlyAnimatedView` and `react-native-screens`
//     `FullWindowOverlay` are not on the peer-dep list; the Reanimated
//     enter/exit transition is dropped (the rn-primitive layer still
//     handles long-press touch trigger ≥ 500 ms per design.md §6).
//   - shadcn-style class names preserved as-is.
//   - Web-only `Platform.select({ web: ... })` branches kept verbatim.

import * as TooltipPrimitive from '@rn-primitives/tooltip';
import * as React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { TextClassContext, cn } from './_internal/utils';

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 4,
  portalHost,
  side = 'top',
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  portalHost?: string;
}) {
  return (
    <TooltipPrimitive.Portal hostName={portalHost}>
      <TooltipPrimitive.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
        <TextClassContext.Provider value="text-xs text-primary-foreground">
          <TooltipPrimitive.Content
            sideOffset={sideOffset}
            className={cn(
              'bg-primary z-50 rounded-sm px-3 py-2 sm:py-1.5',
              Platform.select({
                web: cn(
                  'animate-in fade-in-0 zoom-in-95 origin-(--radix-tooltip-content-transform-origin) w-fit text-balance',
                  side === 'bottom' && 'slide-in-from-top-2',
                  side === 'left' && 'slide-in-from-right-2',
                  side === 'right' && 'slide-in-from-left-2',
                  side === 'top' && 'slide-in-from-bottom-2'
                ),
              }),
              className
            )}
            side={side}
            {...props}
          />
        </TextClassContext.Provider>
      </TooltipPrimitive.Overlay>
    </TooltipPrimitive.Portal>
  );
}

Tooltip.displayName = 'Tooltip';

export { Tooltip, TooltipContent, TooltipTrigger };

export type TooltipProps = React.ComponentProps<typeof Tooltip>;
export type TooltipContentProps = React.ComponentProps<typeof TooltipContent>;
