# Phone Sound Labeller — Developer Brief (v2)

**Purpose:** a web app that listens through a phone microphone, runs sound-labelling models **on the device**, and shows what they hear as a live, scrolling graph. It is a test rig for an "acoustic intelligence" idea, not a product. We want to learn what labels standard models give for real sounds, where they are right, where they fail, and whether CLAP beats YAMNet.

**Audience:** one developer. No backend.

## 0. What changed since v1 (read this first)

| # | Change | Why |
|---|---|---|
| 1 | The top-5 text list is replaced by **two time-series graphs** (relative level, and label scores), centred on "now", with old data drifting off the left edge | The list flickers; a graph shows how a sound builds, peaks and fades |
| 2 | **No "Unknown" anywhere.** Always show and log the model's real labels and scores | v1 replaced the real top label with "Unknown" below 0.3 and lost it from the log |
| 3 | **Relevant classes are coloured; non-relevant classes are drawn in greyscale** (and logged) | On the first test walk, irrelevant labels (typing, horse, boat, fan) cluttered the view |
| 4 | **CLAP added** as a second model, with a full prompt set (§8) | To test open-vocabulary labelling against YAMNet on the same live audio |
| 5 | **No class grouping yet.** Show YAMNet classes as the model outputs them (Aircraft and Fixed-wing aircraft stay separate) | We want to see raw behaviour first |
| 6 | No alert rules or per-class thresholds yet. Raw lines only | Add after we have seen the graphs |

**Findings from the first test (7-minute walk, iPhone, Safari)** that shaped this version:
- Speech, vehicle, motorcycle, bird and bicycle labels were correct.
- Under a rail bridge, "Explosion / Eruption / Fireworks" appeared repeatedly for ~30 s. These were false positives (sustained rumble and echo, not a sharp bang).
- An aeroplane overhead showed only weakly (Aircraft / Fixed-wing aircraft at 0.15–0.26, always below the old 0.3 threshold).
- Wind dominated outdoors (~137 of 278 labelled windows).

---

## 1. Privacy rules (acceptance criteria)

1. **Audio never leaves the phone.** No uploads, streaming or cloud calls containing audio or audio-derived data.
2. **Audio is never stored.** Only in-memory rolling buffers: ~1 s for YAMNet and ~10 s for CLAP. No recording APIs (`MediaRecorder`), no saved blobs.
3. **Only labels, scores, levels and timestamps are logged.** **Do not log or export audio embeddings** (CLAP produces them internally; they must not leave the worker).
4. No analytics or third-party trackers.
5. Show on screen: "Audio stays on this device. Only labels are logged." Verify in the browser's Network tab that nothing is sent after the page and models have loaded.

---

## 2. Models

### 2.1 YAMNet (as in v1)
- Google YAMNet, 521 AudioSet classes, ~4 MB, ~0.975 s windows at 16 kHz mono.
- Run through **MediaPipe Audio Classifier** (`@mediapipe/tasks-audio`; pin the current version — v1.1.0 was available when checked).
- Model file: `yamnet.tflite` (float32), originally published at
  `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`.
  **Download it once and host it with the app**, along with the MediaPipe `wasm/` files.
- Windows hop every ~0.5 s (adjustable).
- Request **all classes' scores**, not just the top few, and set no score threshold (so nothing is filtered out). If the API only returns top-k, set `maxResults` to the maximum (-1) so the full vector is available for the watchlist and the grey-line logic.

### 2.2 CLAP (new)
CLAP matches audio to text. We give it a fixed list of text prompts (§8) and it scores how well the current audio matches each one.

