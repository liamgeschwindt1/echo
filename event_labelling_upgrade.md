# Event labelling upgrade (proposal)
 
18 Oct 2026 · Liam · for the developer and for the project docs
 
This proposes how the test rig should decide when to run labelling, how long a window to give it, and how to handle overlapping sounds. Nothing here is built. Items marked **unverified** need checking against the developer's code or against real recordings before anyone relies on them.
 
Labelling is tested in the phone-rig UI. The 3D sound simulator no longer runs YAMNet or CLAP and only tests localisation (see section 7).
 
---
 
## 1. Problems this addresses
 
From the 16 and 17 October tests (see 08):
 
- A scream, a car acceleration and a crash were merged into one 57.6 s period. Averaged over the period, the DISTRESS group fell to 0.157 even though single readings scored 0.83 to 0.87. The result was a weak `engine_revving` at confidence 0.16.
- The target-share rule only ran when a decoy led the group that won the period, so it never ran on that period.
- CLAP runs about once a second on the iPhone 13 Pro. At a 1.25 s hop it is already near the phone's limit, and it runs all night on overlapping windows.
- Short events (a 2 s scream) are diluted inside a 5 s or 10 s window.
- When two sounds overlap, CLAP's softmax makes labels compete and sum to 1, so neither may win.
---
 
## 2. Proposal A: a two-stage pipeline (watch cheaply, label on demand)
 
**Stage 1: always on, cheap.** Track a rolling noise floor and watch for anything that rises above it.
 
- **Level trigger (primary).** A rise of a set number of dB over the rolling floor starts an event. The existing 15 dB impact rule and the 6 dB for 5 minutes sustained rule are already of this kind. This works for any sound, including ones YAMNet has no class for.
- **YAMNet trigger (secondary).** YAMNet runs at about 12 ms per window, so it can run continuously. It starts an event when a watchlist class passes a threshold. The existing corroboration thresholds are a starting point: Screaming at or above 0.2, Glass, Shatter or Breaking at or above 0.4, Gunshot or gunfire at or above 0.2.
- **Why not gate on YAMNet alone.** YAMNet has no class for planes, exhaust crackle, announcements or bin lorries, so a YAMNet-only gate would miss exactly the sounds it cannot name.
**Stage 2: on demand, expensive.** When Stage 1 fires, run CLAP once on that event's window.
 
- Use a **pre-roll** of a few seconds taken from the rolling in-memory buffer, so the start of the event is included. The buffer stays in memory only. No audio is stored or sent.
- Label the event over its own window, not over a long merged period. This replaces the "cap period length at about 20 s" fix as the main defence against merging.
- Evaluate security groups on the **peak reading**, not the period mean (the first requested fix in 08).
**Slow builds and constant sources.** An onset trigger will not catch a slow rise. Options, in order of simplicity:
1. The sustained rule (6 dB over the floor for 5 minutes).
2. A scheduled CLAP pass, for example every 10 s, only while the level stays elevated. This is a proposal and has not been tested.
**Risks**
- If Stage 1 misses an event, CLAP never sees it. The trigger threshold trades recall against false alarms.
- The pre-roll and trigger add new settings that need calibrating.
**How to test without new recordings**
- Replay the 16 and 17 October logs and check whether the Stage 1 trigger would have fired on the scream, the glass and the gunshot.
- Use the overnight false-alarm run (labels and levels only) to count how often the trigger fires on ordinary night sounds.
---
 
## 3. Proposal B: window length
 
The window does not have to be 5 s or 10 s. The rig already supports a 5 s window with a 1.25 s hop, flags periods under 4 s as `short_event`, and keeps a 10 s mode for ambient sounds.
 
- **Hypothesis:** shorter windows (about 2 s) suit sharp sounds such as gunshot, glass and door slam, and longer windows suit sounds that need context such as planes, traffic and music.
- **Unverified:** I believe the model takes a fixed-length input and that shorter audio is padded or looped to that length, so a 2 s clip may be a 2 s event inside padding. How the developer's code handles this is not known. A shorter window probably does not make each run faster.
- **Test:** use the planned 15-clip test suite in file mode (no microphone). Run it at 2 s, 5 s and 10 s. Compare top-1 and top-3 accuracy, alert recall and time to first detection per group. Also try the first 2 s of each event inside a 5 s window padded with silence.
---
 
## 4. Overlapping sounds
 
Overlap is the main remaining problem. It affects labelling and localisation differently.
 
**Labelling**
- CLAP's scores compete (they sum to 1), so two overlapping sounds split the score and neither may lead.
- YAMNet scores each class independently, so it copes with overlap better by design.
**Localisation** (from the simulator run on 17 October)
- With one direction estimate per window, the louder source tends to win. In that run, n8's engine direction matched its horn direction, which is consistent with the loud horn dominating the merged window.
**Approaches, cheapest first**
 
