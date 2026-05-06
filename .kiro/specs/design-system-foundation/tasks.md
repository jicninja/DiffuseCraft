# design-system-foundation — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, `tsc --noEmit` clean, lint clean (including the no-raw-hex rule landed in T7), Conventional Commits with `mobile`, `ui`, or `repo` scope.
> **t-shirt sizes:** XS = ≤30 min · S = ≤2h · M = ≤half-day. (This spec contains only XS / S / M tasks.)

> **Total estimate:** ~1.5 days for one engineer. Sequential except where noted.

---

## T1 — Snapshot ingestion script + design-snapshot directory

**Title.** Create `tools/snapshot-pen.ts` and run it against the canonical `.pen` (or write the placeholder manifest).

**Files touched.**
- `tools/snapshot-pen.ts` (new)
- `apps/mobile/design-snapshot/.gitkeep` (new)
- `apps/mobile/design-snapshot/manifest.json` (new — real or placeholder per `design.md` §6.4)
- (when `.pen` exists) `apps/mobile/design-snapshot/tokens.json` (new)
- (when `.pen` exists) `apps/mobile/design-snapshot/<artboard-label>/{nodes.json, preview.png, layout.json}` for each of the 13 artboards (new)
- `package.json` root: add `tsx` dev dep + `@modelcontextprotocol/sdk` dep; add npm script `"snapshot:pen": "tsx tools/snapshot-pen.ts"`.

**Behaviour.** Per `design.md` §6. The script connects via `StdioClientTransport` to the configured pencil MCP server (path from env `PENCIL_MCP_BIN`), opens the document at `DIFFUSECRAFT_PEN_PATH`, iterates the 13-artboard target list (frozen in `design.md` §6.3), and writes `manifest.json` with the schema in `design.md` §6.2.

**`.pen` not yet available?** Skip the live MCP path. The script's `main()` detects missing env / `.pen` absent and writes a placeholder `manifest.json` with `snapshot_version: 0`, `source_pen_path: null`, `pencil_mcp_version: ''`, `extracted_at: ''`, and the 13 expected artboard labels populated with empty `paths`. Add a `// TODO(.pen-not-yet): replace placeholder with real snapshot once .pen lands` comment at the top of `tools/snapshot-pen.ts`.

**Acceptance check.**
- `pnpm snapshot:pen` exits 0 in both modes (real `.pen` → real artefacts; missing `.pen` → placeholder).
- `apps/mobile/design-snapshot/manifest.json` exists and parses; `manifest.artboards.length === 13`; every label matches the contract list.
- Re-running with no `.pen` change produces byte-identical output (modulo the deterministically formatted `extracted_at`).

**Dependencies.** None. (Done first to unblock downstream specs that need `manifest.json` to exist.)

**Size.** S.

---

## T2 — Workspace-root `tailwind.config.js`

**Title.** Land the full token set as the single source of truth.

**Files touched.**
- `tailwind.config.js` (new, at workspace root)
- `package.json` root: add `tailwindcss` and `nativewind` (v4) as dev deps if absent.

**Behaviour.** Implements the configuration in `design.md` §4.2 verbatim. `content` globs cover `apps/mobile/**` and `libs/ui/**`. `presets: [require('nativewind/preset')]`. Every token from `design.md` §2 is present.

**Acceptance check.**
- `node -e "console.log(Object.keys(require('./tailwind.config.js').theme.extend.colors))"` lists at least: `canvas, surface, elevated, inset, border-subtle, border-strong, primary, secondary, tertiary, accent, danger, warn, success, info`.
- `borderRadius` keys: `xs, sm, md, lg, xl, pill` — values `4, 6, 10, 14, 20, 999`.
- `spacing` keys map to `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72`.
- `fontSize` keys: `display-lg, display-md, title, body, body-strong, mono, caption`.
- `boxShadow.sheet` is set.

**Dependencies.** T1 (only because T1 also bumps root deps; ordering avoids merge conflicts). Otherwise independent.

**Size.** S.

---

## T3 — Wire NativeWind v4 into `apps/mobile`

