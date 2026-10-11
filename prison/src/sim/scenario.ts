import { assignHousing } from './housing';
import { MEMORY_LIMIT } from './people';
import { FLOOR, WALL, type Agent, type FloorId, type ObjectKind } from './types';
import { World } from './world';

/**
 * Builds the inherited facility. Per the design doc the player starts with a
 * working prison that already has problems, not an empty lot — so this lays
 * down a spine corridor, a cell block, services and a yard, then populates it
 * with inmates who are already part-way through their sentences.
 */
export function createStartingPrison(): World {
  const world = new World(64, 46);
  const { map } = world;

  const floorRect = (x0: number, y0: number, x1: number, y1: number, floor: FloorId) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (map.inBounds(x, y)) map.floors[map.index(x, y)] = floor;
      }
    }
  };

  const wallRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x <= x1; x++) {
      setWall(x, y0);
      setWall(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      setWall(x0, y);
      setWall(x1, y);
    }
  };

  const setWall = (x: number, y: number) => {
    if (map.inBounds(x, y)) map.walls[map.index(x, y)] = WALL.Solid;
  };

  const setDoor = (x: number, y: number) => {
    if (!map.inBounds(x, y)) return;
    const index = map.index(x, y);
    map.walls[index] = WALL.Door;
    if (map.floors[index] === FLOOR.None) map.floors[index] = FLOOR.Concrete;
  };

  const place = (kind: ObjectKind, x: number, y: number) => world.addObject(kind, x, y);

  // --- site perimeter -------------------------------------------------------
  wallRect(6, 6, 62, 40);
  setDoor(6, 23);

  // --- approach road and sally port ----------------------------------------
  floorRect(1, 23, 5, 23, FLOOR.Concrete);
  floorRect(7, 22, 9, 24, FLOOR.Concrete);
  world.intakeTile = map.index(3, 23);

  // --- spine corridor -------------------------------------------------------
  const corridorX0 = 10;
  const corridorX1 = 46;
  floorRect(corridorX0, 22, corridorX1, 24, FLOOR.Concrete);
  for (let x = corridorX0; x <= corridorX1; x++) {
    setWall(x, 21);
    setWall(x, 25);
  }
  for (let y = 21; y <= 25; y++) {
    setWall(corridorX0, y);
    setWall(corridorX1, y);
  }
  setDoor(corridorX0, 23);
  setDoor(corridorX1, 23);

  // --- cell block, north side (shared walls, two beds each) -----------------
  const cellY0 = 16;
  const cellY1 = 21;
  for (let i = 0; i < 8; i++) {
    const x0 = 12 + i * 4;
    const x1 = x0 + 4;
    wallRect(x0, cellY0, x1, cellY1);
    floorRect(x0 + 1, cellY0 + 1, x1 - 1, cellY1 - 1, FLOOR.Concrete);
    setDoor(x0 + 2, cellY1);
    place('bed', x0 + 1, cellY0 + 1);
    place('bed', x0 + 3, cellY0 + 1);
    place('toilet', x0 + 1, cellY1 - 1);
  }

  // --- canteen, south-west --------------------------------------------------
  wallRect(12, 25, 26, 35);
  floorRect(13, 26, 25, 34, FLOOR.Polished);
  setDoor(16, 25);
  setDoor(22, 25);
  for (const ty of [28, 31]) {
    for (const tx of [15, 18, 21, 24]) place('table', tx, ty);
  }

  // --- common room, south-centre -------------------------------------------
  wallRect(27, 25, 37, 33);
  floorRect(28, 26, 36, 32, FLOOR.Concrete);
  setDoor(32, 25);
  place('tv', 32, 27);
  for (const bx of [29, 31, 33, 35]) place('bench', bx, 30);

  // --- bathroom, south-east -------------------------------------------------
  wallRect(38, 25, 44, 31);
  floorRect(39, 26, 43, 30, FLOOR.Polished);
  setDoor(41, 25);
  for (const sy of [27, 29]) {
    for (const sx of [40, 42]) place('shower', sx, sy);
  }

  // --- yard, east -----------------------------------------------------------
  floorRect(47, 23, 47, 23, FLOOR.Concrete);
  floorRect(48, 12, 60, 34, FLOOR.Yard);
  for (const by of [16, 20]) place('bench', 50, by);

  world.markRoomsDirty();
  world.rebuildRooms();
  world.recomputeCapacity();

  // --- population -----------------------------------------------------------
  for (let i = 0; i < 11; i++) {
    const agent = world.spawnPrisoner();
    backdateSentence(world, agent);
    // Scatter the inherited population through the facility.
    const tile = world.rng.pick([
      map.index(14 + world.rng.int(0, 28), 23),
      map.index(16 + world.rng.int(0, 8), 29),
      map.index(30 + world.rng.int(0, 6), 30),
      map.index(50 + world.rng.int(0, 8), 18 + world.rng.int(0, 10)),
    ])!;
    agent.x = map.tileX(tile) + 0.5;
    agent.y = map.tileY(tile) + 0.5;
    agent.needs.sleep = 35 + world.rng.range(0, 50);
    agent.needs.hunger = 30 + world.rng.range(0, 55);
    agent.needs.hygiene = 30 + world.rng.range(0, 60);
    agent.needs.recreation = 35 + world.rng.range(0, 55);
    seedHistory(world, agent);
  }

  for (let i = 0; i < 4; i++) {
    const guard = world.spawnGuard();
    guard.x = 14 + i * 8.5;
    guard.y = 23.5;
  }

  assignHousing(world);
  // The log should read as a handover, not as a fresh boot.
  world.log.length = 0;
  world.logEvent('You have the warden\u2019s chair. 11 inmates, 4 officers on shift.', 'info');
  world.logEvent('Inherited: eight two-bed cells, a canteen, a common room, a yard.', 'info');

  return world;
}

