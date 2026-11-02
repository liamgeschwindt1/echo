# Sound Disaggregation Model
 
**Purpose:** split the sound at a site into its sources and say how much each contributes, the way energy disaggregation splits a meter reading into appliances. Output: "of the noise at this spot, X% road, Y% bar, Z% generator", plus where each source is.
 
**Principle:** localise first, tag by direction, attribute loudness. Full audio separation is optional, not the first step.
 
---
 
## 1. Why not separate the audio first
 
- Sound from several sources adds together, and walls add echoes, so the mix is hard to un-mix (the "cocktail party problem").
- Neural source separation works best on a clean, single-microphone mix with little reverb. It degrades with many overlapping sources and echoes.
- Your nodes have a different advantage: several microphones in known positions. Sources in different places can be separated by **geometry**, which is much more reliable than separating by sound alone.
## 2. Pipeline
 
```
Nodes (12-mic ball, multiple nodes)
   |
[1] Capture + time sync
   |
[2] Detect + localise sources (multi-node)
   |
[3] Direction focus per source (beamforming)
   |
[4] Multi-label tagging per focused signal
   |
[5] Loudness attribution per source
   |
[6] Track over time + aggregate
   |
Output: source list, map, contribution per source
```
 
### 1. Capture and time sync
- Each node records its mic array and timestamps frames.
- Nodes share a clock (mesh sync, no GNSS dependency needed).
- Raw audio stays on the node. Only labels, positions and levels leave it (privacy and bandwidth).
### 2. Detect and localise
- Find sound events and estimate each one's position from arrival-time differences across mics and across nodes.
- Use site geometry (buildings, reflections) from the simulator to correct for echoes.
- Output per event: position estimate, uncertainty, time.
### 3. Direction focus
- For each localised source, steer the array towards it (beamforming) so that source is emphasised and others are reduced.
- This gives a cleaner signal per source without needing neural separation.
### 4. Multi-label tagging
- Run the sound classifier (CLAP-style labelling, with YAMNet as a small context layer) on the focused signal.
- Multi-label: one signal can carry several tags (e.g. "traffic" and "siren").
- Output: label(s) and confidence per source.
### 5. Loudness attribution
- Estimate each source's level at the point of interest (a house, a window, a courtyard) using its position and the beamformed level, corrected for distance and reflections.
- Output: contribution per source, e.g. in dB and as a share of total.
### 6. Track and aggregate
- Link detections over time into tracks (a vehicle driving past, a drone, a person).
- Aggregate into: per-source summaries, heatmap of where sound is produced, timeline with playback of events.
## 3. Outputs
 
| Output | Example | Who uses it |
|---|---|---|
| Source list | road, bar, generator, drone | Head of estate, council |
| Contribution per source | road 60%, bar 25%, generator 15% | Noise enforcement |
| Source heatmap | where sound is produced, last hour | Control room |
| Event cards | "possible fight, courtyard B, 02:14" | Prison/estate security |
 
## 4. Optional: full audio separation
 
- Add later as an extra for clips where it helps (a clean, single dominant mix).
- Not required for attribution. Use only where it measurably improves tagging.
## 5. Validation (use the simulator first)
 
The simulator already has nodes, buildings and reflections, so the true answer is known.
 
1. **Localisation error:** metres of error per source vs ground truth, by distance and number of overlapping sources.
2. **Tagging accuracy:** correct labels when 1, 2, 3+ sources overlap.
3. **Attribution accuracy:** error in each source's estimated share vs the true share.
4. **Failure cases:** two sources in the same direction, heavy reflections, wind, a loud source masking a quiet one.
5. **Real-world check:** the 3-node proof of concept with Flightradar data as ground truth for aircraft.
Set the heatmap grid size only after step 1 shows what localisation accuracy you can honestly claim.
 
## 6. Risks and open questions
 
- **Same-direction sources** (e.g. a bar and a road behind it) can't be split by geometry. Decide how to report them (combined, with an uncertainty flag).
- **Reflections** can make a source appear in the wrong place. Needs the site model.
- **Quiet sources under loud ones** get missed. Report detection limits.
- **Privacy:** speech should never leave the node. Decide what is stored (labels and levels only) and for how long.
- **Calibration:** attribution in dB needs calibrated mics. Decide the calibration method (a brief chirp or reference source at install time could help).
- **Claims:** present attribution shares with an error range until validated.
## 7. Next steps
 
1. Define pass/fail targets for localisation and attribution error.
2. Run the simulator tests above with 2, 3 and 5 overlapping sources.
3. Pick the first real site to test (a road plus a second known source).
4. Compare the attributed shares to a simple reference measurement.