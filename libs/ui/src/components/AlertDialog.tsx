// AlertDialog — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/alert-dialog.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/alert-dialog.tsx
// Pasted: 2026-05-03
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).
//   - `@/registry/nativewind/components/ui/text` -> `./_internal/utils`
//     (TextClassContext).
//   - `@/registry/nativewind/components/ui/button` -> `./Button`
//     (consumes Group 1's Button + buttonTextVariants).
//   - rnr's `NativeOnlyAnimatedView` and `react-native-screens`
//     `FullWindowOverlay` are not on the peer-dep list; we inline a
//     `View` for the overlay. Reanimated enter/exit transitions are
//     dropped (see Dialog notes).
//   - shadcn-style class names preserved as-is.
//   - Web-only `Platform.select({ web: ... })` branches kept verbatim.

import * as AlertDialogPrimitive from '@rn-primitives/alert-dialog';
import * as React from 'react';
import { Platform, View, type ViewProps } from 'react-native';

import { buttonTextVariants, buttonVariants } from './Button';
import { TextClassContext, cn } from './_internal/utils';

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof AlertDialogPrimitive.Overlay>, 'asChild'> & {
  children?: React.ReactNode;
}) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        'absolute bottom-0 left-0 right-0 top-0 z-50 flex items-center justify-center bg-scrim p-2',
        Platform.select({
          web: 'animate-in fade-in-0 fixed',
        }),
        className
      )}
      {...props}
    >
      <View>{children}</View>
    </AlertDialogPrimitive.Overlay>
  );
}

function AlertDialogContent({
  className,
  portalHost,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  portalHost?: string;
}) {
  return (
    <AlertDialogPortal hostName={portalHost}>
      <AlertDialogOverlay>
        <AlertDialogPrimitive.Content
          className={cn(
            'bg-popover border-border z-50 flex w-full max-w-[calc(100%-2rem)] flex-col gap-4 rounded-xl border p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            Platform.select({
              web: 'animate-in fade-in-0 zoom-in-95 duration-200',
            }),
            className
          )}
          {...props}
        />
      </AlertDialogOverlay>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: ViewProps) {
  return (
    <TextClassContext.Provider value="text-center sm:text-left">
      <View className={cn('flex flex-col gap-2', className)} {...props} />
    </TextClassContext.Provider>
  );
}

function AlertDialogFooter({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-foreground text-lg font-semibold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ className })}>
      <AlertDialogPrimitive.Action className={cn(buttonVariants(), className)} {...props} />
    </TextClassContext.Provider>
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ className, variant: 'outline' })}>
      <AlertDialogPrimitive.Cancel
        className={cn(buttonVariants({ variant: 'outline' }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

AlertDialog.displayName = 'AlertDialog';

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};

export type AlertDialogProps = React.ComponentProps<typeof AlertDialog>;
export type AlertDialogContentProps = React.ComponentProps<typeof AlertDialogContent>;
