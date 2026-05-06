# speech-to-text — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `client-sdk` (adapter pattern), `comfyui-management`, `prompt-enhancement`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No auto-flap**; explicit user preference + fallback on unavailability. |
| Q2 | **fp16 default Whisper**; int8 quantized configurable. |
| Q3 | **`transcribe_audio` is `job`** uniformly. |
| Q4 | **No "translate while transcribing" in v1.** STT + `enhance_prompt` orthogonal. |
| Q5 | **Both push-to-talk (long-press) and continuous (tap)** in v1. |
| Q6 | **No audit-logging of transcript text** by default; operator opt-in. |

## 2. Module layout

```
libs/diffusion-client/src/adapters/
└── speech-to-text.ts            # SttAdapter interface

libs/server/src/lib/comfy/whisper/
├── transcribe.ts                # WhisperTranscriber (warm pool + cache patterns from selection-tools)
├── handlers/
│   └── transcribe-audio.ts
└── audio-decode.ts              # decode WAV/Opus → 16k mono PCM

libs/ui/src/stt/
├── MicButton.tsx                # mic icon button next to text inputs
├── DictationOverlay.tsx         # waveform + partial text + cancel
├── SttSettings.tsx              # mode picker (Auto / Native / Server) + locale picker
├── PrivacyInfoPanel.tsx
└── stt-store-slice.ts           # mode, locale, recording state

apps/mobile/src/native/stt/
├── ios-speech.ts                # iOS Speech Framework bridge (Expo modules or custom)
├── android-speech.ts            # Android SpeechRecognizer bridge
└── platform-stt.ts              # unified API
```

## 3. Adapter interface

```typescript
// libs/diffusion-client/src/adapters/speech-to-text.ts
export interface SttAdapter {
  /** True if OS-native STT is available on this host. */
  isAvailable(): Promise<boolean>;

  /** Request permission. Returns true if granted. */
  requestPermission(): Promise<boolean>;

  /** Start a continuous recognition session. */
  start(opts: SttStartOpts): SttSession;
}

export interface SttStartOpts {
  locale: string;                  // e.g., "es-AR", "en-US"
  continuous: boolean;             // false = stop on first silence
  partial_results: boolean;
}

export interface SttSession {
  events: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  };
  stop(): Promise<string>;          // returns final text
  cancel(): void;                   // discard
}
```

`apps/mobile` provides the platform-specific implementation via Expo modules or a small Swift/Kotlin native module.

## 4. iOS adapter (sketch)

```typescript
// apps/mobile/src/native/stt/ios-speech.ts
import { NativeModule } from "expo-modules-core";

export class IosSttAdapter implements SttAdapter {
  async isAvailable(): Promise<boolean> {
    return NativeModule.SFSpeechRecognizerSupported();
  }
  async requestPermission(): Promise<boolean> {
    return NativeModule.SFSpeechRecognizerRequestAuthorization();
  }
  start(opts): SttSession {
    const sessionId = NativeModule.SFStart(opts.locale, opts.continuous, opts.partial_results);
    // ... event subscription bridging native callbacks to JS
  }
}
```

Equivalent for Android using `SpeechRecognizer`.

## 5. Server-side Whisper

```typescript
// libs/server/src/lib/comfy/whisper/transcribe.ts
export class WhisperTranscriber {
  constructor(private comfy: ComfyClient, private warmPool: WarmPool, private config: WhisperConfig) {}

  async transcribe(audio: Uint8Array, opts: { language?: string; model?: string; initial_prompt?: string }): Promise<TranscribeResult> {
    const model = opts.model ?? this.config.default_model;
    await this.warmPool.ensureWarm(model);
    const decoded = decodeAudio(audio);   // → 16k mono PCM
    const graph = buildWhisperGraph({
      pcm: decoded,
      model,
      language: opts.language,
      initial_prompt: opts.initial_prompt,
      temperature: this.config.temperature ?? 0,
    });
    const { prompt_id } = await this.comfy.submitGraph(graph);
    const result = await waitForResult(prompt_id);
    return parseWhisperOutput(result);
  }
}
```

## 6. Handler

```typescript
// libs/server/src/lib/comfy/whisper/handlers/transcribe-audio.ts
export const transcribeAudioHandler: Handler<typeof transcribeAudio> = async (input, ctx) => {
  const audioBytes = await ctx.client.audio.fetch(input.audio);
  if (audioBytes.length > 16 * 1024 * 1024) throw new ServerError({ code: "PAYLOAD_TOO_LARGE", message: "Audio max 16 MB" });

  const job_id = await ctx.tracker.submit({
    kind: "transcribe",
    spec: { audio: audioBytes, language: input.language, model: input.model, initial_prompt: input.initial_prompt },
  }, async (signal) => {
    const result = await ctx.whisper.transcribe(audioBytes, input);
    // Audio discarded; result text returned.
    return { text: result.text, language_detected: result.language_detected, segments: result.segments };
  });
  return { job_id };
};
```

