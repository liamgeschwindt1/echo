# Phone Sound Labeller v2.2: Developer Brief

**Status:** replaces v2 and the v2.1 bug-fix request. Everything in v2.1 is still required (section 12).
**Audience:** one developer.
**Test rig, not a product.** A phone web app that listens, runs two sound models on the device, turns what it hears into *periods* (start, end, label, confidence), and produces a report an estate manager or security lead could read.

---

## 0. What is new in v2.2

1. **One label list, no "security" and "nuisance" split.** Each label has a priority that depends on the time of day. Shouting at 12:00 is a log entry, and at 03:00 it is an alert.
2. **Periods instead of single timestamps.** The audio level finds where a sound starts and stops. The models then label each period, using only the readings inside it.
3. **Both models run together by default** (YAMNet and CLAP).
4. **New CLAP label set** with specific prompts and deliberate "confuser" classes (section 7).
5. **CLAP window option:** 10 s (current) or 5 s, selectable in settings.
6. **Original model labels are always kept** next to the family and the specific label.
7. **Gemini report.** A small Railway backend sends the labels (never audio) to Gemini, which cleans, merges and scores the periods and writes a plain-language summary.
8. **Two outputs:** a raw JSON download for debugging, and a "View results" HTML report with a timeline on the left and the outcomes on the right.
9. **Clean main screen.** Complex options go in Settings. The live graph is behind a button.

**Non-goals for this version:** model caching or faster redeploys (the current behaviour is fine for testing), direction finding, flight-data matching, push notifications, user accounts.

---

## 1. Objectives (what the test must show)

1. Detect and name the sounds in the label list (section 7) at a useful level of reliability, using YAMNet and CLAP together.
2. Catch the "3am bang": a sudden, loud, unexplained impact in quiet hours, even when no label fits.
3. Report **periods**, with start, end, duration, level, label and confidence, so the timeline makes sense to a person.
4. Compare the models fairly: YAMNet alone, CLAP alone (10 s and 5 s) and the two combined.
5. Keep false alarms low. The number of alerts worth acting on matters more than the raw detection score.
6. Show constant loud sources (plant hum, a generator, steady traffic, amplified music) by level and duration.

---

## 2. Hard rules (privacy)

Treat these as acceptance criteria.

1. **Audio never leaves the phone.** No uploads, no streaming, no cloud calls with audio or anything audio-derived (this includes raw spectrograms and CLAP/YAMNet embeddings).
2. **Audio is never stored.** Keep only the rolling buffer needed for the current window in memory. No `MediaRecorder`, no saved blobs.
3. **What may leave the phone:** labels, scores, levels, timestamps and the user's own notes, in one request, to our own backend (section 10), only when the user taps **View results**.
4. **No analytics or third-party trackers** on the page.
5. **Transparency:** Settings has a "Preview what will be sent" button that shows the exact JSON (and its size) before it is posted. The Network tab must show no requests after load except `POST /api/report`.
6. The backend does not store or log request bodies (section 10).
7. Visible note on the main screen: "Audio stays on this device. Only labels and levels are used."

---

## 3. Architecture

```
iPhone / Android browser (static app)
  mic -> AudioWorklet -> level meter (10 Hz) --------------+
                      -> YAMNet (MediaPipe, WASM)          |
                      -> CLAP (transformers.js, Worker)    |
                                |                          v
                          window results ---> period builder (deterministic)
                                                    |
                                       session JSON (labels only)
                                                    |  POST /api/report  (user taps "View results")
                                                    v
Railway server (Node) --- GEMINI_API_KEY (env) ---> Gemini Flash
                                                    |
                                       validated report JSON
                                                    v
                          HTML report (timeline left, outcomes right)
```

- The browser app is static (Vite and vanilla JS, or React if you prefer).
- The server is a tiny Node/Express app on Railway that serves the static files and exposes `POST /api/report`.
- Model files (YAMNet, MediaPipe WASM, CLAP) are self-hosted. Current loading behaviour is acceptable for testing.
- The Gemini key must never reach the browser.
- Do not host as a Claude artifact. The sandbox blocks the microphone.

---

## 4. Screens

### 4.1 Main screen (keep it clean)

Top to bottom:
- Title and the privacy note.
- Large **Start / Stop** button, and elapsed time.
- Status chips: "YAMNet running", "CLAP running", each with the time of its last run (for example "CLAP 2 s ago"). If a model stops or errors, the chip turns red and shows the reason. Never leave a frozen result on screen.
- A small level meter.
- **Clip tag** button with preset chips (siren, train, plane, car revving, bang, music, other) and a free-text box. Tapping stores `timestamp + tag` as a note. This is the ground truth for scoring.
- Buttons: **Live graph**, **View results**, **Download JSON**, and a gear for **Settings**.
- No label lists or scores on the main screen.

View results is enabled once at least one period exists. Download JSON is always enabled.

### 4.2 Settings

Group the options and give each a short explanation.

