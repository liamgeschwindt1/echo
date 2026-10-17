# Estate Acoustics simulator: how it works

The simulator is a design tool for **localising sounds**. It answers two questions:

1. How far away can a node still hear a sound well enough to get a direction from it, once distance, air and background noise lower its level?
2. How accurately can a few 4-microphone nodes work out where a sound came from?

It does not identify or label sounds. (The YAMNet and CLAP recognition step has been switched off in this version.)

It is not validation. It models open ground only (no buildings), so real streets will do worse than the simulator shows.

Open it at `/sim` on the simulator service (or `/sim.html` on the dev server).

---

## 1. The mental model

You build a **scenario** with two kinds of object:

- **Nodes** (lamp-post devices). Each node has **4 microphones** about 10 cm apart.
- **Sources** (a sound placed somewhere, starting at some time).

Then you press **Create**. The simulator works out exactly what each microphone would hear, works out the direction each node heard the sound from, and combines the directions from several nodes into a position.

Everything is stored in memory afterwards. **Play, pause, speed and scrubbing never recompute anything**; they only replay what Create produced.

Positions are in metres: x is east, y is north, height is up. The map is a top-down view, but the physics is 3D.

```
 place nodes + sources  ->  Create  ->  results appear  ->  play / inspect
        (edit)           (render + locate)    (ready)        (instant)
                                                  |
                               any edit  ->  "Out of date" banner (stale)
```

---

## 2. Screen layout

| Area | What it is |
|---|---|
| Top bar | Create, Play, speed slider, time, status text, File menu, Settings (gear), Info (i) |
| Left strip | Move, Add node, Add source, and a Display menu at the bottom |
| Centre | The map |
| Right panel | Appears only when you select a node or source |
| Bottom | The timeline |

On first open you see a **demo scenario**: three nodes at (0, 0), (60, 0) and (30, 50), 5 m up, and one sound at (25, 20) that starts at 3 s. The sound is a gunshot if a gunshot clip is available, otherwise a glass break (no gunshot clip is bundled, so you will normally see the glass break). Press **Create** to see it work.

---

## 3. The map

- **Pan:** drag empty space.
- **Zoom:** mouse wheel.
- **Scale bar:** bottom-left of the map.
- **Node:** a small square. Beside it is a **magnified inset** showing the four mics, numbered 1 to 4 (the mics are only 10 cm apart, which is under one pixel at map scale, so the inset enlarges them and labels it "mics xN"). At high zoom the mics are drawn at their true positions instead. Filled dots are at or above the node's plane, hollow dots below it (only matters for the tetrahedron layout).
- **Source:** a dot with its id and sound name.
- **White** = ground truth (where things really are). **Amber** = what the simulator worked out.
- **Direction wedges** (amber, after Create): one wedge per node that heard the sound, pointing the way that node thinks the sound came from. Every wedge is drawn the same length with an open end and fading out, so its length means nothing about distance. The true position is only ever the white source dot. Each wedge is labelled `±U°  err E°`: **U** is the stated uncertainty (half-width, indicative, from how much the four mics disagreed) and **E** is the actual azimuth error against the truth. When E is bigger than U the node was confidently wrong: the wedge edges are drawn thicker, the label is a solid amber block and ends in `!`. If another sound overlaps this one in time at that node, the wedge edges are dashed and the label ends in `⚠ overlap`, because the direction is contaminated. Where wedges from different nodes cross is where the sound probably is.
- **Amber ring + amber line:** the estimated position, with a line back to the true (white) position showing the error. It appears when at least two nodes heard the sound.
- **Rings** spreading from each source are the sound wave (section 7).

If the map is empty it says what to do next ("Add a node, then add a sound").

---

## 4. Left strip: tools

Only one tool is active at a time (highlighted).

