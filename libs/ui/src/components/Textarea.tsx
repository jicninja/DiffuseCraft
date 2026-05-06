// Textarea — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/textarea.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/textarea.tsx
// Pasted: 2026-05-03
//
// Multi-line text input. Default `multiline` is true; `numberOfLines` is
// the initial height on web and the maximum height on native.
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).

import { Platform, TextInput } from 'react-native';

import { cn } from './_internal/utils';

type TextareaProps = React.ComponentProps<typeof TextInput> & React.RefAttributes<TextInput>;

function Textarea({
  className,
  multiline = true,
  numberOfLines = Platform.select({ web: 2, native: 8 }),
  placeholderClassName,
  ...props
}: TextareaProps) {
  return (
    <TextInput
      className={cn(
        'text-foreground border-input dark:bg-input/30 flex min-h-16 w-full flex-row rounded-md border bg-transparent px-3 py-2 text-base shadow-sm shadow-black/5 md:text-sm',
        Platform.select({
          web: 'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive field-sizing-content resize-y outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.editable === false && 'opacity-50',
        className
      )}
      placeholderClassName={cn('text-muted-foreground', placeholderClassName)}
      multiline={multiline}
      numberOfLines={numberOfLines}
      textAlignVertical="top"
      {...props}
    />
  );
}
Textarea.displayName = 'Textarea';

export { Textarea };
export type { TextareaProps };