**Title.** Babel + Metro + global.css + Expo config so Tailwind classes resolve.

**Files touched.**
- `apps/mobile/babel.config.js` (new) — adds `nativewind/babel` preset.
- `apps/mobile/metro.config.js` (new) — wraps Expo metro with `withNativeWind({ input: './global.css' })`.
- `apps/mobile/global.css` (new) — `@tailwind base; @tailwind components; @tailwind utilities;`.
- `apps/mobile/app.config.ts` (new) — Expo config; declares the entry, name, slug, and any required NativeWind plugin entries.
- `apps/mobile/package.json` (new or updated) — depends on `expo`, `react-native`, `nativewind`, and links the workspace tailwind config.
- `apps/mobile/tsconfig.json` (new or updated) — extends `tsconfig.base.json`, adds NativeWind types reference.
- `apps/mobile/nativewind-env.d.ts` (new) — `/// <reference types="nativewind/types" />` so `className` is typed on RN components.

**Acceptance check.**
- `pnpm --filter mobile dev` starts Expo without a NativeWind / metro error.
- A throwaway `<View className="bg-canvas" />` renders at canvas colour.
- `tsc --noEmit` clean for `apps/mobile`.

**Dependencies.** T2 (the config it points to).

**Size.** M.

---

## T4 — `@diffusecraft/ui` theme module

**Title.** Implement `ThemeProvider`, `useTheme`, and the typed `tokens.ts`.

**Files touched.**
- `libs/ui/src/theme/types.ts` (new) — types from `design.md` §3.
- `libs/ui/src/theme/tokens.ts` (new) — `darkTheme: Theme` with values mirroring `design.md` §2.
- `libs/ui/src/theme/provider.tsx` (new) — `ThemeProvider`, `useTheme`, `useSetTheme` per `design.md` §5.
- `libs/ui/src/theme/index.ts` (new) — public re-exports.
- `libs/ui/src/index.ts` (updated or new) — `export * from './theme';`.
- `libs/ui/package.json` (updated) — exports map includes `./theme` if applicable; peer deps include `react`, `react-native`.
- `libs/ui/src/theme/__tests__/tokens-match-tailwind.test.ts` (new) — vitest test asserting every entry in `darkTheme` matches the value in `tailwind.config.js`.
- `libs/ui/src/theme/__tests__/use-theme.test.tsx` (new) — vitest test asserting `useTheme` throws outside provider and returns the dark theme inside.

**Acceptance check.**
- `import { ThemeProvider, useTheme, type Theme } from '@diffusecraft/ui'` resolves.
- The two tests pass.
- `tsc --noEmit` clean for `libs/ui`.

**Dependencies.** T2 (Tailwind config exists for the cross-check test).

**Size.** M.

---

## T5 — Mount `ThemeProvider` in `apps/mobile/App.tsx`

**Title.** Stub root that imports `global.css`, mounts `<ThemeProvider>`, and renders `<Swatch />`.

**Files touched.**
- `apps/mobile/App.tsx` (new) — content per `design.md` §5 mount snippet.
- `apps/mobile/index.ts` (new or updated) — `registerRootComponent(App)`.

**Acceptance check.**
- `pnpm --filter mobile dev` boots; the Swatch screen renders without throwing the "useTheme outside provider" error.
- No crash from missing `global.css` import.

**Dependencies.** T3, T4, T6 (T6 produces `Swatch`; if T6 lands later, this task initially renders a placeholder `<View />` and is amended once T6 lands — but execution order is T6 before T5 to avoid the amendment).

**Size.** XS.

---

## T6 — Swatch screen

**Title.** Build `apps/mobile/src/screens/Swatch.tsx` with all five sections.

**Files touched.**
- `apps/mobile/src/screens/Swatch.tsx` (new) — five sections per `design.md` §7.
- `apps/mobile/src/screens/index.ts` (new) — `export { Swatch } from './Swatch';`.

**Behaviour.** Reads tokens via `useTheme()`. Applies styling via Tailwind classes. Every token from `design.md` §2 visible. Use `ScrollView` (the screen will exceed viewport height).