| Button | What a click on the map does |
|---|---|
| **Move** (default) | Click an object to select it (the right panel opens). Drag it to move it. Drag empty space to pan the map. |
| **Add node** | Places a new node (flat-square mics, 5 m high) where you clicked and selects it. The tool stays active, so you can click several times to add several nodes. Switch back to **Move** when done. |
| **Add source** | Opens the **Choose a sound** picker. Pick a sound and a source is placed where you clicked (see section 5). The tool stays active. |

There is no Delete tool. To delete: select the object, then press the **Delete key** or the **Delete** button at the bottom of the right panel.

**Display** menu (bottom of the strip):

- **Direction cones:** show or hide the amber wedges.
- **Mic arrays:** show or hide the magnified mic insets beside each node.
- **Tone and grain:** on = rings are drawn with thickness and dashes that reflect the sound's pitch and noisiness. Off = plain loudness pulses.
- **Slice height (m):** which horizontal plane the rings are drawn on (default 1.5 m, roughly head height).
- **Nodes shown:** a tick box per node, plus **all** and **none**. Hiding a node removes it, its mic inset and its wedges from the map so overlapping nodes are easier to read. It is a view setting only: the node still takes part in Create and in the position estimate, and you cannot select or move a hidden node. Loading a scenario shows all nodes again.

---

## 5. Adding a sound

1. Choose **Add source**, then click the map where the sound should be.
2. The **Choose a sound** window lists the built-in sounds. The library is: glass breaking, car horn, dog barking, chainsaw, fireworks, thunderstorm, crying baby, engine, airplane, footsteps. Some are decoys on purpose (fireworks for a gunshot, thunder for a bang, a crying baby for a scream).
3. Click a sound. It appears as a source at that spot, selected, starting at **3 s**.
4. **Upload WAV...** (bottom-left of the window) adds your own file and places it the same way. Files stay in your browser and are not uploaded to a server.
5. **Cancel** closes the window and adds nothing.

Greyed-out sounds mean the audio file is missing on the server. The window says how to fix it. If the list is empty it says why.

A new source starts at 3 s by default. You can change its start time in the right panel or by dragging its block on the timeline; any time from 0 s works.

---

## 6. Right panel (selection)

It opens only when something is selected, and closes when nothing is.

**Node**

- x, y (position in metres).
- **Advanced:** height z, rotation, mic spacing (default 0.10 m), layout.
  - **Flat square:** four mics at the corners of a horizontal square. It cannot tell whether a sound is above or below, so the simulator assumes below (nodes sit on lamp posts).
  - **Tetrahedron:** four mics in 3D. It can tell above from below.
- Delete button.
- After Create: **mic waveforms** (four traces, mic 1 in white) and a **spectrogram** (frequency over time, 0 to 8 kHz).

**Source**

- x, y, **level at 1 m (dB)** (how loud the sound is one metre from the source), **start (s)**.
- A note if the level is a placeholder. All built-in levels are placeholders, not measurements.
- **Advanced:** height z (default 1.5 m).
- Delete button.
- After Create: the **Result** table (section 9).

Changing any number marks the results out of date (section 10).

---

## 7. The rings (wave display)

The rings need no Create. They are drawn from the sound's own audio whenever the playhead is past the source's start time, so press **Play** or drag the playhead to see them.

- A ring shows what the sound was doing at the moment it left the source: **brightness** = loudness, **thickness** = how low-pitched (thick and smooth = low and rumbly, thin = high), **dashes** = how noisy.
- A gunshot makes one sharp ring. A siren makes a continuous train of rings.
- Rings get dimmer with distance (1/distance) and vanish once they fall below the background-noise level.
- They travel at the real speed of sound for the current temperature (about 340 m/s). At 1x speed you watch sound crawl across the map. Use the slow speeds to see it arrive at each mic.
- At high playback speeds the simulator draws fewer rings to stay smooth.

This is a stylised display of loudness over time, not true wavelength.

---

## 8. Top bar

