# echo

Phone sound labeller v2.2. YAMNet (MediaPipe) and CLAP (transformers.js, Web Worker) run on the device. Audio is never stored or uploaded. Only labels, levels and notes are posted to `POST /api/report` when you tap **View results**, and the server forwards them to Gemini.

## Develop

```sh
npm install
npm run fetch-models          # CLAP audio model into public/models (once)
npm run dev:server            # API on :8787 (set GEMINI_API_KEY to use Gemini)
npm run dev                   # Vite, proxies /api to :8787
```

After editing CLAP prompts in `public/config/labels.json`, run `npm run clap:embed` to regenerate `public/config/clap_text_embeddings.json`. Priorities are in `public/config/priorities.json`.

## Build / run production

```sh
npm run build
npm run start   # Express: serves dist/ and /api/report on $PORT (default 8787)
```

## Deploy to Railway

`railway.json` runs `npm run build` then `npm run start`. Environment variables: `GEMINI_API_KEY` (required for Gemini; without it the basic report is used), `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_THINKING_LEVEL` (default `medium`), `MAX_BODY_BYTES` (default 2 MB), `RATE_LIMIT_PER_MIN` (default 10).

## Assets

- `public/model/yamnet.tflite` and `public/model/yamnet_class_map.csv` — the model and its class names, hosted ourselves (no third-party runtime calls).
- `public/wasm/` — MediaPipe's WASM runtime, copied out of `node_modules` by `scripts/copy-wasm.mjs` (runs on `npm install` via `postinstall`).
- `public/worklet/capture-processor.js` — AudioWorklet that buffers mic samples into overlapping windows in memory only.

See [instructions/instructions_v2.2.md](instructions/instructions_v2.2.md) for the full product brief.
