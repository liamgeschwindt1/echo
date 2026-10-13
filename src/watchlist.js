// Shared taxonomy for both models: which classes are "relevant" (coloured by
// family) vs "non-relevant" (greyscale), per instructions_v2.md §7 and §8.

// Okabe-Ito colour-blind-safe palette, one hue per family.
export const FAMILY_COLORS = {
  'Road vehicles': '#E69F00',
  'Emergency and alarms': '#D55E00',
  'Rail and air': '#0072B2',
  'Impacts and security': '#CC79A7',
  'Voice and crowd': '#009E73',
  'Music and PA': '#F0E442',
  'Works and plant': '#56B4E9',
  Animals: '#8B5A2B',
  Context: '#999999'
};

export const GREY = '#9ca3af';

// §7 YAMNet watchlist — matched by display name against yamnet_class_map.csv.
// Indices are kept for reference only; the name is the source of truth.
export const YAMNET_WATCHLIST = [
  // Road vehicles
  ['Road vehicles', 294, 'Vehicle'],
  ['Road vehicles', 300, 'Motor vehicle (road)'],
  ['Road vehicles', 301, 'Car'],
  ['Road vehicles', 302, 'Vehicle horn, car horn, honking'],
  ['Road vehicles', 303, 'Toot'],
  ['Road vehicles', 304, 'Car alarm'],
  ['Road vehicles', 306, 'Skidding'],
  ['Road vehicles', 307, 'Tire squeal'],
  ['Road vehicles', 308, 'Car passing by'],
  ['Road vehicles', 309, 'Race car, auto racing'],
  ['Road vehicles', 310, 'Truck'],
  ['Road vehicles', 311, 'Air brake'],
  ['Road vehicles', 312, 'Air horn, truck horn'],
  ['Road vehicles', 313, 'Reversing beeps'],
  ['Road vehicles', 315, 'Bus'],
  ['Road vehicles', 320, 'Motorcycle'],
  ['Road vehicles', 321, 'Traffic noise, roadway noise'],
  ['Road vehicles', 337, 'Engine'],
  ['Road vehicles', 345, 'Engine starting'],
  ['Road vehicles', 346, 'Idling'],
  ['Road vehicles', 347, 'Accelerating, revving, vroom'],
  ['Road vehicles', 343, 'Heavy engine (low frequency)'],
  // Emergency and alarms
  ['Emergency and alarms', 316, 'Emergency vehicle'],
  ['Emergency and alarms', 317, 'Police car (siren)'],
  ['Emergency and alarms', 318, 'Ambulance (siren)'],
  ['Emergency and alarms', 319, 'Fire engine, fire truck (siren)'],
  ['Emergency and alarms', 390, 'Siren'],
  ['Emergency and alarms', 391, 'Civil defense siren'],
  ['Emergency and alarms', 382, 'Alarm'],
  ['Emergency and alarms', 392, 'Buzzer'],
  ['Emergency and alarms', 393, 'Smoke detector, smoke alarm'],
  ['Emergency and alarms', 394, 'Fire alarm'],
  ['Emergency and alarms', 396, 'Whistle'],
  // Rail and air
  ['Rail and air', 322, 'Rail transport'],
  ['Rail and air', 323, 'Train'],
  ['Rail and air', 324, 'Train whistle'],
  ['Rail and air', 325, 'Train horn'],
  ['Rail and air', 326, 'Railroad car, train wagon'],
  ['Rail and air', 327, 'Train wheels squealing'],
  ['Rail and air', 328, 'Subway, metro, underground'],
  ['Rail and air', 329, 'Aircraft'],
  ['Rail and air', 330, 'Aircraft engine'],
  ['Rail and air', 331, 'Jet engine'],
  ['Rail and air', 332, 'Propeller, airscrew'],
  ['Rail and air', 333, 'Helicopter'],
  ['Rail and air', 334, 'Fixed-wing aircraft, airplane'],
  // Impacts and security
  ['Impacts and security', 420, 'Explosion'],
  ['Impacts and security', 421, 'Gunshot, gunfire'],
  ['Impacts and security', 422, 'Machine gun'],
  ['Impacts and security', 423, 'Fusillade'],
  ['Impacts and security', 424, 'Artillery fire'],
  ['Impacts and security', 426, 'Fireworks'],
  ['Impacts and security', 427, 'Firecracker'],
  ['Impacts and security', 428, 'Burst, pop'],
  ['Impacts and security', 429, 'Eruption'],
  ['Impacts and security', 430, 'Boom'],
  ['Impacts and security', 434, 'Crack'],
  ['Impacts and security', 435, 'Glass'],
  ['Impacts and security', 437, 'Shatter'],
  ['Impacts and security', 460, 'Bang'],
  ['Impacts and security', 463, 'Smash, crash'],
  ['Impacts and security', 464, 'Breaking'],
  ['Impacts and security', 352, 'Slam'],
  ['Impacts and security', 454, 'Thump, thud'],
  // Voice and crowd
  ['Voice and crowd', 0, 'Speech'],
  ['Voice and crowd', 2, 'Conversation'],
  ['Voice and crowd', 6, 'Shout'],
  ['Voice and crowd', 7, 'Bellow'],
  ['Voice and crowd', 9, 'Yell'],
  ['Voice and crowd', 10, 'Children shouting'],
  ['Voice and crowd', 11, 'Screaming'],
  ['Voice and crowd', 13, 'Laughter'],
  ['Voice and crowd', 19, 'Crying, sobbing'],
  ['Voice and crowd', 61, 'Cheering'],
  ['Voice and crowd', 62, 'Applause'],
  ['Voice and crowd', 63, 'Chatter'],
  ['Voice and crowd', 64, 'Crowd'],
  ['Voice and crowd', 65, 'Hubbub, speech noise, speech babble'],
  // Music and PA
  ['Music and PA', 132, 'Music'],
  ['Music and PA', 157, 'Drum kit'],
  ['Music and PA', 163, 'Bass drum'],
  ['Music and PA', 211, 'Pop music'],
  ['Music and PA', 212, 'Hip hop music'],
  ['Music and PA', 215, 'Heavy metal'],
  ['Music and PA', 235, 'House music'],
  ['Music and PA', 236, 'Techno'],
  ['Music and PA', 240, 'Electronic dance music'],
  ['Music and PA', 269, 'Dance music'],
  ['Music and PA', 5, 'Speech synthesizer'],
  // Works and plant
  ['Works and plant', 414, 'Jackhammer'],
  ['Works and plant', 413, 'Hammer'],
  ['Works and plant', 415, 'Sawing'],
  ['Works and plant', 418, 'Power tool'],
  ['Works and plant', 419, 'Drill'],
  ['Works and plant', 341, 'Chainsaw'],
  ['Works and plant', 340, 'Lawn mower'],
  ['Works and plant', 406, 'Mechanical fan'],
  ['Works and plant', 407, 'Air conditioning'],
  // Animals
  ['Animals', 69, 'Dog'],
  ['Animals', 70, 'Bark'],
  ['Animals', 72, 'Howl'],
  ['Animals', 74, 'Growling'],
  // Context
  ['Context', 277, 'Wind'],
  ['Context', 278, 'Rustling leaves'],
  ['Context', 279, 'Wind noise (microphone)'],
  ['Context', 280, 'Thunderstorm'],
  ['Context', 281, 'Thunder'],
  ['Context', 283, 'Rain'],
  ['Context', 285, 'Rain on surface'],
  ['Context', 503, 'Outside, urban or manmade']
].map(([family, index, name]) => ({ family, index, name }));