- **Variant:** start with an HTSAT-based CLAP (LAION-CLAP family). A browser route that may work is **`transformers.js`** with its zero-shot audio classification pipeline and a model such as `Xenova/clap-htsat-unfused`. **Developer to verify** the model exists, its size, licence and expected sample rate before committing.
- **Input:** ~10 s clips. Keep a **rolling 10 s buffer in memory** and run CLAP every **2–3 s** (adjustable). Until the buffer fills, zero-pad or wait.
- **Sample rate:** CLAP HTSAT models usually expect **48 kHz**. Capture at the device's native rate (typically 48 kHz) and resample to 16 kHz for YAMNet and to the CLAP rate as needed. Check the model card.
- **Run it in a Web Worker** so the UI stays smooth. Use WebGPU if available, otherwise WASM. Show a download progress bar on first load (the model may be large) and cache it with a service worker.
- **Scoring (important):**
  1. Embed each prompt phrasing once at load (text side), average the phrasings of a class, and normalise → one text vector per class.
  2. For each audio clip: cosine similarity to every class vector, multiplied by the model's logit scale.
  3. **Softmax across ALL classes, including the context and negative classes** (§8). This is deliberate: it lets probability go to "wind", "footsteps" or "quiet" instead of being forced onto the nearest "relevant" class.
  4. Plot the **softmax probability (0–1)** per class. Log both the softmax and the raw cosine.
  5. Try the prompt template **"This is a sound of {phrase}"** against the bare phrase and keep whichever scores better on the test set; make it a setting.
- **Fallback:** if CLAP is too slow or too hot on the phone, allow CLAP to run only on a laptop or desktop browser, and keep YAMNet on the phone.

### 2.3 Model switch
Settings: **YAMNet / CLAP / Both.** In "Both", draw YAMNet as solid lines and CLAP as dashed lines in the same family colour. Log both with a `model` column (§6).

---

## 3. Audio capture

- `getUserMedia` with processing off:
  ```js
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
  });
  ```
- Start from a button tap (iOS needs a user gesture).
- Use an **AudioWorklet**, not `ScriptProcessor`. Do the resampling in the worklet or worker.
- **HTTPS required** for mic access.
- Compute for every ~0.25 s block: `rms_dbfs` and `peak_dbfs` (relative level, §4.2).

---

## 4. Screen: live graph

### 4.1 Layout
- Portrait phone: **two graphs stacked** sharing one time axis. Top: relative level (~25% of height). Bottom: label scores (~65%). Controls underneath. Must also work in landscape and on desktop.
- **"Now" line fixed at the horizontal centre.** New data appears at the centre and moves left. The **right half is blank** (future). Old data drifts off the left edge.
- Default visible window: **60 s total (≈30 s of history on screen)**. Adjustable: 30 s, 60 s, 2 min, 5 min.
- Scrolling should be smooth (drawn at screen refresh rate) while data arrives in steps (YAMNet every ~0.5 s; CLAP every 2–3 s). Interpolate YAMNet lines; draw CLAP as a stepped or smoothed dashed line.
- Use a canvas-based library or custom canvas (e.g. uPlot) for performance.

### 4.2 Top graph: relative level
- Filled area of `rms_dbfs` over time, plus a thin line for `peak_dbfs`.
- **Label the axis "Relative level (uncalibrated)".** Ticks may show dBFS values, but do **not** present these as dB SPL or dB(A). Show a small note: "Phone microphones are not calibrated; use for comparison only."
- Optional shading band behind both graphs when the wind score (YAMNet "Wind" / "Wind noise (microphone)" or CLAP `wind`) is high, so the viewer sees why other lines may be suppressed. Threshold is a setting (default 0.4).

### 4.3 Bottom graph: label scores
- Y axis: score 0–1. One line per class. **No "Unknown" line and no threshold filtering.**
- **Relevant classes** (the watchlist, §7 for YAMNet and §8 for CLAP) are **coloured by family**:
  - Families: Road vehicles, Emergency and alarms, Rail and air, Impacts and security, Voice and crowd, Music and PA, Works and plant, Animals, Context (wind, rain, thunder).
  - Use a colour-blind-safe palette (e.g. Okabe–Ito), one hue per family; keep lightness readable in both light and dark themes. Classes in the same family share the hue and differ by line style or lightness. Context uses a desaturated dashed style.
