// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/tabs.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` and `TextClassContext` imports rewritten to `./_internal/utils`.
//   - Web-only `Platform.select({ web: ... })` branches removed; native-only
//     class set retained per paste rules.
//   - `TabsList` keeps the native `mr-auto` modifier from upstream's
//     `Platform.select({ native: 'mr-auto' })` branch.

import * as TabsPrimitive from '@rn-primitives/tabs';

import { cn, TextClassContext } from './_internal/utils';

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} {...props} />;
}
Tabs.displayName = 'Tabs';

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bg-muted flex h-9 flex-row items-center justify-center rounded-lg p-[3px] mr-auto',
        className,
      )}
      {...props}
    />
  );
}
TabsList.displayName = 'TabsList';

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { value } = TabsPrimitive.useRootContext();
  return (
    <TextClassContext.Provider
      value={cn(
        'text-foreground dark:text-muted-foreground text-sm font-medium',
        value === props.value && 'dark:text-foreground',
      )}>
      <TabsPrimitive.Trigger
        className={cn(
          'flex h-[calc(100%-1px)] flex-row items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 shadow-none shadow-black/5',
          props.disabled && 'opacity-50',
          props.value === value && 'bg-background dark:border-foreground/10 dark:bg-input/30',
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}
TabsTrigger.displayName = 'TabsTrigger';

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn(className)} {...props} />;
}
TabsContent.displayName = 'TabsContent';

export type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root>;

export { Tabs, TabsContent, TabsList, TabsTrigger };