export const YAMNET_WATCHLIST_BY_NAME = new Map(YAMNET_WATCHLIST.map((e) => [e.name, e]));

// §8 CLAP prompt set. `relevant: false` entries are negatives/ambience that
// only exist so softmax probability has somewhere sensible to go.
export const CLAP_PROMPTS = [
  // Road vehicles
  { id: 'tyre_screech', family: 'Road vehicles', relevant: true, phrasings: ['tyres screeching on tarmac', 'a car skidding to a halt', 'rubber squealing on the road', 'a car braking hard with squealing tyres'] },
  { id: 'car_horn', family: 'Road vehicles', relevant: true, phrasings: ['a car horn honking', 'a vehicle sounding its horn', 'a long blast of a car horn', 'short beeps of a car horn'] },
  { id: 'car_alarm', family: 'Road vehicles', relevant: true, phrasings: ['a car alarm going off', 'a vehicle alarm wailing', 'a car security alarm blaring'] },
  { id: 'car_passing', family: 'Road vehicles', relevant: true, phrasings: ['a car driving past', 'a vehicle passing on the road', 'a car engine passing by'] },
  { id: 'motorcycle', family: 'Road vehicles', relevant: true, phrasings: ['a motorcycle revving', 'a motorbike driving past', 'a loud motorbike accelerating'] },
  { id: 'scooter_ebike', family: 'Road vehicles', relevant: true, phrasings: ['an electric scooter whirring', 'an e-bike passing', 'a moped buzzing past'] },
  { id: 'bicycle', family: 'Road vehicles', relevant: true, phrasings: ['a bicycle passing', 'a bicycle bell ringing', 'bicycle wheels on tarmac'] },
  { id: 'lorry_hgv', family: 'Road vehicles', relevant: true, phrasings: ['a heavy lorry driving past', 'a large truck engine rumbling', 'a diesel lorry accelerating'] },
  { id: 'reversing_beeps', family: 'Road vehicles', relevant: true, phrasings: ['a reversing vehicle beeping', 'a reversing alarm beeping repeatedly', 'a truck backing up with beeps'] },
  { id: 'bin_lorry', family: 'Road vehicles', relevant: true, phrasings: ['a bin lorry collecting rubbish', 'a refuse truck compacting waste', 'bins being emptied into a rubbish truck', 'glass bottles being tipped into a recycling lorry'] },
  { id: 'van_idling', family: 'Road vehicles', relevant: true, phrasings: ['a van idling at the kerb', 'a delivery van with its engine running', 'a van door sliding shut'] },
  { id: 'engine_idling', family: 'Road vehicles', relevant: true, phrasings: ['a vehicle engine idling', 'a diesel engine ticking over', 'a car engine starting'] },
  { id: 'traffic_steady', family: 'Road vehicles', relevant: true, phrasings: ['steady road traffic noise', 'a busy road in the city', 'distant traffic hum'] },
  // Emergency and alarms
  { id: 'siren_police', family: 'Emergency and alarms', relevant: true, phrasings: ['a police siren wailing', 'a police car siren passing', 'a two-tone police siren'] },
  { id: 'siren_ambulance', family: 'Emergency and alarms', relevant: true, phrasings: ['an ambulance siren', 'an ambulance with its siren on passing by'] },
  { id: 'siren_fire', family: 'Emergency and alarms', relevant: true, phrasings: ['a fire engine siren', 'a fire truck with air horn and siren'] },
  { id: 'siren_generic', family: 'Emergency and alarms', relevant: true, phrasings: ['an emergency siren', 'a siren in the distance', 'a siren getting louder'] },
  { id: 'fire_alarm', family: 'Emergency and alarms', relevant: true, phrasings: ['a fire alarm ringing', 'a smoke detector beeping', 'a building alarm bell'] },
  { id: 'intruder_alarm', family: 'Emergency and alarms', relevant: true, phrasings: ['an intruder alarm sounding', 'a burglar alarm siren', 'a house alarm wailing'] },
  // Rail and air
  { id: 'train', family: 'Rail and air', relevant: true, phrasings: ['a train passing', 'a train rumbling on the tracks', 'a train horn', 'train wheels on rails'] },
  { id: 'train_on_bridge', family: 'Rail and air', relevant: true, phrasings: ['a train rumbling across a bridge overhead', 'a train passing over a railway bridge', 'an echoing rumble under a bridge'] },
  { id: 'aircraft', family: 'Rail and air', relevant: true, phrasings: ['an aeroplane flying overhead', 'a jet passing over', 'aircraft engine noise from above', 'a plane on its approach'] },
  { id: 'helicopter', family: 'Rail and air', relevant: true, phrasings: ['a helicopter hovering overhead', 'helicopter rotor blades chopping', 'a police helicopter circling'] },
  // Impacts and security
  { id: 'gunshot', family: 'Impacts and security', relevant: true, phrasings: ['a gunshot', 'gunfire', 'a single shot from a gun', 'several gunshots in a row'] },
  { id: 'explosion', family: 'Impacts and security', relevant: true, phrasings: ['an explosion', 'a loud boom', 'a large blast'] },
  { id: 'fireworks', family: 'Impacts and security', relevant: true, phrasings: ['fireworks exploding', 'firecrackers going off', 'fireworks banging in the sky'] },
  { id: 'bang', family: 'Impacts and security', relevant: true, phrasings: ['a loud bang', 'something heavy banging', 'a sudden sharp crack'] },
  { id: 'door_slam', family: 'Impacts and security', relevant: true, phrasings: ['a door slamming', 'a heavy door slamming shut', 'a metal gate clanging shut'] },
  { id: 'glass_break', family: 'Impacts and security', relevant: true, phrasings: ['glass breaking', 'a window smashing', 'a bottle shattering on the ground'] },
  { id: 'crash', family: 'Impacts and security', relevant: true, phrasings: ['a car crash', 'metal crashing', 'vehicles colliding', 'a loud crash of metal and glass'] },
  { id: 'thud', family: 'Impacts and security', relevant: true, phrasings: ['a heavy thud', 'something heavy dropping on the ground'] },
  // Voice and crowd
  { id: 'speech', family: 'Voice and crowd', relevant: true, phrasings: ['a person talking', 'people having a conversation', 'speech nearby'] },
  { id: 'shouting', family: 'Voice and crowd', relevant: true, phrasings: ['a person shouting', 'someone yelling loudly', 'an angry shout'] },
  { id: 'scream', family: 'Voice and crowd', relevant: true, phrasings: ['a person screaming', 'a loud high-pitched scream', 'someone screaming for help'] },
  { id: 'crowd_chatter', family: 'Voice and crowd', relevant: true, phrasings: ['a crowd of people talking', 'busy crowd noise', 'people chattering in a crowd'] },
  { id: 'crowd_rowdy', family: 'Voice and crowd', relevant: true, phrasings: ['a rowdy group of people outside a pub', 'people cheering and shouting', 'a crowd singing and shouting at night'] },
  { id: 'laughter', family: 'Voice and crowd', relevant: true, phrasings: ['people laughing', 'a group laughing loudly'] },
  { id: 'children_playing', family: 'Voice and crowd', relevant: true, phrasings: ['children playing and shouting', 'kids in a playground'] },
  // Music and PA
  { id: 'music_loud', family: 'Music and PA', relevant: true, phrasings: ['loud music playing', 'a party with loud music', 'music playing from speakers'] },
  { id: 'music_bass', family: 'Music and PA', relevant: true, phrasings: ['a deep bass beat thumping', 'bass music from a car stereo', 'bass thumping through a wall'] },
  { id: 'music_street', family: 'Music and PA', relevant: true, phrasings: ['a busker playing guitar', 'a street musician playing', 'live music outdoors'] },
  { id: 'pa_announcement', family: 'Music and PA', relevant: true, phrasings: ['a tannoy announcement', 'a public address announcement', 'a recorded voice announcing over a loudspeaker', 'a train station announcement over a speaker'] },
  // Works and plant
  { id: 'jackhammer', family: 'Works and plant', relevant: true, phrasings: ['a jackhammer drilling', 'a pneumatic drill breaking concrete', 'roadworks drilling'] },
  { id: 'power_tool', family: 'Works and plant', relevant: true, phrasings: ['an angle grinder', 'a power drill', 'a circular saw cutting', 'an electric saw'] },
  { id: 'construction', family: 'Works and plant', relevant: true, phrasings: ['construction site noise', 'hammering and banging on a building site', 'a digger working', 'a crane or excavator moving'] },
  { id: 'garden_machinery', family: 'Works and plant', relevant: true, phrasings: ['a leaf blower', 'a lawn mower', 'a petrol strimmer', 'a hedge trimmer'] },
  { id: 'generator', family: 'Works and plant', relevant: true, phrasings: ['a diesel generator running', 'a generator humming'] },
  { id: 'hvac_plant', family: 'Works and plant', relevant: true, phrasings: ['an air conditioning unit humming', 'a ventilation fan droning', 'building plant machinery humming'] },
  // Animals
  { id: 'dog', family: 'Animals', relevant: true, phrasings: ['a dog barking', 'dogs barking in the distance', 'a dog howling'] },
  { id: 'fox', family: 'Animals', relevant: true, phrasings: ['a fox screaming at night', 'a fox screeching', 'an urban fox calling'] },
  // Context (drawn dashed and muted)
  { id: 'wind', family: 'Context', relevant: true, phrasings: ['wind blowing into a microphone', 'strong wind noise', 'wind buffeting a microphone', 'a breeze rustling leaves'] },
  { id: 'rain', family: 'Context', relevant: true, phrasings: ['rain falling', 'heavy rain on pavement', 'rain on a roof'] },
  { id: 'thunder', family: 'Context', relevant: true, phrasings: ['thunder rumbling', 'a rumble of thunder'] },
  // Negatives and ambience (greyscale)
  { id: 'footsteps', family: 'Negative', relevant: false, phrasings: ['footsteps on pavement', 'someone walking', 'shoes clicking on a hard floor'] },
  { id: 'handling_noise', family: 'Negative', relevant: false, phrasings: ['a microphone being handled', 'rustling clothing', 'fabric rubbing against a microphone', 'fingers tapping on a phone'] },
  { id: 'keys_typing', family: 'Negative', relevant: false, phrasings: ['typing on a keyboard', 'keys jangling', 'a mouse clicking'] },
  { id: 'quiet_room', family: 'Negative', relevant: false, phrasings: ['silence', 'a very quiet room', 'faint background noise'] },
  { id: 'cafe', family: 'Negative', relevant: false, phrasings: ['a cafe with people chatting and cups clinking', 'a coffee machine hissing and steaming', 'background chatter in a coffee shop'] },
  { id: 'river_boats', family: 'Negative', relevant: false, phrasings: ['a boat engine on a river', 'water lapping against a riverbank', 'a river boat passing'] },
  { id: 'birds', family: 'Negative', relevant: false, phrasings: ['birds singing', 'a pigeon cooing', 'seagulls calling'] },
  { id: 'low_rumble', family: 'Negative', relevant: false, phrasings: ['a low frequency rumble', 'an echoing rumble in a tunnel', 'a reverberant space with distant rumbling'] },
  { id: 'city_ambience', family: 'Negative', relevant: false, phrasings: ['general city ambience', 'a distant city hum', 'a busy street in the background'] }
];

export const CLAP_PROMPTS_BY_ID = new Map(CLAP_PROMPTS.map((c) => [c.id, c]));

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
  'Train',
  'Aircraft overhead',
  'PA / tannoy announcement',
  'Bin lorry reversing',
  'Bass music through wall',
  'Scooter / e-bike',
  'Crowd leaving a bar',
  'Fox scream'
];

export function familyColor(family) {
  return FAMILY_COLORS[family] || GREY;
}