- **Non-relevant classes** (every YAMNet class not on the watchlist; the CLAP negatives) are drawn in **greyscale**, thin, and **only when needed**:
  - Draw a grey line for a non-relevant class only if it is in the top 5 of some window currently visible.
  - Cap at **8 grey lines** at once, keeping those with the highest peak in the visible window. Lighter grey = lower peak.
  - Greys are never listed in the legend; their names show on tap.
- All non-relevant classes are still **logged in full** (§6).

### 4.4 Interaction
- **Tap or drag on the graph** to freeze and scrub: a vertical cursor shows the time and a readout lists the **top 5 labels with scores for each active model** at that moment (including non-relevant ones).
- **Pause / Resume** button. While paused, new data keeps being logged but the view stays still.
- **Legend:** family chips that toggle each family on and off. Tap a chip to isolate a family.
- **Mark event** button (always visible): opens a text box, saves `timestamp + note`, and draws a **vertical dashed marker with the note's text** across both graphs.
- Quick-note presets for the staged sounds in §9.
- Settings drawer: window length, hop, CLAP cadence, model switch (YAMNet / CLAP / Both), prompt template (CLAP), wind-shading threshold, theme (light / dark / system).

---

## 5. Audio windows

| Setting | Default |
|---|---|
| YAMNet window | 0.975 s |
| YAMNet hop | 0.5 s |
| CLAP window | 10 s rolling |
| CLAP cadence | every 2.5 s |

---

## 6. Logging and export

One row **per window per model**. Never write "Unknown". Always store the model's real labels.

| field | notes |
|---|---|
| `timestamp` | ISO, millisecond precision (end of window) |
| `session_id`, `device` | device = user-agent string |
| `model` | `yamnet` or `clap` |
| `window_s` | window length in seconds |
| `rms_dbfs`, `peak_dbfs` | relative, uncalibrated |
| `top1_label` … `top5_label`, `top1_score` … `top5_score` | **raw** top 5, relevant or not |
| `scores_json` | scores for **every watchlist / prompt class** (YAMNet watchlist ≈ 100 classes, CLAP all prompt classes); for CLAP include both `softmax` and `cosine` |
| `note` | free text, only on rows created by "Mark event" |

- Notes are also exported as a separate list: `{timestamp, note}`.
- **Full 521-class YAMNet vector** is optional behind a "Log all classes" toggle (off by default; it makes the file ~10× bigger).
- Export buttons: **CSV and JSON** (user-initiated download on the device). Keep the session in **IndexedDB** so a refresh does not lose it. No server storage.

---

## 7. YAMNet watchlist (coloured classes)

Match by **display name** (indices are the YAMNet class-map indices, for reference). All other YAMNet classes are non-relevant (greyscale).

