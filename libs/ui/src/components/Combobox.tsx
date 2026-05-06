// Combobox — searchable single-select. CUSTOM composite (not an rnr paste).
//
// rnr does not ship a stock Combobox in its nativewind registry as of
// commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// (https://github.com/founded-labs/react-native-reusables). We compose a
// minimal Popover + Input + filtered list locally and surface the
// shadcn-style API. Replace this with an rnr import when one ships.
//
// TODO(rnr-combobox-stock): swap in rnr's Combobox once available upstream.
// Date: 2026-05-03.

import { Check, ChevronsUpDown } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon, cn } from './_internal';
import { Input } from './Input';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export interface ComboboxOption {
  /** Stable identifier — what `value` and `onValueChange` operate on. */
  value: string;
  /** Visible label and the haystack searched by `filter`. */
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Options to choose from. Filtered in-process; v1 targets ≤ 200 items. */
  options: ComboboxOption[];
  /** Currently selected value. Pass `undefined` for an empty state. */
  value?: string;
  /** Called with the new value (or `undefined` if the user clears it). */
  onValueChange?: (value: string | undefined) => void;
  /** Placeholder for the trigger and the search input. */
  placeholder?: string;
  /** Search-field placeholder. Falls back to `placeholder` if omitted. */
  searchPlaceholder?: string;
  /** Rendered when no option matches the filter. */
  emptyText?: string;
  /** Whether the trigger is disabled. */
  disabled?: boolean;
  /** Custom matcher; default does a case-insensitive substring on `label`. */
  filter?: (option: ComboboxOption, query: string) => boolean;
  /** Width of the trigger; classes layered after defaults. */
  className?: string;
  /** Width / styling of the popover content. */
  contentClassName?: string;
  portalHost?: string;
}

const defaultFilter = (option: ComboboxOption, query: string) =>
  option.label.toLowerCase().includes(query.toLowerCase());

function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder,
  emptyText = 'No results',
  disabled,
  filter = defaultFilter,
  className,
  contentClassName,
  portalHost,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const filtered = React.useMemo(
    () => (query ? options.filter((o) => filter(o, query)) : options),
    [options, query, filter],
  );

  const handleSelect = React.useCallback(
    (option: ComboboxOption) => {
      if (option.disabled) return;
      onValueChange?.(option.value === value ? undefined : option.value);
      setOpen(false);
      setQuery('');
    },
    [onValueChange, value],
  );

  // TODO(rn-primitives-popover-controlled): @rn-primitives/popover@1.x exposes
  // onOpenChange but not the controlled `open` prop in its types. Cast for
  // now; revisit when rn-primitives lands typed controlled props.
  const PopoverControlled = Popover as unknown as React.ComponentType<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }>;
  return (
    <PopoverControlled open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          className={cn(
            'border-input bg-background flex h-10 flex-row items-center justify-between gap-2 rounded-md border px-3 py-2 shadow-sm shadow-black/5',
            disabled && 'opacity-50',
            className,
          )}
        >
          <Text
            numberOfLines={1}
            className={cn('flex-1 text-sm', selected ? 'text-foreground' : 'text-muted-foreground')}
          >
            {selected?.label ?? placeholder}
          </Text>
          <Icon as={ChevronsUpDown} aria-hidden className="text-muted-foreground size-4" />
        </Pressable>
      </PopoverTrigger>
      <PopoverContent
        portalHost={portalHost}
        className={cn('w-72 p-0', contentClassName)}
      >
        <View className="border-border border-b p-2">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder ?? placeholder}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={searchPlaceholder ?? placeholder}
          />
        </View>
        <ScrollView className="max-h-64" keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <View className="px-3 py-6">
              <Text className="text-muted-foreground text-center text-sm">{emptyText}</Text>
            </View>
          ) : (
            <View className="p-1">
              {filtered.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: option.disabled }}
                    disabled={option.disabled}
                    onPress={() => handleSelect(option)}
                    className={cn(
                      'active:bg-accent group relative flex flex-row items-center gap-2 rounded-sm py-1.5 pl-2 pr-8',
                      option.disabled && 'opacity-50',
                    )}
                  >
                    <Text
                      numberOfLines={1}
                      className="text-popover-foreground group-active:text-accent-foreground flex-1 text-sm"
                    >
                      {option.label}
                    </Text>
                    {isSelected ? (
                      <View className="absolute right-2 flex size-3.5 items-center justify-center">
                        <Icon as={Check} className="text-foreground size-4" />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </PopoverContent>
    </PopoverControlled>
  );
}
Combobox.displayName = 'Combobox';

export { Combobox };