- **Models:** YAMNet on/off, CLAP on/off (both on by default). CLAP window: 10 s (default) or 5 s. CLAP hop (default 2.5 s). YAMNet window 0.975 s and hop 0.5 s.
- **Period detection:** on-threshold (default floor + 8 dB), off-threshold (floor + 4 dB), minimum duration (0.5 s), merge gap (1.5 s), impulse rise (12 dB), sustained threshold (5 min).
- **Time of day:** day 07:00-19:00, evening 19:00-23:00, night 23:00-07:00 (local time, editable).
- **Session:** optional label, optional free-text location, optional latitude and longitude (reserved for later flight matching, stored in the JSON only).
- **Display:** local time or UTC, theme.
- **Advanced:** show the preview of what will be sent; reset to defaults.

Settings are saved on the device and written into every export (`settings` block).

### 4.3 Live graph (button on the main screen, full-screen overlay)

Carried over from v2, with changes marked **new**.
- Two stacked graphs share a time axis. The "now" line sits at the horizontal centre, and the right half is blank. Default window 60 s (adjustable).
- **Top graph:** relative level, labelled "Relative level (uncalibrated)". **New:** shade the detected periods as bands.
- **Bottom graph:** scores from 0 to 1. Labels in the target families are coloured by family (Okabe-Ito palette). Context labels are greyscale, drawn only when in the current top 5, maximum 8 lines. No "Unknown" anywhere.
- Model switch: YAMNet / CLAP / Both (solid lines for YAMNet, dashed for CLAP).
- **New:** a y-axis toggle for the CLAP graph, "Fixed 0-1" or "Auto".
- Closing the overlay does not stop the session. Do not draw while hidden.

### 4.4 Results report (View results)

Described in section 11.

---

## 5. Audio capture and models

### 5.1 Capture
- `getUserMedia` with `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`, `channelCount: 1`.
- Start from a button tap (iOS needs a gesture). HTTPS is required.
- Use an **AudioWorklet**. Create the `AudioContext` at 16 kHz where supported, and otherwise resample (test on Safari). CLAP needs 48 kHz, so resample separately for that model.
- Compute the level every 100 ms: RMS in dBFS and peak in dBFS. These are relative, not calibrated, and the UI must say so.

### 5.2 YAMNet
- MediaPipe Audio Classifier (`@mediapipe/tasks-audio`, pin the version) with `yamnet.tflite`. Self-host the model and the WASM files.
- Window 0.975 s (15,600 samples), hop 0.5 s. Keep all 521 sigmoid scores per window. Score values are independent per class, so parent and child classes fire together (for example Aircraft and Fixed-wing aircraft).
- Median inference is about 12 ms. Log `infer_ms`.

### 5.3 CLAP
- Suggested route: transformers.js with `Xenova/clap-htsat-unfused` (please verify availability and size). 48 kHz audio.
- **Text side is precomputed.** For each class, embed its prompt phrases (section 7.2) with the template `"This is a sound of {phrase}"`, L2-normalise, average the phrases and re-normalise. Ship the result as a JSON file, or compute once at load. There is no text-model cost at runtime.
- **Scoring (this fixes a bug):** for each window compute the cosine similarity `s_i` between the audio embedding and every class embedding, then
  `p_i = softmax(logit_scale * s_i)` across **all** classes including the context and confuser classes. Use the model's own `logit_scale_a` (about 100 in the config; verify). Log both `cosine` and `softmax` per class. They must differ, and the softmax values must sum to 1.0 (within 0.001).
- Window W = 10 s (default) or 5 s. The encoder expects a fixed input length, so shorter audio is padded or repeated. Record which behaviour is used, and compare 5 s against 10 s in testing (section 13).
- Hop default 2.5 s. **Never start a run while one is still in progress**: skip the tick instead of queueing. Run in a Web Worker.
- Target: one run every 2.5-5 s on an iPhone 13 Pro (it is currently about 1 s per run). If this can't be met, report the real figure instead of silently slowing down.
- A CLAP window ending at time `t` covers `[t - W, t]`. This lag matters for period labelling (section 6.3).
- If the worker errors, stalls or runs out of memory, show "CLAP stopped: reason" on the main screen.

---

## 6. Level, periods and rules

### 6.1 Period detection (deterministic, runs on the phone, no AI)

Input: the 10 Hz level series.
1. **Noise floor:** rolling 10th percentile of the level over the previous 120 s (use the first 10 s of the session until enough history exists).
2. **Start:** level above `floor + on_threshold` (default 8 dB) for at least 0.5 s. **End:** level below `floor + off_threshold` (default 4 dB) for at least 2 s. Merge periods separated by less than 1.5 s.
3. **Impulse periods:** a rise of at least 12 dB within 200 ms that ends within 1.5 s. These may be as short as 0.1 s. Mark `onset: "impulse"`. Other periods are `onset: "gradual"`.
4. **Sustained:** if the level stays at least 6 dB above the floor for the sustained threshold (default 5 min), set `sustained: true`. For periods longer than 60 s also store `segments` (the pooled label for each 30 s).
5. Each period gets an id (`p001`, `p002`, ...), `start`, `end`, `duration_s`, `level_avg_dbfs`, `level_peak_dbfs`, `floor_dbfs`, `delta_over_floor_db` and `time_of_day` (day, evening or night, by local start time).

