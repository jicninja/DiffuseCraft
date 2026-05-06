# Bootstrap smoke test

Run these commands locally to validate specs 1–3 before spec 4.

```bash
cd /Users/ignaciocastro/ia/DiffuseCraft

# 1. Install workspace deps (pnpm should pick up all 7 libs + 2 apps automatically)
pnpm install

# 2. Typecheck — catches missing peerDeps, broken imports, stale types
pnpm -r typecheck

# 3. Hex-guard — must report zero violations
pnpm lint

# 4. Boot Expo (interactive — Ctrl-C to quit)
cd apps/mobile && pnpm start
# Then press 'i' for iOS simulator (iPad Pro) or 'a' for Android tablet emulator.
```

## What to verify in the running app

1. **Cold launch lands on `Pairing.MDNS`** placeholder (because `connectionStore.status === 'no-paired'` by default).
2. **Hardware/back nav** through Pairing flow works.
3. **Debug deep link**: from any screen, run `npx uri-scheme open diffusecraft://__debug/swatch --ios` (or `--android`) — should render the Swatch screen showing every token.
4. **Cycle deep link**: `npx uri-scheme open "diffusecraft://__debug?cycle_to=connected" --ios` — connection state flips, RootRouter swaps to RootStack, lands on `Documents`.
5. **From Documents, navigate to Settings → About** — confirm `__DEV__`-guarded debug card renders the cycler buttons.
6. **Editor route** via `diffusecraft://editor/test-doc?workspace=inpaint` — placeholder shows `documentId: test-doc`, `workspace: inpaint`.
7. **All 16 routes reachable** without crashing.

## Likely friction points (per bootstrap subagent's findings)

- **`@gorhom/bottom-sheet@^5` vs Reanimated 3.10** (Expo SDK 51's pinned version): peer-warning at install. Workaround: pin `@gorhom/bottom-sheet` to v4 line, OR upgrade to Expo SDK 52. Won't crash v1 since no Sheet is mounted yet.
- **NativeWind v4 + Tailwind v3.4** alignment: `tailwind.config.js` should resolve cleanly. If `bg-canvas` etc. don't apply, check `metro.config.js` `withNativeWind` wrapper.
- **`@rn-primitives/*` v1.x** peer-requires `react-native-reanimated >=3.16` for some packages: peer-warning. Should still install with `--strict-peer-dependencies=false` or default pnpm behavior.
- **Missing assets** in `apps/mobile/assets/` (icon.png, splash.png, adaptive-icon.png) — Expo will use defaults. Not blocking.

## What to report back

- Any install errors (paste output).
- Any typecheck errors.
- Whether `pnpm dev:mobile` (= Expo start) actually boots on simulator/emulator.
- Whether the Swatch screen renders correctly (warm gold accent visible, all token sections visible).
- Whether deep links navigate.

If everything works → spec 4 is green-lit (push the 19 subagents).
If something breaks → fix-up subagent dispatched first.
