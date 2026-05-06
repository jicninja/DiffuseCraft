# Structure

## Repository layout

Single Nx monorepo at `/Users/ignaciocastro/ia/DiffuseCraft`. Top-level layout:

```
DiffuseCraft/
├── .kiro/                      # cc-sdd specs and steering (this directory)
│   ├── steering/               # product.md, tech.md, structure.md, principles.md, inspirations.md
│   └── specs/                  # one folder per feature: requirements.md, design.md, tasks.md
├── apps/
│   ├── mobile/                 # Expo app (tablet-first, phone fallback)
│   └── server/                 # npx entry — thin wrapper around @diffusecraft/server
├── libs/
│   ├── core/                   # @diffusecraft/core
│   ├── mcp-tools/              # @diffusecraft/mcp-tools
│   ├── canvas-core/            # @diffusecraft/canvas-core
│   ├── canvas-skia/            # @diffusecraft/canvas-skia
│   ├── diffusion-client/       # @diffusecraft/diffusion-client
│   ├── server/                 # @diffusecraft/server
│   └── ui/                     # @diffusecraft/ui
├── tools/                      # Nx generators, scripts, CI helpers
├── nx.json                     # Nx workspace config
├── pnpm-workspace.yaml         # pnpm workspace config (lockfile: pnpm-lock.yaml)
├── tsconfig.base.json          # path aliases for @diffusecraft/*
├── package.json                # root deps (Nx, pnpm, vitest, prettier, eslint)
├── README.md
├── LICENSE                     # repo-level license note pointing to per-package LICENSE
└── CHANGELOG.md                # Changesets-managed
```

Apps go under `apps/`, libraries under `libs/`. This matches Nx convention and lets `@nx/enforce-module-boundaries` apply tag-based rules cleanly.

## Package layout (per library)

Every library follows the same internal layout. Example for `libs/server/`:

```
libs/server/
├── src/
│   ├── index.ts                # public exports only
│   ├── lib/                    # internal modules; never imported externally
│   │   ├── pairing/
│   │   ├── jobs/
│   │   ├── comfy/
│   │   ├── transports/
│   │   └── ...
│   └── __tests__/              # co-located tests for internal modules
├── package.json                # name, version, exports map, peerDependencies
├── project.json                # Nx project config (targets, tags, dependencies)
├── tsconfig.json               # extends base
├── tsconfig.lib.json           # build config
├── tsconfig.spec.json          # test config
├── vitest.config.ts
├── eslint.config.mjs
├── README.md                   # short, public-facing
└── LICENSE                     # MIT for libs, Apache-2.0 for server
```

`src/index.ts` is the **only** public entry. Importing from `@diffusecraft/server/lib/*` is disallowed via `package.json#exports` and ESLint.

## Naming conventions

| Element | Convention | Example |
|---|---|---|
| Packages | `@diffusecraft/<kebab-case>` | `@diffusecraft/canvas-core` |
| Apps | `apps/<kebab-case>` | `apps/mobile` |
| Files (TS source) | `kebab-case.ts` | `pairing-flow.ts` |
| Files (React components) | `PascalCase.tsx` | `LayerPanel.tsx` |
| Test files | `<source>.test.ts` co-located | `pairing-flow.test.ts` |
| Type files (when isolated) | `<noun>.types.ts` | `tool-catalog.types.ts` |
| MCP tool names | `verb_noun` snake_case | `generate_image`, `apply_history_item` |
| MCP resource URIs | `diffusecraft://<noun>/<id>` | `diffusecraft://job/abc-123` |
| Zod schemas | PascalCase ending in `Schema` | `GenerateImageInputSchema` |
| Inferred types | PascalCase same root | `GenerateImageInput` (from `z.infer`) |
| Stores (factories) | `create<Noun>Store` | `createEditorStore` |
| Store hooks (consumer side) | `use<Noun>Store` (returned from factory bind) | `useEditorStore` |
| Events | `noun.verb-past-tense` | `job.completed`, `model.downloaded` |
| Error codes | UPPER_SNAKE_CASE, English | `UNSUPPORTED_CATALOG_VERSION` |
| Branches | `<scope>/<short-desc>` | `mcp-tools/add-region-tool` |
| Commits | Conventional Commits | `feat(server): add managed comfyui install` |

