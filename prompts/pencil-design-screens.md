You are the **ORCHESTRATOR** of a multi-agent design job. You will produce a complete `.pen` design file for the **DiffuseCraft tablet app** by coordinating one Style Scout subagent and thirteen Screen Designer subagents working in parallel. You will write almost no design content yourself — your job is to bootstrap, dispatch, and converge.

You have access to the **`pencil` MCP** (tools: `get_editor_state`, `open_document`, `get_guidelines`, `batch_get`, `batch_design`, `snapshot_layout`, `get_screenshot`, `get_variables`, `set_variables`, `find_empty_space_on_canvas`, `search_all_unique_properties`, `replace_all_matching_properties`, `export_nodes`) and to the `Agent` tool for dispatching subagents. **Never** use Read/Grep/Edit on `.pen` files — only the `pencil` MCP.

---

# WAVE 0 — Style Scout (1 subagent, must complete before Wave 1)

Dispatch ONE subagent first (you cannot start Wave 1 until it returns) using the `Agent` tool with `subagent_type: "general-purpose"`:

> **Description:** "Style scout — desktop_workshop"
>
> **Prompt:**
>
> You are the Style Scout for a multi-agent design job. Your job is to study a single design reference and return a tight style guide that other subagents will use as their bible. You will write nothing into the `.pen` file.
>
> **Step 1 — Fetch and study.** Use `WebFetch` (or your platform's equivalent) on:
>
> `https://api.anthropic.com/v1/design/h/kK5yyS270xvDoK-VG9Jc6g?open_file=ui_kits%2Fdesktop_workshop%2Findex.html`
>
> If the response references a README inside the design package, fetch and read it. Open and study `ui_kits/desktop_workshop/index.html` specifically.
>
> **Step 2 — Extract the language, NOT the screens.** Take typography rhythm, neutral palette discipline, restrained accent usage, panel/card construction, list density, border-over-shadow treatment, mono usage for technical strings, hover/active state treatment, the overall "calm instrument / workshop" tone. Do **not** describe its screens, page structures, navigation, or domain content — you are extracting a language, not a template.
>
> **Step 3 — Return a style guide** in this exact shape:
>
> ```
> ## Tone in one sentence
> <one sentence>
>
> ## Typography
> - display sizes / line heights / weights observed
> - body sizes / line heights / weights observed
> - mono usage rules
> - hierarchy ratios (e.g., display:body ≈ 2.3x)
>
> ## Color discipline
> - neutrals: number of steps, perceived hue temperature, contrast deltas
> - accent: count (1 expected), hue family, where it's used / where it's NOT used
> - semantic colors: how subdued or saturated
>
> ## Surface construction
> - how panels separate (border / bg shift / shadow / inset)
> - card radii observed
> - density (px between rows, px of card padding)
>
> ## Component shapes
> - button radii, sizes, variant count
> - input field treatment (border, fill, height)
> - tabs treatment (segmented? underlined? pill?)
> - list rows (left icon? trailing meta? divider style?)
>
> ## Don'ts
> - things desktop_workshop does that we should NOT carry over because we're tablet/touch
>
> ## Token refinements
> - propose specific overrides to the orchestrator's starting tokens to better match desktop_workshop (e.g., "shift accent hue toward indigo", "tighten radii by 2pt", "reduce text/secondary contrast")
> ```
>
> Keep the guide under 600 words. No prose outside the headings. Do not propose layouts. Do not propose screens.

When this subagent returns, **incorporate its token refinements into Wave 1's tokens** before calling `set_variables`, and **paste its full style guide verbatim** into every Wave 1 subagent prompt under the heading `## STYLE GUIDE (from Style Scout — match this)`.

---

# WAVE 1 — Bootstrap (you, sequentially, ~5 minutes)

You do this yourself. Sequential, fast.

1. `get_editor_state` — confirm pencil is open.
2. `open_document` — if no doc, create/open `DiffuseCraft Tablet — Screens v1`. If a doc is open, append a new page named `DiffuseCraft Tablet v1` (do NOT destroy prior content).
3. `get_guidelines` — read pencil idioms.
4. `set_variables` — register the design tokens below, **after applying Style Scout's refinements**:

   **Color — neutral (dark, default):**
   - `bg/canvas` `#0B0B0C`
   - `bg/surface` `#141416`
   - `bg/elevated` `#1C1C1F`
   - `bg/inset` `#0F0F11`
   - `border/subtle` `#26262B`
   - `border/strong` `#3A3A42`
   - `text/primary` `#F4F4F5`
   - `text/secondary` `#A1A1AA`
   - `text/tertiary` `#71717A`

   **Color — accent (single accent):**
   - `accent/default` `#7C5CFF`
   - `accent/hover` `#8E72FF`
   - `accent/muted` `#2A2240`

   **Color — semantic:** `danger #EF4444`, `warn #F59E0B`, `success #22C55E`, `info #0EA5E9`

   **Radii:** `xs 4`, `sm 6`, `md 10`, `lg 14`, `xl 20`, `pill 999`

   **Spacing:** 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72

   **Type (Inter / SF Pro fallback):**
   - `display/lg` 32 / 40 / 600
   - `display/md` 24 / 32 / 600
   - `title` 18 / 24 / 600
   - `body` 14 / 20 / 400
   - `body-strong` 14 / 20 / 500
   - `mono` 13 / 18 / 400
   - `caption` 12 / 16 / 400

   **Elevation:** `shadow/sheet` `0 -8 24 rgba(0,0,0,0.4)` (only for bottom sheets entering from below).

5. **Pre-allocate 13 artboards** in a 5-column grid (use `find_empty_space_on_canvas` to anchor the top-left). All artboards 1366×1024 (landscape iPad). Reserve a `Z-Components` artboard at the far right.

   | # | Artboard label |
   |---|---|
   | 1 | `01-Splash` |
   | 2 | `02-Pairing-mDNS` |
   | 3 | `02b-Pairing-QR` |
   | 4 | `02c-Pairing-Code` |
   | 5 | `02d-Pairing-Manual` |
   | 6 | `03-ServerPicker` |
   | 7 | `04-Documents` |
   | 8 | `05-Editor-Generate` (HERO) |
   | 9 | `05b-Editor-Inpaint` |
   | 10 | `05c-Editor-Live` |
   | 11 | `05d-Editor-Chat-Open` |
   | 12 | `06-Settings` |
   | 13 | `06a-Settings-Connection` |

6. Confirm to me (one short paragraph): tokens applied, artboards created, Style Guide absorbed. Then immediately dispatch Wave 2.

---

# WAVE 2 — Screen Designers (13 subagents, dispatched in ONE message)

**This is a hard requirement: dispatch all 13 subagents in a single message** (one assistant turn with thirteen `Agent` tool calls). Do NOT serialize. If you find yourself dispatching one, waiting, then dispatching another — stop and redo. Parallelism is the entire point of this wave.

Each `Agent` call uses `subagent_type: "general-purpose"` and the prompt template below, with `<ARTBOARD>`, `<SIZE>`, and `<SCREEN-BRIEF>` filled per row. Embed the **full Style Guide returned by the Style Scout** verbatim in every prompt.

### Subagent prompt template

> **Description:** "Designer — `<ARTBOARD>`"
>
> **Prompt:**
>
> You are a Screen Designer subagent in a parallel design job. You design **one** screen of the DiffuseCraft tablet app inside an existing `.pen` document. You have access to the `pencil` MCP. You may NOT write outside your assigned artboard.
>
> **Project in two sentences:** DiffuseCraft is a tablet-first, Procreate-inspired, AI-native image editor that pairs with a ComfyUI server (the tablet runs no inference). The UI must feel like a calm instrument — voice and keyboard are peers for prompting, the paired AI agent is a vendor-neutral collaborator visible in a chat panel, and the heart of the app is layers + transforms + masks + AI generation, not brush authoring.
>
> ## STYLE GUIDE (from Style Scout — match this)
>
> <PASTE STYLE SCOUT OUTPUT VERBATIM HERE>
>
> ## Your assignment
> - **Artboard:** `<ARTBOARD>`
> - **Size:** `<SIZE>` (do not modify or write outside this artboard)
> - **Brief:** `<SCREEN-BRIEF>`
>
> ## Workflow
> 1. `get_variables` — read tokens. Reference tokens by name only. **No raw hex anywhere.**
> 2. `get_guidelines` (once) — confirm pencil idioms.
> 3. `batch_design` — bulk-create the screen content inside your artboard. Use multiple batches if needed.
> 4. `get_screenshot` of your artboard — self-verify against the Style Guide.
> 5. If anything diverges (typography rhythm off, accent overused, density wrong, shadow used instead of border, hover-only affordance), fix it in-place before reporting.
>
> ## Hard rules
> - **Visual language must match the Style Guide above.** This is non-negotiable.
> - Tablet UX. No bottom tab bar, no top menu bar. Side rails / floating panels / sheets only.
> - Touch targets ≥ 44×44 pt. Stylus-friendly. Avoid hover-only affordances.
> - Single accent color (`accent/default`), used only for primary action and active state.
> - Dark theme only this pass; structure colors so a future light theme is a token swap.
> - Chrome must be expressible with `react-native-reusables` primitives: Button, Input, Textarea, Label, Slider, Switch, Checkbox, RadioGroup, Card, Separator, Badge, Avatar, Skeleton, Dialog, AlertDialog, Popover, Tooltip, Tabs, Accordion, Collapsible, Select, Combobox, ContextMenu, DropdownMenu, Progress, Toast. Custom shapes only for canvas-domain widgets (layer thumbnails, transform handles, brush dot, regions overlays).
> - Borders + bg shifts > shadows. Reserve shadow only for bottom sheets entering from below.
> - English copy with ~30% expansion room for Spanish.
> - Do NOT replicate any screen from the desktop_workshop reference — only its language.
>
> ## Reply with
> - one-paragraph summary of what you designed
> - list of rnr primitives used
> - any tokens you wished existed but didn't
> - any open questions for the orchestrator

### The 13 dispatches

Fill `<SCREEN-BRIEF>` with the matching block below. All `<SIZE>` values are `1366×1024`.

**1 — `01-Splash`**
> Branding moment on cold launch while we check for prior pairing. Centered wordmark "DiffuseCraft", small caption "Connecting to your studio…", a single indeterminate progress hairline. No buttons. Background `bg/canvas`. Quiet, confident, fast — the first 600 ms of the app.

**2 — `02-Pairing-mDNS`**
> Full-screen onboarding. Title "Find your DiffuseCraft server", subtitle "We'll look on your network". List of discovered servers (mDNS): server icon + name + IP:port + tap-to-pair affordance. Empty state: centered illustration placeholder + "No servers nearby" + 3 secondary actions (Scan QR, Enter code, Paste URL). Top-right: help (?). Bottom: tertiary `mono` line "Don't have a server yet? Run `npx @diffusecraft/server` on your PC."

**3 — `02b-Pairing-QR`**
> Full-screen camera viewfinder mock. Dark frame, centered square cutout with corner brackets, reticle in `text/primary` 60%. Brackets switch to `accent/default` only when "detecting". Top: back chevron + title "Scan the QR on your server screen". Below viewfinder: helper text "Hold steady — auto-detects". Bottom row: alt links **Use a code instead**, **Paste URL**.

**4 — `02c-Pairing-Code`**
> Full-screen. Title "Enter the 6-digit code shown on your server". Six separate digit boxes (each `lg` radius, `bg/inset`). On-screen numeric pad (3×4, keys ≥56pt). Wrong-attempt state: digit boxes shake `danger` border. Bottom secondary link **Try QR instead**.

**5 — `02d-Pairing-Manual`**
> Full-screen form. Two inputs: "Server URL" (placeholder `http://192.168.1.50:9876`) and "Pairing token" (mono, masked with eye toggle). Single primary **Pair** button. Helper text per field. Below form: collapsed "What's this?" disclosure that expands to 4 short bullets. Footer link **Back to discovery**.

**6 — `03-ServerPicker`**
> Title "Your studios". Vertical list of paired servers as cards: avatar (server initial), server name, last-connected timestamp, online/offline dot, capability chips ("ComfyUI ✓", "Models: 12"). Tap to connect. Long-press shows context menu (Rename, Revoke token, Show audit log). FAB-style **+ Pair new** bottom-right. Top-right: settings cog.

**7 — `04-Documents`**
> Tablet gallery. Top app bar: app title left, search input center, sort + view-toggle (grid/list) right, avatar far-right. Body: responsive grid of document tiles (3–4 columns landscape) — thumbnail + filename + last edit + workspace badge. Sticky **+ New** bottom-right. Empty state: large illustration placeholder + 2 CTAs (Start blank, Import image).

**8 — `05-Editor-Generate` (HERO — most important screen)**
> Convey the whole app's identity in one screen.
> - **Left rail (72pt vertical):** 5 brush presets (pen, pencil, marker, eraser, smooth), separator, selection (lasso/rect), transform, mask, eyedropper. Bottom: layers toggle, undo/redo. Active tool tile uses `accent/default` bg.
> - **Top bar (56pt):** left = back chevron + inline-editable document name + saved indicator; center = Workspace Tabs (Generate/Inpaint/Upscale/Live) as segmented rnr Tabs; right = connection chip (server name + green dot), share, more (⋯).
> - **Right panel (320pt scrollable):** sub-tabs Layers (default), History, Controls, Regions. Layers list shows thumbnail + name + visibility eye + opacity slider (long-press). Active layer has `accent/muted` bg.
> - **Bottom prompt bar (floating, max 720pt wide, 64pt tall, `lg` radius, `bg/elevated`):** large mic button left (PEER with keyboard, NOT secondary), prompt input center (placeholder "Describe what to generate…"), enhance ✨ button, primary **Generate** right (`accent/default`). Below the bar: strength slider 0–100% + tiny preset chip row.
> - **Canvas:** centered with subtle dotted boundary indicating canvas size, surrounded by `bg/canvas`. Tiny floating overlay top-right of canvas: zoom %, fit, 1:1.
>
> Must read as "Procreate met the desktop_workshop language": pen-friendly negative space, calm tool rail, single accent, prompt bar that immediately says "voice OR text, both equal."

**9 — `05b-Editor-Inpaint`**
> Same chrome as 05. Workspace="Inpaint". Canvas shows a sample selection (marching-ants rectangle). Prompt bar replaces **Generate** with primary **Fill** + sub-mode pill Tabs above it (Fill / Expand / Add / Remove / Replace bg). Right panel defaults to **Controls** showing structural control layers attached to the inpaint.

**10 — `05c-Editor-Live`**
> Same chrome. Workspace="Live". Right panel switches to **Live settings** card: "Continuous regen ON" toggle, fixed-seed lock (locked by default), latency readout in `mono` (e.g., "230 ms"). Bottom bar primary becomes **Stop Live** (`border/strong` outline + `danger` text — not full red). Floating preview thumbnail top-right of canvas shows last completed frame.

**11 — `05d-Editor-Chat-Open`**
> Same chrome as 05. Right panel area replaces its sub-tabs with a **Chat** tab as the active surface (avoid stacking 3 panels). Chat panel: agent identity row (vendor-neutral icon + agent name e.g., "Claude Code @ studio-iMac" + connection dot), message list (user bubbles right with `accent/muted` bg, agent bubbles left with `bg/elevated` bg, tool-call cards inline showing `🛠 add_layer({…})` collapsible), input at bottom (mic + textarea + send). Tool-call cards must be visually distinct — they're actions, not chat.

**12 — `06-Settings`**
> Master/detail tablet layout. Left column (320pt): list of sub-sections (Connection, Models & Presets, Agents, Speech, Appearance, Audit log, About). Right column: detail view — show **About** here (version, build, repo + license links, "Made by Suquía Bytes" footer). Top bar: back chevron + title "Settings".

**13 — `06a-Settings-Connection`**
> Right-column content of Settings. Section "Paired servers": list of cards — server name, IP:port, connected status, last activity, "⋯" menu (Rename, Revoke token, Show in audit log). Section "Pairing": single primary **Pair a new server** button. Section "This device": editable device name, public key fingerprint (mono, copyable). rnr Cards + Separators. Accent only on the "Pair a new server" button.

---

# WAVE 3 — Convergence (you, sequentially, after all 13 subagents return)

1. `search_all_unique_properties` for `fill`, `stroke`, `fontFamily`, `fontSize`, `cornerRadius`. Anything that didn't resolve to a token is a divergence.
2. For each divergence, `replace_all_matching_properties` to map to the nearest token. If no token fits, `set_variables` to add one and document why.
3. `snapshot_layout` per artboard — verify no overlapping nodes, no off-artboard content.
4. `get_screenshot` per artboard — final visual pass; flag and fix any inconsistency (different paddings, dissonant typography, accent color used for non-primary action).
5. *(Optional polish)* Populate `Z-Components` with swatch rows: Button × 4 variants, Input × 3 states, Tabs × 2, Slider, Switch, Card, Sheet, Dialog, Popover, Toast, Avatar, Badge.
6. Reply to me with: (a) artboard list + screenshot summary, (b) token coverage report, (c) divergences resolved, (d) one-sentence confirmation that the design language matches the Style Scout's guide, (e) any open design questions.

---

# Hard rules for you (the orchestrator)

- **Never** call Read or Grep on a `.pen`. Pencil MCP only.
- **Never** dispatch Wave 2 sequentially. All 13 designers go out in one message.
- **Never** start Wave 1 before the Style Scout returns.
- If a designer reports its artboard is too small, allow growth **only along the y-axis**.
- If pencil is not connected or the document fails to open, stop and ask me — do not invent a workaround.
- Communicate with me in English. Component labels in artboards are also English.

Begin now: dispatch the Style Scout.