### Create
1. Checks you have at least one node and one source.
2. Loads the sound files.
3. **Renders** the audio at every mic (progress bar).
4. Works out each node's **direction** to each source, and how loud the sound is above the noise (SNR) at each node.
5. Leaves out any node whose SNR is below the **Minimum SNR** setting (default 6 dB), because it cannot really hear the sound. The rest are combined into a position.

When finished the status text reads, for example, `Located 1 of 1 sounds`. The simulator is now **Ready**.

### Play / Pause
Moves the playhead forward at the chosen speed and **plays the sounds** (see "Hearing the sounds" below). At the end it stops; pressing Play again starts from 0. Works before and after Create.

### Speed
0.05x to 4x. Dragging it changes speed immediately. It snaps to exactly 1x near the middle. Sound is only played at exactly 1x; at any other speed the readout shows "(muted)".

### Time readout
The playhead position in seconds. The scenario **ends exactly when the last sound finishes**. Behind the scenes Create renders a little longer than that, enough for sound still travelling to the farthest mic.

### File menu
- **Save scenario:** downloads the scenario as JSON (nodes, sources, settings, seed).
- **Load scenario:** loads a saved file and clears results.
- **Export results:** downloads scenario, summary, results and model readings as JSON. Only works after Create. The same scenario and seed always give identical results.
- **Repeats / sweep:** see section 11.

### Settings (gear)
- **Temperature** and **humidity:** change the speed of sound and how quickly high frequencies fade with distance.
- **Noise floor (dB SPL):** background noise level at every mic. Higher = harder to hear distant sounds.
- **Ground reflectivity (0 to 1):** how much sound bounces off the ground. 0 switches the bounce off.
- **Random seed:** the noise is random but repeatable. Changing the seed gives a different noise sample.
- **Minimum SNR to use a node (dB):** a node quieter than this (sound above noise) is treated as not hearing the sound and is left out of the position. Raise it to be stricter.
- **Sound during playback:** what you hear when you press Play at 1x. See below.

### Hearing the sounds
Press **Play at 1x speed** and you hear the sounds as the playhead passes their start times. The choice is in Settings under **Sound during playback**:

- **Sources, as recorded** (default): each source's clip plays as recorded, at its start time. It works immediately, with no Create needed. Louder sources (by their level at 1 m) are played louder, but distance from a node is not applied.
- **n1 mic 1 (rendered)** and so on: after Create, any mic of any node. This is what that mic actually "hears" after distance, air absorption, the ground bounce and noise.
- **Off:** silent.

If you drag the playhead or move a sound's start time while playing, the audio restarts from the right place. Audio needs a click on the page first (a browser rule), which pressing Play already provides.

### Info (i)
Lists the limits of the simulation.

---

## 9. Reading the results

After Create, select a **source** to see its Result table.

| Column | Meaning |
|---|---|
| node | Which node |
| m | Distance from that node to the source |
| SNR dB | How far the sound is above the background noise at that node |
| used | "yes" if the SNR reached the minimum, so the node counts towards the position |
| ±° | The stated uncertainty of that node's direction |
| az err ° | Actual error in the direction that node worked out (azimuth = compass direction) |
| (last column) | `wrong` = the error exceeded the stated uncertainty; `overlap s2` = sound s2 overlapped in time at this node |

Below the table:

