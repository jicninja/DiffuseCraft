// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/card.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` import rewritten to `./_internal/utils`.
//   - `TextClassContext` imported from `./_internal/utils` (Group 1 paste)
//     instead of upstream `./text` (rnr `text.tsx` is not pasted in v1).
//   - Upstream `<Text>` wrapper is replaced by a local `Text` reader that
//     consumes `TextClassContext` and forwards to React Native's native
//     `<Text>` — preserving the rnr behaviour of inheriting parent intent
//     classes onto descendant text nodes without pasting `text.tsx`.
//   - `<CardTitle>` and `<CardDescription>` props are typed against
//     `RNText` directly (upstream typed against the now-removed wrapper).

import { Text as RNText, View } from 'react-native';
import * as React from 'react';

import { cn, TextClassContext } from './_internal/utils';

function Text({ className, ...props }: React.ComponentProps<typeof RNText>) {
  const ctxClass = React.useContext(TextClassContext);
  return <RNText className={cn(ctxClass, className)} {...props} />;
}

function Card({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View
        className={cn(
          'bg-card border-border flex flex-col gap-6 rounded-xl border py-6 shadow-sm shadow-black/5',
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}
Card.displayName = 'Card';

function CardHeader({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('flex flex-col gap-1.5 px-6', className)} {...props} />;
}
CardHeader.displayName = 'CardHeader';

function CardTitle({
  className,
  ...props
}: React.ComponentProps<typeof RNText>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn('font-semibold leading-none', className)}
      {...props}
    />
  );
}
CardTitle.displayName = 'CardTitle';

function CardDescription({
  className,
  ...props
}: React.ComponentProps<typeof RNText> & React.RefAttributes<RNText>) {
  return <Text className={cn('text-muted-foreground text-sm', className)} {...props} />;
}
CardDescription.displayName = 'CardDescription';

function CardContent({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('px-6', className)} {...props} />;
}
CardContent.displayName = 'CardContent';

function CardFooter({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('flex flex-row items-center px-6', className)} {...props} />;
}
CardFooter.displayName = 'CardFooter';

export type CardProps = React.ComponentProps<typeof View> & React.RefAttributes<View>;

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