| Family | Classes (index) |
|---|---|
| **Road vehicles** | Vehicle (294), Motor vehicle (road) (300), Car (301), Vehicle horn / car horn / honking (302), Toot (303), Car alarm (304), Skidding (306), Tire squeal (307), Car passing by (308), Race car (309), Truck (310), Air brake (311), Air horn / truck horn (312), Reversing beeps (313), Bus (315), Motorcycle (320), Traffic noise / roadway noise (321), Engine (337), Engine starting (345), Idling (346), Accelerating / revving (347), Heavy engine (low frequency) (343) |
| **Emergency and alarms** | Emergency vehicle (316), Police car (siren) (317), Ambulance (siren) (318), Fire engine / fire truck (siren) (319), Siren (390), Civil defense siren (391), Alarm (382), Buzzer (392), Smoke detector / smoke alarm (393), Fire alarm (394), Whistle (396) |
| **Rail and air** | Rail transport (322), Train (323), Train whistle (324), Train horn (325), Railroad car (326), Train wheels squealing (327), Subway / metro / underground (328), Aircraft (329), Aircraft engine (330), Jet engine (331), Propeller (332), Helicopter (333), Fixed-wing aircraft / airplane (334) |
| **Impacts and security** | Explosion (420), Gunshot / gunfire (421), Machine gun (422), Fusillade (423), Artillery fire (424), Fireworks (426), Firecracker (427), Burst / pop (428), Eruption (429), Boom (430), Crack (434), Glass (435), Shatter (437), Bang (460), Smash / crash (463), Breaking (464), Slam (352), Thump / thud (454) |
| **Voice and crowd** | Speech (0), Conversation (2), Shout (6), Bellow (7), Yell (9), Children shouting (10), Screaming (11), Laughter (13), Crying / sobbing (19), Cheering (61), Applause (62), Chatter (63), Crowd (64), Hubbub / speech babble (65) |
| **Music and PA** | Music (132), Drum kit (157), Bass drum (163), Pop music (211), Hip hop music (212), Heavy metal (215), House music (235), Techno (236), Electronic dance music (240), Dance music (269), Speech synthesizer (5) |
| **Works and plant** | Jackhammer (414), Hammer (413), Sawing (415), Power tool (418), Drill (419), Chainsaw (341), Lawn mower (340), Mechanical fan (406), Air conditioning (407) |
| **Animals** | Dog (69), Bark (70), Howl (72), Growling (74) |
| **Context** | Wind (277), Rustling leaves (278), Wind noise (microphone) (279), Thunderstorm (280), Thunder (281), Rain (283), Rain on surface (285), Outside, urban or manmade (503) |

Note: Eruption, Explosion and Fireworks are on the watchlist but are known to misfire on echo and rumble (e.g. under a rail bridge). Keep them visible so the misfires can be measured.

---

## 8. CLAP prompt set

**How to use:** every row is one class. Embed each phrasing, average them, and normalise to one vector per class (§2.2). The **Relevant** column decides coloured vs greyscale lines. Classes marked **No** are *negatives / context*: they exist so probability has somewhere sensible to go instead of being forced onto a relevant class. **Do not remove them** to "reduce noise".

Starting phrasings only; tune on the test set (§9) and keep a changelog. Keep each class at 3–5 phrasings.

### Road vehicles (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `tyre_screech` | tyres screeching on tarmac · a car skidding to a halt · rubber squealing on the road · a car braking hard with squealing tyres |
| `car_horn` | a car horn honking · a vehicle sounding its horn · a long blast of a car horn · short beeps of a car horn |
| `car_alarm` | a car alarm going off · a vehicle alarm wailing · a car security alarm blaring |
| `car_passing` | a car driving past · a vehicle passing on the road · a car engine passing by |
| `motorcycle` | a motorcycle revving · a motorbike driving past · a loud motorbike accelerating |
| `scooter_ebike` | an electric scooter whirring · an e-bike passing · a moped buzzing past |
| `bicycle` | a bicycle passing · a bicycle bell ringing · bicycle wheels on tarmac |
| `lorry_hgv` | a heavy lorry driving past · a large truck engine rumbling · a diesel lorry accelerating |
| `reversing_beeps` | a reversing vehicle beeping · a reversing alarm beeping repeatedly · a truck backing up with beeps |
| `bin_lorry` | a bin lorry collecting rubbish · a refuse truck compacting waste · bins being emptied into a rubbish truck · glass bottles being tipped into a recycling lorry |
| `van_idling` | a van idling at the kerb · a delivery van with its engine running · a van door sliding shut |
| `engine_idling` | a vehicle engine idling · a diesel engine ticking over · a car engine starting |
| `traffic_steady` | steady road traffic noise · a busy road in the city · distant traffic hum |

### Emergency and alarms (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `siren_police` | a police siren wailing · a police car siren passing · a two-tone police siren |
| `siren_ambulance` | an ambulance siren · an ambulance with its siren on passing by |
| `siren_fire` | a fire engine siren · a fire truck with air horn and siren |
| `siren_generic` | an emergency siren · a siren in the distance · a siren getting louder |
| `fire_alarm` | a fire alarm ringing · a smoke detector beeping · a building alarm bell |
| `intruder_alarm` | an intruder alarm sounding · a burglar alarm siren · a house alarm wailing |

