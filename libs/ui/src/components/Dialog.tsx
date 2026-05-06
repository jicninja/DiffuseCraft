// Dialog — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/dialog.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/dialog.tsx
// Pasted: 2026-05-03
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).
//   - `@/registry/nativewind/components/ui/icon` -> `./_internal/icon`
//     (the rnr `Icon` is not promoted to the public surface in v1).
//   - rnr's `NativeOnlyAnimatedView` and `react-native-screens`
//     `FullWindowOverlay` are not on the peer-dep list; we inline a
//     `View` for the overlay + a `Fragment` substitute. Reanimated
//     enter/exit transitions are dropped here (Reanimated lands later
//     for the Slider; the transition can be retrofitted in a follow-up
//     without changing the component's API surface).
//   - shadcn-style class names preserved as-is; they resolve to
//     DiffuseCraft tokens via `tailwind.config.js` aliases.
//   - Web-only `Platform.select({ web: ... })` branches kept verbatim;
//     `Platform.select` returns undefined on native and the strings are
//     no-ops at runtime.
//   - `<PortalProvider>` is mounted at `App.tsx` by the
//     `app-shell-navigation` spec, NOT here.

import * as DialogPrimitive from '@rn-primitives/dialog';
import { X } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Text, View, type ViewProps } from 'react-native';

import { Icon } from './_internal/icon';
import { cn } from './_internal/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Overlay>, 'asChild'> & {
  children?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center bg-scrim p-2',
        Platform.select({
          web: 'animate-in fade-in-0 fixed cursor-default [&>*]:cursor-auto',
        }),
        className
      )}
      {...props}
    >
      <View>{children}</View>
    </DialogPrimitive.Overlay>
  );
}

function DialogContent({
  className,
  portalHost,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
}) {
  return (
    <DialogPortal hostName={portalHost}>
      <DialogOverlay>
        <DialogPrimitive.Content
          className={cn(
            'bg-popover border-border z-50 mx-auto flex w-full max-w-[calc(100%-2rem)] flex-col gap-4 rounded-xl border p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            Platform.select({
              web: 'animate-in fade-in-0 zoom-in-95 duration-200',
            }),
            className
          )}
          {...props}
        >
          <>{children}</>
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4 rounded opacity-70 active:opacity-100',
              Platform.select({
                web: 'ring-offset-background focus:ring-ring data-[state=open]:bg-accent transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2',
              })
            )}
            hitSlop={12}
          >
            <Icon
              as={X}
              className={cn('text-popover-foreground web:pointer-events-none size-4 shrink-0')}
            />
            <Text className="sr-only">Close</Text>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ViewProps) {
  return (
    <View className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-foreground text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

Dialog.displayName = 'Dialog';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

export type DialogProps = React.ComponentProps<typeof Dialog>;
export type DialogContentProps = React.ComponentProps<typeof DialogContent>;
