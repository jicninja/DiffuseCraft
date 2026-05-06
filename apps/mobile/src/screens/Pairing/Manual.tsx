// Implements 02d-Pairing-Manual from design-snapshot v1.0.0
//
// Full-screen form. Operator pastes a server URL + pairing token. The Pair
// button is wired to a `console.log('TODO(pairing-protocol)')` placeholder;
// real validation + handshake lands in pairing-protocol. The "What's this?"
// disclosure expands to 4 short bullets explaining when to use Manual.

import { useRouter } from 'expo-router';
import { ChevronDown, ChevronLeft, ChevronUp, Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
} from '@diffusecraft/ui';

import { PAIRING_MANUAL_STRINGS as S } from '../_strings/PairingManual';

export function PairingManualScreen() {
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const onPair = () => {
    console.log('TODO(pairing-protocol)');
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar: 56pt (h-14). Back chevron + title. */}
      <View className="h-14 flex-row items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={20} className="text-text-primary" />
        </Button>
        <Text className="text-title text-text-primary" numberOfLines={1}>
          {S.title}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-6 pb-10 items-center"
      >
        {/* Subtitle above the form. */}
        <View className="w-full max-w-md">
          <Text className="text-text-secondary text-body">{S.subtitle}</Text>
        </View>

        {/* Form card, centered, max-w-md. */}
        <Card className="w-full max-w-md mt-6 gap-5 border-border-subtle bg-surface px-5 py-5">
          {/* Server URL field */}
          <View className="gap-2">
            <Label nativeID="pair-url-label">{S.urlLabel}</Label>
            <Input
              aria-labelledby="pair-url-label"
              value={url}
              onChangeText={setUrl}
              placeholder={S.urlPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
            />
            <Text className="text-text-tertiary text-caption">{S.urlHelper}</Text>
          </View>

          {/* Pairing token field with eye toggle */}
          <View className="gap-2">
            <Label nativeID="pair-token-label">{S.tokenLabel}</Label>
            <View className="relative">
              <Input
                aria-labelledby="pair-token-label"
                value={token}
                onChangeText={setToken}
                placeholder={S.tokenPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showToken}
                className="font-mono pr-12"
              />
              <Pressable
                onPress={() => setShowToken((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  showToken ? S.tokenHideA11yLabel : S.tokenShowA11yLabel
                }
                className="absolute right-2 top-0 bottom-0 h-10 w-10 items-center justify-center rounded-md"
              >
                {showToken ? (
                  <EyeOff size={18} className="text-text-secondary" />
                ) : (
                  <Eye size={18} className="text-text-secondary" />
                )}
              </Pressable>
            </View>
            <Text className="text-text-tertiary text-caption">{S.tokenHelper}</Text>
          </View>

          {/* Primary action */}
          <Button variant="default" onPress={onPair} accessibilityLabel={S.pairButton}>
            <Text className="text-primary-foreground text-body-strong">
              {S.pairButton}
            </Text>
          </Button>
        </Card>

        {/* "What's this?" disclosure */}
        <View className="w-full max-w-md mt-6">
          <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
            <CollapsibleTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={S.disclosureTitle}
                className="flex-row items-center justify-between rounded-md border border-border-subtle bg-surface px-4 py-3"
              >
                <Text className="text-text-primary text-body-strong">
                  {S.disclosureTitle}
                </Text>
                {helpOpen ? (
                  <ChevronUp size={18} className="text-text-secondary" />
                ) : (
                  <ChevronDown size={18} className="text-text-secondary" />
                )}
              </Pressable>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <View className="mt-2 gap-2 rounded-md border border-border-subtle bg-surface px-4 py-3">
                {S.disclosureBullets.map((bullet) => (
                  <View key={bullet} className="flex-row gap-2">
                    <Text className="text-text-tertiary text-body">{'•'}</Text>
                    <Text className="flex-1 text-text-secondary text-body">
                      {bullet}
                    </Text>
                  </View>
                ))}
              </View>
            </CollapsibleContent>
          </Collapsible>
        </View>

        {/* Footer cross-link back to discovery */}
        <View className="w-full max-w-md mt-6 items-center">
          <Button
            variant="ghost"
            onPress={() => router.push('/pair')}
            accessibilityLabel={S.footerBackToDiscovery}
          >
            <ChevronLeft size={16} className="text-text-secondary" />
            <Text className="text-text-secondary text-body">
              {S.footerBackToDiscovery}
            </Text>
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
PairingManualScreen.displayName = 'PairingManualScreen';