### Rail and air (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `train` | a train passing · a train rumbling on the tracks · a train horn · train wheels on rails |
| `train_on_bridge` | a train rumbling across a bridge overhead · a train passing over a railway bridge · an echoing rumble under a bridge |
| `aircraft` | an aeroplane flying overhead · a jet passing over · aircraft engine noise from above · a plane on its approach |
| `helicopter` | a helicopter hovering overhead · helicopter rotor blades chopping · a police helicopter circling |

### Impacts and security (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `gunshot` | a gunshot · gunfire · a single shot from a gun · several gunshots in a row |
| `explosion` | an explosion · a loud boom · a large blast |
| `fireworks` | fireworks exploding · firecrackers going off · fireworks banging in the sky |
| `bang` | a loud bang · something heavy banging · a sudden sharp crack |
| `door_slam` | a door slamming · a heavy door slamming shut · a metal gate clanging shut |
| `glass_break` | glass breaking · a window smashing · a bottle shattering on the ground |
| `crash` | a car crash · metal crashing · vehicles colliding · a loud crash of metal and glass |
| `thud` | a heavy thud · something heavy dropping on the ground |

### Voice and crowd (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `speech` | a person talking · people having a conversation · speech nearby |
| `shouting` | a person shouting · someone yelling loudly · an angry shout |
| `scream` | a person screaming · a loud high-pitched scream · someone screaming for help |
| `crowd_chatter` | a crowd of people talking · busy crowd noise · people chattering in a crowd |
| `crowd_rowdy` | a rowdy group of people outside a pub · people cheering and shouting · a crowd singing and shouting at night |
| `laughter` | people laughing · a group laughing loudly |
| `children_playing` | children playing and shouting · kids in a playground |

### Music and PA (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `music_loud` | loud music playing · a party with loud music · music playing from speakers |
| `music_bass` | a deep bass beat thumping · bass music from a car stereo · bass thumping through a wall |
| `music_street` | a busker playing guitar · a street musician playing · live music outdoors |
| `pa_announcement` | a tannoy announcement · a public address announcement · a recorded voice announcing over a loudspeaker · a train station announcement over a speaker |

### Works and plant (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `jackhammer` | a jackhammer drilling · a pneumatic drill breaking concrete · roadworks drilling |
| `power_tool` | an angle grinder · a power drill · a circular saw cutting · an electric saw |
| `construction` | construction site noise · hammering and banging on a building site · a digger working · a crane or excavator moving |
| `garden_machinery` | a leaf blower · a lawn mower · a petrol strimmer · a hedge trimmer |
| `generator` | a diesel generator running · a generator humming |
| `hvac_plant` | an air conditioning unit humming · a ventilation fan droning · building plant machinery humming |

### Animals (Relevant: Yes)
| Class id | Phrasings |
|---|---|
| `dog` | a dog barking · dogs barking in the distance · a dog howling |
| `fox` | a fox screaming at night · a fox screeching · an urban fox calling |

### Context (Relevant: Yes, drawn dashed and muted)
| Class id | Phrasings |
|---|---|
| `wind` | wind blowing into a microphone · strong wind noise · wind buffeting a microphone · a breeze rustling leaves |
| `rain` | rain falling · heavy rain on pavement · rain on a roof |
| `thunder` | thunder rumbling · a rumble of thunder |

### Negatives and ambience (Relevant: No, greyscale)
These absorb things that should *not* count as events.

