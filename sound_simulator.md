# Sound Simulator Architecture

*1 November 2026*

## Purpose

The simulator renders what every microphone on a node would record when physical objects move through a real site, so detection and localisation can be trained, tested and demonstrated before real recordings exist.

The core idea: an object is a **digital twin** that synthesises its own sound from its physical state, not an audio clip stretched along a path. The site simulator (nodes, buildings, reflections) already exists; this plan adds the object library and the layers that drive it.

## Architecture at a glance

*Twins turn motion into sound; the site and array turn it into a recording.*

| Block | What it holds |
|---|---|
| **Real recordings** | Clean object sounds and on-site noise. Used to *fit the fingerprint* (object twins) and to *calibrate the site* (site engine). |
| **Motion engine** | Paths and speeds, controls over time, true position kept |
| **Object twins** | Anatomy + materials, fitted fingerprint, sound from state |
| **Site engine** | Buildings, wind, delay and Doppler, background noise |
| **Array model** | 12 mics per node, mic response, timing and drift |
| **Simulated recording** | Multichannel audio plus ground truth |
| **Real pipeline** | Detect, classify and localise |
| **Scoring** | Compares pipeline output with ground truth |

Flow: Motion engine → Object twins → Site engine → Array model → Simulated recording → Real pipeline → Scoring. The motion engine also passes **true positions** straight to Scoring.

Motion produces state, the twin turns state into sound, the site carries it to the microphones and the array model records it. Scoring compares the real pipeline's output with the stored ground truth; real recordings calibrate the twins and the site, and give the final test.

## Object twin library

Each object in the library is a twin with three parts, and the sound it makes is computed from its state at every moment.

1. **Anatomy and materials:** the physical build (for example rotors, blades and body for a drone, or glass and thickness for a bottle) that sets what sounds it can make.
2. **Control and state:** the inputs that drive it (throttle, steering, impact force) and the resulting state over time, such as rotor speeds, attitude and velocity.
3. **Fingerprint:** parameters fitted from clean, isolated real recordings of that object, so the twin sounds like the real thing.

The library needs three synthesis classes, because objects make sound in different ways:

- **Continuous:** drones, vehicles. Sound is a function of ongoing state.
- **Impulsive:** glass breaking, gunshots, impacts. Sound is triggered by an event, then rings out.
- **Vocal:** shouting. Sound is shaped by a source and its level.

Adding a new object means adding a twin and a fingerprint; no other layer changes.

## Motion and scenario engine

A scenario places one or more twins in the site and says how each moves. The engine turns that into the state each twin needs at every time step.

- **Paths and kinematics:** position, velocity and altitude over time, set by waypoints, a controller or a recorded log.
- **Dynamics:** a twin's controls produce its internal state, for example a drone's commands changing each rotor's speed and its tilt. Sound follows from that state, not just from Doppler.
- **Multiple objects:** several twins in one scene (a drone, a vehicle, a shout), each with its own path, starting and ending at set times.
- **Randomisation:** sweeps over speed, path, object variant and timing generate a very wide range of scenarios from one description.

Every scenario stores the true position and class of each object at each moment, which becomes the ground truth for scoring.

## Site and propagation engine

This layer already exists as the site simulator and carries each twin's sound from its position to every microphone.

- **Geometry:** the site's buildings and obstacles, so sound is reflected, blocked or diffracted as it would be on site.
- **Propagation:** moving-source delay per microphone (which gives Doppler and the time differences between mics), distance loss and air absorption.
- **Environment:** wind, weather and background noise, ideally taken from real recordings of the target site.

The twin supplies the source sound and its direction pattern; this layer decides what reaches each microphone.

## Array and sensor model

This layer turns sound at each microphone position into the digital signal the real node would produce.

- **Node geometry:** the 12-microphone icosahedral layout and the node's position and orientation on site.
- **Microphone behaviour:** sensitivity, noise floor, frequency response and sampling, matched to the real hardware.
- **Timing:** sample timing between microphones and between nodes, including realistic clock drift, since localisation depends on it.

The output is a multichannel recording per node, in the same format the real hardware produces, so the detection and localisation pipeline runs on it unchanged.

## Outputs and uses

Each run produces a multichannel recording plus ground truth (true position, class and time for every object). That pair supports five uses:

- **Training data:** large, perfectly labelled sets for detection, classification and localisation.
- **Regression testing:** every pipeline change is scored automatically against a fixed set of scenarios.
- **Coverage planning:** load a site map, place nodes, and see where objects would be missed before installing anything.
- **Demos:** fly an object through a customer's site on screen and show it being tracked, with no hardware on site.
- **Live map:** the same viewer shows simulated or real events, so the digital twin of the site works in both modes.

## Validation loop

Simulated sound only helps if it matches real sound, so real recordings keep the simulator honest at three points.

1. **Fit the fingerprint:** clean, isolated recordings of each object set the twin's parameters.
2. **Check the site model:** compare simulated and real recordings at the same positions, and adjust reflections and background noise until they agree.
3. **Final test:** train only on simulated data, then run the detector and localiser on real recordings from the nodes. Success here is the proof that the approach works.

Test results are only ever reported on real recordings, never on simulated ones.

## Build order and open questions

Build one object end to end before widening the library.

1. Define the twin interface: what state goes in, and what source sound and direction pattern come out.
2. Build the first twin: one popular object, with its fingerprint fitted from clean recordings.
3. Connect it to the existing site simulator and array model, starting with open ground.
4. Run the simulation-to-real test on the nodes.
5. Extend: add an impulsive-sound twin, then the library tooling for creating and browsing objects.

**Open questions:**

- Which object and brand go first? Best answered by what the target customer actually sees.
- Which clean recordings exist, or must be made, for the first fingerprint?
- Is each source's direction pattern modelled, or measured per object?
- How is clock drift between nodes represented?