// Implements 02d-Pairing-Manual from design-snapshot v1.0.0
//
// Full-screen form. Operator pastes a server URL + pairing token. The Pair
// button now records the manually-entered backend in the connection store
// (paired list + secure token), sets it as the current backend, and
// returns to the editor. The root layout's `useDiffuseCraftClient` hook
// observes the change, instantiates a `DiffuseCraftClient` over HTTP,
// completes the MCP handshake, and threads the result into
// `<StoresProvider>` so the editor's BottomPromptBar Generate button
// can fire `generate_image` against the real server.
//
// The "What's this?" disclosure expands to 4 short bullets explaining
// when to use Manual.

import { useRouter } from 'expo-router';
import { ChevronDown, ChevronLeft, ChevronUp, Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConnectionStore } from '@diffusecraft/core';
import { PairingClient } from '@diffusecraft/diffusion-client';
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  toast,
  tokens,
} from '@diffusecraft/ui';

import { completePairing } from '../../sdk/pairing-flow';
import { PAIRING_MANUAL_STRINGS as S } from '../_strings/PairingManual';

export function PairingManualScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pairBackend = useConnectionStore((s) => s.pairBackend);
  const setCurrentBackend = useConnectionStore((s) => s.setCurrentBackend);

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onPair = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Single-paste path: the operator pasted the server's `pair`
      // boot-log line (`http://<ip>:<port>/?t=<token>`) into the URL
      // field. Route through the SDK's parser so the URL + token
      // extraction matches the server's `buildManualUrl` shape exactly.
      // Two-field path: the operator typed URL + Token separately.
      // Validate the URL with `new URL(...)` and require a non-empty
      // token.
      let parsed: { url: string; token: string };
      const trimmedUrl = url.trim();
      if (trimmedUrl.includes('?t=') || trimmedUrl.includes('?token=')) {
        try {
          parsed = new PairingClient({}).parseManual(trimmedUrl);
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'Invalid manual URL');
          return;
        }
      } else {
        try {
          // Constructor throws if the input is not a valid URL.
          new URL(trimmedUrl);
        } catch {
          toast.error('Invalid URL');
          return;
        }
        const trimmedToken = token.trim();
        if (trimmedToken.length === 0) {
          toast.error('Token required');
          return;
        }
        parsed = { url: trimmedUrl, token: trimmedToken };
      }

      await completePairing(
        { pairBackend, setCurrentBackend },
        'manual',
        { url: parsed.url, token: parsed.token },
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar: 56pt (h-14). Back chevron + title. */}
      <View style={{ paddingTop: insets.top }}>
        <View className="h-14 flex-row items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            onPress={() => router.back()}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={20} color={tokens.colors.text.primary} />
          </Button>
          <Text className="text-title text-text-primary" numberOfLines={1}>
            {S.title}
          </Text>
        </View>
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
          <Button
            variant="default"
            onPress={onPair}
            disabled={submitting}
            accessibilityLabel={S.pairButton}
          >
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
            <ChevronLeft size={16} color={tokens.colors.text.secondary} />
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