## 7. Tablet UX

### 7.1 MicButton

```typescript
// libs/ui/src/stt/MicButton.tsx
export const MicButton: React.FC<{ onText: (text: string) => void; field: string }> = ({ onText, field }) => {
  const mode = useSttStore((s) => s.mode);                    // "auto" | "native" | "server"
  const locale = useSttStore((s) => s.locale);
  const recording = useSttStore((s) => s.recording);

  const onTap = async () => {
    if (recording) {
      await stopAndCommit();
    } else {
      await startRecording();
    }
  };
  const onLongPressStart = () => startRecording({ pushToTalk: true });
  const onLongPressEnd = () => stopAndCommit();

  return (
    <Pressable onPress={onTap} onLongPressStart={onLongPressStart} onLongPressEnd={onLongPressEnd}>
      <MicIcon pulse={recording} />
    </Pressable>
  );
};

async function startRecording({ pushToTalk = false } = {}) {
  const adapter = await pickAdapter();   // native or server fallback
  if (adapter.kind === "native") {
    const session = adapter.start({ locale, continuous: !pushToTalk, partial_results: true });
    session.events.onPartial = (t) => sttStore.setPartial(t);
    session.events.onFinal = (t) => onText(t);
    sttStore.setSession(session);
  } else {
    // Server path: record audio locally with expo-av, then ship to Whisper
    sttStore.setRecording(true);
    const recorder = await startAvRecorder();
    sttStore.setRecorder(recorder);
  }
}
```

### 7.2 DictationOverlay

While recording, an overlay shows:
- Mic icon pulsing in primary color.
- Live waveform (from audio capture mean amplitude).
- Partial transcription (italic) when native; "Transcribing…" spinner when server-mode after stop.
- Cancel button (swipe-away or tap X).

### 7.3 SttSettings

```typescript
// libs/ui/src/stt/SttSettings.tsx
<SettingsSection title="Speech-to-text">
  <RadioGroup value={mode} onChange={setMode}>
    <Radio value="auto" label="Auto (recommended)" hint="Use native; fall back to server" />
    <Radio value="native" label="Device only" hint="Faster; may use Apple/Google services" />
    <Radio value="server" label="Server (Whisper)" hint="Highest quality; fully local; slower" />
  </RadioGroup>
  <LocalePicker value={locale} onChange={setLocale} />
  <PrivacyInfoLink onPress={openPrivacyPanel} />
</SettingsSection>
```

### 7.4 Privacy panel

Surfaces clearly:
- Native mode: which OS sends audio where (per-platform). E.g., "iOS may send audio to Apple's servers in non-offline mode."
- Server mode: "Audio runs locally on your paired server. Never leaves your LAN."

## 8. Adapter selection

```typescript
// libs/diffusion-client/src/stt/select-adapter.ts
async function pickAdapter(): Promise<NativeAdapter | ServerAdapter> {
  const mode = sttStore.getState().mode;
  if (mode === "server") return new ServerSttAdapter(client);
  if (mode === "native") {
    const native = platformAdapter();
    if (await native.isAvailable() && await native.requestPermission()) return native;
    throw new Error("Native STT unavailable");
  }
  // auto
  const native = platformAdapter();
  if (await native.isAvailable() && await native.requestPermission()) return native;
  if (client.capabilities.server.has_whisper) return new ServerSttAdapter(client);
  throw new Error("No STT available");
}
```

## 9. Server capability declaration

The server's `get_server_info` reports `whisper_available: bool` so the client can know whether server-side transcription is offered.

## 10. Catalog impact

**0 new tools.** `transcribe_audio` already in v1 catalog from `mcp-tool-catalog` §3.3.13. This spec extends its schema (audio envelope shape, optional `initial_prompt`, language, model) but keeps the count. Catalog stays at ~57 (cap 60).

## 11. Cross-spec touches

- **`mcp-tool-catalog`**: extend `transcribe_audio` schema per FR-8/14.
- **`comfyui-management`**: Whisper as ComfyUI custom node; required-nodes list adds Whisper if user enables; default-models adds the chosen Whisper checkpoint.
- **`prompt-enhancement`**: orthogonal; this spec doesn't touch it (P24).
- **`client-state-architecture`**: new `sttStore` slice (mode, locale, recording state).

## 12. Acceptance criteria

1. Both adapters work end-to-end on iPad + Android tablet.
2. Live partial transcription shows for native mode.
3. Whisper warm pool delivers latency budget.
4. Privacy panel accurately describes data flow per mode.
5. STT does NOT auto-call enhance_prompt anywhere.
6. Long-press push-to-talk + tap-continuous both work.