| Route | What it does | Status |
|---|---|---|
| 1. Detect, do not separate | Check each label's raw cosine score against its own threshold instead of picking one winner, so several labels can be present at once. YAMNet already works this way | Cheap. Can be tested on existing exports |
| 2. Use geometry | Nodes at different places hear different mixes. Keep a bearing only when several nodes agree, and do not trust one node's dominant source | Test in the simulator |
| 3. Use the microphone array | Estimate a direction per time-frequency bin and look for several clusters, or use beamforming. Works when the sounds differ in pitch or timing and there is little reverberation | **Unverified** for four microphones 10 cm apart. Treat as a hypothesis |
| 4. Neural separation | Models that pull one sound out of a mixture, some by text query | Heavy for a lamp-post node. Not a starting point |
 
**Where overlap is easy or hard**
 
| Case | Difficulty | Handling |
|---|---|---|
| A short bang over a steady background | Easy | The background becomes the floor, so subtract it |
| Two events a second or two apart | Medium | Shorter windows and onset detection split them in time |
| Two sustained broadband sounds at once, at similar level (for example an engine and a crowd) | Hard | Flag as unresolved instead of guessing |
 
**Rule to adopt now:** when two events overlap in time, report the dominant label and bearing but mark the window as **overlapped, unreliable**. Do not attempt separation until route 1 and route 2 have been tested.
 
---
 
## 5. Privacy
 
- The architecture rule stays: nothing derived from audio leaves the device. That includes spectrograms and **embeddings**. An embedding is not playable audio, but it still carries information about the sound and in some models can reveal things such as who is speaking. A data protection officer should be asked before any embedding is stored or sent.
- The pre-roll buffer is rolling and in memory only, with no saved files.
- The privacy review for the distress labels is still outstanding and should happen before any pilot.
---
 
## 6. Changes to existing requested fixes
 
| Existing fix (08) | Effect of this proposal |
|---|---|
| Evaluate security groups on the peak reading | Still needed. Stage 2 uses it on each event's window |
| Cap period length (about 20 s) or split when the leading group changes | Largely replaced by labelling each triggered event separately. Keep a cap as a safety net |
| Cap no-agreement labels under 0.3 confidence at `flag` | Unchanged |
| 5 s window for short events | Becomes one setting in the window-length test (section 3) |
| Guard on the YAMNet bypass | Unchanged. Only after real fox clips exist |
 
---
 
## 7. The simulator
 
The simulator (see the build instructions) no longer runs YAMNet or CLAP. This removes the model download, the merged-event and mislabelling problems and the label-dependent detection.
 
- A node counts as **hearing** a source when its SNR at that node is above a threshold setting. The threshold is a placeholder until real recordings exist.
- Each source's start and end time are known, so localisation runs inside that window.
- Overlap is allowed and flagged. A sweep over how far apart in time and level two sources are shows where direction error grows.
- Source levels are better set as an SNR at a reference distance than as an unverifiable dB SPL value.
The simulator can degrade audio realistically, but how YAMNet and CLAP respond to degraded audio is an empirical question for the phone-rig UI and real recordings.
 
---
 
## 8. Test plan
 
1. **Trigger replay.** Run the Stage 1 trigger over the 16 and 17 October logs. Record whether it fires on each event and how long after onset.
2. **Window length.** Run the 15-clip suite at 2 s, 5 s and 10 s (section 3).
3. **Multi-label check.** Re-score existing exports with per-label cosine thresholds. See whether the scream, glass and gunshot are caught where the softmax winner was wrong.
4. **Overnight false-alarm run.** Windowsill, labels and levels only. Count Stage 1 triggers per night per zone.
5. **Overlap sweep in the simulator.** Vary the time gap and the level difference between two sources and plot direction error.
Metrics per group: alert recall, top-1 and top-3 accuracy, time to first detection, false alerts per night.
 
---
 
## 9. Open questions
 
- How does the developer's code handle windows shorter than the model's input length (padding, looping or other)?
- What is CLAP's real run time on the iPhone when it runs once per event, not on a 1.25 s hop? Can Stage 2 run on a lower-end phone?
- What trigger threshold gives acceptable recall without too many false alarms? This needs the overnight run.
- How often do real incidents involve two simultaneous sounds? This is a question for buyer interviews. If it is rare, the overlap flag may be enough.
- Does the dominant-source bearing from the simulator match what real nodes would report? This needs calibration against real recordings at known distances.
- Real CLAP logit scale and checkpoint are still unconfirmed (see 08).
---