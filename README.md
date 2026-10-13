# echo

Phone sound labeller — runs YAMNet on-device via MediaPipe (`@mediapipe/tasks-audio`). No backend, no audio upload/storage; only labels/scores/timestamps are logged locally in the browser session.

## Develop

```sh
npm install
npm run dev
```

Open the dev server over HTTPS (or `localhost`) on a phone to test the mic. Tap **Start listening** to grant mic access.

## Build / run production

```sh
npm run build
npm run start   # serves dist/ on $PORT (defaults to 4173)
```

## Deploy to Railway

This repo includes `railway.json` configured to run `npm run build` then `npm run start`. Just connect the repo in Railway — no extra setup needed. Railway provides HTTPS and sets `$PORT` automatically.

## Assets

- `public/model/yamnet.tflite` and `public/model/yamnet_class_map.csv` — the model and its class names, hosted ourselves (no third-party runtime calls).
- `public/wasm/` — MediaPipe's WASM runtime, copied out of `node_modules` by `scripts/copy-wasm.mjs` (runs on `npm install` via `postinstall`).
- `public/worklet/capture-processor.js` — AudioWorklet that buffers mic samples into overlapping windows in memory only.

See [instructions.md](instructions.md) for the full product brief.
