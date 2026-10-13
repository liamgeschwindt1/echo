// Classes we care about for the test rig (indices from yamnet_class_map.csv).
// Names are resolved at runtime against the class map so they always match
// whatever the model actually returns.
export const WATCHLIST = {
  Vehicles: [307, 306, 302, 304, 308, 320, 310, 313, 321, 337],
  Emergency: [390, 317, 318, 319],
  Transport: [323, 329, 333],
  'Impacts and security': [421, 420, 426, 460, 352, 463, 435, 437],
  'Voice-adjacent': [11, 6, 9, 64, 0],
  'Music and nuisance': [132, 163, 414, 418],
  Animals: [69, 70],
  Context: [279]
};

export const QUICK_NOTE_PRESETS = [
  'Tyre screech (speaker playback)',
  'Car horn',
  'Siren',
  'Glass breaking',
  'Loud bang / door slam',
  'Shouting',
  'Scream (recording)',
  'Dog bark',
  'Fireworks',
  'Power tools',
  'PA / tannoy announcement',
  'Bin lorry reversing',
  'Bass music through wall',
  'Scooter / e-bike',
  'Crowd leaving a bar'
];