- **Position:** the estimated x, y, z, or one of:
  - *not heard by any node* (every node was below the minimum SNR).
  - *heard by one node: direction only* (one node gives a direction, never a position).
  - *poorly conditioned* (the nodes' directions are nearly parallel, so any position would be unreliable).
- **Error:** distance between the estimate and the truth, horizontal and 3D.
- **Ray angle:** the widest angle between two nodes' directions. Wider is better.

On the map, once there are results, you see the wedges and the estimate described in section 3.

On the timeline:

- Amber ticks mark when the sound first reaches each node (one row per node).
- The **error lane** shows each source's 3D error as an amber line over the time the sound is audible, scaled 0 to 20 m.

A position needs **at least two nodes that heard the sound**. Nodes below the minimum SNR are left out.

---

## 10. Out of date (stale) results

Any change after Create (moving a node, changing a sound, level, start time, or a setting) shows an amber banner: **Out of date, press Create**. Old results stay visible but are greyed out so you do not mistake them for the new layout. Press **Create** again to refresh.

Edits made *while* Create is running are not flagged. Wait for it to finish before editing.

---

## 11. Repeats / sweep (File menu)

Runs the scenario many times with different random noise, to see how reliable the result is.

- **Vary:** nothing (just repeat), distance scale, noise floor, or node count.
  - *Distance scale* moves every source away from (or towards) the middle of the nodes by that factor (2 = twice as far).
  - *Node count* uses the first N nodes.
- **Values:** a comma-separated list, for example `0.5, 1, 2, 4`.
- **Seeds:** how many noise samples per value (default 50).
- **Run** shows a progress bar, then a table and a plot.

Table columns: number of trials; **fix rate** (share of sounds that got a position); median and 90th-percentile 3D error; median and 90th-percentile direction error.

Each seed re-renders every mic, so large runs take minutes.

---

## 12. What the simulator actually calculates

For every source and every mic:

1. **Travel time** = distance / speed of sound (speed = 331.3 + 0.606 x temperature in C). Mics only 10 cm apart differ by about 0.3 ms, so delays are applied with fractional-sample precision.
2. **Loudness** falls as 1/distance (6 dB per doubling of distance).
3. **Air absorption** removes high frequencies with distance (ISO 9613-1), so far-away sounds arrive duller.
4. **Ground bounce:** one extra reflected path from the mirror image of the source below the ground, scaled by ground reflectivity. The direct and bounced sound interfere.
5. All sources are added together, then **background noise** (pink, at the noise-floor level) and **mic self-noise** (white) are added, separately for each mic.

Direction finding then compares arrival-time differences between the six mic pairs (band-limited to 200 to 1600 Hz, because 10 cm spacing cannot resolve higher pitches) and solves for the direction of the sound. Directions from several nodes are intersected to give a position.

---

## 13. Things that surprise people

- **No rings?** Press Play or drag the playhead past the source's start time, and make sure the sound file loaded.
- **No position, just wedges?** Fewer than two nodes heard the sound (SNR below the minimum). Make the sound louder, move it closer, or lower the minimum SNR in Settings.
- **Wedges overlap and clutter the map?** Hide nodes you are not looking at with Display > Nodes shown, or turn off Direction cones or Mic arrays.
- **"Poorly conditioned"?** The nodes see the sound from almost the same direction. Move a node so the angle between them is wider.
- **A close sound is not used by a node?** Check its level at 1 m and the noise floor; the node must reach the minimum SNR.
- **High-pitched sounds locate badly.** That is expected: the direction finder only uses 200 to 1600 Hz.
- **Flat nodes assume the sound is below them.** A source above the node gives the wrong elevation unless you use the tetrahedron layout.
- **Levels are placeholders.** Do not quote distances or detection rates from this tool as evidence the real system works.
- **Sounds greyed out in the picker?** Their audio files are missing on the server. The simulator service must be built with `SIM_ENABLED=1`.
- **Clips are non-commercial** (ESC-50 dataset), fine for this tool but not for a production product.

---

## 14. Typical session

1. Open `/sim`. Look at the demo.
2. Press **Create**. Wait for "Located 1 of 1 sound" in the top bar.
3. Press **Play** and watch the rings reach each node. Select the source and read the Result table. Look at the amber wedges and their labels: they should cross near the true position.
4. Select a node to see its waveforms and spectrogram. Use Display > Nodes shown to hide nodes and see one node's cone at a time.
5. Drag the source further away and press **Create** again. Compare the SNR, label and error.
6. Open **File > Repeats / sweep**, vary distance scale, and read the fix rate to see where it stops working.
7. **File > Save scenario** to keep it.
