// Frames and select offsets are zero based. The in-point is measured from scene boot.
export const fps = 60;
const takes = [
  // slug, subject, seed, seconds, in-point, press selects, test-link setup, camera
  ['first-contact', 'Bright Meadow · the dash through the pack', 42, 5, 30, [65, 181],
    'day&hero=rookie&aim=1,-.2&swarm=88&dashes=2', 'chase'],
  ['king-bopper', 'King Bopper · entrance and first attack', 71, 4, 10, [55],
    'stage=1&bossnow&aim=0,-1', 'scene'],
  ['dune-patrol', 'Sunset Dunes · drone escort', 37, 5, 48, [52, 182],
    'stage=2&day&weapons=drones:5&aim=.6,-.8&swarm=55', 'follow'],
  ['parry', 'Frosty Peaks · return fire', 81, 4, 75, [62],
    'stage=3&day&parrygo=2.2&spawn=shooter:7&aim=1,0', 'chase'],
  ['evolution', 'Flare Buster · the evolution salute', 56, 4, 80, [95, 154],
    'stage=1&evolution=2.3&aim=1,0', 'scene'],
  ['storm-drones', 'Storm Drones · lightning through the swarm', 101, 5, 22, [38, 175],
    'biome=meadow:autumn&weapons=storm_drones&aim=0,-1&hold=155&swarm=175', 'wide'],
  ['ronin', 'Neon City · Ronin draws the katana', 52, 5, 30, [31, 185],
    'stage=5&hero=ronin&biome=neon&night&aim=.8,-.3&spawn=bopper:15&spawnr=5&swarm=48', 'chase'],
  ['toy-factory', 'Toy Factory · conveyor skirmish', 84, 4, 55, [107],
    'stage=6&biome=factory&day&dry&hero=bulwark&spawn=shooter:8&aim=-1,0', 'glide'],
  ['boxer-jack', 'Boxer Jack · the wind-up', 19, 4, 40, [210],
    'stage=6&biome=factory&bossnow&nointro&b3near&b3move=punch', 'duel'],
  ['sky-fortress', 'Sky Fortress · over the chasm', 88, 5, 60, [35, 209],
    'stage=7&biome=sky&day&dry&at=flag&hero=ace&aim=-1,-.2&spawn=shooter:8', 'glide'],
  ['couch-crew', 'Shared-screen co-op · three kits in one arena', 32, 6, 75, [56, 225],
    'localcoop=run&lcpads=2&aim=.7,-.6&hold=45', 'follow'],
  ['team-ultimate', 'Team ultimate · the crew closes ranks', 61, 5, 80, [55, 161],
    'stage=3&day&dry&heroes=4&matebots&spread=6&teamult=2.7&swarm=75&aim=0,-1', 'wide'],
  ['glitch-dj', 'Glitch DJ · neon dance floor', 104, 4, 100, [98],
    'stage=5&biome=neon&night&bossnow&nointro&b3near&b3move=grid&aim=1,0', 'duel'],
  ['hive-queen', 'Hive Queen · entrance above the snow', 76, 4, 15, [57],
    'stage=3&bossnow&day&aim=0,-1', 'scene'],
  ['titan-rise', 'Titan Goliath · the reveal', 27, 5, 85, [162],
    'stage=1&bossnow&titan&day', 'scene'],
  ['titan-beam', 'Titan Goliath · beam and weak points', 27, 5, 245, [58, 204],
    'stage=1&bossnow&titan&titanphase=3&titanmove=beam&nointro&aim=0,-1', 'duel'],
  ['magma', 'Magma Isle · rockets in the caldera', 125, 4, 40, [95],
    'stage=4&day&dry&hero=furnace&weapons=napalm_rockets&swarm=125&aim=1,0&at=lava', 'wide'],
  ['omega', 'Omega Overlord · the last blow', 93, 4, 70, [98, 148],
    'stage=4&bossnow&nointro&killboss=2.7&aim=0,-1', 'scene'],
  ['golden-route', 'Bright Meadow · the golden portal', 91, 4, 100, [147],
    'day&flawless=2.2&portalnow&aim=1,0', 'scene'],
  ['postcard', 'Photo mode · airmail from Bright Meadow', 42, 4, 90, [134],
    'day&photo=.6&photopose=salute&photoquiet&photohour=15&photocam=.5,20,8&photoframe=postcard&stickers=comet@.18,.27&photohide', 'photo'],
];
let cursor = 0;
export const shots = takes.map(([id, subject, seed, seconds, preroll, selects, setup, camera], i) => {
  const frames = seconds * fps;
  const start = cursor;
  cursor += frames;
  return { id: String(i + 1).padStart(2, '0') + '-' + id, subject, start, frames, preroll, selects, camera,
    link: '?test&bench&circle&god&quality=high&cine=full&clips=off&season=off&lang=en&seed=' + seed + '&' + setup };
});
