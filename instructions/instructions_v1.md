# Phone Sound Labeller — Developer Brief

**Purpose:** a small web app that listens through a phone microphone, runs a sound-labelling model **on the device**, and shows the labels it produces. It is a test rig for the "acoustic intelligence" idea, not a product. We want to learn what labels a standard model gives for real sounds, and how good they are.

**Audience:** one developer, one to two days of work. No backend.

---

## 1. Hard rules (privacy)

These are the point of the exercise. Please treat them as acceptance criteria.

1. **Audio never leaves the phone.** No uploads, no streaming, no cloud calls with audio or audio-derived data.
2. **Audio is never stored.** Keep only the rolling buffer needed for the current window (about 1 s) in memory. No recording, no `MediaRecorder`, no saving blobs.
3. **Only labels, scores and timestamps are kept.** These can be shown, logged and exported.
4. **No analytics or third-party trackers** on the page.
5. **Visible proof:** show a short note on screen ("Audio stays on this device. Only labels are logged.") and confirm in the browser's Network tab that nothing is sent after the page and model have loaded.

---

## 2. Model

**Use YAMNet** (Google, trained on AudioSet, 521 classes, about 4 MB, ~1 s windows at 16 kHz mono).

Recommended route: **MediaPipe Audio Classifier** (`@mediapipe/tasks-audio`), which runs YAMNet in the browser via WebAssembly.

- Package: `@mediapipe/tasks-audio` (v1.1.0 was available when we looked; please check the current version and pin it).
- Model file: `yamnet.tflite` (float32), published by Google at
  `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`
- **Download the model once and host it with the app**, so there is no runtime dependency on a third-party URL. Likewise serve the MediaPipe `wasm/` files from our own host.
- Fallback if MediaPipe causes trouble: TensorFlow.js with a YAMNet model. Check the current source for the model files, as TF Hub has moved.

Class names come from the model output. The full class list is the public `yamnet_class_map.csv` in the TensorFlow models repo (`research/audioset/yamnet/`).

---

## 3. Audio capture

- Request the mic with `getUserMedia`. **Turn off the phone's processing**, otherwise the labels will be distorted:
  ```js
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
  });
  ```
- Start from a button tap (iOS Safari requires a user gesture to start audio).
- YAMNet expects **16 kHz mono**. Create the `AudioContext` at 16 kHz where supported; otherwise resample (some Safari versions ignore the requested rate, so please test).
- Prefer an **AudioWorklet** over the deprecated `ScriptProcessor`.
- Feed the classifier with **~0.975 s windows (15,600 samples), hopping every ~0.5 s** so windows overlap and short sounds are not missed. Make window and hop adjustable.
- **HTTPS is required for mic access** (`localhost` is fine for development).

---

## 4. Screens and behaviour

### 4.1 Live view
- Big Start / Stop button.
- Live list of the **top 5 labels with scores**, updated every hop.
- A scrolling **timeline** of the top label over the last 60 s.
- A **watchlist panel** (see §5) showing the current score for each target class, highlighted when above threshold.
- Settings drawer:
  - score threshold (default 0.3), below which the output is shown as **"Unknown"**
  - smoothing on/off (median or majority over 3 windows)
  - window length and hop

### 4.2 Event log
Every window is logged as a row (not just the winner):

| field | notes |
|---|---|
| `timestamp` | ISO time, millisecond precision |
| `top1_label`, `top1_score` | |
| `top2_label` … `top5_score` | keep all five |
| `rms_dbfs` | uncalibrated level, **for reference only** |
| `session_id`, `device` | phone model / browser string |

### 4.3 Ground-truth marking (important for scoring)
- A "Mark event" button plus a text box: the tester types what they actually did ("played siren from laptop, 5 m") and the app stores `timestamp + note` in the log.
- Quick-note presets for the staged sounds in §6.

### 4.4 Export
- **Export CSV and JSON** of the log (user taps a button; file downloads on the device).
- No server storage. Optionally keep the log in `IndexedDB` so a refresh does not lose a session.

---

## 5. Watchlist (classes we care about)

Show these by name (match on the label name returned by the model; indices are from the YAMNet class map):

| group | classes (index) |
|---|---|
| Vehicles | Tire squeal (307), Skidding (306), Vehicle horn / car horn (302), Car alarm (304), Car passing by (308), Motorcycle (320), Truck (310), Reversing beeps (313), Traffic noise (321), Engine (337) |
| Emergency | Siren (390), Police car siren (317), Ambulance siren (318), Fire engine siren (319) |
| Transport | Train (323), Aircraft (329), Helicopter (333) |
| Impacts and security | Gunshot, gunfire (421), Explosion (420), Fireworks (426), Bang (460), Slam (352), Smash / crash (463), Glass (435), Shatter (437) |
| Voice-adjacent | Screaming (11), Shout (6), Yell (9), Crowd (64), Speech (0) |
| Music and nuisance | Music (132), Bass drum (163), Jackhammer (414), Power tool (418) |
| Animals | Dog (69), Bark (70) |
| Context | Wind noise (microphone) (279) |

The full 521-class output should still be available behind an "All classes" toggle.

---

## 6. Test protocol (how we will use it)

For each sound below, play or stage it at **three distances (near ~2 m, mid ~10 m, far ~30 m where possible)**, a few times, and log the notes:

**Sounds that should map to existing classes:** tyre screech (a video played from a speaker is fine for a first pass), car horn, siren, glass breaking, a loud bang or door slam, shouting, a scream (from a recording), a dog bark, fireworks, power tools.

**Gaps we expect the model to miss (the interesting part):** PA / tannoy announcement, bin lorry reversing, bass music through a wall, scooter or e-bike, a crowd leaving a bar.

**Real-world run:** carry the phone on a night walk past a main road or station and see what false positives appear.

Scoring: for each staged sound, was the correct class in the **top 1**, in the **top 5**, or **absent**? We will compare this with larger models later.

---

## 7. Tech stack suggestion

- Static site: **Vite + vanilla JS** (or React if the developer prefers). No backend.
- Host on **GitHub Pages, Netlify or Railway** (anything with HTTPS).
- **Do not host it as a Claude artifact:** the artifact sandbox blocks microphone access.
- Optional: a service worker so the app and model work offline after the first load (useful for a night walk with poor signal).

---

## 8. Known limits (so nobody is surprised)

- A phone is **one microphone**: no direction, no range estimate.
- Level readings are **uncalibrated**, because phone mics have unknown gain and frequency response. Do not trust the dB numbers.
- YAMNet is a small baseline. The class list has no PA announcements, bin lorries or party noise, and "scream" does not tell us whether it is distress.
- Results will vary a lot by phone model, case, wind and where the phone is held.

---

## 9. Acceptance checklist

- [ ] Runs on an iPhone and an Android phone over HTTPS
- [ ] Model and WASM files are served from our own host
- [ ] Labels update at least once per second, top 5 with scores
- [ ] Mic processing (echo cancel, noise suppression, auto gain) is off
- [ ] Watchlist panel and "Unknown" threshold work
- [ ] "Mark event" notes are stored with timestamps
- [ ] CSV and JSON export work
- [ ] No audio is stored or sent (verified in the Network tab)
- [ ] Privacy note is visible on screen

---

## 10. Next step (not part of this build)

Once we have a table of results, run the same staged sounds through a larger tagger (PANNs or EfficientAT) and through CLAP on a laptop, and compare. If CLAP handles the gap classes well, it becomes a candidate for the node. Possible in-browser route to test later: `transformers.js` has a zero-shot audio classification pipeline that can run CLAP-style models (please check the model availability before relying on it).