**Acceptance check.**
- The screen renders all 16 colour tokens, all 12 spacing values, all 6 radii, all 7 type styles, and the `shadow/sheet` preview.
- Visual run on iPad viewport in Expo: nothing clipped, every label legible.

**Dependencies.** T3, T4.

**Size.** M.

---

## T7 — CI guard: ban raw hex outside `tailwind.config.js`

**Title.** Add a lint rule (or grep-based CI step) that fails on raw hex literals in `apps/mobile/` and `libs/ui/`.

**Files touched.**
- Either `tools/lint/no-raw-hex.js` (new) — a tiny custom ESLint rule, registered in the existing flat config(s).
- Or `package.json` root: a `"lint:no-raw-hex"` script wrapping the ripgrep command in `design.md` §8.
- `apps/mobile/eslint.config.mjs` and `libs/ui/eslint.config.mjs` (new or updated) — register the rule (if going the ESLint route).
- CI workflow file at `.github/workflows/ci.yml` (new or updated) — invoke the script as a separate job step. (If no CI is wired yet in the repo, add the script; CI wiring lands when the first CI workflow does.)

**Behaviour.** The rule (or grep) ignores `tailwind.config.js`, `**/__snapshots__/**`, `**/design-snapshot/**`, and `**/*.test.{ts,tsx}` to avoid false positives on test fixtures.

**Acceptance check.**
- Introducing `style={{ color: '#ff0000' }}` in a `apps/mobile` source file fails CI.
- Removing the offending line restores green.

**Dependencies.** T6 (Swatch is the canonical "all-tokens" surface; running the rule against it must pass).

**Size.** S.

---

## T8 — Snapshot test of Swatch screen

**Title.** Vitest + React Native Testing Library snapshot covering the Swatch render.

**Files touched.**
- `apps/mobile/src/screens/__tests__/Swatch.test.tsx` (new).
- `apps/mobile/vitest.config.ts` (new or updated) — RN Testing Library setup, jsdom or `react-native` test env.
- `apps/mobile/test-setup.ts` (new) — RN-specific shims if needed.

**Behaviour.** Renders `<ThemeProvider><Swatch /></ThemeProvider>` and snapshots the tree. Changes to token values cause an intentional snapshot diff that the reviewer accepts when the contract changes.

**Acceptance check.**
- `pnpm --filter mobile test` passes.
- Mutating a hex value in `tailwind.config.js` causes the snapshot to diverge.

**Dependencies.** T6.

**Size.** S.

---

## Dependency order

```
T1 ─────────────────────────────────────┐
T2 → T3 ┐                               │
        ├→ T4 ┐                         │
        │     ├→ T6 → T5                │
        │     │       └→ T8             │
        │     │                         │
        │     └→ T7 ─────────────────── │
        │                               │
        └───────────────────────────────┘
```

Linear-friendly read: **T1 → T2 → T3 → T4 → T6 → T5 → T7 → T8**.

T1 is independent and runs first to unblock downstream specs that read `manifest.json`. T2–T8 form the core implementation chain, with the only concurrency opportunity being T7 vs. T5 + T8 once T6 lands.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| NativeWind v4 token naming collides with internal Tailwind defaults (e.g., `accent` is also a Tailwind colour family in some plugin sets) | Use explicit nested key names (`accent.DEFAULT`); avoid plugin packs in this spec. |
| `@modelcontextprotocol/sdk` API drift in `tools/snapshot-pen.ts` | Pin SDK version; test the script in CI when `.pen` exists. |
| `useTheme()` inside Skia draw closures triggers per-frame allocations | Read once outside the closure; pass primitive values in. Document this in `libs/ui` README when canvas-skia integration begins. |
| `.pen` file not delivered before downstream specs need real artefacts | T1's placeholder mode unblocks; downstream specs read `manifest.json` shape, not contents. Real run is a re-PR when `.pen` lands. |
| Light theme stub in `ThemeProvider` (`name === 'light' ? darkTheme : darkTheme`) gets shipped to production | Add a dev-mode `console.warn` and a follow-up issue tagged `@light-theme`. |
