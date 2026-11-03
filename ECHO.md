# ECHO: phone sound labeller, technical reference

This is the reference for the **echo** frontend: the phone web app that listens through the microphone, runs YAMNet and CLAP on the device, turns the level into periods, labels each period, and produces a report. It covers the browser app, the labelling logic shared with the simulator, the static assets and models, the web server and the parts of the backend that echo uses.

The code is the source of truth. Where an earlier brief says something different, this document follows the code and says so (section 23). Constants that are placeholders or unconfirmed are marked **placeholder** or **unconfirmed**.

The simulator has its own document, [SIM.md](SIM.md). The simulator now reuses the labelling stack described here (`PeriodDetector` and `labelPeriods` from [periods.js](packages/shared/src/periods.js), via [label.js](packages/sim-core/src/label.js)). This document does not describe the simulator.

## Contents

1. [Purpose and status](#1-purpose-and-status)
2. [Code map](#2-code-map)
3. [Privacy rules](#3-privacy-rules)
4. [Pipeline overview](#4-pipeline-overview)
5. [Audio capture and the AudioWorklet](#5-audio-capture-and-the-audioworklet)
6. [YAMNet](#6-yamnet)
7. [CLAP](#7-clap)
8. [Rows, level series, notes and storage](#8-rows-level-series-notes-and-storage)
9. [Label catalogue and pools](#9-label-catalogue-and-pools)
10. [Period detection](#10-period-detection)
11. [Period labelling](#11-period-labelling)
12. [Priority by time of day](#12-priority-by-time-of-day)
13. [Settings](#13-settings)
14. [Results report and the backend](#14-results-report-and-the-backend)
15. [Live graph](#15-live-graph)
16. [Main screen, status chips and session lifecycle](#16-main-screen-status-chips-and-session-lifecycle)
17. [Sample test rig](#17-sample-test-rig)
18. [JSON export schema](#18-json-export-schema)
19. [Web server, Vite config and CSP](#19-web-server-vite-config-and-csp)
20. [Develop, test, build, deploy](#20-develop-test-build-deploy)
21. [Test protocol and earlier findings](#21-test-protocol-and-earlier-findings)
22. [Known limits](#22-known-limits)
23. [Where the code differs from the earlier briefs](#23-where-the-code-differs-from-the-earlier-briefs)
24. [Proposals not built yet](#24-proposals-not-built-yet)
25. [Unconfirmed constants and open questions](#25-unconfirmed-constants-and-open-questions)

---

## 1. Purpose and status

echo is a **test rig, not a product**. It is used to learn which labels standard sound models give for real sounds, where they are right and where they fail, and whether CLAP adds anything over YAMNet. Its output is a set of **periods** (start, end, level, label, confidence, priority) and a report that an estate manager or security lead could read.

Objectives carried over from the v2.2 brief, still valid:

1. Detect and name the sounds in the label list (section 9) at a useful level of reliability, with YAMNet and CLAP together.
2. Catch the "3am bang": a sudden, loud, unexplained impact in quiet hours, even when no label fits (rule in section 11.9).
3. Report periods with start, end, duration, level, label and confidence, so the timeline makes sense to a person.
4. Compare the models fairly: YAMNet alone, CLAP alone (10 s and 5 s windows) and both together.
5. Keep false alarms low. The number of alerts worth acting on matters more than the raw detection score.
6. Show constant loud sources (plant hum, a generator, steady traffic, amplified music) by level and duration.

App version string: `APP_VERSION = '2.2.0'` in [main.js](apps/echo/src/main.js). Export schema version `'2.2'`. Label catalogue version `'2.2'`.

Not in scope: direction finding, flight-data matching, push notifications, user accounts, model caching or service workers.

---

## 2. Code map

| File | Role |
|---|---|
| [apps/echo/index.html](apps/echo/index.html) | Main screen, live graph overlay, settings overlay, results overlay. CSP meta tag. |
| [apps/echo/src/main.js](apps/echo/src/main.js) | App controller: session state, capture start/stop, YAMNet calls, CLAP worker messages, level handling, settings UI, export, results, sample test UI. |
| [apps/echo/src/clapWorker.js](apps/echo/src/clapWorker.js) | Web Worker: CLAP audio tower. Resampling, tiling, the text-embedding check, cosine and softmax come from [packages/shared/src/clap.js](packages/shared/src/clap.js), which the simulator's runners also use. |
| [apps/echo/src/graph.js](apps/echo/src/graph.js) | `LiveGraph`: canvas level and score graphs. |
| [apps/echo/src/report.js](apps/echo/src/report.js) | `reportApp` (results report renderer), `REPORT_CSS`, `buildStandaloneHtml`. |
| [apps/echo/src/db.js](apps/echo/src/db.js) | `SessionStore`: IndexedDB persistence of rows and session state. |
| [apps/echo/src/sample-test.js](apps/echo/src/sample-test.js) | Sample test: clip preparation, mono normalisation, per-clip scoring. |
| [apps/echo/src/style.css](apps/echo/src/style.css) | App styles, light/dark tokens. |
| [apps/echo/server.js](apps/echo/server.js) | Production entry: `startFrontendServer({ name: 'echo', distDir })`. |
| [apps/echo/vite.config.js](apps/echo/vite.config.js) | `frontendConfig({ port: 5173 })`. |
| [apps/echo/test/sample-test.test.js](apps/echo/test/sample-test.test.js) | Node tests: fixtures, CSP, sample scoring, worklet. |
| [packages/shared/src/catalogue.js](packages/shared/src/catalogue.js) | Catalogue builder, pools, prompt hash, priority lookup, time-of-day bucket. |
| [packages/shared/src/periods.js](packages/shared/src/periods.js) | `PeriodDetector` (level to periods) and `labelPeriods` (readings to labels and rules). |
| [packages/shared/src/report-core.js](packages/shared/src/report-core.js) | `buildReportRequest`, `fallbackReport`, `validateReport`. |
| [packages/shared/src/settings.js](packages/shared/src/settings.js) | `DEFAULTS`, settings screen `GROUPS`, `clapHopS`, load/save. |
| [packages/assets/public/config/labels.json](packages/assets/public/config/labels.json) | Families, groups, CLAP classes and prompts, YAMNet mapping. |
| [packages/assets/public/config/priorities.json](packages/assets/public/config/priorities.json) | Priority table by time of day, sustained settings. |
| [packages/assets/public/config/clap_text_embeddings.json](packages/assets/public/config/clap_text_embeddings.json) | Precomputed CLAP text embeddings (generated). |
| [packages/assets/public/worklet/capture-processor.js](packages/assets/public/worklet/capture-processor.js) | AudioWorklet: rolling buffers, level blocks, YAMNet and CLAP windows. |
| [packages/assets/public/model/](packages/assets/public/model/) | `yamnet.tflite` (4,126,810 bytes) and `yamnet_class_map.csv`. |
| [packages/assets/public/models/Xenova/clap-htsat-unfused/](packages/assets/public/models/Xenova/clap-htsat-unfused/) | CLAP `config.json`, `preprocessor_config.json`, `onnx/audio_model_quantized.onnx` (34,301,667 bytes). |
| [packages/assets/public/wasm/](packages/assets/public/wasm/) | MediaPipe audio WASM runtime (copied from `node_modules`). |
| [packages/assets/public/ort/](packages/assets/public/ort/) | ONNX Runtime WASM files (copied from `node_modules`). |
| [packages/assets/public/test-audio/](packages/assets/public/test-audio/) | ESC-50 sample clips, `manifest.json`, `esc50.csv`, `LICENSE.esc50`. |
| [packages/assets/scripts/](packages/assets/scripts/) | `clap-embed.mjs`, `fetch-models.mjs`, `copy-wasm.mjs`, `fetch-test-audio.mjs`. |
| [packages/web-server/src/vite.js](packages/web-server/src/vite.js) | Shared Vite config: `publicDir`, CSP header, `/api` proxy. |
| [packages/web-server/src/server.js](packages/web-server/src/server.js) | Production static server and `/api` proxy. |
| [apps/backend/src/app.js](apps/backend/src/app.js) | Backend API, including `POST /api/report` and `/healthz`. |
| [apps/backend/src/gemini.js](apps/backend/src/gemini.js) | Gemini REST call, system instruction, response schema. |

Pinned dependencies: `@mediapipe/tasks-audio` `1.1.0` (exact), `@xenova/transformers` `^2.17.2` (2.17.2 installed), `vite` `^5.4.11`, `express` `^4.22.3`. Node `>=20`.

---

## 3. Privacy rules

These are acceptance criteria, carried over from all briefs and the labelling proposal, stated against what the code does.

1. **Audio never leaves the device.** No uploads, no streaming. Nothing derived from audio in raw form leaves the device either: no spectrograms, no audio samples, no **embeddings**. An embedding is not playable audio, but it still carries information about the sound and in some models can reveal things such as who is speaking. A data protection officer should be asked before any embedding is stored or sent.
   - In code: the CLAP worker computes the audio embedding, uses it for cosine scores, and returns only `{ id, family, cosine, softmax }` per class ([clapWorker.js](apps/echo/src/clapWorker.js)). The embedding never leaves the worker and is never stored.
2. **Audio is never stored.** Only in-memory rolling buffers in the worklet: the YAMNet window (0.975 s), the CLAP window (5 s or 10 s) and a 100 ms level block. No `MediaRecorder`, no saved blobs. Sample-test clips (including user-selected files) are decoded in memory only.
3. **What may leave the device**, in one request, to our own backend, only when the user taps **View results**: the trimmed request built by `buildReportRequest` (section 14.1). It contains session meta (without the device string), a settings summary, the labelled periods (labels, pooled per-period scores, levels, rule flags), the 1 Hz level series, the user's notes and the label catalogue. It does **not** contain rows (per-window scores), audio or embeddings. The backend forwards it to Gemini (Google), a third party.
   - If the user has typed a session label, location text, latitude or longitude, those are in `meta` and are sent.
   - Sample-test reports are built locally and never call the API.
4. **The backend does not store or log request or response bodies.** Errors log only status codes and error names ([app.js](apps/backend/src/app.js), [gemini.js](apps/backend/src/gemini.js), [server.js](packages/web-server/src/server.js)).
5. **No analytics or third-party trackers.** The page and all servers send `Content-Security-Policy: connect-src 'self' blob:` (section 19.3). This also blocks MediaPipe 1.1.0's periodic telemetry to `odml.pa.googleapis.com`; the library has no public opt-out. CSP refusal messages may appear in the console, but no request is sent.
6. **Transparency.** Settings > Advanced > **Preview what will be sent** shows the exact JSON and its byte size before anything is posted. The main screen shows "Audio stays on this device. Only labels and levels are used."
7. **Local files.** **Download JSON** writes a file on the device that does contain the per-window rows (section 18). It stays on the device unless the user shares it.
8. The privacy review for the distress labels (scream, distress_call) is still outstanding and should happen before any pilot.

---

## 4. Pipeline overview

```
browser (static app, same origin only)
  mic (getUserMedia, processing off) or sample track (AudioBufferSourceNode)
    -> AudioContext at the device's native rate (usually 48 kHz)
    -> AudioWorklet "capture-processor"
         -> level block every 100 ms (RMS dBFS, peak dBFS) --> PeriodDetector (main thread)
         -> YAMNet window 0.975 s, resampled to 16 kHz, every yamnet_hop_s
               --> MediaPipe AudioClassifier (main thread, WASM) --> row (model "yamnet")
         -> CLAP window 10 s or 5 s at native rate, every clapHopS
               --> clapWorker (Web Worker, transformers.js, ONNX WASM) --> row (model "clap")
  rows + raw periods + notes + level series --> IndexedDB
  at export / View results / sample UI refresh:
    labelPeriods(raw periods, rows, notes, settings, catalogue)  (deterministic, no AI)
      --> labelled periods
      --> buildReportRequest --> POST /api/report
                                   frontend server --proxy--> backend --> Gemini
                                   <-- validated report or deterministic fallback
      --> reportApp (results overlay) / buildStandaloneHtml (download)
```

Two points to keep in mind throughout:

- **Detection is online, labelling is offline.** Periods are fixed when they close, using the settings at that moment. Labels are recomputed from all stored rows **every time** the export, the results or the sample UI needs them, using the settings at that moment. Changing a labelling setting (for example `yamnet_min`) relabels the whole session retroactively; changing a detection setting affects only periods detected afterwards.
- **Clock.** Every timestamp (level blocks, YAMNet rows, CLAP send time, notes) is `Date.now()` on the main thread when the message is handled, not the audio clock.

---

## 5. Audio capture and the AudioWorklet

### 5.1 Starting capture ([main.js](apps/echo/src/main.js) `start`)

1. At least one model must be enabled, or start fails with "Enable at least one model in Settings."
2. `new AudioContext()` at the **default (native) rate**, then `ctx.resume()`. The context is not created at 16 kHz; YAMNet audio is resampled in the worklet and CLAP audio in the worker. `ctx.sampleRate` is stored as `meta.sample_rate_hz`.
3. Microphone mode: `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`. The phone's processing is turned off because it distorts labels. Start is triggered by a button tap (iOS needs a user gesture). Microphone access needs a secure context (HTTPS, or `localhost`).
4. `ctx.audioWorklet.addModule('/worklet/capture-processor.js')`.
5. Models load (YAMNet once per page, CLAP worker once per page). In microphone mode a model that fails to load is shown as stopped and the session continues with the other one. In sample mode a load failure aborts the start.
6. An `AudioWorkletNode('capture-processor')` is created with these `processorOptions` (r = `ctx.sampleRate`):

| Option | Value |
|---|---|
| `nativeRate` | r |
| `yamnetWindowSamples` | `round(yamnet_window_s * r)` (46,800 at 48 kHz) |
| `yamnetHopSamples` | `round(yamnet_hop_s * r)` (24,000 at 48 kHz, default) |
| `yamnetTargetRate` | 16,000 |
| `yamnetTargetLength` | `round(yamnet_window_s * 16000)` = 15,600 |
| `clapWindowSamples` | `round(clap_window_s * r)` (480,000 or 240,000 at 48 kHz) |
| `clapHopSamples` | `round(clapHopS(settings) * r)` |
| `levelBlockSamples` | `round(0.1 * r)` (4,800 at 48 kHz) |

7. Graph: `source -> node -> gain(0) -> destination`. The zero-gain node keeps the worklet pulled without playing the mic. In sample mode the source is also connected directly to the destination, so the clips are audible.
8. `detector.reset()` clears the level history, so every Start has a fresh 2 s floor warm-up.

Window and hop settings are read at Start. Changing `yamnet_enabled`, `clap_enabled`, `clap_window_s`, `clap_hop_s` or `yamnet_hop_s` while running shows "Model changes take effect at the next Start." `clap_logit_scale` is sent with every CLAP request and takes effect on the next run.

### 5.2 Worklet buffers ([capture-processor.js](packages/assets/public/worklet/capture-processor.js))

Only channel 0 of input 0 is read. For each input sample the processor writes into three buffers:

- **YAMNet ring buffer** of `yamnetWindowSamples`. A counter `yamnetSinceHop` increments per sample. When `yamnetSinceHop >= yamnetHopSamples` and the buffer has been filled once, the counter resets and a window is emitted: the ring is unrolled into time order and, if `nativeRate != 16000`, linearly resampled to exactly `yamnetTargetLength` samples. The first window is emitted after `max(window, hop)` samples, so after 0.975 s with the defaults, then every hop.
- **CLAP ring buffer** of `clapWindowSamples`, same logic with `clapHopSamples`. The window is emitted **at the native rate** with `nativeRate` attached. First emission after one full window (10 s or 5 s), then every hop.
- **Level block** of `levelBlockSamples`. When full, it emits `{ type: 'level', rmsDbfs, peakDbfs }` and restarts.

All emitted arrays are transferred (zero copy) to the main thread. Nothing is kept beyond the ring buffers.

### 5.3 Level math

For a block of N samples x_i (N = 0.1 s of audio):

```
rms      = sqrt( (1/N) * sum_i x_i^2 )
rms_dbfs = 20 * log10(rms)          (-Infinity if rms = 0)
peak_dbfs = 20 * log10(max_i |x_i|) (-Infinity if peak = 0)
```

These are **relative, uncalibrated** levels in dBFS (0 dBFS = full scale). Phone microphones have unknown gain and frequency response, so they must not be read as dB SPL or dB(A).

The main thread (`onLevel`) pushes each block to the detector, the graph and the meter. The meter maps `rms_dbfs` from -90..0 to 0..100 % width. A 1 Hz series is built for the export: per wall-clock second,

```
level_series.rms_dbfs  = 10 * log10( mean_k 10^(rms_k/10) )   (power mean over the blocks in that second;
                                                                -Infinity blocks add 0 power but count in n;
                                                                null if the second had no power at all)
level_series.peak_dbfs = max_k peak_k
```

rounded to 0.1 dB, stored as `{ t, rms_dbfs, peak_dbfs }` with `t` the start of the second (ISO UTC).

### 5.4 Linear resampling (worklet and worker use the same formula)

```
dstLength = given (worklet) or round(srcLength * dstRate / srcRate) (worker)
ratio     = srcRate / dstRate
for i in 0..dstLength-1:
  pos  = i * ratio;  k = floor(pos);  f = pos - k
  s0 = x[k] (0 if out of range);  s1 = x[k+1] if k+1 < srcLength else s0
  y[i] = s0 + (s1 - s0) * f
```

There is **no anti-alias low-pass filter**. From 48 kHz to 16 kHz the ratio is exactly 3, so `f = 0` and the YAMNet input is plain decimation (`y[i] = x[3i]`): content above 8 kHz aliases into the YAMNet band. Whether this hurts YAMNet's labels has not been measured.

---

## 6. YAMNet

- Model: Google YAMNet, trained on AudioSet, 521 classes, `yamnet.tflite` (float32), originally published at `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`, self-hosted at `/model/yamnet.tflite`. Class names in `/model/yamnet_class_map.csv` (`index,mid,display_name`), the public class map from the TensorFlow models repo (`research/audioset/yamnet/`).
- Runtime: MediaPipe Audio Classifier (`@mediapipe/tasks-audio` 1.1.0) on WASM, runtime files self-hosted at `/wasm` ([main.js](apps/echo/src/main.js) `loadYamnet`):
  ```js
  const fileset = await FilesetResolver.forAudioTasks('/wasm');
  AudioClassifier.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/model/yamnet.tflite' }, maxResults: -1 });
  ```
  `maxResults: -1` returns all 521 class scores. No score threshold is set.
- Input: 15,600 samples at 16 kHz (0.975 s), the model's fixed window. `yamnet_window_s` is read-only in settings. Hop `yamnet_hop_s` (default 0.5 s), so windows overlap by about half.
- Call: `yamnetClassifier.classify(samples, 16000)` runs **synchronously on the main thread** in the worklet message handler. Its duration is logged as `infer_ms` (median about 12 ms in the October tests).
- Scores are independent per class (not a softmax over classes), so parent and child classes fire together (for example Aircraft and Fixed-wing aircraft). This also means YAMNet copes with overlapping sounds better than CLAP by design.
- The row's `window_s` is `settings.yamnet_window_s` (0.975). The row covers `[timestamp - 0.975 s, timestamp]`.
- Each run: categories are sorted by score; `scores_json` keeps every class with score >= 0.001, rounded to 4 decimal places, keyed by display name (`categoryName`, else `displayName`). The top 5 go into `top1_label..top5_score`. `top1_family` is the mapped family of the top label (section 9.4), else `'other'`. The graph receives every class with score >= 0.01.

Known YAMNet behaviour from the tests (be aware, do not "fix" in code): a rail-bridge rumble produced false Explosion/Eruption/Fireworks for about 30 s; planes were weak (Aircraft 0.15 to 0.26) or labelled Breathing/Snort; wind dominates outdoors (about 137 of 278 windows on the first walk). YAMNet has no class for planes in some conditions, exhaust crackle, PA announcements or bin lorries.

---

## 7. CLAP

### 7.1 Model and runtime

- Checkpoint: `Xenova/clap-htsat-unfused` (ONNX conversion of `laion/clap-htsat-unfused`, per its `config.json`), via transformers.js 2.17.2. Only the **audio tower** runs in the browser: `ClapAudioModelWithProjection` with `onnx/audio_model_quantized.onnx` (34.3 MB, quantised). The text tower is never loaded on the phone; text embeddings are precomputed (section 7.4). The script comment puts the text tower at 126 MB (not re-measured).
- Files are self-hosted under `/models/Xenova/clap-htsat-unfused/`. Worker environment ([clapWorker.js](apps/echo/src/clapWorker.js)):
  ```js
  env.allowRemoteModels = false;  env.allowLocalModels = true;  env.localModelPath = '/models/';
  env.backends.onnx.wasm.wasmPaths = '/ort/';  env.backends.onnx.wasm.numThreads = 1;
  ```
  ONNX Runtime runs on WASM with one thread. WebGPU is not used.
- Runs in a module Web Worker, created on the first Start with CLAP enabled.
- `fetch-models.mjs` downloads `config.json`, `preprocessor_config.json` and `onnx/audio_model_quantized.onnx` from Hugging Face at revision `main` (not pinned to a commit) and skips files that already exist. The files are also checked into the repository.

### 7.2 Worker initialisation

The main thread posts `{ type: 'init', classMeta: [{id, family}], embeddingsUrl: '/config/clap_text_embeddings.json', promptsHash }`. The worker:

1. Fetches the text embeddings. Fails if missing.
2. Checks `emb.prompts_hash === promptsHash(labels.json)`. If not equal: error "text embeddings are out of date; run "npm run clap:embed"". This stops prompts and embeddings drifting apart.
3. Builds one `Float32Array` embedding per class in catalogue order. Fails if any class has no embedding.
4. Loads `AutoProcessor` and `ClapAudioModelWithProjection` (download progress is shown as "Loading CLAP: n%").
5. Replies `{ type: 'ready', padMode: 'repeat' }`. The main thread stores `padMode` as `meta.clap_short_window`.

### 7.3 Per-window math

The main thread posts `{ type: 'classify', requestId, audio, nativeRate, timestamp, windowS, logitScale }`. `timestamp` is the send time, which is the end of the window, so a CLAP reading at time t covers `[t - W, t]` with W = `window_s`. This lag (up to one window) matters for period labelling.

Steps, with x the native-rate window of N samples:

1. **Resample to 48 kHz** (section 5.4): `y = resampleLinear(x, nativeRate, 48000)`, length `L = round(N * 48000 / nativeRate)`. No-op at 48 kHz.
2. **Fit to the fixed 10 s input** (`MODEL_INPUT_SAMPLES = 480000`):
   ```
   if L >= 480000:  z = last 480000 samples of y
   else:            z[j] = y[j mod L]  for j = 0..479999      (tiling / repeat, not zero padding)
   ```
   A 5 s window at 48 kHz is exactly two copies of itself. This is what `padMode: 'repeat'` records.
3. **Features**: `processor(z)` (transformers.js `ClapFeatureExtractor`, configured by [preprocessor_config.json](packages/assets/public/models/Xenova/clap-htsat-unfused/preprocessor_config.json): `sampling_rate` 48000, `feature_size` 64 mel bins, `n_fft`/`fft_window_size` 1024, `hop_length` 480, `frequency_min` 50 Hz, `frequency_max` 14000 Hz, `nb_max_samples` 480000, `nb_max_frames` 1000, `padding` "repeatpad", `truncation` "rand_trunc"). Because z is always exactly 480,000 samples, the extractor's own padding and random truncation never come into play. The extractor's internal steps are transformers.js's and are not reimplemented here.
4. **Audio embedding**: `audio_embeds = audioModel(inputs).audio_embeds`, a 512-dimensional vector a.
5. **L2 normalisation**: `â = a / ||a||` (`||a||` replaced by 1 if zero).
6. **Cosine** against each class text embedding t_k (unit length, see 7.4):
   ```
   s_k = sum_d â_d * t_k,d
   ```
7. **Softmax with logit scale** λ = `logitScale` (from `settings.clap_logit_scale`, default 18.66; the worker falls back to `exp(2.9264452)` if the value is missing or not positive):
   ```
   z_k = λ * s_k
   p_k = exp(z_k - max_j z_j) / sum_j exp(z_j - max_j z_j)
   ```
   across **all 81 classes**, including context and confuser classes. This is deliberate: probability can go to "wind", "footsteps" or "quiet room" instead of being forced onto the nearest relevant class. With 81 classes a uniform output is 1/81 = 0.0123.
8. Reply `{ type: 'result', requestId, scores: [{id, family, cosine, softmax}], timestamp, windowS, inferMs, logitScale }`.

**Logit scale (unconfirmed).** 18.66 = exp(2.9264452). The source of 2.9264452 is not confirmed; it is not in the shipped `config.json`, which only has `logit_scale_init_value: 14.2857` (= 1/0.07, an initial value, not the trained one). The v2.2 brief guessed "about 100"; the code does not use that. Higher λ gives more peaked scores. Cosine values are logged so softmax can be recomputed offline at any scale. Tune on real clips.

The main thread checks `|sum_k p_k - 1| <= 0.001` on each result and logs an error otherwise. Softmax and cosine must differ; both are logged.

### 7.4 Text embeddings ([clap-embed.mjs](packages/assets/scripts/clap-embed.mjs))

Run with `npm run clap:embed -w @echo/assets` after editing prompts or the template in `labels.json`. For each class with prompts P_1..P_m:

```
text_j = clap_template.replace('{phrase}', P_j)      template: "This is a sound of {phrase}"
e_j    = ClapTextModelWithProjection(tokenizer(text_j)).text_embeds      (512-d)
t      = normalize( (1/m) * sum_j normalize(e_j) )
stored = round(t_d * 1e6) / 1e6
```

Output JSON: `{ model, template, prompts_hash, dim: 512, classes: [{id, embedding}] }`. The current file has 81 classes and `prompts_hash` `62a8b04a`, which matches the current `labels.json`. Rounding to 6 decimals means `||t||` is 1 only to about 1e-6.

`promptsHash(labels)` ([catalogue.js](packages/shared/src/catalogue.js)) is 32-bit FNV-1a over `JSON.stringify([clap_template, classes.map(c => [c.id, c.prompts])])` (offset `0x811c9dc5`, prime `0x01000193`), as 8 hex digits. Changing a class id, its prompts or the template changes the hash; changing families, groups, roles or the YAMNet map does not.

Prompt guidance carried over from the briefs: one concrete sound per phrase, no abstract words, 2 to 5 phrases per class. If a sound repeatedly lands on the wrong class, add a context or confuser class for what it really was rather than deleting the wrong class. Do not remove context or confuser classes to "reduce noise"; they are what lets probability go somewhere sensible.

### 7.5 Scheduling, skips and errors

- Hop: `clapHopS(s) = s.clap_window_s === 5 ? 1.25 : s.clap_hop_s`. The 5 s window always hops 1.25 s.
- **Never overlap runs, never queue.** The main thread sends a window only when `clapBusy` is false; the worker also refuses with `{ type: 'skipped' }` if a run is in progress. A skipped tick is dropped. On a slow phone the effective rate is therefore one run per inference time, not one per hop.
- A 5 s window costs the same per run as a 10 s window, because both run on a 10 s input.
- Results from a previous session (after New session) are discarded by comparing the session id.
- Worker errors, uncaught exceptions and rejections are posted as `{ type: 'error' }`; the main thread sets CLAP to "stopped: reason" and writes the error to `errors`.
- Stall watchdog (main thread, every 0.5 s): if CLAP is `ok` and no result has arrived for `max(30 s, 8 * clapHopS)` (measured from the last result, or from `start + clap_window_s` before the first), CLAP is marked stopped with "stalled (no run in n s)".
- Measured speed in the October tests: about 1 s per run on an iPhone 13 Pro. At a 1.25 s hop it is near the phone's limit.

Each result becomes a row: `scores_json = { classId: { softmax, cosine } }` for **all** classes, rounded to 4 decimal places; top 5 by softmax; `top1_family` from the class family; `clap_logit_scale` = the λ used. The graph receives all classes.

---

## 8. Rows, level series, notes and storage

### 8.1 Row fields (one per model run)

| Field | YAMNet | CLAP |
|---|---|---|
| `timestamp` | ISO UTC, ms, time the window arrived (end of window) | ISO UTC, ms, time the window was sent (end of window) |
| `session_id`, `device` | session id, `navigator.userAgent` | same |
| `model` | `"yamnet"` | `"clap"` |
| `window_s` | 0.975 | 10 or 5 (the real audio window) |
| `infer_ms` | classify time | worker time |
| `clap_logit_scale` | absent | λ used |
| `rms_dbfs`, `peak_dbfs` | last 100 ms level block when the row was made, 0.1 dB | same |
| `top1_label`..`top5_label`, `top1_score`..`top5_score` | raw top 5 (display names), 4 dp | raw top 5 (class ids, softmax), 4 dp |
| `top1_family` | mapped family or `other` | class family |
| `scores_json` | `{ displayName: score }`, scores >= 0.001 | `{ classId: { softmax, cosine } }`, all classes |
| `note` | always `""` | always `""` |

`top*_label` is always the raw model label. "Unknown" is never written or shown.

### 8.2 Notes (clip tags)

The **Clip tag** button opens presets (`siren`, `train`, `plane`, `car revving`, `bang`, `music`, `other`) and a free-text box (max 200 characters, trimmed). Each tag is stored as `{ timestamp, text }` in `session.notes`. Notes are the ground truth for scoring. A period lists the notes with `timestamp` in `[start - 5 s, end + 2 s]` as `notes_in_period`.

### 8.3 Session state

`session = { meta, level_series, raw_periods, notes, errors, report, report_key, elapsed_ms, sample_test? }`. `meta` starts as `{ session_id (UUID), started_at, ended_at, tz_name, tz_offset_min, device, app_version }` and gains `sample_rate_hz`, `clap_short_window` and, for sample runs, `source: 'sample'`. `errors` entries are `{ timestamp, source, message }` with source `yamnet`, `clap`, `capture` or `sample`.

### 8.4 Persistence ([db.js](apps/echo/src/db.js))

- IndexedDB database `echo-sessions`, version 2, stores `rows` (auto-increment key) and `state` (key `current`). An upgrade deletes all existing stores. Rows are added one by one as they arrive. The state (everything except rows) is saved 1 s after any change (debounced), and every 10 level-series entries.
- Sample tests use a separate database, `echo-sample-tests`, cleared at the start of each sample run.
- On page load the saved state and rows are restored, so a refresh does not lose the session. The detector continues numbering periods after the restored ones.
- Settings are in `localStorage` under `echo-settings-v2.2`. Only keys present in `DEFAULTS` are read back.
- Nothing in IndexedDB or localStorage leaves the device.

---

## 9. Label catalogue and pools

### 9.1 Structure of labels.json

- `version`: `"2.2"`. `clap_template`: `"This is a sound of {phrase}"`.
- `families` (13): id to `{ name, color, default_label }`. Colours follow the Okabe-Ito palette where possible.
- `groups` (6): risk groups that cut across families, id to `{ default_label, corroboration? }`.
- `classes` (81): `{ id, family, group?, role, prompts[] }`. Role is `target` (a sound we want to report), `confuser` (a lookalike that gives confusable sounds somewhere to go; "decoy" in the code comments) or `context` (background; reported as an event only through the context-label rule, section 11.10).
- `yamnet` (137 entries): `{ index, name, family, group?, label, weight? }`. `name` is the YAMNet display name (verified against `yamnet_class_map.csv`), `label` the app class it maps to (or `null` for "family only"), `weight` an optional multiplier (default 1). A YAMNet class not listed has family `other` and is logged only.

Three levels are always kept in the data: `label` (specific, for example `siren_police`), `family`, and `raw_label` (YAMNet's display name or CLAP's class id).

| Family | Name | Default label |
|---|---|---|
| `gunshots_blasts` | Gunshots and blasts | explosion |
| `impacts_breakage` | Impacts and breakage | heavy_thud |
| `voices_crowds` | Voices and crowds | shouting |
| `alarms_signals` | Alarms and signals | intruder_alarm |
| `sirens` | Sirens | siren_generic |
| `road_vehicles` | Road vehicles | car_passing |
| `aircraft` | Aircraft | plane_flyover |
| `rail_water` | Rail and water | train_passing |
| `music_amplified` | Amplified music | music_loud |
| `works_construction` | Works and construction | drill_saw |
| `plant_services` | Plant and services | hvac_hum |
| `animals` | Animals | dog_barking |
| `context` | Context | street_background |

| Group | Default label | YAMNet corroboration (pooled max >= min) |
|---|---|---|
| `GUN` | explosion | Gunshot, gunfire >= 0.2 |
| `GLASS` | glass_break | Glass >= 0.4; Shatter >= 0.4; Breaking >= 0.4 |
| `DISTRESS` | scream | Screaming >= 0.2 |
| `VEHICLE_INCIDENT` | vehicle_collision | none |
| `FORCED_ENTRY` | forced_entry | none |
| `ALARM` | intruder_alarm | none |

### 9.2 Pools

All scores are pooled and compared **per pool**, not per family ([catalogue.js](packages/shared/src/catalogue.js) `buildCatalogue`):

```
classPool(class)   = class.group || class.family
yamnetPool(entry)  = entry.group || classPool(entry.label) || entry.family
```

`cat.pools = { ...families, ...groups }`, so a pool's default label is the group's when the pool is a group. The `family_scores` fields in the period output are keyed by pool. The resulting pools (confusers marked "conf."):

| Pool | CLAP classes | YAMNet labels (mapped label, weight) |
|---|---|---|
| `GUN` | gunshot, explosion, fireworks_bang (conf.), fireworks_crackle (conf.), vehicle_backfire (conf.), thunder (conf.) | Gunshot, gunfire / Machine gun / Fusillade / Artillery fire -> gunshot; Cap gun -> fireworks_crackle; Explosion -> explosion; Fireworks -> fireworks_bang; Firecracker -> fireworks_crackle; Burst, pop; Eruption; Boom; Bang; Crack (no label); Thunder / Thunderstorm -> thunder |
| `GLASS` | glass_break, bottle_bank (conf.), bottle_smash (conf.) | Glass -> glass_break (x0.6); Shatter -> glass_break; Breaking -> glass_break (x0.5); Chink, clink -> bottle_bank |
| `FORCED_ENTRY` | door_slam, forced_entry | Slam -> door_slam |
| `impacts_breakage` | metal_bang, heavy_thud, crash | Smash, crash -> crash; Thump, thud -> heavy_thud; Clang -> metal_bang; Knock; Clatter; Door; Wood (no label) |
| `VEHICLE_INCIDENT` | vehicle_collision, tyre_screech | Tire squeal / Skidding -> tyre_screech |
| `DISTRESS` | scream, distress_call, fox_scream (conf.) | Screaming -> scream |
| `voices_crowds` | shouting, argument, crowd_rowdy, chanting_singing | Shout / Yell / Bellow -> shouting; Whoop / Cheering -> crowd_rowdy; Chant / Singing -> chanting_singing |
| `ALARM` | fire_alarm, intruder_alarm, car_alarm, personal_alarm | Alarm (no label); Fire alarm / Smoke detector, smoke alarm -> fire_alarm; Car alarm -> car_alarm |
| `alarms_signals` | reversing_beeps, car_horn, pa_announcement | Vehicle horn, car horn, honking / Air horn, truck horn -> car_horn; Reversing beeps -> reversing_beeps; Buzzer; Beep, bleep; Foghorn (no label) |
| `sirens` | siren_police, siren_ambulance, siren_fire, siren_generic | Siren / Emergency vehicle / Civil defense siren -> siren_generic; Police car (siren) -> siren_police; Ambulance (siren) -> siren_ambulance; Fire engine, fire truck (siren) -> siren_fire |
| `road_vehicles` | engine_revving, exhaust_crackle, motorcycle, scooter_ebike, car_passing, vehicle_idling | Car passing by -> car_passing; Idling -> vehicle_idling; Accelerating, revving, vroom -> engine_revving; Motorcycle -> motorcycle; Vehicle; Car; Motor vehicle (road); Engine; Light/Medium/Heavy engine; Engine knocking; Engine starting; Truck; Bus; Air brake (no label) |
| `aircraft` | plane_flyover, plane_landing_takeoff, helicopter, drone | Aircraft / Fixed-wing aircraft, airplane / Aircraft engine / Jet engine / Propeller, airscrew -> plane_flyover; Helicopter -> helicopter |
| `rail_water` | train_passing, train_on_bridge (conf., no group), light_rail, boat_horn | Train / Rail transport / Railroad car, train wagon / Train horn -> train_passing; Subway, metro, underground -> light_rail; Boat, Water vehicle; Motorboat, speedboat; Ship (no label) |
| `music_amplified` | music_loud, music_bass, music_street, music_distant, car_stereo, party_noise | Music / Techno / Dance music / Electronic music / Hip hop music / Pop music -> music_loud; Bass drum / Dubstep -> music_bass; Drum; Drum machine (no label) |
| `works_construction` | jackhammer, drill_saw, angle_grinder, hammering_piling, scaffold_clatter, pressure_washer, leaf_blower | Jackhammer -> jackhammer; Drill / Power tool / Sawing -> drill_saw; Hammer -> hammering_piling; Chainsaw; Lawn mower; Sanding; Tools (no label) |
| `plant_services` | hvac_hum, generator, bin_lorry, roller_shutter, delivery_trolley | Mechanical fan / Air conditioning -> hvac_hum; Hum -> hvac_hum (x0.5); Pump (liquid); Rumble; Whir; Vacuum cleaner (no label) |
| `animals` | dog_barking | Dog / Bark / Howl / Growling -> dog_barking; Domestic animals, pets (no label) |
| `context` | crowd_chatter, laughter, traffic_steady, media_playback, children_playing, wind_on_mic, wind, rain, speech_normal, footsteps, handling_noise, quiet_room, birds, street_background (all role context) | Crowd / Hubbub, speech noise, speech babble / Chatter -> crowd_chatter; Laughter -> laughter; Children shouting / Children playing -> children_playing; Traffic noise, roadway noise -> traffic_steady; Wind -> wind; Wind noise (microphone) -> wind_on_mic; Rain / Rain on surface -> rain; Speech -> speech_normal; Walk, footsteps -> footsteps; Silence / Inside, small room -> quiet_room; Outside, urban or manmade -> street_background; Radio / Television -> media_playback; Bird -> birds; Mains hum; Outside, rural or natural; White noise; Noise (no label) |

`isContextFamily(f)` is true for `'context'`, `'other'` and empty. Groups are never context.

The full prompt list is in [labels.json](packages/assets/public/config/labels.json); it is the only copy and is not repeated here.

### 9.3 priorities.json

```
levels: ["ignore", "log", "flag", "alert"]          PRIORITY_RANK = { ignore: 0, log: 1, flag: 2, alert: 3 }
sustained_labels: [hvac_hum, generator, vehicle_idling, music_loud, music_bass, party_noise, pressure_washer, leaf_blower]
sustained_min_priority: "flag"
table: label -> { day, evening, night }               (82 rows: all 81 classes + unexplained_impact)
```

Meaning of the levels: `ignore` (never shown as an event), `log` (listed in the report), `flag` (highlighted), `alert` (the event a security team would be paged about; in this version only a field and a highlight, no notifications).

| Label(s) | Day | Evening | Night |
|---|---|---|---|
| gunshot, explosion, glass_break, scream, distress_call, fire_alarm, intruder_alarm, car_alarm, personal_alarm, vehicle_collision, forced_entry | alert | alert | alert |
| fireworks_bang, fireworks_crackle, vehicle_backfire, thunder, fox_scream, train_on_bridge | flag | flag | flag |
| bottle_bank, bottle_smash | log | flag | flag |
| door_slam, metal_bang, heavy_thud, crash, unexplained_impact | log | flag | alert |
| shouting, argument, chanting_singing | log | flag | alert |
| crowd_rowdy | flag | flag | alert |
| crowd_chatter, laughter | log | log | flag |
| reversing_beeps | log | flag | alert |
| car_horn, pa_announcement | log | log | flag |
| siren_police, siren_ambulance, siren_fire, siren_generic | flag | flag | flag |
| engine_revving, exhaust_crackle, motorcycle, scooter_ebike | log | flag | alert |
| tyre_screech | flag | flag | alert |
| car_passing | log | log | log |
| traffic_steady | ignore | ignore | ignore |
| vehicle_idling | log | flag | flag |
| plane_flyover, plane_landing_takeoff | log | log | log |
| helicopter | log | log | flag |
| drone | flag | flag | alert |
| train_passing, light_rail | log | log | log |
| boat_horn | log | flag | flag |
| music_loud, music_bass, car_stereo, party_noise | log | flag | alert |
| music_street, music_distant | log | log | flag |
| jackhammer, drill_saw, angle_grinder, hammering_piling, pressure_washer, leaf_blower, scaffold_clatter | log | flag | alert |
| hvac_hum, generator | log | flag | flag |
| bin_lorry, roller_shutter | log | flag | alert |
| delivery_trolley | log | log | flag |
| dog_barking | log | flag | flag |
| wind_on_mic, wind, rain, speech_normal, footsteps, handling_noise, quiet_room, birds, children_playing, media_playback, street_background | ignore | ignore | ignore |

The table can be edited without code changes. `sustained_labels` is **not** used by the deterministic labelling; it is only passed to Gemini in the report catalogue (section 14.1). The deterministic sustained rule is level-based (section 10.7, 12).

### 9.4 Catalogue helpers ([catalogue.js](packages/shared/src/catalogue.js))

- `buildCatalogue(labels, priorities)` returns `{ version, template, families, groups, pools, classPool, yamnetPool, classes, yamnet, classById, yamnetByName, priorities, sustainedSet }`.
- `UNEXPLAINED_IMPACT = 'unexplained_impact'`: a rule label, not a CLAP class. `labelFamily` maps it to `impacts_breakage`; `isKnownLabel` accepts it.
- `maxPriority(...levels)`: highest by rank, starting from `ignore`.
- `priorityFor(cat, label, timeOfDay, sustained)`: section 12.
- `timeOfDay(ms, settings)`: section 12.

---

## 10. Period detection

Deterministic, on the device, no AI. Input: the 10 Hz level series. Code: `PeriodDetector` in [periods.js](packages/shared/src/periods.js). `getSettings()` is called live, so detection settings apply immediately.

### 10.1 Constants (not settings)

| Constant | Value | Meaning |
|---|---|---|
| `FLOOR_WINDOW_MS` | 120,000 | History used for the noise floor |
| `FLOOR_MIN_HISTORY_MS` | 2,000 | No floor (and so no detection) for the first 2 s after Start |
| `END_HOLD_MS` | 2,000 | Level must stay below the off level this long to end a period; also the dip bridged by the sustained run |
| `IMPULSE_RISE_WINDOW_MS` | 200 | Look-back for an impulse rise |
| `IMPULSE_MAX_MS` | 1,500 | An impulse-started period longer than this is reported as gradual |
| `IMPULSE_MIN_MS` | 100 | Minimum period length |
| `SUSTAINED_DELTA_DB` | 6 | Level over the floor that counts towards "sustained" |
| `BLOCK_MS` | 100 | Length of one level block |
| `DB_FLOOR` | -120 | Levels below this (and -Infinity, NaN) are clamped to -120 dBFS |
| impact spacing | 300 ms | Minimum time between counted impacts |

### 10.2 Rolling noise floor

Every pushed sample `(t, rms)` is appended to `history`; entries older than `t - 120 s` are dropped. The floor is recomputed at most once per second:

```
floor = percentile_10( history.rms )
percentile_p(v) = sorted(v)[ min(n-1, floor(p/100 * n)) ]
```

It is not computed until 2 s after the session (Start) began. Until then `push` returns early: no periods can open in the first 2 s.

The history includes the samples inside periods, so a loud source lasting more than about 12 s of a 120 s history (10 %) starts to raise the floor. An open period keeps the floor it had when it opened (`a.floor`), so its own off level does not move.

### 10.3 Opening a period

With `onLevel = floor + on_threshold_db` and `prev` = history samples in the last 200 ms before the current one:

```
impulse = prev not empty
          and rms - min(prev.rms) >= impulse_rise_db
          and rms > onLevel
```

- If `impulse`: open at once with `start = (candStart ?? t) - 100 ms` and `impulseStart = true`.
- Else if `rms > onLevel`: set `candStart = t` on the first such sample; open when `t - candStart + 100 ms >= min_duration_s * 1000`, with `start = candStart - 100 ms`, `impulseStart = false`. With the defaults this is 5 consecutive blocks (0.5 s).
- Else: `candStart = null`.

The `- 100 ms` puts the start at the beginning of the first block (a block's `t` is its end).

### 10.4 Closing a period

While a period is open, every sample is appended to it.

```
if rms < a.floor + off_threshold_db:
    belowSince = belowSince ?? t
    if t - belowSince >= 2000 ms: close with end = belowSince - 100 ms
else:
    belowSince = null
```

Any sample at or above the off level resets the hold, so dips shorter than 2 s never split a period. **Stop** calls `flush(now)`, which closes an open period at `belowSince - 100 ms` if a hold is running, else at `now`.

On close:

```
end      = max(end, start + 100 ms)
samples  = period samples with start < t <= end + 1 ms
duration = end - start
impulse  = impulseStart and duration <= 1500 ms
if not impulse and duration < min_duration_s:  drop the period
```

### 10.5 Merging

```
if a previous period exists and (start - previous.end) < merge_gap_s * 1000:
    merge into the previous period: keep its id and start, take the new end,
    recompute all stats over (previous samples + new samples), floor = previous floor_dbfs,
    onset forced to "gradual"
else:
    new period, id "p" + 3-digit counter (p001, p002, ...)
```

**Consequence of the 2 s end hold (checked by running the detector):** a period ends at `belowSince - 100 ms` but is only closed 2 s later, and a new period can only start after that. So the gap between two consecutive periods is always at least about 2.1 s. With the default `merge_gap_s = 1.5`, **merging never happens**. Merging only has an effect for `merge_gap_s` above about 2.1 s. In that case a merged period is always `onset: "gradual"`, so the unexplained-impact rule (section 11.9) can no longer fire on it.

Previous-period samples are kept only in memory (`lastClosedSamples`). After a page reload, a merge into a restored period recomputes its stats from the new samples only (with the old start).

### 10.6 Period statistics (`_stats`)

| Field | Formula |
|---|---|
| `start`, `end` | ISO UTC |
| `duration_s` | `(end - start) / 1000`, 2 dp |
| `onset` | `"impulse"` if impulse and `duration_s <= 1.5`, else `"gradual"` |
| `time_of_day` | `timeOfDay(start, settings)` (section 12), fixed at close |
| `level_avg_dbfs` | `10 * log10( mean_i 10^(rms_i/10) )` over the period samples (power mean), 0.1 dB; floor if no samples |
| `level_peak_dbfs` | `max_i peak_i`, 0.1 dB |
| `floor_dbfs` | floor at open, 0.1 dB |
| `delta_over_floor_db` | average minus floor, both unrounded (for a merged period the previous, rounded `floor_dbfs`), then rounded to 0.1 dB |
| `sustained` | `longestRun(floor + 6 dB) >= sustained_min * 60 s` |
| `impacts` | count of separate sharp rises, see 10.8 |

### 10.7 Sustained

`longestRunMs(samples, floor + 6)`: walk the samples; a sample at or above the threshold extends the current run, or starts a new one at `t - 100 ms` if the previous above-threshold sample was more than 2 s earlier. Result: the longest `lastAbove - runStart`. Dips under 2 s are bridged. With the default `sustained_min = 5`, a period is sustained after 5 minutes at 6 dB or more over its floor.

### 10.8 Impacts

```
for each period sample x_i (in time order):
  skip if x_i.rms <= floor + on_threshold_db or x_i.t - lastImpact < 300 ms
  minPrev = min rms of the period samples in the 200 ms before x_i (and x_i itself)
  if x_i.rms - minPrev >= impulse_rise_db: count++, lastImpact = x_i.t
```

Only samples inside the period are looked back on, so **the onset that opened the period is not counted**. Three separate bangs in one period give `impacts = 2` (checked). This matters for the glass cap (section 11.13): `glass_max_alert_impacts = 3` needs four bangs.

---

## 11. Period labelling

`labelPeriods(rawPeriods, rows, notes, settings, cat)` in [periods.js](packages/shared/src/periods.js). Called for the export, the report request, the sample UI and its scoring. For sample runs every period's `time_of_day` is forced to `night` first, and the sample run's frozen settings are used.

For each period `[a, b]` (ms), `labelInterval(a, b, ...)` pools both models, and then the rules in sections 11.9 to 11.15 run in that order.

### 11.1 Reading interval

A row with `timestamp` t and `window_s` w covers `[t - w, t]`. `overlap(a, b, t - w, t) = max(0, min(b, t) - max(a, t - w))`. dur = `b - a`.

### 11.2 YAMNet pooling

Rows qualify when `overlap >= 0.5 * min(w, dur)`. Let n be the number of qualifying rows. For each row, `scores_json` gives `score(name)`.

```
label mean(name) = (1/n) * sum_rows score(name)          (missing = 0)
label max(name)  = max_rows score(name)
per row, per pool P:   famWin(P) = max over names in P of score(name) * weight(name)
pool mean(P) = (1/n) * sum_rows famWin(P)     -> family_scores[P]
pool max(P)  = max_rows famWin(P)             -> family_max[P]
```

Names not in the YAMNet map have no pool and do not contribute to pool scores (they are still in the label list with pool `other`). The label list `y.labels` is sorted by mean, each entry `{ raw_label, label, family, pool, weight, mean, max }` (4 dp).

### 11.3 CLAP pooling

Rows qualify when `overlap >= 0.6 * dur` **or** `overlap >= 0.6 * w`: a window qualifies if it covers most of the period, or if most of the window is inside the period. Straddling windows that hold mostly a neighbouring sound are ignored. (In the 13 October test, clips 3 to 5 s apart made CLAP's 10 s window still contain the previous clip, so CLAP labels trailed the sound by up to a window. This pooling is the fix, together with leaving at least 10 s between test clips.)

```
class mean(k) = (1/n) * sum_rows p_k       class max(k) = max_rows p_k
pool score(P) = sum over classes k in P of mean(k)      -> family_scores[P]
```

Pool scores are **sums** of class probabilities. This matters for pools such as `sirens`, where CLAP often picks the wrong siren type but the pool is right. `window_s` is the single window length of the qualifying rows, an array if mixed, or null if none.

For a short period, every CLAP window that contains the whole period qualifies (overlap = dur >= 0.6 dur), up to `W / hop` windows.

### 11.4 short_event (5 s readings for short periods)

```
SHORT_EVENT_S = 4
if dur < 4 s and at least one qualifying CLAP row has window_s = 5:
    use only the 5 s rows for CLAP;  shortEvent = true
```

5 s rows exist only when the session ran with `clap_window_s = 5`. A short event is less diluted in a 5 s window than in a 10 s one.

### 11.5 clap_unreliable

```
clapUnreliable = shortEvent ? false : (dur < 3 s or c.n == 0)
```

An unreliable CLAP is excluded from the top-family decision and from target-share, but its readings still count for the context-only test (11.8) and can still supply a label in `pickLabel` when YAMNet has no candidate (11.7).

### 11.6 topFamily, agreement and the chosen pool

```
topFamily(scores, includeContext = false): the pool with the highest score, skipping context/other unless includeContext.
yTop = topFamily(y.family_scores)              if y.n > 0, else null
cTop = topFamily(c.family_scores)              if CLAP reliable, else null
yAbove = yTop and yTop.score >= yamnet_min     (default 0.2)
cAbove = cTop and cTop.score >= clap_min       (default 0.3)
```

| Agreement | Condition | Chosen pool |
|---|---|---|
| `agree` | yAbove and cAbove and same pool | that pool |
| `disagree` | yAbove and cAbove, different pools | the one with the larger ratio to its minimum: `yTop.score / yamnet_min >= cTop.score / clap_min` ? YAMNet's : CLAP's |
| `partial` | exactly one above | that model's pool |
| `none` | neither above | weak evidence: `yr = yTop.score / yamnet_min`, `cr = cTop.score / clap_min` (0 if absent); if `max(yr, cr) >= 0.5` take the larger (YAMNet on a tie), else no pool |

Agreement is decided on pools, so "agree" means both models put the most weight on the same risk group or family.

### 11.7 pickLabel (specific label within the chosen pool P)

```
yInFam = YAMNet labels in P that map to an app label, sorted by mean * weight (descending)
if yInFam[0] and yInFam[0].mean * weight >= yamnet_min:          -> yInFam[0].label,  source "yamnet"
cInFam = CLAP classes in P (sorted by mean)
if cInFam[0] and (CLAP reliable or yInFam is empty):              -> cInFam[0].class,  source "clap"
if yInFam[0]:                                                       -> yInFam[0].label,  source "yamnet"
otherwise:                                                          -> pools[P].default_label, source "family_default"
```

`label_source` is `"<agreement>:<source>"`, for example `agree:yamnet`. Consequence: YAMNet "Bang" or "Boom" (GUN pool, no mapped label) above 0.2 with CLAP disabled gives the GUN default `explosion`, which is an alert at all times.

The period's `family` is the family of the picked class (not the pool), falling back to the pool id.

### 11.8 Context-only

```
yAny = topFamily(y.family_scores, includeContext = true)   if y.n > 0
cAny = topFamily(c.family_scores, includeContext = true)   if c.n > 0   (even if CLAP is unreliable)
contextOnly = every non-null of [yAny, cAny] is a context/other pool
```

If neither model has readings, the list is empty and `contextOnly` is true.

### 11.9 Rule: unexplained impact (the "3am bang")

```
if onset == "impulse" and delta_over_floor_db >= 15 and (agreement == "none" or contextOnly):
    label = "unexplained_impact", family = "impacts_breakage", label_source = "rule",
    rule_flags += "unexplained_impact"
```

This does not depend on the models naming the sound and overrides any weak-evidence label. Its priority comes from the table (log / flag / alert). The 15 dB threshold is a constant in code. Because an impulse is at most 1.5 s long, CLAP is unreliable for it unless 5 s readings exist; agreement then rests on YAMNet alone.

### 11.10 Rule: sustained flag and context labels

- If `sustained`: `rule_flags += "sustained"`.
- Context label: computed only when no pool was chosen (11.6). Candidates: the first reliable CLAP class in pool `context` with mean >= `clap_min` (classes sorted by mean), else the first YAMNet label in pool `context` with a mapped label and `mean * weight >= yamnet_min` (labels sorted by mean). If the period still has no label and the candidate's priority (time of day, sustained) is not `ignore`, the period takes it with `label_source = "<agreement>:context"`. In practice only `crowd_chatter` and `laughter` can win this way (log, log, flag); the other context labels are `ignore`.

### 11.11 Rule: target share (decoys)

For every group that has at least one `target` and one `confuser` member (GUN, GLASS, DISTRESS), `group_shares[g]` is computed from the pooled CLAP class means:

```
total      = sum over members m of mean(m)
target_sum = sum over target members of mean(m)
value      = target_sum / total     (null if CLAP unreliable, c.n == 0 or total == 0)
top_target = target member with the largest mean;  top_decoy = confuser member with the largest mean
```

If the period's current label is a confuser whose group is in `group_shares` (a **decoy**):

```
hit       = YAMNet corroboration names of the group whose pooled max >= their min (table in 9.1)
threshold = max(0, target_share_min - (hit not empty ? target_share_corroboration_drop : 0))
            defaults: 0.25, or 0.15 with corroboration
promoted  = value != null and value >= threshold and top_target exists
rule_flags += "target_share:<value or n/a>"
target_share = { group, value, threshold, corroborated_by: hit, decoy: label, promoted }
if promoted:
    label_text = "possible <top_target>, decoy <decoy> close"
    label = top_target, family = its family, label_source = "target_share"
```

The share uses CLAP's means even when the decoy label came from YAMNet (for example YAMNet "Fireworks" -> fireworks_bang). The rule only runs when the chosen label is a confuser; it does not run when the period went to a different pool. `train_on_bridge` is a confuser with no group, so this rule never applies to it.

### 11.12 Default priority and decoy floor

```
default_priority = label ? priorityFor(cat, label, time_of_day, sustained)
                         : sustained ? sustained_min_priority ("flag") : "ignore"
if decoy and not promoted and default_priority < flag:
    default_priority = flag;  rule_flags += "decoy_floor"
```

A decoy that still leads a group containing targets never drops below flag. With the current table this changes only `bottle_bank` and `bottle_smash` in the day bucket (log -> flag). Then, if `shortEvent`: `rule_flags += "short_event"`.

### 11.13 Rule: glass duration cap

```
if label == "glass_break" and default_priority > flag
   and (duration_s > glass_max_alert_s or impacts >= glass_max_alert_impacts):
    default_priority = "flag";  rule_flags += "glass_duration_cap"
```

Defaults 6 s and 3 impacts. A long or repeated glass event is more likely a bottle bank than a window. Remember the onset is not counted in `impacts` (10.8). The cap also applies to a glass_break that was promoted from a bottle decoy.

### 11.14 Segments for long periods

If `duration_s > 60`, the period is cut into 30 s pieces `[t, min(b, t + 30 s))` and each piece is pooled with `labelInterval` on its own. Each segment stores `{ start, end, label (picked label), family, agreement, yamnet_top (raw top label), clap_top (top class) }`. Rules 11.9 to 11.13 are not applied to segments.

### 11.15 Confidence

Only when the period has a label (otherwise 0). yS = `yTop.score`, cS = `cTop.score` (0 if absent; cTop is absent when CLAP is unreliable):

```
yn = min(1, yS / (3 * yamnet_min))        saturates at 0.6 with defaults
cn = min(1, cS / (2.5 * clap_min))        saturates at 0.75 with defaults
agree:    c = 0.55 + 0.45 * (yn + cn) / 2        range [0.55, 1.00]
partial:  c = 0.30 + 0.40 * max(yn, cn)          range [0.30, 0.70]
disagree: c = 0.25 + 0.25 * max(yn, cn)          range [0.25, 0.50]
none:     c = 0.10 + 0.20 * max(yn, cn)          range [0.10, 0.30]
confidence = round(clamp(c, 0, 1), 2)
```

yS and cS are the top pool scores of each model, not necessarily of the pool of the final label (for example after the unexplained-impact rule or a target-share promotion). The formula is a heuristic; its constants are **placeholders** that have not been calibrated against outcomes.

### 11.16 Output per period

Each labelled period is the raw period (section 10.6) plus:

```jsonc
{
  "yamnet": { "n": 24, "top": [ {"raw_label","label","family","pool","weight","mean","max"} x3 ],
              "family_scores": { "<pool>": mean }, "family_max": { "<pool>": max } },
  "clap":   { "n": 5, "window_s": 10, "clap_unreliable": false, "short_event": false,
              "top": [ {"class","raw_label","label","family","mean","max"} x3 ],
              "family_scores": { "<pool>": sum of class means } },
  "agreement": "agree",                 // agree | partial | disagree | none
  "label": "siren_police",              // or null
  "label_text": null,                   // "possible X, decoy Y close" after promotion
  "group_scores": { "yamnet": {...}, "clap": {...} },   // same as the two family_scores
  "group_shares": { "GUN": {"value","target_sum","group_total","top_target","top_decoy"}, ... },
  "target_share": null,                 // or {group, value, threshold, corroborated_by, decoy, promoted}
  "family": "sirens",
  "label_source": "agree:yamnet",       // <agreement>:yamnet|clap|family_default|context, "rule", "target_share"
  "confidence": 0.86,
  "rule_flags": [],                     // unexplained_impact, sustained, target_share:<v>, decoy_floor, short_event, glass_duration_cap
  "default_priority": "flag",
  "notes_in_period": [ {"timestamp","text"} ],
  "segments": []                        // only for periods > 60 s
}
```

`clap.window_s` falls back to `settings.clap_window_s` when no CLAP row qualified.

---

## 12. Priority by time of day

`timeOfDay(ms, settings)` uses the **device's local time** at the period start:

```
m = hours * 60 + minutes (local)
day     if day_start <= m < evening_start
evening if evening_start <= m < night_start
night   otherwise (wraps past midnight)
```

Defaults: day 07:00, evening 19:00, night 23:00 (night runs until day starts). Invalid `HH:MM` strings fall back to 07:00, 19:00 and 23:00. The rule assumes `day_start < evening_start < night_start` within one day; a night start after midnight (for example 00:30) would make the evening bucket empty.

`priorityFor(cat, label, tod, sustained)`:

```
if no label: sustained ? sustained_min_priority : "log"
p = table[label][tod] ?? "log"      (labels missing from the table are "log")
if sustained and p != "ignore": p = max(p, sustained_min_priority)      ("flag")
```

The sustained raise applies to **any** non-ignored label on a sustained period, not only to `sustained_labels`. Gemini may raise a priority with a stated reason but may never lower it; the server enforces this (section 14.4).

---

## 13. Settings

From `DEFAULTS` in [settings.js](packages/shared/src/settings.js). Saved in `localStorage` (`echo-settings-v2.2`), written into every export as `settings`, and reset by Settings > Advanced > **Reset to defaults**. The settings screen validates numbers against the listed min/max and reverts invalid input; an empty number field resets to the default (or null for latitude/longitude).

| Key | Default | Range / options | Meaning | Used in |
|---|---|---|---|---|
| `yamnet_enabled` | true | bool | Run YAMNet | `start` ([main.js](apps/echo/src/main.js)), report header |
| `clap_enabled` | true | bool | Run CLAP | `start`, report header |
| `clap_window_s` | 10 | 10 or 5 | CLAP audio window. 5 s is tiled to fill the 10 s input and hops 1.25 s; periods under 4 s use only 5 s readings | worklet options, `clapHopS`, CLAP row `window_s`, stall watchdog, sample gap, report header |
| `clap_hop_s` | 2.5 | 1 to 10, step 0.5 | Time between CLAP runs (10 s window only). A run is skipped if the last is still going | `clapHopS`, worklet, watchdog |
| `yamnet_window_s` | 0.975 | read-only | YAMNet window, fixed by the model | worklet options, YAMNet row `window_s`, sample gap |
| `yamnet_hop_s` | 0.5 | 0.25 to 2, step 0.05 | Time between YAMNet runs | worklet options |
| `yamnet_min` | 0.2 | 0 to 1 | Pooled pool score needed to count as a YAMNet opinion; also the label threshold in `pickLabel` and the context-label threshold | labelling 11.6, 11.7, 11.10, 11.15; report "Only YAMNet" line |
| `clap_min` | 0.3 | 0 to 1 | Pooled pool probability needed to count as a CLAP opinion; context-label threshold | labelling 11.6, 11.10, 11.15 |
| `target_share_min` | 0.25 | 0 to 1 | Target members' share of a group's CLAP score needed to promote a decoy to the top target | rule 11.11 |
| `target_share_corroboration_drop` | 0.1 | 0 to 1 | Subtracted from the share threshold when YAMNet corroborates the group | rule 11.11 |
| `glass_max_alert_s` | 6 | 1 to 60 | A glass_break longer than this is capped at flag | rule 11.13 |
| `glass_max_alert_impacts` | 3 | 1 to 20 | A glass_break with this many counted impacts or more is capped at flag | rule 11.13 |
| `clap_logit_scale` | 18.66 | 1 to 200, step 0.01 | λ in `softmax(λ * cosine)`. **Unconfirmed** (exp(2.9264452)) | CLAP worker, row `clap_logit_scale` |
| `on_threshold_db` | 8 | 1 to 40 | Period starts when the level stays this far above the floor | detector 10.3, impacts 10.8 |
| `off_threshold_db` | 4 | 0 to 40 | Period ends when the level stays below floor + this for 2 s | detector 10.4 |
| `min_duration_s` | 0.5 | 0.1 to 10 | Time above the on level needed to open a gradual period; shorter non-impulse periods are dropped | detector 10.3, 10.4 |
| `merge_gap_s` | 1.5 | 0 to 10, step 0.5 | Periods closer than this are joined. Has no effect below about 2.1 s (10.5) | detector 10.5 |
| `impulse_rise_db` | 12 | 3 to 40 | Rise within 200 ms that marks an impulse (bang) | detector 10.3, impacts 10.8 |
| `sustained_min` | 5 | 0.5 to 60 min | Time at 6 dB over the floor before a source is sustained | detector 10.7 |
| `day_start` | "07:00" | time | Start of day | `timeOfDay` |
| `evening_start` | "19:00" | time | Start of evening | `timeOfDay` |
| `night_start` | "23:00" | time | Start of night (runs until day) | `timeOfDay` |
| `session_label` | "" | text | Optional session name | export `meta`, report title, standalone HTML title |
| `location_text` | "" | text | Optional free-text location | export `meta`, report header |
| `lat` | null | -90 to 90 | Optional latitude, stored in the JSON only (reserved for later flight matching) | export `meta` |
| `lon` | null | -180 to 180 | Optional longitude | export `meta` |
| `time_display` | "local" | local, utc | Times on screen. Exports are always UTC | report |
| `theme` | "system" | system, light, dark | Theme | app (`data-theme`), report |
| `graph_window_s` | 60 | 30, 60, 120, 300 | Live graph history (set from the graph overlay, not the settings screen) | `LiveGraph.windowS` |
| `graph_model` | "both" | both, yamnet, clap | Models drawn in the live graph | `LiveGraph.model` |
| `clap_y_axis` | "fixed" | fixed, auto | Score axis: fixed 0-1 or auto | `LiveGraph.yAxis` |

`session_label`, `location_text`, `lat` and `lon` are read from the current settings at export time, not stored when the session starts.

The report request carries only a summary: `yamnet_enabled, clap_enabled, clap_window_s, clap_hop_s, yamnet_min, clap_min, clap_logit_scale, on_threshold_db, off_threshold_db, min_duration_s, merge_gap_s, impulse_rise_db, sustained_min, day_start, evening_start, night_start`. The JSON export carries all settings.

---

## 14. Results report and the backend

### 14.1 Building the request (`buildReportRequest`, [report-core.js](packages/shared/src/report-core.js))

Input is the full export (section 18). Output:

```jsonc
{
  "schema_version": "2.2",
  "meta": { /* export meta without "device" */ },
  "settings": { /* the 16-key summary in section 13 */ },
  "periods": [ /* labelled periods, section 11.16 */ ],
  "level_series": [ /* 1 Hz */ ],
  "notes": [ /* {timestamp, text} */ ],
  "catalogue": {
    "version": "2.2",
    "families": { "<id>": "<name>" },
    "classes": [ { "id", "family", "group", "role" } ],
    "extra_labels": [ { "id": "unexplained_impact", "family": "impacts_breakage", "role": "rule" } ],
    "priorities": { /* priorities.json table */ },
    "sustained_labels": [ ... ]
  }
}
```

Never rows, per-window scores, audio or embeddings. Settings > Advanced > **Preview what will be sent** shows exactly this JSON and its size in bytes.

### 14.2 Client flow (`showResults` in [main.js](apps/echo/src/main.js))

1. **View results** is enabled once at least one period exists.
2. Build the export and a cache key `"<number of periods>|<last period end>|<number of notes>|<number of rows>"`.
3. If there is no saved report, the key changed, or **Regenerate** was pressed: build the request and
   - sample run: `fallbackReport(request, 'Sample test: local report only; no data sent to the server')`;
   - otherwise `POST /api/report` with the JSON body. A non-2xx response gives a local `fallbackReport` with reason `body.reason || body.error || "Server returned HTTP <status>"`; a network failure gives reason "Could not reach the report server". A 2xx body is used as is (it may itself be a server-side fallback).
4. The report and key are saved with the session, so reopening does not call Gemini again.
5. Render with `reportApp` in the results overlay.

### 14.3 Backend `POST /api/report` ([app.js](apps/backend/src/app.js))

Middleware in order: security headers (same as section 19.2), same-origin check, rate limit, JSON body parser.

- **Same origin:** if an `Origin` header is present, its host must equal the `Host` header, else 403 `{ error: 'cross_origin' }`. No CORS headers are ever sent. The frontend proxy keeps the browser's `Host`.
- **Rate limit:** in memory, per `req.ip`, `RATE_LIMIT_PER_MIN` (default 10) requests per rolling 60 s, else 429 `{ error: 'rate_limited' }`.
- **Body limit:** `MAX_BODY_BYTES` (default 2 MB), else 413 `{ error: 'body_too_large' }`. Invalid JSON gives 400 `invalid_json`. A rough estimate (not measured): a level-series entry is about 65 bytes, so the 1 Hz series alone reaches 2 MB after about 8 to 9 hours.
- **Shape check:** `periods` must be an array of objects with string `id`, else 400 `invalid_request`.
- **No key:** if `GEMINI_API_KEY` is unset, 200 with `fallbackReport(request, 'GEMINI_API_KEY is not set on the server')` and `validation: null`.
- **Gemini:** `callGemini` (14.5), then `validateReport` (14.4). If validation removes every needed event: 200 with `fallbackReport(request, 'validation removed every event')` plus `validation`, `model`, `usage`. Otherwise 200 with the validated report plus `validation`, `model`, `generated_at`, `usage`.
- **Gemini failure:** 502 `{ error: 'gemini_unavailable', reason }`, reason one of "Gemini timed out", "Could not reach Gemini", "Gemini returned HTTP n", "Gemini returned no content", "Gemini returned invalid JSON". The client then builds a local fallback with that reason.
- The server logs only `report failed: <code or name> <status>`, never bodies. It stores nothing.

Environment: `GEMINI_API_KEY` (server only, never sent to the browser), `GEMINI_MODEL` (default `gemini-3.8-flash`, a pinned name; do not use the moving alias `gemini-flash-latest`; re-check the model list when deploying), `GEMINI_THINKING_LEVEL` (default `medium`; `low` is fine if reports are slow), `MAX_BODY_BYTES`, `RATE_LIMIT_PER_MIN`.

### 14.4 Validation (`validateReport`)

For each Gemini event:

1. Drop (listed in `validation.dropped` with a reason) if `period_ids` is empty or has an id not in the request; if `final_label` is not a catalogue class or `unexplained_impact`; if `confidence` is not a number in [0, 1].
2. Default priority for the event: `def = max over its periods of max(p.default_priority, priorityFor(final_label, p.time_of_day, p.sustained))`.
3. If the priority is not a known level or is below `def`, it is **reset** to `def` (listed in `validation.priority_reset` with `from` and `to`). The event is kept.
4. `priority_raised = priority > def`; `priority_reason` is kept only when raised ("No reason given." if empty).
5. `family` is recomputed from `final_label`; `agreement` must be one of the four values, else the first period's; `matches_note` must be boolean, else null; `explanation` and `flags` are coerced to strings.

`merges` and `data_quality` entries with unknown period ids are dropped (`data_quality` entries with no ids are kept). `validation.uncovered_period_ids` lists labelled, non-ignored periods that no event covers. If no event survives but at least one period has a label and a non-ignore priority, the result is `ok: false` and the server falls back. `counts_by_priority` is always recomputed from the kept events; Gemini's `headline`, `quiet_hours_summary` and `overall_notes` are kept as text.

### 14.5 Gemini call ([gemini.js](apps/backend/src/gemini.js))

- `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, header `x-goog-api-key`.
- Body: `systemInstruction` (below), one user turn containing `JSON.stringify(request)`, `generationConfig: { responseMimeType: 'application/json', responseSchema, thinkingConfig: { thinkingLevel } }`. No `temperature`, `top_p`, `top_k`, `candidate_count` or prefilled model turns (Gemini 3.x guidance).
- Timeout 60 s (AbortController). One retry after 1.5 s on HTTP 429 or 5xx.
- The reply text is the concatenation of the first candidate's non-thought text parts, parsed as JSON. `usage` = `{ prompt_tokens, output_tokens, thinking_tokens, total_tokens }` from `usageMetadata`; `model` = `modelVersion` or the requested name.

System instruction (as in code):

```
You are an analyst preparing a report from an acoustic monitoring test.
You receive detected sound periods with scores from two models (yamnet, clap),
level data, user notes, and a label catalogue with priorities by time of day.
Rules:
1. Use only the data provided. Never invent events, times, labels or numbers.
2. Every event you output must reference one or more existing period_id values.
3. final_label must come from the label catalogue (or "unexplained_impact").
4. confidence is a number from 0 to 1 based only on the evidence: model scores,
   agreement between models, period length, and any user note at that time.
5. You may merge adjacent periods only if they are clearly one sound; list the merged ids.
6. You may raise a priority above the catalogue default and must give a short reason.
   You may never lower it.
7. If the user notes name what was played or done at that time, record whether the
   models agreed with it in "matches_note" (true, false or null). Do not let the note
   change the label.
8. Report disagreements between models and data-quality problems honestly.
9. Write short, plain sentences. No marketing language.
Return only JSON matching the response schema.
```

What Gemini does: merge adjacent periods that are clearly one sound; choose the final label from the evidence; set confidence; flag disagreements; note data-quality problems (wind, CLAP lag, short periods); raise priority with a reason; write the summary and the quiet-hours summary. What it must not do: invent events, times or labels; add anything that does not trace back to a period id; use knowledge from outside the data; lower a priority.

Response schema (required fields marked *):

```jsonc
{
  "summary"*: { "headline"*, "counts_by_priority": {"alert","flag","log"}, "quiet_hours_summary"*, "overall_notes": [] },
  "events"*: [ { "period_ids"*, "final_label"*, "family"*, "priority"* (log|flag|alert),
                 "priority_raised", "priority_reason" (nullable), "confidence"*,
                 "agreement"* (agree|partial|disagree|none), "matches_note" (nullable),
                 "explanation"*, "flags" } ],
  "merges"*: [ { "period_ids"*, "reason"* } ],
  "data_quality"*: [ { "period_ids"*, "issue"* } ]
}
```

### 14.6 Deterministic fallback (`fallbackReport`)

Built from the labelled periods alone, on the client or the server:

- A period without a label is not an event; it adds `data_quality: "No model reached a label for this period."` (this includes sustained periods with no label).
- A period with `default_priority = ignore` is skipped.
- Every other period is one event: `final_label = label`, `family`, `priority = default_priority`, `priority_raised = false`, `confidence = period confidence`, `agreement`, `matches_note = null`, `explanation = label_text or ""`, `flags = rule_flags + "clap_unreliable" (if set) + "short_event" (if set and not already present)`.
- `summary.headline = "<n> events: <a> alert, <f> flagged, <l> logged."`; `quiet_hours_summary` counts events in night periods. `source: 'fallback'`, `fallback_reason`, `model: null`, empty `merges`.

### 14.7 Report rendering (`reportApp`, [report.js](apps/echo/src/report.js))

`reportApp(root, data, opts)` is self-contained (no outer references) because its source is inlined into the downloadable HTML. `data = { meta, device, settings, periods, level_series, notes, report, families: {id: {name, color}}, time_display, theme }`.

- **Header:** session label (or "Sound labelling session"), date, start and end time, duration, location text, device, models on (with the CLAP window), "Report by <model> at <time>" for Gemini or "Offline model timeline" otherwise, and for a fallback the banner "AI report unavailable: showing the sound labels produced directly by the enabled models in a scrollable timeline (<reason>)". Then the headline.
- **Summary strip:** alert, flag and log counts, number of model disagreements, number of quiet-hours (night) events. Then the quiet-hours summary and overall notes.
- **Filters (chips):** priority, family (families present), "Disagreements only", "Quiet hours only", "Collapse silent gaps" (default on), "UTC" (default from `time_display`). Times use the session's `tz_name` unless UTC.
- **Timeline** (left column at >= 900 px, about 35 %; hidden on narrow screens): an SVG time axis running downwards. With collapse on, active ranges are each event and note +/- 10 s, ranges closer than 60 s are joined, and each gap between ranges is drawn as 28 px with "quiet <duration>". Scale `pps = clamp(1400 / active_seconds, 0.05, 8)` px per second. A faint level sparkline (`rms_dbfs` -90..0) sits behind the bars. Events are bars coloured by family (context grey), placed in greedy lanes (up to 8 columns). Notes are small triangles. Clicking a bar scrolls to its card; scrolling highlights the matching bar (IntersectionObserver).
- **Cards** (right column, about 65 %; on a phone a single column with a thin time rail and a coloured dot per card), sorted by time: time range, duration and time-of-day bucket; final label (large); priority badge, family, confidence; "Priority raised: <reason>" if raised; agreement line ("Both models agree", "Only YAMNet", "Only CLAP", "Models disagree", "Neither model sure"); evidence tables per period with YAMNet raw label, mapped label, mean and max, and CLAP class, family and mean, with reading counts, window and "unreliable" / "short event" notes; level line (average, peak, dB above floor, "impulse", "sustained", labelled relative); explanation; flags; merges; data-quality notes; notes near the period with "matches note: yes/no/not stated"; an expandable "Raw detail" with the event and period JSON.
  - "Only YAMNet" is shown for a partial event when any YAMNet pool score (including context) reaches `yamnet_min`; it can therefore say "Only YAMNet" when the deciding opinion was CLAP's.
- **Footer:** Regenerate (in app only), Download JSON, Download report HTML, data-quality notes, counts of events dropped and priorities reset by validation, and "Levels are relative and uncalibrated. Audio never left the device."
- Light and dark themes follow `theme` or the system; readable at 400 px with 16 px side padding.

`buildStandaloneHtml(data)` writes one file: inline CSS, inline `reportApp` source, the data embedded as JSON (`<`, U+2028 and U+2029 escaped), and its own CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:`, so it makes no external requests and works offline.

---

## 15. Live graph

`LiveGraph` in [graph.js](apps/echo/src/graph.js), opened with **Live graph** as a full-screen overlay. It draws with `requestAnimationFrame` only while visible; closing the overlay does not stop the session. Data is kept for 10 minutes.

- **Time axis:** `t0 = now - windowS`, `t1 = now + windowS`. The "now" line sits at the horizontal centre; new data appears at the centre and moves left; the right half is blank. So the window setting (30 s, 60 s, 2 min, 5 min) is the length of visible history.
- **Top canvas, relative level:** the 100 ms RMS line, y from -90 to 0 dBFS, grid at -80, -60, -40, -20, title "Relative level (uncalibrated, dBFS)". Closed and open periods are shaded as blue bands. In sample runs, each clip start is a dashed marker with the clip name.
- **Bottom canvas, scores:** one line per class, y 0 to 1 ("Fixed 0-1") or auto (`max(0.05, visible max) * 1.1`, capped at 1). YAMNet solid, CLAP dashed (softmax). Line selection per frame:
  - target lines (family not context/other, from the YAMNet map or the CLAP class family): visible peak >= 0.02, the 10 highest peaks, coloured by family, 2 px;
  - context lines: visible peak >= 0.02 **and** in the latest reading's top 5 of that model, the 8 highest peaks, drawn in a cycle of greys, 1 px.
  - Each line is labelled at its last point as "Y <label>" or "C <class>".
- Controls: model (Both / YAMNet / CLAP), window, y-axis. These are saved as `graph_model`, `graph_window_s`, `clap_y_axis`.
- No "Unknown" line and no threshold filtering beyond the 0.01 storage and 0.02 drawing cut-offs.

---

## 16. Main screen, status chips and session lifecycle

Main screen, top to bottom ([index.html](apps/echo/index.html)): title and privacy note; large **Start / Stop** and elapsed time (hh:mm:ss, summed over runs); status chips for YAMNet and CLAP; load status line; sample test panel; level meter with "(relative, uncalibrated)"; **Clip tag**; buttons **Live graph**, **View results**, **Download JSON**, Settings (gear); counts line ("Rows logged: n (YAMNet y, CLAP c) · Periods: p · Notes: k"). No label lists or scores on the main screen. Download JSON is always enabled.

Status chips (refreshed every 0.5 s): "<model> off", "<model> loading", "<model> idle (last n s ago)", "<model> running, n s ago" (CLAP adds the last `infer_ms`), or red "<model> stopped: <reason>". A frozen result is never left on screen.

Watchdogs: YAMNet is marked "stalled (no run in 10 s)" when running, previously ok and no run for 10 s. CLAP as in 7.5. A later successful run sets the chip back to running. Every error is also written to `session.errors`.

Lifecycle:

- **Start** after **Stop** continues the same session: `started_at` is kept, rows, periods and notes accumulate, elapsed time adds up.
- **Stop** tears down the audio graph, stops the microphone tracks, closes the AudioContext, flushes the open period and the current 1 Hz bucket, and sets `ended_at`.
- **New session (clear data)** in Settings > Advanced (with a confirmation dialog) clears the IndexedDB stores and starts a fresh session id.
- A page refresh restores the saved session (8.4).

---

## 17. Sample test rig

Internal, **non-commercial** smoke test. **Run sample test** plays a fixed set of ESC-50 clips through the **same AudioWorklet, YAMNet, CLAP, period detector and labelling rules** as microphone capture, without asking for the microphone ([sample-test.js](apps/echo/src/sample-test.js), [manifest.json](packages/assets/public/test-audio/manifest.json)).

- **Clips:** 15 slots. 13 are ESC-50 files (5 s, 44.1 kHz WAV), chosen reproducibly as the first file per category in the pinned `esc50.csv` (revision `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6`). Gunshot and human scream have no file and are explicitly **missing**, not simulated or counted as passes. The user can select their own licensed, non-AudioSet recordings for those two slots (0.1 to 15 s); they are decoded in memory only, never persisted or uploaded. No UrbanSound8K download is included.
- **Licence:** ESC-50 is CC-BY-NC-3.0. Do not ship this fixture set in a commercial app. Credits are in [LICENSE.esc50](packages/assets/public/test-audio/LICENSE.esc50). One clip per class is not a representative benchmark or evidence of safety. ESC-50 is not sourced from AudioSet, but that alone does not prove training-set independence.
- **Preparation:** each clip is decoded, downmixed to mono (channel mean) and peak-normalised to -6 dBFS: `gain = 10^(-6/20) / max|x|` (silent clips are rejected). No trimming, compression or repetition. Clips are placed on one track with silence `gap = max(3, longest enabled window + 3)` seconds before, between and after them (13 s with the 10 s CLAP window). The gap lets the floor warm up, periods close and rolling windows clear. The track is played through an `AudioBufferSourceNode` connected digitally to the worklet (and audibly to the speakers; it is not re-recorded). Headphones are recommended. Keep the tab in the foreground.
- **Run:** a separate IndexedDB database (`echo-sample-tests`), cleared at each run; Start afterwards restores the live session. Settings are frozen into `sample_test.settings` and the Settings button is disabled during the run. The graph opens at a 5-minute window with clip markers. After the track ends, the app waits up to 60 s for an in-flight CLAP result, then stops (a timeout is written to `errors`).
- **Night priorities:** every period is labelled with `time_of_day = night`, regardless of the clock.
- **Report:** always the local fallback; the report API is never called.
- **Scoring (`scoreSamples`)**, per clip interval `[start, end]`:
  - readings: rows whose `[t - w, t]` overlaps the clip at all (trailing windows included);
  - recognition per model: accepted names are the clip's `yamnet` display names for YAMNet and its `labels` (class ids) for CLAP; `top 1` if any reading has an accepted name as top 1, `top 5` if in its top 5, else `absent`; `unmapped` if the clip has no accepted names; `no readings` if none;
  - `expected_night`: the single night priority shared by the clip's labels, else null (unmapped);
  - `observed_priority`: highest `default_priority` among periods overlapping the clip;
  - `priority_match`: null if the clip is not complete, has no expectation, or has no readings; if expected `ignore`, true when observed is `ignore`; otherwise true when an overlapping period has one of the clip's labels at exactly the expected priority;
  - `excessive_priority`: observed above the manifest's `max_priority`;
  - the UI shows "pending", "not completed", "no model readings", "EXCESS PRIORITY", "expected label/priority missed", "match" or "inspect manually".
- **Expectations** (night): tools alert (chainsaw is a broad `drill_saw` proxy, since YAMNet "Chainsaw" has no app label), laughter flags, rain and footsteps are ignored, fireworks and thunder may flag but should not alert. Generic engine and door knock have no exact priority mapping; baby crying has only a no-alert cap. These ambiguities are left visible and are not verified ground truth. A shout is not interchangeable with a scream; the optional slot is a human scream.
- **Export:** the JSON adds `sample_test` (provenance, normalisation, gains, exact clip timings, missing slots, models, settings) and `sample_scores`. A top-5 appearance alone is not an alert pass; check window counts and final detections.
- Restore the fixtures with `npm run fetch-test-audio -w @echo/assets`.

---

## 18. JSON export schema

**Download JSON** (file `echo-<session_id>.json`). This is the source of truth; the report is built from it. Timestamps are ISO 8601 UTC with milliseconds, plus timezone info.

```jsonc
{
  "schema_version": "2.2",
  "meta": {
    "session_id": "...", "started_at": "...Z", "ended_at": "...Z (now if running)",
    "tz_name": "Europe/London", "tz_offset_min": 60,          // offset recomputed at export
    "device": "<user agent>", "app_version": "2.2.0",
    "sample_rate_hz": 48000, "clap_short_window": "repeat",
    "source": "sample",                                       // sample runs only
    "session_label": "", "location_text": "", "lat": null, "lon": null
  },
  "settings": { /* every DEFAULTS key (sample run: the frozen settings) */ },
  "label_catalogue_version": "2.2",
  "rows": [ /* section 8.1 */ ],
  "level_series": [ { "t": "...Z", "rms_dbfs": -48.2, "peak_dbfs": -31.0 } ],
  "periods": [ /* labelled, section 11.16 */ ],
  "notes": [ { "timestamp": "...Z", "text": "police siren from laptop" } ],
  "report": null,                                             // or the saved report
  "errors": [ { "timestamp": "...Z", "source": "clap", "message": "..." } ],
  "sample_test": { ... }, "sample_scores": [ ... ]           // sample runs only
}
```

The exported row count matches the on-screen count (both come from the same `rows` array).

---

## 19. Web server, Vite config and CSP

### 19.1 Vite ([vite.js](packages/web-server/src/vite.js))

`frontendConfig({ port })` (echo uses 5173):

- `publicDir` = `packages/assets/public`, so `/config`, `/model`, `/models`, `/wasm`, `/ort`, `/worklet` and `/test-audio` are served from the site root in development and copied into `dist` on build.
- `server` and `preview`: `host: true`, header `Content-Security-Policy: connect-src 'self' blob:`, proxy `/api` to `BACKEND_URL` (default `http://localhost:8787`) with `changeOrigin: false`, so the backend's same-origin check sees the page's host. `preview.allowedHosts: true`.
- `worker.format: 'es'` (the CLAP worker is a module worker).

### 19.2 Production server ([server.js](packages/web-server/src/server.js))

`startFrontendServer({ name: 'echo', distDir })`, listening on `::` (IPv4 and IPv6) at `PORT` (default 8080):

- Security headers on every response: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: connect-src 'self' blob:`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self), geolocation=(self)`. `x-powered-by` off, `trust proxy` 1.
- `GET /healthz` -> `{ ok: true }` (answered by the frontend itself, not proxied).
- `/api/*` -> streamed proxy to `BACKEND_URL` (default `http://localhost:8787`): hop-by-hop headers removed, the browser's `Host` kept, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-for` set, 120 s timeout. If the backend is unreachable: 502 `{ error: 'backend_unavailable' }`. Bodies are streamed and never logged.
- Static files from `dist` (`maxAge` 1 h), with every other path falling back to `index.html`. If `dist` is missing: 503 "Frontend is not built. Run the build first."

The browser only talks to its own frontend origin; the backend does not need to be public.

### 19.3 CSP

`connect-src 'self' blob:` is set in four places: the `index.html` meta tag, the Vite dev and preview headers, the production frontend server, and the backend's own header. The echo test ([sample-test.test.js](apps/echo/test/sample-test.test.js)) checks the meta tag, both Vite headers and the backend source; the web-server test ([server.test.js](packages/web-server/test/server.test.js)) checks the production frontend server. It restricts `fetch`, XHR and WebSocket to the page origin (and `blob:`). Other directives (scripts, images, styles) are not restricted by it. The standalone report HTML has its own stricter CSP (14.7).

Requests after the page loads: the label config, the model and runtime files (`/config`, `/model`, `/wasm`, `/models`, `/ort`, `/worklet`) are fetched lazily at the first Start, and `/test-audio` during a sample run. All are same-origin. The only request carrying session data is `POST /api/report`.

### 19.4 Backend routes echo does not use

The backend ([app.js](apps/backend/src/app.js)) serves no pages. Besides `/api/report` and `GET /healthz` (store ping; `{ ok, store }` or 503), it serves `/api/osm` (OpenStreetMap proxy), `/api/simulations` and `/api/library` (saved simulations and library, Postgres or in-memory store) for the simulator, all behind the same-origin check and a rate limit (`SIM_RATE_LIMIT_PER_MIN`, default 240; `SIM_MAX_BODY_BYTES`, default 25 MB). Other `/api` paths answer 404. The backend needs `DATABASE_URL` in production for those routes; echo does not use the database.

---

## 20. Develop, test, build, deploy

### 20.1 Develop

```sh
npm install                                # postinstall copies MediaPipe and ONNX Runtime wasm into packages/assets/public
npm run fetch-models -w @echo/assets       # CLAP audio model (once; files are also in git)
npm run fetch-test-audio -w @echo/assets   # ESC-50 sample clips (once; also in git)
npm run dev                                # backend :8787, echo :5173, sim :5174
npm run dev -w @echo/echo                  # echo only (Vite on :5173, /api proxied to BACKEND_URL)
```

Set `GEMINI_API_KEY` in the backend environment to get Gemini reports; without it the backend returns the deterministic fallback. Without `DATABASE_URL` the backend keeps simulations in memory (not relevant to echo).

After editing CLAP prompts or the template in `labels.json`, run `npm run clap:embed -w @echo/assets` to regenerate `clap_text_embeddings.json`; otherwise the worker refuses to start (prompt hash mismatch). Priorities are edited in `priorities.json`; no code change or regeneration is needed.

Microphone access needs HTTPS or `localhost`. The Vite dev server is plain HTTP, so testing on a phone needs an HTTPS route (for example the deployed Railway URL). Do not host the app as a Claude artifact: the artifact sandbox blocks the microphone.

### 20.2 Test

```sh
npm test                    # every workspace
npm test -w @echo/echo      # echo: 8 tests
npm test -w @echo/web-server
```

Echo tests ([sample-test.test.js](apps/echo/test/sample-test.test.js)): manifest has 15 slots and 13 WAV fixtures (RIFF/WAVE, 44.1 kHz, exactly 5 s) whose YAMNet names exist in the class map and whose labels exist in the catalogue; CSP is set in `index.html`, the backend, and Vite server and preview; night expectations follow `priorities.json`; mono normalisation; track preparation (gap, timings, missing slots, no audio in metadata); scoring of trailing windows, missed and excessive priorities; ignored clips; and the real worklet run in a VM (6 s at 48 kHz gives 11 YAMNet windows of 15,600 samples, one 240,000-sample CLAP window, 60 level blocks). The labelling functions are also exercised through the simulator's tests ([sim-label.test.js](packages/sim-core/test/sim-label.test.js)). There is no dedicated unit test file for `periods.js` or `report-core.js` in `packages/shared`.

### 20.3 Build and run

```sh
npm run build:echo && npm run start:echo     # fetch-models + vite build; then node apps/echo/server.js, PORT default 8080
npm run start:backend                        # PORT default 8787
```

### 20.4 Deploy to Railway

Settings live in [.railway/railway.ts](.railway/railway.ts) (Railway Infrastructure as Code; per-service `railway.json` is deprecated). It declares `Postgres`, `backend`, `sim` and `echo`. All services build from the repository root (the apps import `packages/`). For echo:

| Item | Value |
|---|---|
| Builder | Railpack |
| Build command | `npm run build:echo` |
| Start command | `npm run start:echo` |
| Health check | `/healthz`, timeout 120 s |
| Restart | on failure, max 10 retries |
| Watch paths | `apps/echo/**`, `packages/**`, `package.json`, `package-lock.json` |
| Variables | `BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}` |

Backend variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PORT=8787`, `NODE_ENV=production`, `GEMINI_API_KEY` (kept with `preserve()`, set in Railway). Optional: `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `MAX_BODY_BYTES`, `RATE_LIMIT_PER_MIN`, `PGSSL=1`. The backend needs no public domain; the frontends reach it over the private network.

Apply with the Railway CLI (5.42.1 or newer) from the repository root:

```bash
railway login
railway link            # pick the project and the production environment
railway config plan     # preview; check nothing is marked for deletion
railway config apply
```

Railway does not read `.railway/` during deploys, so run `plan` / `apply` again after editing it. A whole-project apply deletes services and variables the file leaves out: review the plan first and add any extra variables to the file.

Without these settings Railway runs the root `npm run build` and `npm start` ([scripts/service.mjs](scripts/service.mjs)), which pick the app from `ECHO_APP`, or else from `RAILWAY_SERVICE_NAME` (a name starting with `backend`, `sim` or `echo`). `start` runs `node server.js` directly in `apps/echo` so SIGTERM reaches the server.

---

## 21. Test protocol and earlier findings

### 21.1 Protocol (from the v2 and v2.2 briefs, still the plan)

- **Setup:** play clips from a laptop about 25 cm from the phone, volume so the level reaches about -35 dBFS. Leave **at least 10 s of silence between clips** (CLAP's window). Use clips at least 15 s long. Tap Clip tag at the start of each clip.
- **Baseline sequence** (three passes): police siren, train passing, plane landing, car revving with exhaust crackle.
- **Window comparison:** run the sequence with CLAP at 10 s and at 5 s; score both on periods.
- **Added families:** gunshot, glass breaking, scream, shouting, fire alarm, car alarm, loud music with bass, jackhammer, drill, plus the confusers (fireworks, backfire, a fox scream, bottles into a bin, thunder).
- **Quiet-hours test:** bangs, door slams and thuds at 2 m, 10 m and 30 m, in a quiet room or street at night, plus ordinary night sounds (footsteps, a fridge, a passing car) for the false-alarm rate. Set the time-of-day settings so the bucket is night, or tag manually.
- **Real-world walk:** a street walk including a rail bridge, near trains, traffic and wind, to check false positives. Note the places that caused trouble.
- **Fixed-position run:** phone on a tripod or windowsill outdoors for 1 to 2 hours (evening if possible) for false alarms per hour without handling noise. A handheld test is harder than a fixed node will be; the fixed run is the fairer test.
- **Gap sounds** expected to be missed: PA / tannoy announcement, bin lorry reversing, bass music through a wall, e-scooter, a crowd leaving a bar, a fox scream.
- **Scoring per period:** right family top 1, top 3 or absent; period start and end within 2 s of the real clip; whether the agreement flag helped; alerts per hour not worth acting on. Score YAMNet alone, CLAP alone and combined. CLAP wins only if it improves the gap sounds **without** adding false alarms (check bridge rumble, wind, footsteps).

### 21.2 Findings recorded in the briefs

- First walk (v1 build, 7 minutes, iPhone, Safari): speech, vehicle, motorcycle, bird and bicycle labels correct; under a rail bridge, Explosion / Eruption / Fireworks for about 30 s (false: sustained rumble and echo); an aeroplane only weakly (Aircraft / Fixed-wing aircraft 0.15 to 0.26); wind dominated (about 137 of 278 windows).
- 13 October: YAMNet siren 0.67 to 0.92 (hit), train weak or variable, plane missed (Breathing/Snort); CLAP siren family correct but wrong type, train 0.60 to 0.77, plane 0.58 to 0.85; car revving only "Vehicle" in YAMNet and motorcycle/scooter late in CLAP; exhaust crackle detected by neither. CLAP labels trailed clips by up to a window because clips were 3 to 5 s apart.
- 16 and 17 October (from the labelling proposal): a scream, a car acceleration and a crash were merged into one 57.6 s period; averaged over the period the DISTRESS group fell to 0.157 although single readings scored 0.83 to 0.87, giving a weak `engine_revving` at confidence 0.16. The target-share rule did not run on that period, because it only runs when a decoy is the chosen label (still true in the code, 11.11). CLAP ran about once a second on the iPhone 13 Pro.

---

## 22. Known limits

- One phone microphone: no direction and no distance.
- Levels are relative and uncalibrated (unknown gain and frequency response). Do not treat them as dB SPL or dB(A).
- Results depend on the phone model, case, wind, placement and handling.
- CLAP lags by up to one window, and its scores depend on how the prompts are written. Softmax shows relative preference among our 81 classes, not absolute confidence. Overlapping sounds split CLAP's probability, so neither may lead.
- CLAP is heavy: about 1 s per run on an iPhone 13 Pro; skipped hops are dropped by design. Battery and thermal behaviour with both models running has not been documented.
- YAMNet is fast but has no class for many target sounds (planes in some conditions, exhaust crackle, PA, bin lorries), and "Screaming" does not tell distress from play.
- The YAMNet input is decimated without an anti-alias filter (5.4).
- Labels are recomputed with current settings at each export; an export's `settings` block describes the labelling, but periods were detected with whatever detection settings applied at the time.
- Long periods dilute short events in the pooled mean (21.2). Merging is inert at default settings (10.5), but long continuous periods still form whenever the level does not drop for 2 s.
- The report body limit (2 MB) may be reached by very long sessions (14.3, estimate).
- Gemini's output is only as good as the periods it is given. The raw JSON is the source of truth.
- Flight-data matching, direction finding and push alerts are not in this version.

---

## 23. Where the code differs from the earlier briefs

The briefs (v1, v2, v2.2), the README and the labelling proposal were folded into this document. Where they disagree with the code:

| Brief says | Code does |
|---|---|
| v1/v2.2: create the AudioContext at 16 kHz where supported | Native rate; YAMNet resampled in the worklet (linear, no anti-alias filter), CLAP in the worker |
| v1: "Unknown" below a 0.3 threshold, smoothing, top-5 live list, watchlist panel, CSV export | None of these. No "Unknown" anywhere (as v2 required); JSON export only |
| v2: service worker / offline cache; WebGPU | Neither. ONNX Runtime WASM, one thread |
| v2: tap/drag to scrub, pause, family legend chips, note markers on the graph, wind shading, prompt-template setting, filled level area plus peak line | Not built. Level graph is one RMS line; only sample clips get markers; the template is fixed in `labels.json` |
| v2: 60 s window = 30 s of history | The window setting is the history; the same length of blank future is drawn to the right |
| v2: grey lines for classes in the top 5 of any visible window, lighter grey for lower peaks | Grey lines only for classes in the **latest** reading's top 5, cycling greys; also a cap of 10 coloured lines |
| v2: `scores_json` only for watchlist classes, "Log all classes" toggle | YAMNet: every class >= 0.001; CLAP: every class; no toggle |
| v2: level every ~0.25 s | Every 100 ms |
| v2.2: noise floor warm-up uses the first 10 s | 2 s |
| v2.2: merge periods separated by less than 1.5 s | Same setting, but with the 2 s end hold the gap is always >= ~2.1 s, so merging never happens at the default |
| v2.2: 73 classes | 81 classes. Added bottle_smash, vehicle_collision, forced_entry, distress_call, personal_alarm, music_distant, media_playback, children_playing; crowd_chatter, laughter and traffic_steady are now role and family `context`. Six risk groups added. Several prompts changed (labels.json is authoritative) |
| v2.2: traffic_steady log/log/log | ignore/ignore/ignore |
| v2.2 6.5: any label in the sustained set (including traffic_steady, crowd_chatter) is a sustained source | `sustained_labels` (8 labels, without those two) is only passed to Gemini; the deterministic rule is level-based and raises any non-ignored label on a sustained period to at least flag |
| v2.2: only the siren family score is a sum | Every CLAP pool score is a sum of its class means; pools are groups where a class has a group |
| v2.2: confusers are reported as themselves and never merged into their lookalike | Target-share rule can promote a decoy to the group's top target ("possible X, decoy Y close"); a decoy that is not promoted is floored at flag |
| v2.2: `clap_unreliable` if shorter than 3 s or no reading | Same, except a period under 4 s with 5 s readings uses only those and is never unreliable (`short_event`) |
| v2.2: use the model's `logit_scale_a`, "about 100 in the config" | Default 18.66 = exp(2.9264452), source **unconfirmed**; the shipped config has only `logit_scale_init_value` 14.29 |
| v2.2: shorter CLAP audio "padded or repeated" | Repeated (tiled) to 480,000 samples |
| v2.2: server validation drops lowered priorities | Lowered or invalid priorities are reset to the default and listed in `priority_reset`; the event is kept |
| v2.2: fallback banner "Basic report: Gemini was not used (reason)" | "AI report unavailable: showing the sound labels produced directly by the enabled models in a scrollable timeline (reason)" |
| v2.2: the Railway server serves the static app and `/api/report` | Separate frontend services serve the app and proxy `/api` to a backend that serves no pages |
| v2.2: Network tab shows no requests after load except `POST /api/report` | Model, runtime and config files are fetched lazily at the first Start (same origin); `/api/report` is the only request with session data |
| v2.2: what may leave: labels, scores, levels, timestamps, notes | Matches: per-period pooled scores (top 3 per model, pool scores, group shares) are sent; per-window rows are not; typed location and coordinates are in `meta` |
| README: test audio "used by the sim" | Also used by the echo sample test |
| Labelling proposal 3 and 9: how shorter windows are handled is unknown | Answered: 5 s windows are tiled to 10 s; the only window options are 10 s and 5 s; a 5 s run costs the same as a 10 s run |

---

## 24. Proposals not built yet

From the labelling proposal of 18 October 2026 (Liam). **Nothing in this section is built.** Items marked **unverified** need checking against code or real recordings before anyone relies on them. Notes in *italics* say what the current code does.

### 24.1 Problems addressed

From the 16 and 17 October tests:

- A scream, a car acceleration and a crash were merged into one 57.6 s period. Averaged over the period, the DISTRESS group fell to 0.157 even though single readings scored 0.83 to 0.87. The result was a weak `engine_revving` at confidence 0.16.
- The target-share rule only ran when a decoy led the group that won the period, so it never ran on that period. *Still true in the code (11.11).*
- CLAP runs about once a second on the iPhone 13 Pro. At a 1.25 s hop it is already near the phone's limit, and it runs all night on overlapping windows.
- Short events (a 2 s scream) are diluted inside a 5 s or 10 s window.
- When two sounds overlap, CLAP's softmax makes labels compete and sum to 1, so neither may win.

### 24.2 Proposal A: two-stage pipeline (watch cheaply, label on demand)

**Stage 1: always on, cheap.** Track a rolling noise floor and watch for anything that rises above it.

- **Level trigger (primary).** A rise of a set number of dB over the rolling floor starts an event. The existing 15 dB impact rule and the 6 dB for 5 minutes sustained rule are already of this kind. This works for any sound, including ones YAMNet has no class for.
- **YAMNet trigger (secondary).** YAMNet runs at about 12 ms per window, so it can run continuously. It starts an event when a watchlist class passes a threshold. The existing corroboration thresholds are a starting point: Screaming >= 0.2; Glass, Shatter or Breaking >= 0.4; Gunshot, gunfire >= 0.2.
- **Why not gate on YAMNet alone.** YAMNet has no class for planes, exhaust crackle, announcements or bin lorries, so a YAMNet-only gate would miss exactly the sounds it cannot name.

**Stage 2: on demand, expensive.** When Stage 1 fires, run CLAP once on that event's window.

- Use a **pre-roll** of a few seconds taken from the rolling in-memory buffer, so the start of the event is included. The buffer stays in memory only. No audio is stored or sent.
- Label the event over its own window, not over a long merged period. This replaces the "cap period length at about 20 s" fix as the main defence against merging.
- Evaluate security groups on the **peak reading**, not the period mean. *The code pools CLAP by mean; YAMNet pool maxima are computed (`family_max`) but only used for corroboration.*

**Slow builds and constant sources.** An onset trigger will not catch a slow rise. Options, simplest first: (1) the sustained rule (6 dB over the floor for 5 minutes); (2) a scheduled CLAP pass, for example every 10 s, only while the level stays elevated (proposal, not tested).

**Risks.** If Stage 1 misses an event, CLAP never sees it; the trigger threshold trades recall against false alarms. The pre-roll and trigger add settings that need calibrating.

**How to test without new recordings.** Replay the 16 and 17 October logs and check whether the Stage 1 trigger would have fired on the scream, the glass and the gunshot. Use the overnight false-alarm run (labels and levels only) to count how often the trigger fires on ordinary night sounds.

### 24.3 Proposal B: window length

The rig supports a 5 s window with a 1.25 s hop, flags periods under 4 s as `short_event`, and keeps a 10 s mode for ambient sounds.

- **Hypothesis:** shorter windows (about 2 s) suit sharp sounds such as gunshot, glass and door slam; longer windows suit sounds that need context such as planes, traffic and music.
- **Unverified** in the proposal: that the model takes a fixed-length input and shorter audio is padded or looped. *Answered by the code: the input is fixed at 480,000 samples (10 s at 48 kHz) and shorter windows are tiled (looped). A 2 s window would be five copies of the event, not one event in padding. A shorter window does not make a run faster.*
- **Test:** run the 15-clip suite (sample test, no microphone) at 2 s, 5 s and 10 s. Compare top-1 and top-3 accuracy, alert recall and time to first detection per group. Also try the first 2 s of each event inside a 5 s window padded with silence. *A 2 s option and silence padding do not exist yet.*

### 24.4 Overlapping sounds

Overlap is the main remaining problem.

- **Labelling:** CLAP's scores compete (they sum to 1), so two overlapping sounds split the score and neither may lead. YAMNet scores each class independently, so it copes better by design.
- **Localisation** is a simulator topic (see SIM.md).

Approaches for labelling, cheapest first:

| Route | What it does | Status |
|---|---|---|
| 1. Detect, do not separate | Check each label's raw cosine score against its own threshold instead of picking one winner, so several labels can be present at once. YAMNet already works this way | Cheap. Can be tested on existing exports (rows keep `cosine` per class) |
| 2. Use geometry | Several nodes hear different mixes; keep a bearing only when several agree | Simulator |
| 3. Use a microphone array | Direction per time-frequency bin, or beamforming | **Unverified** for four microphones 10 cm apart; a hypothesis |
| 4. Neural separation | Models that pull one sound out of a mixture, some by text query | Heavy for a lamp-post node; not a starting point |

| Case | Difficulty | Handling |
|---|---|---|
| A short bang over a steady background | Easy | The background becomes the floor, so subtract it |
| Two events a second or two apart | Medium | Shorter windows and onset detection split them in time |
| Two sustained broadband sounds at similar level (an engine and a crowd) | Hard | Flag as unresolved instead of guessing |

**Rule proposed for now:** when two events overlap in time, report the dominant label but mark the window as **overlapped, unreliable**. Do not attempt separation until routes 1 and 2 have been tested. *Not built: there is no overlap flag in echo.*

### 24.5 Privacy

The rule stays: nothing derived from audio in raw form leaves the device, including spectrograms and embeddings (section 3). The pre-roll buffer would be rolling and in memory only, with no saved files. The distress-label privacy review is still outstanding.

### 24.6 Effect on the requested fixes from the 16-17 October notes

| Requested fix | Effect of the proposal | Status in code |
|---|---|---|
| Evaluate security groups on the peak reading | Still needed; Stage 2 uses it on each event's window | Not built (mean pooling) |
| Cap period length (about 20 s) or split when the leading group changes | Largely replaced by labelling each triggered event separately; keep a cap as a safety net | Not built (only 30 s `segments` for periods over 60 s, informational) |
| Cap no-agreement labels under 0.3 confidence at `flag` | Unchanged | Not built |
| 5 s window for short events | Becomes one setting in the window-length test | Built (`clap_window_s = 5`, `short_event`) |
| Guard on the YAMNet bypass | Unchanged; only after real fox clips exist | Not built |

### 24.7 Test plan

1. **Trigger replay** over the 16 and 17 October logs: does the Stage 1 trigger fire on each event, and how long after onset?
2. **Window length:** the 15-clip suite at 2 s, 5 s and 10 s.
3. **Multi-label check:** re-score existing exports with per-label cosine thresholds; see whether the scream, glass and gunshot are caught where the softmax winner was wrong.
4. **Overnight false-alarm run:** windowsill, labels and levels only; count Stage 1 triggers per night.
5. Overlap sweep: simulator (SIM.md).

Metrics per group: alert recall, top-1 and top-3 accuracy, time to first detection, false alerts per night.

### 24.8 Open questions from the proposal

- How does the code handle windows shorter than the model's input? *Answered: tiled (7.3).*
- What is CLAP's real run time on the iPhone when it runs once per event instead of on a 1.25 s hop? Can Stage 2 run on a lower-end phone?
- What trigger threshold gives acceptable recall without too many false alarms? Needs the overnight run.
- How often do real incidents involve two simultaneous sounds? A question for buyer interviews; if rare, the overlap flag may be enough.
- Real CLAP logit scale and checkpoint revision are still unconfirmed (section 25).

---

## 25. Unconfirmed constants and open questions

| Item | Value | Status |
|---|---|---|
| `clap_logit_scale` | 18.66 = exp(2.9264452) | **Unconfirmed.** Source of 2.9264452 not traced; not in the shipped config. Tune on real clips |
| CLAP checkpoint revision | `Xenova/clap-htsat-unfused` at `main` | Not pinned to a commit in `fetch-models.mjs`; the checked-in files are what runs |
| Confidence formula constants | 0.55/0.45, 0.30/0.40, 0.25/0.25, 0.10/0.20; normalisers 3 x yamnet_min, 2.5 x clap_min | **Placeholder** heuristic, not calibrated |
| Unexplained-impact delta | 15 dB | Constant in code, from the brief; not calibrated |
| Sustained delta | 6 dB | Constant in code, from the brief; not calibrated |
| Detection defaults (8 / 4 dB, 0.5 s, 12 dB, 2 s hold, 10th percentile over 120 s) | section 10 | From the brief; not calibrated against labelled recordings |
| Target share 0.25, corroboration drop 0.1, corroboration minimums (0.2, 0.4) | sections 9.1, 11.11 | **Placeholders**, set from the October tests |
| Glass cap 6 s / 3 impacts | section 11.13 | **Placeholder** |
| YAMNet weights (Glass 0.6, Breaking 0.5, Hum 0.5) | labels.json | **Placeholder** |
| `merge_gap_s` default 1.5 s | section 10.5 | Inert at this value; whether merging is wanted at all is open |
| Effect of the missing anti-alias filter on YAMNet | section 5.4 | Not measured |
| CLAP speed and battery on target phones | about 1 s per run on an iPhone 13 Pro (October tests) | Lower-end phones not measured |
| Safari `AudioContext` rate behaviour on iPhone | native rate is used, whatever it is | Brief check item; the actual iPhone rate is recorded per session in `meta.sample_rate_hz` but not documented here |
| Report body size for long sessions | 2 MB limit | Rough estimate only (14.3) |
