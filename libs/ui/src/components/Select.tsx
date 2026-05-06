// Select — single-select dropdown built on @rn-primitives/select.
//
// Modeled after react-native-reusables' Select recipe at
// packages/registry/src/nativewind/components/ui/select.tsx (commit
// 7c287b976d461b717de397e1f581ab44c8e6d72d) — see
// https://github.com/founded-labs/react-native-reusables.
// Pasted/adapted: 2026-05-03. Native-only: web branches dropped per FR-3.

import * as SelectPrimitive from '@rn-primitives/select';
import { Check, ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon, TextClassContext, cn } from './_internal';

type Option = SelectPrimitive.Option;

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;

function SelectValue({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value> & { className?: string }) {
  const { value } = SelectPrimitive.useRootContext();
  return (
    <SelectPrimitive.Value
      ref={ref}
      className={cn(
        'text-foreground line-clamp-1 flex flex-row items-center gap-2 text-sm',
        !value && 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
SelectValue.displayName = 'SelectValue';

type SelectTriggerSize = 'default' | 'sm';

function SelectTrigger({
  ref,
  className,
  children,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  children?: React.ReactNode;
  size?: SelectTriggerSize;
}) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'border-input bg-background flex h-10 flex-row items-center justify-between gap-2 rounded-md border px-3 py-2 shadow-sm shadow-black/5',
        size === 'sm' && 'h-8 py-1.5',
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <>{children}</>
      <Icon as={ChevronDown} aria-hidden className="text-muted-foreground size-4" />
    </SelectPrimitive.Trigger>
  );
}
SelectTrigger.displayName = 'SelectTrigger';

function SelectContent({
  className,
  children,
  position = 'popper',
  portalHost,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  className?: string;
  portalHost?: string;
}) {
  return (
    <SelectPrimitive.Portal hostName={portalHost}>
      <SelectPrimitive.Overlay style={StyleSheet.absoluteFill}>
        <TextClassContext.Provider value="text-popover-foreground">
          <Animated.View className="z-50" entering={FadeIn} exiting={FadeOut}>
            <SelectPrimitive.Content
              className={cn(
                'bg-popover border-border relative z-50 min-w-[8rem] rounded-md border p-1 shadow-md shadow-black/5',
                className,
              )}
              position={position}
              {...props}
            >
              <SelectPrimitive.Viewport
                className={cn('p-1', position === 'popper' && 'w-full')}
              >
                {children}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </Animated.View>
        </TextClassContext.Provider>
      </SelectPrimitive.Overlay>
    </SelectPrimitive.Portal>
  );
}
SelectContent.displayName = 'SelectContent';

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  );
}
SelectLabel.displayName = 'SelectLabel';

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'active:bg-accent group relative flex w-full flex-row items-center gap-2 rounded-sm py-1.5 pl-2 pr-8',
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <View className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Icon as={Check} className="text-muted-foreground size-4 shrink-0" />
        </SelectPrimitive.ItemIndicator>
      </View>
      <SelectPrimitive.ItemText className="text-foreground group-active:text-accent-foreground select-none text-sm" />
      {typeof children === 'function' ? null : (children as React.ReactNode)}
    </SelectPrimitive.Item>
  );
}
SelectItem.displayName = 'SelectItem';

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}
SelectSeparator.displayName = 'SelectSeparator';

export type SelectProps = React.ComponentProps<typeof Select>;
export type SelectTriggerProps = React.ComponentProps<typeof SelectTrigger>;
export type SelectValueProps = React.ComponentProps<typeof SelectValue>;
export type SelectContentProps = React.ComponentProps<typeof SelectContent>;
export type SelectItemProps = React.ComponentProps<typeof SelectItem>;
export type SelectLabelProps = React.ComponentProps<typeof SelectLabel>;
export type SelectGroupProps = React.ComponentProps<typeof SelectGroup>;
export type SelectSeparatorProps = React.ComponentProps<typeof SelectSeparator>;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type Option,
};
