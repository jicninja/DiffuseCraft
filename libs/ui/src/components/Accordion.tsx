// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/accordion.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` and `TextClassContext` imports rewritten to `./_internal/utils`.
//   - Web-only `Platform.select({ web: ... })` branches removed; the
//     `<Trigger>` alias is locked to `Pressable` since v1 is native-only.
//   - Upstream `Icon` wrapper (which reads `TextClassContext`) is replaced
//     with a thin local `Icon` that forwards `lucide-react-native:ChevronDown`
//     and accepts `className` + `size` — preserving the rnr behaviour without
//     pasting `icon.tsx`. Colour follows the muted-foreground class.
//   - `asChild={Platform.OS !== 'web'}` simplified to `asChild` (native).

import * as AccordionPrimitive from '@rn-primitives/accordion';
import { ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { cn, TextClassContext } from './_internal/utils';

function Icon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // ChevronDown from lucide-react-native accepts `color` + `size` props.
  // We pass the className through; NativeWind resolves the foreground via
  // currentColor. For SVG icons we rely on the parent class context.
  const ctxClass = React.useContext(TextClassContext);
  return (
    <ChevronDown
      className={cn(ctxClass, className) as unknown as undefined}
      size={size}
    />
  );
}

function Accordion({
  children,
  ...props
}: Omit<React.ComponentProps<typeof AccordionPrimitive.Root>, 'asChild'>) {
  return (
    <LayoutAnimationConfig skipEntering>
      <AccordionPrimitive.Root
        {...(props as AccordionPrimitive.RootProps)}
        asChild>
        <Animated.View layout={LinearTransition.duration(200)}>{children}</Animated.View>
      </AccordionPrimitive.Root>
    </LayoutAnimationConfig>
  );
}
Accordion.displayName = 'Accordion';

function AccordionItem({
  children,
  className,
  value,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn('border-border border-b', className)}
      value={value}
      asChild
      {...props}>
      <Animated.View
        className="native:overflow-hidden"
        layout={LinearTransition.duration(200)}>
        {children}
      </Animated.View>
    </AccordionPrimitive.Item>
  );
}
AccordionItem.displayName = 'AccordionItem';

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  children?: React.ReactNode;
}) {
  const { isExpanded } = AccordionPrimitive.useItemContext();

  const progress = useDerivedValue(
    () => (isExpanded ? withTiming(1, { duration: 250 }) : withTiming(0, { duration: 200 })),
    [isExpanded],
  );
  const chevronStyle = useAnimatedStyle(
    () => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    }),
    [progress],
  );

  return (
    <TextClassContext.Provider value={cn('text-left text-sm font-medium')}>
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger {...props} asChild>
          <Pressable
            className={cn(
              'flex-row items-start justify-between gap-4 rounded-md py-4 disabled:opacity-50',
              className,
            )}>
            <>{children}</>
            <Animated.View style={chevronStyle}>
              <Icon size={16} className={cn('text-muted-foreground shrink-0')} />
            </Animated.View>
          </Pressable>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
    </TextClassContext.Provider>
  );
}
AccordionTrigger.displayName = 'AccordionTrigger';

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <TextClassContext.Provider value="text-sm">
      <AccordionPrimitive.Content className={cn('overflow-hidden')} {...props}>
        <Animated.View exiting={FadeOutUp.duration(200)} className={cn('pb-4', className)}>
          {children}
        </Animated.View>
      </AccordionPrimitive.Content>
    </TextClassContext.Provider>
  );
}
AccordionContent.displayName = 'AccordionContent';

export type AccordionProps = Omit<
  React.ComponentProps<typeof AccordionPrimitive.Root>,
  'asChild'
>;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