| Class id | Phrasings |
|---|---|
| `footsteps` | footsteps on pavement · someone walking · shoes clicking on a hard floor |
| `handling_noise` | a microphone being handled · rustling clothing · fabric rubbing against a microphone · fingers tapping on a phone |
| `keys_typing` | typing on a keyboard · keys jangling · a mouse clicking |
| `quiet_room` | silence · a very quiet room · faint background noise |
| `cafe` | a cafe with people chatting and cups clinking · a coffee machine hissing and steaming · background chatter in a coffee shop |
| `river_boats` | a boat engine on a river · water lapping against a riverbank · a river boat passing |
| `birds` | birds singing · a pigeon cooing · seagulls calling |
| `low_rumble` | a low frequency rumble · an echoing rumble in a tunnel · a reverberant space with distant rumbling |
| `city_ambience` | general city ambience · a distant city hum · a busy street in the background |

If a sound repeatedly lands on the wrong class, add a negative prompt for what it really was rather than deleting the wrong class.

---

## 9. Test protocol

**Real-world run:** carry the phone on a walk (route and notes in the log), use **Mark event** when something notable happens, and note the places that caused trouble (e.g. under a bridge, near trains, traffic, wind).

**Staged sounds**, three distances where possible (~2 m, ~10 m, ~30 m), a few repeats each, with a note per attempt:
- *Should map to existing classes:* tyre screech (from a speaker), car horn, siren, glass breaking, a bang or door slam, shouting, a scream (from a recording), a dog bark, fireworks, power tools, a train, an aircraft overhead.
- *Gaps we expect the models to miss:* tannoy / PA announcement, bin lorry reversing, bass music through a wall, e-scooter, a crowd leaving a bar, a fox scream.

**Fixed-position run:** put the phone on a tripod or windowsill outdoors for 1–2 hours (evening if possible) to see false alarms per hour without handling noise.

**Scoring:** for each staged sound, was the right class in the top 1, top 5, or missing, for YAMNet and for CLAP? Also count false positives per hour per class from the fixed-position run. CLAP wins only if it improves the gap sounds **without** adding new false alarms (check especially: bridge rumble, wind, footsteps).

---

## 10. Hosting and stack

- Static site, **Vite + vanilla JS** (or React). Host on GitHub Pages, Netlify or Railway (HTTPS). Not as a Claude artifact (the artifact sandbox blocks mic access).
- Service worker to cache the app and models for offline use after the first load.
- Run CLAP in a Web Worker. Test thermal behaviour and battery when running both models together on a phone.

---

## 11. Known limits

- A phone is **one microphone**: no direction or range.
- **Level is relative and uncalibrated.** Do not treat it as real dB.
- CLAP is heavier; it may be too slow on some phones.
- CLAP scores are not calibrated; the softmax shows relative preference among our classes, not absolute confidence.
- Results vary by phone model, case, wind and how the phone is held.
- A moving, handheld test is harder than a fixed node will be (handling noise, footsteps); the fixed-position run is the fairer test of the product idea.

---

## 12. Developer checks (not verified by the brief's author)

- [ ] Current MediaPipe version and that it can return the full score vector.
- [ ] CLAP model availability in the browser (e.g. `transformers.js`), size, licence, expected sample rate, and phone performance.
- [ ] Safari AudioContext sample-rate behaviour on iPhone.
- [ ] WebGPU availability on the target iOS and Android browsers.

---

## 13. Acceptance checklist

- [ ] Runs on an iPhone and an Android phone over HTTPS
- [ ] Models and WASM files served from our own host
- [ ] Two stacked graphs, "now" line centred, history drifting left, right half blank
- [ ] Relative level graph labelled "uncalibrated"
- [ ] Relevant classes coloured by family; non-relevant in greyscale, max 8 grey lines, drawn only when in a visible top 5
- [ ] No "Unknown" anywhere; real labels always shown and logged
- [ ] Model switch: YAMNet / CLAP / Both (solid vs dashed)
- [ ] Tap/drag to freeze and read the top 5 per model at that time
- [ ] Mark event draws a labelled vertical marker and is logged
- [ ] Log has raw top 5 plus watchlist / prompt scores per model; CSV and JSON export work
- [ ] No audio or embeddings stored or sent (verified in the Network tab)
- [ ] Privacy note visible on screen