/** Puts an inherited inmate part-way through their sentence. */
function backdateSentence(world: World, agent: Agent): void {
  const { profile } = agent;
  const served = world.rng.int(0, Math.max(1, profile.sentenceDays - 1));
  profile.intakeDay = 1 - served;
  profile.releaseDay = Math.max(2, profile.intakeDay + profile.sentenceDays);
  // The intake note belongs on the day they actually arrived.
  const admission = agent.memory[agent.memory.length - 1];
  if (admission) admission.day = profile.intakeDay;
}

const HISTORY_LINES: ReadonlyArray<[string, 'info' | 'good' | 'warn' | 'bad']> = [
  ['Transferred in from the county jail.', 'info'],
  ['Three days in segregation after a fight in the canteen.', 'bad'],
  ['Put on the kitchen rota. Kept it.', 'good'],
  ['Visit cancelled at the gate. Took it badly.', 'warn'],
  ['Completed a literacy assessment.', 'good'],
  ['Searched after a tip-off. Nothing found.', 'info'],
  ['Moved cells twice in one week.', 'warn'],
];

/**
 * Gives an inherited inmate a plausible paper trail, dated across the time
 * they have already served rather than all stamped with today.
 */
function seedHistory(world: World, agent: Agent): void {
  const count = world.rng.int(2, 5);
  const span = Math.max(1, 1 - agent.profile.intakeDay);
  const days: number[] = [];
  for (let i = 0; i < count; i++) days.push(agent.profile.intakeDay + world.rng.int(0, span + 1));
  days.sort((a, b) => a - b);

  for (const day of days) {
    const line = world.rng.pick(HISTORY_LINES)!;
    // Oldest first, so unshifting leaves the record newest-first.
    agent.memory.unshift({
      day,
      time: `${String(world.rng.int(7, 21)).padStart(2, '0')}:${String(world.rng.int(0, 60)).padStart(2, '0')}`,
      text: line[0],
      tone: line[1],
    });
  }
  if (agent.memory.length > MEMORY_LIMIT) agent.memory.length = MEMORY_LIMIT;
}