### 6.2 Labelling a period

For each model, pool the readings that belong to the period:
- **YAMNet:** readings whose 0.975 s window overlaps the period by at least 50%. Per window, a family's score is the maximum of its YAMNet labels' scores (mapping in section 7.3). Pool by mean and by max across windows. Also pool each raw label.
- **CLAP:** readings whose window `[t - W, t]` overlaps the period by at least 60% of the period's duration (or has at least 60% of its own span inside the period). Pool the softmax by mean. A family's score is the **sum** of its class probabilities.
- Mark `clap_unreliable: true` if the period is shorter than 3 s or no CLAP reading qualifies. In that case rely on YAMNet and the level.

For each period store the top 3 labels per model (raw label, specific label, family, pooled mean and max, number of readings).

**Agreement:**
- `agree`: both models' top families match, and both pooled scores are above their minimum (YAMNet 0.20, CLAP 0.30, adjustable).
- `partial`: only one model is above its minimum.
- `disagree`: both are above their minimum but the families differ.
- `none`: neither is above its minimum.

### 6.3 Why the pooling matters
In the 13 October test, clips were 3-5 s apart and CLAP's 10 s window still contained the end of the previous clip, so CLAP's labels trailed the sound by up to a window. Pooling only the readings mostly inside a period, and ignoring the straddling ones, is the fix. Test clips should be at least 10 s apart (section 13).

### 6.4 Rule: unexplained loud event (the "3am bang")
If a period is an impulse, has `delta_over_floor_db >= 15`, and agreement is `none` (or the top labels are context only), label it `unexplained_impact`, family `impacts_breakage`. This is a deterministic rule and does not depend on the models naming the sound. The label list is not used for this. Its priority comes from the table in section 8.

### 6.5 Rule: sustained sources
A period with `sustained: true`, or any label in the sustained set (hvac_hum, generator, traffic_steady, vehicle_idling, music_loud, music_bass, party_noise, crowd_chatter, pressure_washer, leaf_blower), is reported with its duration and average level. It is flagged by level and duration, not by the model's confidence alone. The default flag is: at least 6 dB over the floor for at least 5 minutes.

---

## 7. Labels

