// Placeholder for spec:screens-implementation
//
// Shared body used by every screen in the app shell. Renders a centered Card
// announcing its route name + label, plus an optional list of intra-stack
// navigation buttons (`actions`) so reviewers can walk every outgoing edge
// without typing deep links.
//
// Uses ONLY `@diffusecraft/ui` primitives (Card, Button, Separator) plus raw
// `View`/`Text`/`ScrollView` from React Native for layout. No raw hex.

import { ScrollView, Text, View } from 'react-native';

import { Button, Card, Separator } from '@diffusecraft/ui';

export interface PlaceholderAction {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
}

export interface PlaceholderProps {
  /** Programmatic route identifier (e.g., 'Editor'). */
  routeName: string;
  /** Optional human-readable label (e.g., '05-Editor-Generate'). */
  label?: string;
  /** Optional one-line role description. */
  description?: string;
  /** Buttons rendered below the title, used for intra-stack navigation. */
  actions?: PlaceholderAction[];
  /** Free-form area appended below `actions` (route-specific affordances). */
  detail?: React.ReactNode;
}

export function Placeholder({
  routeName,
  label,
  description,
  actions,
  detail,
}: PlaceholderProps) {
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
    >
      <View className="p-6 gap-4 max-w-2xl mx-auto w-full">
        <Card className="p-6 gap-2">
          <Text className="text-display-md text-text-primary">{routeName}</Text>
          {label !== undefined && (
            <Text className="text-caption text-text-secondary">{label}</Text>
          )}
          {description !== undefined && (
            <>
              <Separator className="my-2" />
              <Text className="text-body text-text-secondary">{description}</Text>
            </>
          )}
        </Card>

        {actions !== undefined && actions.length > 0 && (
          <Card className="p-4 gap-2">
            <Text className="text-body-strong text-text-primary mb-1">
              Outgoing edges
            </Text>
            <Separator className="mb-2" />
            <View className="gap-2">
              {actions.map((a) => (
                <Button
                  key={a.label}
                  variant={a.variant ?? 'default'}
                  onPress={a.onPress}
                >
                  <Text className="text-body text-text-primary">{a.label}</Text>
                </Button>
              ))}
            </View>
          </Card>
        )}

        {detail !== undefined && <View className="gap-2">{detail}</View>}
      </View>
    </ScrollView>
  );
}
Placeholder.displayName = 'Placeholder';
