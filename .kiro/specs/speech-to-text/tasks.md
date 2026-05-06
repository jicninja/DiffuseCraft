# speech-to-text — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `mobile`, `server`, or `mcp-tools` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer.** Native bridge work is the biggest piece.

---

## Phase A — Adapter interface & SDK

- [ ] **A.1** `SttAdapter` interface + `SttSession` + types in `client-sdk`. **(S)**
- [ ] **A.2** `pickAdapter` selection logic (auto / native / server). **(S)**
- [ ] **A.3** `ServerSttAdapter` implementation: capture audio with expo-av, ship to `transcribe_audio`. **(M)**
- [ ] **A.4** Tests with mock native + server adapters. **(M)**

## Phase B — iOS native bridge

- [ ] **B.1** Expo module wrapping `SFSpeechRecognizer`. **(L)**
- [ ] **B.2** Request authorization flow + Info.plist `NSSpeechRecognitionUsageDescription`. **(S)**
- [ ] **B.3** Continuous + partial result events bridged to JS. **(M)**
- [ ] **B.4** Locale selection via init parameter. **(S)**
- [ ] **B.5** Cancel handling. **(S)**
- [ ] **B.6** Tests on simulator + device. **(M)**

## Phase C — Android native bridge

- [ ] **C.1** Expo module wrapping `SpeechRecognizer`. **(L)**
- [ ] **C.2** Permission request flow (`RECORD_AUDIO`). **(S)**
- [ ] **C.3** Partial + final results events. **(M)**
- [ ] **C.4** Locale selection. **(S)**
- [ ] **C.5** Tests on emulator. **(M)**

## Phase D — Server-side Whisper

- [ ] **D.1** Add Whisper ComfyUI custom node to `comfyui-management/required-nodes.ts` (optional; only when `whisper.enabled` config is true). **(S)**
- [ ] **D.2** Default-models registry adds `whisper-large-v3-turbo` (configurable). **(S)**
- [ ] **D.3** `WhisperTranscriber` class with warm pool + audio decode (WAV/Opus → 16k mono PCM). **(L)**
- [ ] **D.4** `buildWhisperGraph` with language, initial_prompt, temperature params. **(M)**
- [ ] **D.5** `parseWhisperOutput` extracting text, language_detected, segments. **(S)**
- [ ] **D.6** `transcribeAudioHandler` per design.md §6. **(M)**
- [ ] **D.7** Pre-warming on first call; LRU eviction. **(S)**
- [ ] **D.8** Performance benchmark: ≤1.5 s warm for 5 s audio. **(S)**
- [ ] **D.9** Tests with fixture audio files (Spanish + English + mixed + noisy). **(M)**

## Phase E — Catalog

- [ ] **E.1** Extend `transcribe_audio` schema in `@diffusecraft/mcp-tools` (audio envelope, optional language/model/initial_prompt). **(S)**
- [ ] **E.2** Output schema: `{ text, language_detected, segments? }`. **(XS)**
- [ ] **E.3** Footprint test still ≤100 KB. **(XS)**
- [ ] **E.4** `whisper_available` field added to `get_server_info` response. **(S)**

## Phase F — Tablet UX

- [ ] **F.1** `<MicButton />` component with tap + long-press handlers. **(M)**
- [ ] **F.2** `<DictationOverlay />` with waveform + partial text + cancel. **(L)**
- [ ] **F.3** `<SttSettings />` panel with mode + locale + privacy info. **(M)**
- [ ] **F.4** `<PrivacyInfoPanel />` describing data flow per mode. **(M)**
- [ ] **F.5** `sttStore` slice: mode, locale, session, partial. **(S)**
- [ ] **F.6** Mic button placement: prompt input, region prompt input, root prompt bar, brush name on import, etc. **(S)**
- [ ] **F.7** Tests: tap-continuous flow; long-press push-to-talk; cancel; native unavailable → fallback. **(M)**

## Phase G — Privacy & audit

- [ ] **G.1** Audit log records duration_ms + language_detected only (no audio bytes, no text). **(S)**
- [ ] **G.2** Server config option to opt-in to text-logging for compliance. **(S)**
- [ ] **G.3** Privacy panel content reviewed for accuracy across iOS/Android. **(S)**

## Phase H — Documentation

- [ ] **H.1** README on STT modes + tradeoffs. **(M)**
- [ ] **H.2** Operator guide: how to enable Whisper on the server, model size selection. **(M)**
- [ ] **H.3** Privacy claims documented. **(S)**

---

## Dependency order

```
A → B / C (native bridges, parallel)
A → D (server)
       \
        → E (catalog) → F (UI) → G (privacy/audit) → H (docs)
```

A foundational. B and C can be done in parallel by two devs (iOS + Android). D server-side. E/F/G/H final.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS Speech Framework deprecation in future iOS | Pin OS version target; monitor release notes; alternative path is server Whisper which we ship. |
| Android SpeechRecognizer quality varies wildly across vendors | Test matrix Pixel / Samsung / Xiaomi; document caveats; recommend server mode for Android power users. |
| Whisper model download size (~3 GB for large-v3-turbo) | D.2 makes Whisper opt-in; default-models doesn't include it unless operator enables. Whisper-small as 500 MB alternative. |
| Audio capture format mismatch between client and server (WAV vs Opus) | D.3 supports both; expo-av records WAV by default. |
| Privacy claim drift if Apple changes iOS Speech behavior | G.3 review on each iOS major release; update PrivacyInfoPanel text. |
| Non-paired audio leak through accidental third-party SDK | NFR-3 hard rule; CI grep for `fetch(...stt.googleapis...)` etc. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Both native bridges work on real devices.
3. Whisper warm-latency target met.
4. Privacy panel reviewed.
5. Risks acceptable.

After approval, implementation begins with Phase A.