## Spec organization (`.kiro/`)

Specs follow the cc-sdd workflow. One folder per feature.

```
.kiro/specs/<feature-slug>/
├── requirements.md             # User stories + EARS acceptance criteria + out-of-scope
├── design.md                   # Architecture, schemas, types, sequence diagrams
└── tasks.md                    # Checklist with t-shirt sizes and DoD
```

Naming: kebab-case slug, no version suffix. The current state of the spec lives in those three files; history lives in git.

| Spec slug pattern | Meaning |
|---|---|
| `<feature>` | Main feature spec (e.g., `mcp-tool-catalog`, `pairing-protocol`) |
| `<feature>-<aspect>` | Sub-spec when a feature is too large for one folder (e.g., `mcp-tool-catalog-events`) |

Cross-references between specs use relative links: `[see pairing-protocol](../pairing-protocol/design.md#claim-flow)`.

## Coding standards

| Rule | Tooling |
|---|---|
| TypeScript strict mode | `tsconfig.base.json` with `"strict": true, "noUncheckedIndexedAccess": true` |
| No `any` in shipped code; use `unknown` and narrow | ESLint `@typescript-eslint/no-explicit-any` error |
| Prefer named exports; default exports only for React Native screens that require them | ESLint `import/prefer-default-export` off |
| All public exports of `libs/*` must have JSDoc descriptions | tsdoc rule |
| Zod is the single source of truth for schemas; types are inferred via `z.infer` | Convention |
| MCP tool inputs/outputs come from `@diffusecraft/mcp-tools` schemas; never re-declare | Lint check (custom) |
| No `// TODO` without an owner — write `// TODO(@username): <reason>` or open an issue | Custom ESLint rule |
| No console.log in shipped code; use the project logger (`pino` in server, RN logger in mobile) | ESLint `no-console` error |
| Imports ordered: stdlib → external → @diffusecraft → relative | `eslint-plugin-import` |
| Filenames must match exported symbol's casing convention | Custom ESLint rule |
| All English in code, comments, commits, and steering/specs | Convention; user-facing strings via i18n |

## Dependency rules

Enforced by `@nx/enforce-module-boundaries`. Each project has tags; rules say which tags can depend on which.

| Project | Tags |
|---|---|
| `core` | `scope:foundation` |
| `mcp-tools` | `scope:contract` |
| `canvas-core` | `scope:canvas`, `type:lib` |
| `canvas-skia` | `scope:canvas`, `type:lib`, `platform:rn` |
| `diffusion-client` | `scope:client-sdk`, `type:lib` |
| `server` | `scope:server`, `type:lib` |
| `ui` | `scope:client-ui`, `type:lib`, `platform:rn` |
| `apps/mobile` | `scope:app`, `platform:rn` |
| `apps/server` | `scope:app`, `platform:node` |

Allowed dependencies (excerpt):

| From → To | Allowed? |
|---|---|
| `scope:foundation` → anything | ❌ (foundation is leaf) |
| `scope:contract` → `zod` only | ✅ enforced by package.json + lint |
| `scope:canvas` → `scope:server`, `scope:client-sdk`, `scope:contract`, `scope:client-ui` | ❌ |
| `scope:server` → `scope:canvas`, `scope:client-ui` | ❌ |
| `scope:client-sdk` → `scope:server`, `scope:canvas`, `scope:client-ui` | ❌ |
| `scope:client-ui` → `scope:server` | ❌ |
| `scope:app` → any `scope:*` | ✅ |
| Anything → `scope:foundation`, `scope:contract` | ✅ |

These rules embody the architectural principles in `principles.md` ("Library independence"). Violations fail CI.