One list. Every row has a role:
- **target:** a sound we want to report.
- **confuser:** a lookalike that exists so confusable sounds have somewhere to go (fireworks and backfires for gunshots, a fox's scream for a human scream, bottles tipped into a bin for breaking glass, thunder for explosions, a train rumbling over a bridge for an explosion). Report it as itself and never merge it into its lookalike.
- **context:** reported only in the raw data, never as an event.

**Always keep three levels in the data:** `label` (specific, e.g. `siren_police`), `family`, and `raw_label` (YAMNet's original display name, or CLAP's class name).

### 7.1 Families and classes (73 classes)

| Family | Classes (role) |
|---|---|
| `gunshots_blasts` | gunshot (target), explosion (target), fireworks_bang (confuser), fireworks_crackle (confuser), vehicle_backfire (confuser), thunder (confuser) |
| `impacts_breakage` | glass_break (target), bottle_bank (confuser), door_slam (target), metal_bang (target), heavy_thud (target), crash (target) |
| `voices_crowds` | scream (target), fox_scream (confuser), shouting (target), argument (target), crowd_rowdy (target), chanting_singing (target), crowd_chatter (target), laughter (target) |
| `alarms_signals` | fire_alarm (target), intruder_alarm (target), car_alarm (target), reversing_beeps (target), car_horn (target), pa_announcement (target) |
| `sirens` | siren_police, siren_ambulance, siren_fire, siren_generic (all target). **Family score is the sum of the four**, because CLAP often picks the wrong siren type. |
| `road_vehicles` | engine_revving (target), exhaust_crackle (target), motorcycle (target), scooter_ebike (target), tyre_screech (target), car_passing (target), vehicle_idling (target), traffic_steady (target) |
| `aircraft` | plane_flyover (target), plane_landing_takeoff (target), helicopter (target), drone (target) |
| `rail_water` | train_passing (target), train_on_bridge (confuser), light_rail (target), boat_horn (target) |
| `music_amplified` | music_loud (target), music_bass (target), music_street (target), car_stereo (target), party_noise (target) |
| `works_construction` | jackhammer, drill_saw, angle_grinder, hammering_piling, scaffold_clatter, pressure_washer, leaf_blower (all target) |
| `plant_services` | hvac_hum (target), generator (target), bin_lorry (target), roller_shutter (target), delivery_trolley (target) |
| `animals` | dog_barking (target) |
| `context` | wind_on_mic, wind, rain, speech_normal, footsteps, handling_noise, quiet_room, birds, street_background (all context) |

**Removed from the previous set** (they hurt the output or don't serve the families): `keys_typing`, `bicycle`, `children_playing`, `river_boats`, `low_rumble`, `city_ambience` (replaced by `street_background`), `cafe` (merged into `crowd_chatter`), and the separate `train_on_bridge`-style catch-alls other than the one confuser kept above.

Aircraft stay in the list. Planes and helicopters are a nuisance that estates need to measure, even though they can't be moved. Later (not in this version) detected aircraft periods will be matched against public flight data as a free accuracy check. Store the optional latitude and longitude for that.

### 7.2 CLAP prompts

Template: `"This is a sound of {phrase}"`. Use every phrase for the class, average the normalised embeddings (section 5.3). One concrete sound per phrase, no abstract words. Developer: please sanity-check each class against test clips and tell us which prompts misbehave.

**gunshots_blasts**
- `gunshot`: "a gunshot"; "a loud gunshot echoing between buildings"; "several gunshots in a row"
- `explosion`: "an explosion"; "a loud explosion with a deep boom"; "a large blast"
- `fireworks_bang`: "a firework exploding in the sky"; "a loud firework bang"
- `fireworks_crackle`: "fireworks crackling and popping"; "firecrackers going off"
- `vehicle_backfire`: "a car backfiring"; "an exhaust backfire with a loud pop"
- `thunder`: "thunder rumbling"; "a loud crack of thunder"

**impacts_breakage**
- `glass_break`: "glass breaking"; "a window smashing"; "a glass shattering on the ground"
- `bottle_bank`: "bottles being tipped into a recycling bin"; "glass bottles clinking and crashing into a container"
- `door_slam`: "a door slamming"; "a heavy door banging shut"
- `metal_bang`: "someone banging on metal"; "a loud metallic clang"; "a metal gate or shutter being hit"
- `heavy_thud`: "a heavy thud"; "something heavy being dropped"
- `crash`: "a loud crash"; "a vehicle collision"; "objects crashing to the ground"

**voices_crowds**
- `scream`: "a person screaming"; "a woman screaming"; "a loud scream in the street"
- `fox_scream`: "a fox screaming at night"; "an animal shrieking"
- `shouting`: "a person shouting"; "a man yelling loudly outside"
- `argument`: "two people having a loud argument"; "angry shouting between people"
- `crowd_rowdy`: "a rowdy crowd shouting and cheering"; "a drunk crowd outside a bar"
- `chanting_singing`: "people chanting"; "drunk people singing loudly"
- `crowd_chatter`: "a crowd of people talking outdoors"; "people chatting on a restaurant terrace"
- `laughter`: "people laughing loudly"; "a group laughing"

**alarms_signals**
- `fire_alarm`: "a fire alarm ringing"; "a smoke alarm beeping"
- `intruder_alarm`: "a burglar alarm sounding"; "a building alarm bell ringing continuously"
- `car_alarm`: "a car alarm going off"; "a car alarm with changing tones"
- `reversing_beeps`: "a vehicle reversing beep"; "a lorry reversing alarm beeping"
- `car_horn`: "a car horn honking"; "a long blast of a car horn"
- `pa_announcement`: "a public address announcement"; "a loudspeaker announcement"

**sirens**
- `siren_police`: "a police siren wailing"; "a police car siren passing by"
- `siren_ambulance`: "an ambulance siren"; "an ambulance siren passing by"
- `siren_fire`: "a fire engine siren"; "a fire truck siren and air horn"
- `siren_generic`: "an emergency siren"; "a siren getting louder and then fading"

**road_vehicles**
- `engine_revving`: "a car engine revving loudly"; "a sports car accelerating hard"
- `exhaust_crackle`: "a car exhaust crackling and popping"; "an exhaust popping on deceleration"
- `motorcycle`: "a motorcycle passing"; "a motorbike revving"
- `scooter_ebike`: "an electric scooter whining past"; "an electric bike passing"
- `tyre_screech`: "tyres screeching"; "a car skidding"
- `car_passing`: "a car driving past"; "a vehicle passing on a road"
- `vehicle_idling`: "a van idling"; "a lorry engine idling"
- `traffic_steady`: "steady road traffic"; "continuous traffic noise from a busy road"

**aircraft**
- `plane_flyover`: "an aeroplane flying overhead"; "a passenger jet passing overhead"
- `plane_landing_takeoff`: "an aeroplane landing"; "a jet taking off with engines roaring"
- `helicopter`: "a helicopter flying overhead"; "helicopter rotor blades"
- `drone`: "a small drone buzzing"; "a quadcopter drone whining"

**rail_water**
- `train_passing`: "a train passing"; "a train rumbling along the track"
- `train_on_bridge`: "a train rumbling over a bridge"; "a deep rumble from a train overhead"
- `light_rail`: "a light rail train arriving at a station"; "a metro train passing with a whine"
- `boat_horn`: "a ship horn"; "a boat sounding its horn on the water"

**music_amplified**
- `music_loud`: "loud music playing"; "amplified music from a speaker"
- `music_bass`: "heavy bass music through a wall"; "thumping bass from a party"
- `music_street`: "a street musician playing"; "live music being played outside"
- `car_stereo`: "loud music from a car stereo"; "bass from a passing car"
- `party_noise`: "a house party with music and people"; "a noisy party with shouting and music"

**works_construction**
- `jackhammer`: "a jackhammer"; "a pneumatic drill breaking concrete"
- `drill_saw`: "an electric drill"; "a power saw cutting"
- `angle_grinder`: "an angle grinder cutting metal"; "a grinder screeching"
- `hammering_piling`: "hammering on a building site"; "a piling rig thumping"
- `scaffold_clatter`: "scaffolding poles clattering"; "metal poles dropped on the ground"
- `pressure_washer`: "a pressure washer"; "a high pressure jet washer running"
- `leaf_blower`: "a leaf blower"; "a petrol garden blower running"

**plant_services**
- `hvac_hum`: "an air conditioning unit humming"; "a constant ventilation fan drone"
- `generator`: "a diesel generator running"; "a portable generator droning"
- `bin_lorry`: "a bin lorry compacting rubbish"; "a refuse truck emptying bins"
- `roller_shutter`: "a metal roller shutter being opened"; "a roller shutter rattling"
- `delivery_trolley`: "a delivery trolley rattling over paving"; "a metal cage trolley being wheeled"

**animals**
- `dog_barking`: "a dog barking"; "a dog barking repeatedly"

**context**
- `wind_on_mic`: "wind blowing into a microphone"; "wind noise buffeting"
- `wind`: "wind blowing"; "a strong breeze"
- `rain`: "rain falling"; "heavy rain on the pavement"
- `speech_normal`: "people talking normally"; "a quiet conversation"
- `footsteps`: "footsteps on a pavement"; "someone walking"
- `handling_noise`: "a phone being handled"; "rustling and fumbling on a microphone"
- `quiet_room`: "a quiet room"; "silence with faint background noise"
- `birds`: "birds singing"; "birdsong"
- `street_background`: "general city street background noise"; "distant city ambience"

### 7.3 YAMNet raw label to family mapping (names verified against `yamnet_class_map.csv`, index in brackets)

Match by display name. Keep the raw label in the log. A raw label not listed here has family `other` and is logged only.

- **gunshots_blasts:** Gunshot, gunfire (421); Machine gun (422); Explosion (420); Fireworks (426); Firecracker (427); Burst, pop (428); Eruption (429); Boom (430); Bang (460); Crack (434); Thunder (281); Thunderstorm (280)
- **impacts_breakage:** Glass (435); Shatter (437); Smash, crash (463); Breaking (464); Slam (352); Thump, thud (454); Knock (353); Clang (478); Clatter (483); Chink, clink (436); Door (348); Wood (431)
- **voices_crowds:** Screaming (11); Shout (6); Yell (9); Bellow (7); Whoop (8); Crowd (64); Hubbub, speech noise, speech babble (65); Chatter (63); Cheering (61); Laughter (13); Chant (27); Singing (24); Children shouting (10)
- **alarms_signals:** Alarm (382); Fire alarm (394); Smoke detector, smoke alarm (393); Buzzer (392); Car alarm (304); Vehicle horn, car horn, honking (302); Air horn, truck horn (312); Reversing beeps (313); Beep, bleep (475); Foghorn (395)
- **sirens:** Siren (390); Police car (siren) (317); Ambulance (siren) (318); Fire engine, fire truck (siren) (319); Emergency vehicle (316); Civil defense siren (391)
- **road_vehicles:** Vehicle (294); Car (301); Car passing by (308); Motor vehicle (road) (300); Engine (337); Light engine (338); Medium engine (342); Heavy engine (343); Engine knocking (344); Engine starting (345); Idling (346); Accelerating, revving, vroom (347); Motorcycle (320); Traffic noise, roadway noise (321); Truck (310); Bus (315); Tire squeal (307); Skidding (306); Air brake (311)
- **aircraft:** Aircraft (329); Fixed-wing aircraft, airplane (334); Aircraft engine (330); Jet engine (331); Propeller, airscrew (332); Helicopter (333)
- **rail_water:** Train (323); Rail transport (322); Railroad car, train wagon (326); Subway, metro, underground (328); Train horn (325); Boat, Water vehicle (295); Motorboat, speedboat (298); Ship (299)
- **music_amplified:** Music (132); Bass drum (163); Drum (159); Techno (236); Dance music (269); Electronic music (234); Hip hop music (212); Dubstep (237); Pop music (211); Drum machine (158)
- **works_construction:** Jackhammer (414); Drill (419); Power tool (418); Sawing (415); Hammer (413); Chainsaw (341); Lawn mower (340); Sanding (417); Tools (412)
- **plant_services:** Mechanical fan (406); Air conditioning (407); Pump (liquid) (448); Hum (490); Mains hum (510); Rumble (487); Whir (482); Vacuum cleaner (371)
- **animals:** Dog (69); Bark (70); Domestic animals, pets (68); Howl (72); Growling (74)
- **context:** Wind (277); Wind noise (microphone) (279); Rain (283); Rain on surface (285); Speech (0); Walk, footsteps (48); Silence (494); Inside, small room (500); Outside, urban or manmade (503); Outside, rural or natural (504); White noise (514); Noise (507); Radio (519); Television (518); Bird (106)

Known YAMNet behaviour from our tests (do not "fix" in code, just be aware): a rail bridge rumble produced false Explosion/Eruption; planes were labelled Breathing/Snort; wind dominates outdoors.

---

## 8. Priority by time of day

Four priority levels: `ignore` (never shown), `log` (listed in the report), `flag` (highlighted), `alert` (the event a security team would be paged about; in this version it is only a field and a highlight, no notifications).

Periods use the local time at the period's start (section 4.2).

| Label(s) | Day | Evening | Night |
|---|---|---|---|
| gunshot, explosion | alert | alert | alert |
| glass_break, scream | alert | alert | alert |
| fire_alarm, intruder_alarm, car_alarm | alert | alert | alert |
| fireworks_*, vehicle_backfire, thunder, fox_scream, train_on_bridge (confusers) | flag | flag | flag |
| bottle_bank | log | flag | flag |
| door_slam, metal_bang, heavy_thud, crash | log | flag | alert |
| unexplained_impact (rule 6.4) | log | flag | alert |
| shouting, argument, chanting_singing | log | flag | alert |
| crowd_rowdy | flag | flag | alert |
| crowd_chatter, laughter | log | log | flag |
| reversing_beeps | log | flag | alert |
| car_horn, pa_announcement | log | log | flag |
| siren_* (family) | flag | flag | flag |
| engine_revving, exhaust_crackle, motorcycle, scooter_ebike | log | flag | alert |
| tyre_screech | flag | flag | alert |
| car_passing, traffic_steady | log | log | log |
| vehicle_idling | log | flag | flag |
| plane_flyover, plane_landing_takeoff | log | log | log |
| helicopter | log | log | flag |
| drone | flag | flag | alert |
| train_passing, light_rail | log | log | log |
| boat_horn | log | flag | flag |
| music_loud, music_bass, car_stereo, party_noise | log | flag | alert |
| music_street | log | log | flag |
| jackhammer, drill_saw, angle_grinder, hammering_piling, pressure_washer, leaf_blower | log | flag | alert |
| scaffold_clatter | log | flag | alert |
| hvac_hum, generator | log (flag if sustained) | flag | flag |
| bin_lorry, roller_shutter | log | flag | alert |
| delivery_trolley | log | log | flag |
| dog_barking | log | flag | flag |
| context classes | ignore | ignore | ignore |

The table lives in one config file (`priorities.json`) so it can be edited without code changes. Gemini may raise a priority with a stated reason, but never lower it (section 10).

---

## 9. Data: the JSON export ("Download JSON")

For debugging. It is the source of truth, and the report is built from it. One file per session, downloaded to the device. Timestamps are ISO 8601 UTC with milliseconds, plus the timezone info.

```jsonc
{
  "schema_version": "2.2",
  "meta": {
    "session_id": "…", "started_at": "…Z", "ended_at": "…Z",
    "tz_name": "Europe/London", "tz_offset_min": 60,
    "device": "<user agent>", "app_version": "…",
    "session_label": "", "location_text": "", "lat": null, "lon": null
  },
  "settings": { /* every setting, section 4.2 */ },
  "label_catalogue_version": "2.2",
  "rows": [ /* one per model run, see below */ ],
  "level_series": [ /* 1 Hz: {t, rms_dbfs, peak_dbfs} */ ],
  "periods": [ /* section 6, one object per period */ ],
  "notes": [ {"timestamp": "…Z", "text": "police siren from laptop"} ],
  "report": null,
  "errors": [ {"timestamp": "…Z", "source": "clap", "message": "…"} ]
}
```

**Row fields** (one per model run):
`timestamp, session_id, device, model ("yamnet" | "clap"), window_s (the real audio window: 0.975, 10 or 5), infer_ms, rms_dbfs, peak_dbfs, top1_label … top5_label, top1_score … top5_score, top1_family, scores_json, note`.
- `top*_label` is always the raw top label. Never replace it with "Unknown" in the log.
- For YAMNet, `scores_json` holds `{label: score}`; for CLAP it holds `{class: {softmax, cosine}}`. Round to 4 decimal places and drop values below 0.001 to keep the file small.
- `top1_family` comes from the mapping in sections 7.1 and 7.3.

**Period fields:**
```jsonc
{
  "id": "p003", "start": "…Z", "end": "…Z", "duration_s": 14.2,
  "onset": "gradual",             // or "impulse"
  "time_of_day": "night",
  "level_avg_dbfs": -37.2, "level_peak_dbfs": -29.1,
  "floor_dbfs": -66.0, "delta_over_floor_db": 28.8,
  "sustained": false,
  "yamnet": { "n": 24, "top": [ {"raw_label": "Police car (siren)", "label": "siren_police", "family": "sirens", "mean": 0.78, "max": 0.92} ] },
  "clap":   { "n": 5, "window_s": 10, "clap_unreliable": false,
              "top": [ {"class": "siren_fire", "family": "sirens", "mean": 0.33}, … ],
              "family_scores": { "sirens": 0.74 } },
  "agreement": "agree",           // agree | partial | disagree | none
  "rule_flags": [],                // "unexplained_impact", "sustained"
  "default_priority": "flag",
  "notes_in_period": [ … ],
  "segments": []                   // only for periods > 60 s
}
```

---

## 10. Backend and Gemini

### 10.1 Server
- Node/Express on Railway. Serves the static app and `POST /api/report`.
- Environment variables: `GEMINI_API_KEY` (required), `GEMINI_MODEL` (default `gemini-3.8-flash`), `MAX_BODY_BYTES` (default 2 MB), `RATE_LIMIT_PER_MIN` (default 10).
- **Model name:** `gemini-3.8-flash` is Google's current generally available Flash model (docs updated 9 October 2026). Use this pinned name and keep it in the env variable. Do **not** use the moving alias `gemini-flash-latest`. Please re-check the model list at build time in case a newer Flash has shipped.
- Follow the Gemini 3.x notes: set `thinking_level` (default `medium`; `low` is fine if reports are slow), and do not send `temperature`, `top_p`, `top_k`, `candidate_count` or prefilled model turns. Use structured output (JSON mode with a response schema) and check the current docs for the exact parameter names.
- Same-origin only. No CORS.
- **Do not log request or response bodies** and do not store anything. The server is stateless.
- Timeout 60 s, one retry on 429 or 5xx, then return an error. The client falls back to the basic report (section 11.4).

### 10.2 Request (client to server)
The client sends a trimmed copy of the JSON export: `meta` (without the device string), `settings` summary, `periods`, `level_series`, `notes`, and the label catalogue (family and priority tables). It does **not** send `rows`. The server forwards this to Gemini with the instruction below.

### 10.3 What Gemini does and does not do
**Does:** merge adjacent periods that are clearly one sound; choose the final label from the models' evidence; set the confidence; flag disagreements between the models; note data-quality problems (wind, CLAP lag, short periods); raise priority with a reason; write the plain-language summary and the quiet-hours summary.

**Does not:** invent events, times or labels; add anything that does not trace back to a `period_id`; use knowledge from outside the provided data; lower a priority.

**System instruction (use as written, edit as needed):**
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

### 10.4 Response schema
```jsonc
{
  "summary": { "headline": "…", "counts_by_priority": {"alert":0,"flag":0,"log":0},
               "quiet_hours_summary": "…", "overall_notes": ["…"] },
  "events": [ {
      "period_ids": ["p003"],
      "final_label": "siren_police", "family": "sirens",
      "priority": "flag", "priority_raised": false, "priority_reason": null,
      "confidence": 0.86, "agreement": "agree",
      "matches_note": true,
      "explanation": "YAMNet police siren at 0.78; CLAP siren family 0.74.",
      "flags": []
  } ],
  "merges": [ {"period_ids": ["p004","p005"], "reason": "…"} ],
  "data_quality": [ {"period_ids": ["p006"], "issue": "CLAP window overlaps previous clip"} ]
}
```

### 10.5 Server-side validation (required)
- Parse and validate against the schema.
- Drop (and list in `validation.dropped`) any event whose `period_ids` do not exist in the request, any `final_label` not in the catalogue, any lowered priority (reset to the default), and any confidence outside 0 to 1.
- Attach `validation`, `model` (the Gemini model used), `generated_at` and `usage` (token counts) to the response.
- If validation removes everything, return the deterministic fallback.

---

## 11. Results report

### 11.1 When and how
- Tapping **View results** posts the trimmed JSON to `/api/report` (with a loading state), then shows the report. The result is saved with the session on the device (IndexedDB), so reopening does not call Gemini again. A **Regenerate** button re-runs it.
- The report is rendered in the app and can be downloaded as one self-contained HTML file (inline CSS and JS, no external requests, works offline).

### 11.2 Layout
- **Desktop (≥ 900 px):** two columns. Left (about 35%): the timeline. Right (about 65%): the outcomes.
- **Phone:** a single scrolling column. A thin vertical time rail runs down the left edge, with a coloured marker for each event, and the outcome card sits to the right of its marker. The page scrolls vertically. No horizontal scrolling anywhere.
- Light and dark themes (follow the system theme), readable at 400 px wide, 16 px side margins.

### 11.3 Contents
**Header:** session label, date, local start and end time and duration, device, models on, CLAP window, Gemini model and generation time, and the headline sentence. A banner if Gemini was not used (section 11.4).

**Summary strip:** counts by priority (alert, flag, log), number of model disagreements, number of quiet-hours events.

**Timeline (left):**
- Time axis in local time (toggle UTC).
- One bar per event, coloured by family (Okabe-Ito palette; context in grey), height or width scaled to duration.
- A small level sparkline behind the bars.
- A toggle, default on, that collapses long silent gaps.
- Tapping a bar scrolls to its card, and scrolling highlights the matching bar.
- User notes appear as small markers.

**Outcome cards (right):** sorted by time. Each card shows:
- Time range and duration, and the time-of-day bucket.
- Final label (large), family, priority badge (alert, flag, log), and confidence.
- A line for agreement: "Both models agree", "Only YAMNet", "Models disagree", or "Neither model sure".
- Both models' evidence, with the **original labels kept**: YAMNet raw label and score, CLAP class and score.
- Level: average, peak and amount above the noise floor (labelled "relative").
- Gemini's explanation and flags, any merged periods, and any user note near it with "matches note: yes/no".
- An expandable "raw detail" block with the period JSON.

**Filters:** priority chips, family chips, "disagreements only", "quiet hours only".

**Footer:** Download JSON, Download report HTML, data-quality notes.

### 11.4 Fallback report
If the backend or Gemini is unavailable, or validation fails, build the same report from the deterministic periods alone: label from the pooled scores, priority from the table, no explanation text, and a visible banner "Basic report: Gemini was not used (reason)".

---

## 12. Carry-over fixes from v2.1 (still required)

1. CLAP softmax is a real softmax (sums to 1; differs from cosine). Confirmed fixed in the 13 October build, keep it.
2. CLAP runs about every 2.5 s without overlapping runs, with a visible last-run time and `infer_ms`. Confirmed.
3. `window_s` logs the real audio window. Confirmed.
4. One row per model run is always logged and exported. Check that the exported count matches the on-screen count.
5. Worker errors and stalls are shown on screen and written to `errors`.
6. "Unknown" is never written to the log or shown (v2).
7. Timestamps are UTC in the export, but the app shows **local time** by default and labels any UTC column "UTC". (The logs were an hour behind the phone clock because of British Summer Time. They were correct.)
8. The CLAP graph has fixed and auto y-axis modes (section 4.3).
9. Clip tags and notes are exported with timestamps.

---

## 13. Test protocol

Play clips from a laptop about 25 cm from the phone, with the volume set so the level reaches about -35 dBFS. **Leave at least 10 s of silence between clips.** Use clips at least 15 s long. Use the Clip tag button at the start of each clip.

1. **Baseline sequence** (three passes): police siren, train passing, plane landing, car revving with exhaust crackle.
2. **Window comparison:** run the sequence once with CLAP at 10 s and once at 5 s. Score both on periods.
3. **Added families:** gunshot, glass breaking, scream, shouting, fire alarm, car alarm, loud music with bass, jackhammer, drill. Include the confusers (fireworks, backfire, a fox scream, bottles into a bin, thunder).
4. **Quiet-hours test:** bangs, door slams and thuds at 2 m, 10 m and 30 m, in a quiet room or street at night. Plus ordinary night sounds (footsteps, a fridge, a passing car) to check the false-alarm rate. Set the device clock bucket to night in testing, or tag manually.
5. **Real-world walk:** a street walk including a rail bridge, to check false positives.

**Scoring (per period):** was the right family top 1, top 3 or absent; was the period start and end within 2 s of the real clip; did the agreement flag help; how many alerts per hour were not worth acting on. Score YAMNet alone, CLAP alone, and combined.

Reference results from 13 October (for comparison): YAMNet siren 0.67-0.92 (hit), train weak or variable, plane missed (called Breathing/Snort); CLAP siren family correct but wrong type, train 0.6-0.77, plane 0.58-0.85; car revving only "Vehicle" in YAMNet and motorcycle/scooter late in CLAP; exhaust crackle not detected by either.

---

## 14. Known limits (so nobody is surprised)

- One phone microphone: no direction and no distance. Levels are relative and uncalibrated.
- Results depend on placement, wind and the phone. Proper fixed microphones and arrays are a later step.
- CLAP lags by up to one window, and its scores depend on how the prompts are written. YAMNet is fast but has no class for many sounds (planes, crackle, PA, bin lorries).
- Flight-data matching, direction finding and push alerts are not in this version.
- Gemini's output is only as good as the periods it is given. The raw JSON is the source of truth.

---

## 15. Acceptance checklist

**App and models**
- [ ] Runs on an iPhone and an Android phone over HTTPS
- [ ] YAMNet and CLAP both run by default, and both can be switched off in Settings
- [ ] CLAP window selectable (10 s or 5 s), hop adjustable, no overlapping runs
- [ ] CLAP softmax sums to 1, differs from cosine, and is logged with both values
- [ ] Last-run time and errors visible on the main screen
- [ ] Mic processing is off
- [ ] Main screen is clean (section 4.1) and the live graph opens from a button

**Periods and labels**
- [ ] Periods detected from the level series, with the settings in Settings
- [ ] Each period labelled from the readings inside it, with raw label, specific label and family all stored
- [ ] Agreement flag works (agree, partial, disagree, none)
- [ ] Unexplained-impact rule works on a bang that no label explains
- [ ] Sustained-source rule works
- [ ] Priority table loaded from `priorities.json` and applied by time of day
- [ ] The 73 classes and prompts from section 7 are loaded, and the list can be edited without code changes

**Outputs**
- [ ] Download JSON works and matches the schema in section 9
- [ ] View results posts only labels, levels and notes (check "Preview what will be sent")
- [ ] Report has the timeline on the left and the outcomes on the right on desktop, and a single scrolling column on a phone
- [ ] Report downloads as a self-contained HTML file
- [ ] Fallback report works when the backend is switched off

**Backend and privacy**
- [ ] `GEMINI_API_KEY` is only on the server
- [ ] Server validation drops invented events and lowered priorities
- [ ] Request bodies are not logged or stored
- [ ] No audio or embeddings leave the phone (Network tab shows only `POST /api/report`)
- [ ] Privacy note visible on the main screen
- [ ] Times shown in local time, and UTC clearly labelled in exports