# speech-to-text — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`transcribe_audio` already in v1 catalog), `client-sdk` (adapter interface), `comfyui-management` (Whisper as ComfyUI custom node, optional), `prompt-enhancement` (independent — P24).
> **References:** P24 (STT and prompt enhancement are independent and composable), P22 (tablet reference), P26 (client never runs models — except trivial native APIs that aren't ML inference of diffusion).

## 1. Purpose

Define **speech-to-text** for prompt input and other text fields. Two execution paths, transparent to the user:

1. **OS-native STT** (default): iOS Speech Framework, Android SpeechRecognizer. Free, multilingual, no server roundtrip, no GPU.
2. **Server-side Whisper** (optional upgrade): runs as a ComfyUI custom node. Better quality, uniform across platforms, but adds latency and consumes server resources.

STT is **independent of prompt enhancement** (P24): dictating a prompt does not auto-trigger enhancement. The user (or agent) explicitly composes the two if desired.

## 2. Stakeholders & user stories

### S1 — Illustrator dictating a quick prompt
> **Story 1.** As an illustrator on iPad, I tap the mic icon next to the prompt input. I speak: "neon city skyline at dusk in cyberpunk style". Live partial transcription appears as I speak. I tap stop; the transcription lands in the text field. I can edit, optionally tap "Enhance" to rewrite to model-ready English, then Generate.

### S2 — Illustrator without internet wanting STT to work
> **Story 2.** As an illustrator on iPadOS where iOS Speech is **on-device** in offline mode, dictation works without network. Server-side Whisper requires network; OS-native is the offline fallback by default.

### S3 — Power user wanting higher transcription accuracy
> **Story 3.** As a power user dictating long technical prompts in mixed Spanish/English, I switch to "Server transcription (Whisper)" in settings. Now mic taps send audio bytes to the server, which transcribes via Whisper-large-v3. Higher accuracy at the cost of ~1–2 s latency.

### S4 — Agent transcribing a captured audio file
> **Story 4.** As Claude Code processing a voice note file, I `transcribe_audio({ audio: <ImageEnvelope-like-but-audio> })` to get text. Server runs Whisper; returns text. Agent then composes with `enhance_prompt` if desired.

### S5 — User dictating in Spanish; UI in Spanish
> **Story 5.** As an illustrator with Spanish UI, I dictate "una mujer joven sonriendo en un campo de flores". STT transcribes in Spanish (input locale). The text lands in the prompt field as-is. To convert to English-for-the-model, I tap "Enhance" (calls `enhance_prompt` separately). Independent steps per P24.

## 3. Functional requirements (EARS)

### 3.1 Two execution paths

**FR-1 (Ubiquitous).** v1 SHALL support **two STT paths**:

| Path | Where it runs | Latency | Quality | Network needed |
|---|---|---|---|---|
| OS-native (default) | Client device (iOS Speech Framework, Android SpeechRecognizer) | <300 ms | Good | Often online; some platforms offer offline modes |
| Server-side Whisper | Server (ComfyUI custom node) | 1–3 s for short clips | Excellent | Yes (LAN to server) |

**FR-2 (Ubiquitous).** Default = OS-native. User can switch via settings.

**FR-3 (Ubiquitous).** When OS-native is unavailable on the host (Android version too old, missing permission, etc.), the tablet UI gracefully falls back to server-side Whisper if available; if neither, the mic button is disabled with a tooltip.

### 3.2 OS-native STT

**FR-4 (Ubiquitous).** iOS: uses `SFSpeechRecognizer` from `Speech` framework. Requires `NSSpeechRecognitionUsageDescription` in Info.plist. v1 supports continuous recognition (live partial results).

**FR-5 (Ubiquitous).** Android: uses `SpeechRecognizer` (Google's on-device or cloud-based per device default). Live partial results supported.

**FR-6 (Ubiquitous).** OS-native uses **device locale** by default. User can override via settings (per-session locale picker).

**FR-7 (Ubiquitous).** OS-native is **client-side only**; bytes never leave the device. No `transcribe_audio` MCP call when in OS-native mode.

### 3.3 Server-side Whisper

**FR-8 (Ubiquitous).** When server-side mode is active, the tablet sends audio (PCM 16-bit, 16 kHz, mono, max 30 s per call) to the server via `transcribe_audio({ audio: AudioEnvelope, language?: string, model?: string })`.

**FR-9 (Ubiquitous).** Audio envelope shape (analogous to `ImageEnvelope`): `{ format: "wav" | "ogg-opus", sample_rate, channels, duration_ms, inline | ref }`.

**FR-10 (Ubiquitous).** Whisper model selection: server config `comfyui.whisper.model`, default `whisper-large-v3-turbo` (good quality + acceptable speed; ~1.5x real-time on RTX 3060). Smaller models (`whisper-base`, `whisper-small`) configurable for low-VRAM hosts.

**FR-11 (Ubiquitous).** Latency budget for 5-second audio clip: ≤ 1.5 s on RTX 3060 with warm pool; ≤ 3 s cold-start.

**FR-12 (Ubiquitous).** Pre-warming: Whisper model loaded into VRAM on first transcribe call; kept warm with LRU eviction (same pattern as MobileSAM in `selection-tools`).

**FR-13 (Ubiquitous).** Optional Whisper params: `language` (auto-detect if omitted), `temperature` (default 0), `initial_prompt` (context biasing — e.g., user's recent prompts).

**FR-14 (Ubiquitous).** Returns: `{ text, language_detected, segments?: [{ start_ms, end_ms, text }] }` (segments for long clips; absent for short).

### 3.4 Independence from prompt enhancement (P24)

**FR-15 (Ubiquitous).** STT result lands as plain text in the active text field. **No automatic call to `enhance_prompt`** at any point.

**FR-16 (Ubiquitous).** The tablet's prompt input has TWO independent buttons: 🎤 mic (STT) and ✨ enhance. User chooses freely.

**FR-17 (Ubiquitous).** STT supports any text field, not just prompt: filename, search box, brush name on import, etc. (Tablet exposes mic input where text-input contexts exist; not literally everywhere, but as a generic text-input enhancement.)

### 3.5 Live partial results

**FR-18 (Event-driven).** WHEN OS-native STT recognizes partial words mid-utterance, the tablet UI SHALL update the text field live with the partial transcript shown in italic / lighter weight. On final result, the partial replaces with the committed text.

**FR-19 (Ubiquitous).** Server-side Whisper does NOT stream live partial results in v1 (Whisper requires the full clip for accurate output). UX shows a "Transcribing…" spinner.

### 3.6 MCP tool

**FR-20 (Ubiquitous).** `transcribe_audio` (already in v1 catalog) SHALL match this spec's input schema. Output: `{ text, language_detected, segments? }` per FR-14.

**FR-21 (Ubiquitous).** Tool category: `job` (long-running for >2 s clips); `read`-style for tiny clips. Use `job` uniformly per P7.

**FR-22 (Ubiquitous).** Reversibility: `transcribe_audio` is `reversible: false` (it's a read of audio data; doesn't mutate document state). Caller takes the returned text and decides what to do with it.

### 3.7 Privacy considerations

**FR-23 (Ubiquitous).** OS-native STT in some platforms (Android default, iOS without offline-only flag) **may send audio to the OS vendor's cloud**. The tablet UI surfaces this via a privacy-info panel: "Native STT on this device may use Apple/Google services. Switch to server-side Whisper for fully local."

**FR-24 (Ubiquitous).** Server-side Whisper is **fully local** (runs on user's GPU). Audio never leaves the LAN.

**FR-25 (Ubiquitous).** Audio bytes are NOT persisted by default (FR-26).

**FR-26 (Ubiquitous).** Server processes audio in memory; the result text is returned and the audio bytes are discarded immediately. Audit log records `{ token_name, operation: "transcribe_audio", duration_ms, language_detected }` — no audio content, not the resulting text.

### 3.8 Tablet UX

**FR-27 (Ubiquitous).** A 🎤 mic icon button next to every text input that supports dictation. Tap to start; tap again to stop. Long-press for hold-to-talk mode.

**FR-28 (Ubiquitous).** Visual feedback while recording:
- Pulsing mic icon + waveform / VU meter.
- Live partial text in the input field (OS-native only).
- Stop button reachable.
- Cancel gesture (swipe-away) to discard.

**FR-29 (Ubiquitous).** Permission flow: first-tap requests OS speech permission. Denied → tooltip explains; offers fallback to Whisper if available.

**FR-30 (Ubiquitous).** Settings entry: "Speech-to-text mode": Auto (default — OS-native preferred) / OS-native / Server (Whisper).

**FR-31 (Ubiquitous).** Locale picker: defaults to device locale; user can override per session ("Always recognize Spanish even on English iPad").

### 3.9 Performance

**FR-32 (Ubiquitous).** OS-native: <300 ms partial-result latency.

**FR-33 (Ubiquitous).** Server-side Whisper warm: ≤ 1.5 s for 5 s audio. Cold: ≤ 3 s.

**FR-34 (Ubiquitous).** Audio upload bandwidth: 5 s of 16 kHz mono 16-bit PCM = 160 KB; well within `max_payload_bytes` (16 MB cap from `mcp-tool-catalog` rate-limit).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Tablet bundle size impact: ≤ 200 KB (RN bridge for Speech / SpeechRecognizer adapters).

**NFR-2 (Ubiquitous).** Whisper warm pool memory: ~3 GB VRAM for `large-v3-turbo`; ~1.5 GB for `whisper-small`. Configurable.

**NFR-3 (Ubiquitous).** Audio MUST NOT be uploaded to any non-paired endpoint. The `transcribe_audio` MCP tool is the only path; no third-party cloud STT in the server.

## 5. Out of scope

- **Voice-driven canvas commands** ("Make the sky bluer") — that's natural-language commanding via agent + LLM, not STT. Handled by other paths (agents using `enhance_prompt` or directly invoking tools).
- **Dictation while painting simultaneously** — single-modal at a time in v1.
- **Multi-speaker diarization** — out of scope.
- **Custom vocabulary / phrase hints** beyond Whisper's `initial_prompt`. Post-v1.
- **Voice cloning / TTS (text-to-speech, the inverse)** — out of product scope.

## 6. Open questions

### Q1 — Should OS-native vs Server be auto-selected based on connectivity?
Auto-fallback to OS-native when server is reachable but slow.

**Recommendation:** **no auto-flap**. User's preference setting is sticky; explicit fallback only on unavailability (e.g., no permission). Stable behavior.

### Q2 — Whisper quantized vs full-precision?
`whisper-large-v3-turbo` works in fp16; quantized variants (int8) save VRAM.

**Recommendation:** **fp16 default**. int8 quantized as alt configurable. Operator can switch via config.

### Q3 — Should `transcribe_audio` be exposed as `read` or `job`?
Short clips are subsecond; long clips multi-second.

**Recommendation:** **`job` uniformly** per P7. Even short clips return a job_id; the client can wait for completion (typically very fast).

### Q4 — Should we offer "translate while transcribing" (Whisper supports it)?
Whisper can transcribe Spanish audio and output English text in one call.

**Recommendation:** **post-v1.** v1: STT output is in the input language. To translate, user runs `enhance_prompt` separately. Keeps STT and translation as orthogonal capabilities (P24 mindset).

### Q5 — Push-to-talk vs continuous dictation
Both are valid UX patterns.

**Recommendation:** **support both**. Tap mic → continuous (re-tap to stop). Long-press mic → push-to-talk (release stops). v1 ships both.

### Q6 — Audit log: should we record the resulting text?
Useful for support but privacy-sensitive.

**Recommendation:** **no, not by default.** FR-26 says audit only records duration + language. Operators can opt in via config for compliance scenarios.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized.
2. OS-native and Whisper paths both deliver text.
3. Live partial results work for OS-native; spinner for Whisper.
4. STT and `enhance_prompt` remain decoupled per P24.
5. Privacy panel surfaces clearly.
6. Performance budgets met.
7. Open questions have acceptable recommendations.
