// ContextMenu — long-press triggered menu over @rn-primitives/context-menu.
//
// Modeled after react-native-reusables' ContextMenu recipe at
// packages/registry/src/nativewind/components/ui/context-menu.tsx (commit
// 7c287b976d461b717de397e1f581ab44c8e6d72d) — see
// https://github.com/founded-labs/react-native-reusables.
// Pasted/adapted: 2026-05-03. Native-only: web branches dropped per FR-3.

import * as ContextMenuPrimitive from '@rn-primitives/context-menu';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import * as React from 'react';
import {
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon, TextClassContext, cn } from './_internal';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;
const ContextMenuSub = ContextMenuPrimitive.Sub;
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  iconClassName,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  children?: React.ReactNode;
  iconClassName?: string;
  inset?: boolean;
}) {
  const { open } = ContextMenuPrimitive.useSubContext();
  const icon = open ? ChevronUp : ChevronDown;
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sm select-none group-active:text-accent-foreground',
        open && 'text-accent-foreground',
      )}
    >
      <ContextMenuPrimitive.SubTrigger
        className={cn(
          'active:bg-accent group flex flex-row items-center rounded-sm px-2 py-1.5',
          open && 'bg-accent mb-1',
          inset && 'pl-8',
          className,
        )}
        {...props}
      >
        <>{children}</>
        <Icon
          as={icon}
          className={cn('text-foreground ml-auto size-4 shrink-0', iconClassName)}
        />
      </ContextMenuPrimitive.SubTrigger>
    </TextClassContext.Provider>
  );
}
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger';

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <Animated.View entering={FadeIn}>
      <ContextMenuPrimitive.SubContent
        className={cn(
          'bg-popover border-border overflow-hidden rounded-md border p-1 shadow-lg shadow-black/5',
          className,
        )}
        {...props}
      />
    </Animated.View>
  );
}
ContextMenuSubContent.displayName = 'ContextMenuSubContent';

function ContextMenuContent({
  className,
  overlayClassName,
  overlayStyle,
  portalHost,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  overlayStyle?: StyleProp<ViewStyle>;
  overlayClassName?: string;
  portalHost?: string;
}) {
  return (
    <ContextMenuPrimitive.Portal hostName={portalHost}>
      <ContextMenuPrimitive.Overlay
        style={
          overlayStyle
            ? StyleSheet.flatten([
                StyleSheet.absoluteFill,
                overlayStyle as typeof StyleSheet.absoluteFill,
              ])
            : StyleSheet.absoluteFill
        }
        className={overlayClassName}
      >
        <Animated.View entering={FadeIn}>
          <TextClassContext.Provider value="text-popover-foreground">
            <ContextMenuPrimitive.Content
              className={cn(
                'bg-popover border-border min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg shadow-black/5',
                className,
              )}
              {...props}
            />
          </TextClassContext.Provider>
        </Animated.View>
      </ContextMenuPrimitive.Overlay>
    </ContextMenuPrimitive.Portal>
  );
}
ContextMenuContent.displayName = 'ContextMenuContent';

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  className?: string;
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <TextClassContext.Provider
      value={cn(
        'select-none text-sm text-popover-foreground group-active:text-popover-foreground',
        variant === 'destructive' && 'text-destructive group-active:text-destructive',
      )}
    >
      <ContextMenuPrimitive.Item
        className={cn(
          'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm px-2 py-1.5',
          variant === 'destructive' && 'active:bg-destructive/10',
          props.disabled && 'opacity-50',
          inset && 'pl-8',
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}
ContextMenuItem.displayName = 'ContextMenuItem';

function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  children?: React.ReactNode;
}) {
  return (
    <TextClassContext.Provider value="text-sm text-popover-foreground select-none group-active:text-accent-foreground">
      <ContextMenuPrimitive.CheckboxItem
        className={cn(
          'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm py-1.5 pl-8 pr-2',
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        <View className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <ContextMenuPrimitive.ItemIndicator>
            <Icon as={Check} className="text-foreground size-4" />
          </ContextMenuPrimitive.ItemIndicator>
        </View>
        <>{children}</>
      </ContextMenuPrimitive.CheckboxItem>
    </TextClassContext.Provider>
  );
}
ContextMenuCheckboxItem.displayName = 'ContextMenuCheckboxItem';

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  children?: React.ReactNode;
}) {
  return (
    <TextClassContext.Provider value="text-sm text-popover-foreground select-none group-active:text-accent-foreground">
      <ContextMenuPrimitive.RadioItem
        className={cn(
          'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm py-1.5 pl-8 pr-2',
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        <View className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <ContextMenuPrimitive.ItemIndicator>
            <View className="bg-foreground h-2 w-2 rounded-full" />
          </ContextMenuPrimitive.ItemIndicator>
        </View>
        <>{children}</>
      </ContextMenuPrimitive.RadioItem>
    </TextClassContext.Provider>
  );
}
ContextMenuRadioItem.displayName = 'ContextMenuRadioItem';

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  className?: string;
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        'text-foreground px-2 py-1.5 text-sm font-medium',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}
ContextMenuLabel.displayName = 'ContextMenuLabel';

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}
ContextMenuSeparator.displayName = 'ContextMenuSeparator';

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
      {...props}
    />
  );
}
ContextMenuShortcut.displayName = 'ContextMenuShortcut';

export type ContextMenuProps = React.ComponentProps<typeof ContextMenu>;
export type ContextMenuTriggerProps = React.ComponentProps<typeof ContextMenuTrigger>;
export type ContextMenuContentProps = React.ComponentProps<typeof ContextMenuContent>;
export type ContextMenuItemProps = React.ComponentProps<typeof ContextMenuItem>;

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
