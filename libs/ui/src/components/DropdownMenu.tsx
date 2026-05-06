// DropdownMenu — anchored menu over @rn-primitives/dropdown-menu.
//
// Modeled after react-native-reusables' DropdownMenu recipe at
// packages/registry/src/nativewind/components/ui/dropdown-menu.tsx (commit
// 7c287b976d461b717de397e1f581ab44c8e6d72d) — see
// https://github.com/founded-labs/react-native-reusables.
// Pasted/adapted: 2026-05-03. Native-only: web branches dropped per FR-3.

import * as DropdownMenuPrimitive from '@rn-primitives/dropdown-menu';
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

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  iconClassName,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  children?: React.ReactNode;
  iconClassName?: string;
  inset?: boolean;
}) {
  const { open } = DropdownMenuPrimitive.useSubContext();
  const icon = open ? ChevronUp : ChevronDown;
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sm select-none group-active:text-accent-foreground',
        open && 'text-accent-foreground',
      )}
    >
      <DropdownMenuPrimitive.SubTrigger
        className={cn(
          'active:bg-accent group flex flex-row items-center rounded-sm px-2 py-1.5',
          open && 'bg-accent',
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
      </DropdownMenuPrimitive.SubTrigger>
    </TextClassContext.Provider>
  );
}
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <Animated.View entering={FadeIn}>
      <DropdownMenuPrimitive.SubContent
        className={cn(
          'bg-popover border-border overflow-hidden rounded-md border p-1 shadow-lg shadow-black/5',
          className,
        )}
        {...props}
      />
    </Animated.View>
  );
}
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

function DropdownMenuContent({
  className,
  overlayClassName,
  overlayStyle,
  portalHost,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  overlayStyle?: StyleProp<ViewStyle>;
  overlayClassName?: string;
  portalHost?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal hostName={portalHost}>
      <DropdownMenuPrimitive.Overlay
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
            <DropdownMenuPrimitive.Content
              className={cn(
                'bg-popover border-border min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg shadow-black/5',
                className,
              )}
              {...props}
            />
          </TextClassContext.Provider>
        </Animated.View>
      </DropdownMenuPrimitive.Overlay>
    </DropdownMenuPrimitive.Portal>
  );
}
DropdownMenuContent.displayName = 'DropdownMenuContent';

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
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
      <DropdownMenuPrimitive.Item
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
DropdownMenuItem.displayName = 'DropdownMenuItem';

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  children?: React.ReactNode;
}) {
  return (
    <TextClassContext.Provider value="text-sm text-popover-foreground select-none group-active:text-accent-foreground">
      <DropdownMenuPrimitive.CheckboxItem
        className={cn(
          'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm py-1.5 pl-8 pr-2',
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        <View className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <Icon as={Check} className="text-foreground size-4" />
          </DropdownMenuPrimitive.ItemIndicator>
        </View>
        <>{children}</>
      </DropdownMenuPrimitive.CheckboxItem>
    </TextClassContext.Provider>
  );
}
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  children?: React.ReactNode;
}) {
  return (
    <TextClassContext.Provider value="text-sm text-popover-foreground select-none group-active:text-accent-foreground">
      <DropdownMenuPrimitive.RadioItem
        className={cn(
          'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm py-1.5 pl-8 pr-2',
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        <View className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <View className="bg-foreground h-2 w-2 rounded-full" />
          </DropdownMenuPrimitive.ItemIndicator>
        </View>
        <>{children}</>
      </DropdownMenuPrimitive.RadioItem>
    </TextClassContext.Provider>
  );
}
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  className?: string;
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'text-foreground px-2 py-1.5 text-sm font-medium',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

function DropdownMenuShortcut({
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
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export type DropdownMenuProps = React.ComponentProps<typeof DropdownMenu>;
export type DropdownMenuTriggerProps = React.ComponentProps<typeof DropdownMenuTrigger>;
export type DropdownMenuContentProps = React.ComponentProps<typeof DropdownMenuContent>;
export type DropdownMenuItemProps = React.ComponentProps<typeof DropdownMenuItem>;

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
