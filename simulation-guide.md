# Estate Acoustics simulator: how it works

The simulator is a design tool for **localising sounds**. It answers two questions:

1. How far away can a node still hear a sound well enough to get a direction from it, once distance, air and background noise lower its level?
2. How accurately can a few 4-microphone nodes work out where a sound came from?

It does not identify or label sounds. (The YAMNet and CLAP recognition step has been switched off in this version.)

It is not validation. It models open ground only (no buildings), so real streets will do worse than the simulator shows.

Open the simulator service at `/` (in development, `npm run dev` serves it on http://localhost:5174).

### Saving simulations

Use the **File** menu:

- **Save…** stores the scenario in the shared database. Tick **Include current results** to keep the latest results too. Every save adds a new version; older versions stay available.
- **Save as new…** makes a separate copy.
- **Open saved…** lists every saved simulation. Search by name, open the latest version, view the version history, rename or delete.
- **New simulation** starts again from the demo.

The title next to the menu shows the open simulation, its version and a dot when there are unsaved changes. Ctrl+S saves. The page URL (`?sim=…&v=…`) points to the open simulation, so reloading or sharing the link reopens it. Saved results come back without audio; press **Create** to render it again. Uploaded WAV clips are not saved.

**Files on this computer** still downloads and loads scenario files and exports results, without using the database.

### OpenStreetMap environment

Open **Environment** in the top bar, then **Load map** to import the default
Battersea Power Station area. Change latitude, longitude and tile size (200 to
1000 metres) to load another area. The simulator server fetches map data through
the same-origin `/api/osm` endpoint, so the browser does not need direct access
to map providers or external CORS permissions. The server requests the bounded
tile from the official OpenStreetMap JSON map API first, with Overpass as a
fallback. The server needs internet access;
each upstream attempt stops after 15 seconds, and the browser stops waiting
after 35 seconds. The Load map button shows a countdown. **Cancel loading**
stops waiting immediately without changing the current scene. Failures appear
below the button, and Load map becomes available again. Restart
the dev server after updating its configuration. Upstream failures appear with
the server name and failure reason rather than a generic browser fetch error.

The map adds building footprints, roads, rail, water, parks and trees to the 2D
and 3D views. Loading replaces current buildings; nodes or sources inside the
new buildings are removed and listed in a notice. Acoustic calculations use each
building's real footprint outline: placement, line-of-sight blocking,
reflections off walls at any angle, and diffraction at every outward corner
(with that corner's angle) and along every roof edge. Outlines are simplified
for acoustics by dropping points within 1 metre of a straight wall; the views
draw the full outline. Courtyards are treated as solid, and corners or roof
edges buried against a neighbouring building do not diffract. Heights without
OSM height tags are estimated from storeys or default to 15 metres.

**Remove map** removes the imported environment and its buildings. Saved simulations and downloaded
scenario files include the map data, so reopening a saved scenario does not need another fetch.

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
- **White** = ground truth (where things really are). **Amber** = combined position estimates. Each node has its own map colour; node labels and bearing marks use that same colour.
- **Direction observations** (after Create): the simulator uses a rolling 100 ms microphone window and updates every 100 ms (10 estimates per second). Each node's dashed line and circle show that node's bearing at that update; dashed-line length and circle position are visual markers only, not measured range. The translucent cone shows the latest bearing and its uncertainty. Acoustic arrival and the 100 ms window mean updates are delayed; low-SNR or overlapped windows can leave gaps.
- **Amber estimated path:** the large orange ring follows the latest combined fix as playback advances, with its source id and measurement time alongside. Smaller hollow circles retain every earlier fix, joined as a trail; future fixes appear only when playback reaches their time. This works in both 2D and 3D. At least two nodes must provide usable bearings. During detection gaps the ring stays at the last known fix, labelled "last fix", and the trail does not bridge the gap. The original source dot remains ground truth; compare it with the estimated path to see error.
- **Whole-event summaries:** the inspector's summary position and back-trace candidates use the full event, not a tracking update. For moving sources, those static back-trace overlays are hidden so they cannot be mistaken for the live orange ring. A source can only be tracked while it emits audible sound; moving the path does not make a short clip play for longer.
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

- **Sound display:** choose **Heatmap / waves** for the existing overlays, or **Particles** for outward-moving sound-energy markers. Every source has its own colour, shared by its particles, source dot, and legend in both 2D and 3D. Particle mode temporarily hides the heatmap and wave rings; switching back restores their settings. Use **3D view** to see spherical particle fields, or leave it off to see their slice at **Slice height**. Play, pause, speed, and timeline scrubbing control both views without Create. New sources start at 3 s by default, so particles appear only after their start time.
- **Reflected sound:** includes reflected rings or particles using the existing wall and ground reflection paths. Particles follow the wavefront display's travel time, loudness fade, and building visibility checks. Moving-source emissions originate at the source's position when emitted; reflected particles are available for stationary sources only. These are visual sound-energy markers, not simulated air molecules or true wavelengths, and they do not diffract.
- **Direction cones:** show or hide node-coloured bearing observations and cones.
- **Mic arrays:** show or hide the magnified mic insets beside each node.
- **Tone and grain:** on = rings are drawn with thickness and dashes that reflect the sound's pitch and noisiness. Off = plain loudness pulses.
- **Slice height (m):** which horizontal plane the rings are drawn on (default 1.5 m, roughly head height).
- **Nodes shown:** a tick box per node, plus **all** and **none**. Hiding a node removes it, its mic inset, bearing line and observations from the map so overlapping nodes are easier to read. It is a view setting only: the node still takes part in Create and in the position estimate, and you cannot select or move a hidden node. Loading a scenario shows all nodes again.

---

## 5. Adding a sound

1. Choose **Add source**, then click the map where the sound should be.
2. The **Choose a sound** window lists the built-in sounds. The library is: glass breaking, car horn, dog barking, chainsaw, fireworks, thunderstorm, crying baby, engine, airplane, footsteps. Some are decoys on purpose (fireworks for a gunshot, thunder for a bang, a crying baby for a scream).
3. Click a sound. It appears as a source at that spot, selected, starting at **3 s**.
4. **Upload WAV...** (bottom-left of the window) adds your own file and places it the same way. Files stay in your browser and are not uploaded to a server.
5. **Cancel** closes the window and adds nothing.

Greyed-out sounds mean the audio file is missing on the server. The window says how to fix it. If the list is empty it says why.

A new source starts at 3 s by default. You can change its start time in the right panel or by dragging its block on the timeline; any time from 0 s works.

### Making a sound move

Any sound can travel along a line you draw:

1. Select the source and press **Add path** in the right panel.
2. Click on the map to add points; the path starts at the source. A dashed line follows the pointer. **Double-click** or **Enter** finishes, **Backspace** removes the last point, **Esc** cancels. A path cannot go through a building.
3. The source now walks the line at a constant speed. On the map the path is dashed (ring = start, square = end) and the dot shows where the source is at the playhead time.
4. The timeline shows a **blue bar** under the sound's block from when it starts moving to when it arrives. Drag either **end handle** to change when it sets off or arrives (this sets the speed, shown next to the bar), or drag the bar itself to move the whole trip in time. A new path runs over the length of the clip (at least 1 s).

Before the trip starts the source waits at the start of the path; after it ends it stays at the end. Dragging the sound's block also moves the trip with it. In the right panel a moving source shows its length, speed and **moves from / arrives at** times, plus **Redraw path** and **Remove path**. Its x and y move the whole path; dragging it on the map does the same.

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
- **Path:** **Add path** makes the sound move (section 5). A moving source shows its points, length, speed, **moves from (s)** and **arrives at (s)**, and **Redraw path** / **Remove path**.
- **Advanced:** height z (default 1.5 m; for a moving source it sets the whole path).
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
- A moving sound leaves each ring where the source was when that bit of sound left it, so the rings bunch up ahead of it and spread out behind. Moving sounds show direct rings only (no reflected rings).

This is a stylised display of loudness over time, not true wavelength.

### The heatmap (on by default)

A coloured map under the rings, in the Display menu. It needs no Create: it is computed from the scenario, the sound and the path finder, and recomputes itself a moment after any change (a coarse preview first, then full detail).

- **Height slider** (`z = ...`): the height of the slice. It drives the rings, the reach map and the heatmap together. Buttons jump to street level (1.5 m), the selected node's height, or the tallest roof. While you drag, the nearest height already computed is shown; the exact one is computed when you let go. Above a roof the cells are open air and the roof is drawn as a dashed outline.
- **Pulse** (default): the level arriving at each point at the playhead. The front moves out and fades; echoes and sound bent round corners or over roofs show as later fronts. A faint level map (about 25 % opacity) sits underneath so the map is never empty before the first sound arrives.
- **Peak-hold:** the highest level each point has reached so far. At the end it shows how far the sound got and where the shadows are. It restarts when the height changes.
- **Level:** the clip-mean level (or the peak, with the option). Same idea as the reach map, recoloured.
- **Band:** 250 Hz, 1 kHz, 4 kHz or the localisation band. **Source:** the selected source (all of them if none is selected) or all sources.
- Colours use a smooth rainbow gradient with a 60 dB span and a legend. By default it shows level above the noise floor (localisation band only) with a line where the sound falls to the minimum SNR; switch it off to see dB SPL.
- Levels are added without interference, bending round building edges uses the wedge diffraction model, and levels depend on placeholder constants.

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
- **New simulation / Open saved… / Save… / Save as new…:** the shared database; see "Saving simulations" at the top.
- **Download scenario file:** downloads the scenario as JSON (nodes, sources, settings, seed).
- **Load scenario file:** loads a downloaded file and clears results.
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
   **Buildings:** reflections off the walls, and **diffraction** round the vertical corners and over the roof edges (a rigid-wedge model, on by default at order 2: one edge, two edges, or a reflection plus an edge). Sound behind a building fades smoothly into the shadow, higher pitches fade more, and a path that bends is reported with its edge name. The settings dialog has the diffraction order (0 switches it off), the model (the old formula is kept for comparison only) and how far below the strongest path a weak path is dropped (50 dB).
   **Moving sounds:** the clip is cut into short overlapping pieces (crossfaded, about every 25 cm of travel) and each piece is sent from where the source was at that moment, so delays, loudness and blocking follow the motion and the pitch shifts (Doppler) as the delays change.
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
- **Sounds greyed out in the picker?** Their audio files are missing on the server. The simulator service must be built with `npm run build:sim`, which downloads them.
- **Moving sound: which "true position"?** A moving sound has no single position. Each node is scored against where the source was when the sound it used left it (middle of its window), and the position error against the average of those points. The stated uncertainty includes the angle the source sweeps through during the window. The render audit skips moving sounds, the reach map uses the start of the path, and the heatmap uses a few points along it.
- **Clips are non-commercial** (ESC-50 dataset), fine for this tool but not for a production product.

---

## 14. Typical session

1. Open the simulator. Look at the demo.
2. Press **Create**. Wait for "Located 1 of 1 sound" in the top bar.
3. Press **Play** and watch the rings reach each node. Select the source and read the Result table. Look at the amber wedges and their labels: they should cross near the true position.
4. Select a node to see its waveforms and spectrogram. Use Display > Nodes shown to hide nodes and see one node's cone at a time.
5. Drag the source further away and press **Create** again. Compare the SNR, label and error.
6. Open **File > Repeats / sweep**, vary distance scale, and read the fix rate to see where it stops working.
7. **File > Save…** to keep it.