## Versioning and releases

- **Changesets** for coordinated releases inside the monorepo.
- Each package has its own semver; releases are independent.
- `core`, `canvas-core`, `mcp-tools` tend to bump together when contracts change.
- Pre-1.0: minor bumps may include breaking changes; document in CHANGELOG.
- Post-1.0: strict semver, breaking changes = major.
- Apps (`apps/mobile`, `apps/server`) are not published to npm; they have their own version (Expo `version` for store releases, `apps/server` matches `@diffusecraft/server` major).

## Testing layout (cross-cutting)

Tests live alongside the code they test:

```
libs/server/src/lib/pairing/
├── claim-flow.ts
├── claim-flow.test.ts
└── token-store.ts
```

Cross-package E2E tests (agent-driven, full stack) live in:

```
tools/e2e/
├── agent-orchestration.test.ts        # spin up server, drive via MCP client, assert outcomes
├── catalog-conformance.test.ts        # for each tool in mcp-tools, verify server has handler
└── client-compat-matrix/
    ├── claude-desktop.test.ts
    ├── codex.test.ts
    └── gemini-cli.test.ts
```

`tools/e2e/` is itself an Nx project (private, not published). Run with `nx test e2e`.

## Documentation conventions

- **Per-package README**: short, lists purpose + install + canonical usage example. Not a full API reference (that lives in TSDoc + generated site).
- **Steering docs** (`.kiro/steering/*.md`): single-screen-ideally, durable. Update when fundamentals change.
- **Spec docs** (`.kiro/specs/<feature>/*.md`): never reference current task or sprint context; specs are durable artifacts.
- **CHANGELOG.md**: per-package, Changesets-managed; user-facing language.
- **No multi-line comment blocks** in source code unless capturing a non-obvious WHY. Code comments are last resort.
- **TSDoc on all public exports of libs/**: one-line summary + `@param` + `@example` for non-trivial functions.

## Commit conventions

Conventional Commits, scoped by package or app:

```
feat(mcp-tools): add region tool schema
fix(server): handle ComfyUI disconnect during job
docs(steering): update tech.md after MeshCraft decision
chore(repo): bump nx to 19.x
```

Allowed scopes match package directories: `core`, `mcp-tools`, `canvas-core`, `canvas-skia`, `diffusion-client`, `server`, `ui`, `mobile` (for `apps/mobile`), `server-app` (for `apps/server`), `repo`, `steering`, `specs`.

Multi-package commits use `meta` scope only when truly cross-cutting; otherwise prefer one commit per scope.

## Where new things go

| New artifact | Location |
|---|---|
| New MCP tool | Schema in `libs/mcp-tools/src/tools/<tool>.ts`; handler in `libs/server/src/lib/handlers/<tool>.ts`; spec excerpt in `.kiro/specs/mcp-tool-catalog/design.md` |
| New canvas operation | `libs/canvas-core/src/lib/operations/<op>.ts` (pure logic); render in `libs/canvas-skia/src/lib/render/<op>.ts` |
| New persisted entity | Migration in `libs/server/src/lib/db/migrations/<n>-<desc>.ts`; type in `libs/core/src/lib/persistence-types.ts` |
| New Zustand slice | `libs/core/src/lib/stores/<noun>-slice.ts`; factory updated in same dir |
| New UI component | `libs/ui/src/lib/components/<Component>.tsx`; consumer in `apps/mobile/src/screens/<Screen>.tsx` |
| New feature spec | `.kiro/specs/<feature-slug>/{requirements,design,tasks}.md` |

## TBD

- **Specific Nx generators** to scaffold the patterns above — written when the corresponding pattern stabilizes (e.g., MCP tool generator after `mcp-tool-catalog` spec is approved).
- **CI provider** (GitHub Actions assumed; confirm in first CI setup PR).
- **Code coverage targets** per package — set when the first stable lib lands.
- **Storybook or equivalent** for `libs/ui` — likely yes, but not v1 priority.
