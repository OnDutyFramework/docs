import type { Rng } from '../core/math';
import type { MemoryEntry, Profile, SecurityLevel } from './types';

export const MEMORY_LIMIT = 24;

const FIRST_NAMES = [
  'Marcus', 'Dale', 'Elias', 'Ray', 'Omar', 'Travis', 'Nathan', 'Desmond', 'Victor', 'Curtis',
  'Hollis', 'Jerome', 'Abel', 'Lenny', 'Cyrus', 'Ivan', 'Rudy', 'Terrence', 'Mitch', 'Clyde',
  'Wendell', 'Jonah', 'Ike', 'Russell', 'Darnell', 'Emmett', 'Grady', 'Otis', 'Silas', 'Rafael',
  'Keenan', 'Lamar', 'Bruno', 'Vernon', 'Hector', 'Linus', 'Augie', 'Royce', 'Mateo', 'Roland',
];

const LAST_NAMES = [
  'Okafor', 'Whitlock', 'Brennan', 'Castellano', 'Mbeki', 'Vance', 'Doherty', 'Alvarez', 'Pruitt',
  'Nakamura', 'Birch', 'Salinas', 'Hollingsworth', 'Reyes', 'Kowalski', 'Fenwick', 'Ibrahim',
  'Tate', 'Delacroix', 'Mercer', 'Osei', 'Bannon', 'Quintero', 'Lindqvist', 'Marsh', 'Ferraro',
  'Abernathy', 'Strand', 'Vasquez', 'Holloway', 'Dubois', 'Ng', 'Petrov', 'Calloway', 'Rhodes',
];

interface ChargeDef {
  charge: string;
  security: SecurityLevel;
  /** Sentence range in simulated days. */
  minDays: number;
  maxDays: number;
  /** Relative frequency in the intake mix. */
  weight: number;
}

/**
 * The intake mix. Short sentences dominate on purpose: the roster should churn
 * so the player sees release days early and often, not only after hours.
 */
const CHARGES: readonly ChargeDef[] = [
  { charge: 'Possession with intent', security: 'minimum', minDays: 4, maxDays: 10, weight: 5 },
  { charge: 'Burglary, second degree', security: 'minimum', minDays: 5, maxDays: 12, weight: 4 },
  { charge: 'Fraud and forgery', security: 'minimum', minDays: 4, maxDays: 9, weight: 3 },
  { charge: 'Grand theft auto', security: 'medium', minDays: 7, maxDays: 16, weight: 4 },
  { charge: 'Aggravated assault', security: 'medium', minDays: 9, maxDays: 20, weight: 4 },
  { charge: 'Armed robbery', security: 'medium', minDays: 12, maxDays: 26, weight: 3 },
  { charge: 'Trafficking', security: 'maximum', minDays: 16, maxDays: 34, weight: 2 },
  { charge: 'Manslaughter', security: 'maximum', minDays: 20, maxDays: 44, weight: 2 },
  { charge: 'Arson, occupied dwelling', security: 'maximum', minDays: 18, maxDays: 38, weight: 1 },
];

/** Ties on the outside — the thing a sentence is measured against. */
const TIES = [
  'Two kids in Rockdale County; writes to them every Sunday.',
  'His mother visits every month and never stays the full hour.',
  'Nobody on his visitor list. Hasn\u2019t had a call in a year.',
  'A girlfriend who says she\u2019ll wait. He believes her about half the time.',
  'Was eleven days from a trade qualification when he was arrested.',
  'Has a brother three blocks over in the same system.',
  'Sends most of his commissary money home to a sister.',
  'Owned a garage before this. Still talks about it in the present tense.',
  'Reads everything the library has. Twice.',
  'Keeps a photograph he won\u2019t let anyone else touch.',
  'Grew up ninety minutes from this gate and has never left the county.',
  'Was a line cook for eleven years. Asks about the kitchen job weekly.',
  'Signed up for the GED track on day one and hasn\u2019t missed a session.',
  'Served two years elsewhere. Knows exactly how this works.',
  'Has a dog being looked after by a neighbour who may not have it anymore.',
  'Pays off a debt on the outside that keeps growing without him.',
];

/** Traits are chosen to conflict — a volatile man who is also a peacemaker is interesting. */
const TRAITS = [
  'Volatile', 'Quiet', 'Literate', 'Illiterate', 'Religious', 'Peacemaker', 'Grudge-holder',
  'Hustler', 'Insomniac', 'Fastidious', 'Gang-affiliated', 'Protective', 'Addicted',
  'Institutionalised', 'Ambitious', 'Proud', 'Anxious', 'Respected',
];

function weightedCharge(rng: Rng): ChargeDef {
  let total = 0;
  for (const def of CHARGES) total += def.weight;
  let roll = rng.next() * total;
  for (const def of CHARGES) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return CHARGES[0];
}

export function makePrisonerProfile(rng: Rng, intakeDay: number): Profile {
  const def = weightedCharge(rng);
  const sentenceDays = Math.round(rng.range(def.minDays, def.maxDays));
  const traitCount = rng.next() < 0.35 ? 3 : 2;
  const traits: string[] = [];
  while (traits.length < traitCount) {
    const trait = rng.pick(TRAITS)!;
    if (!traits.includes(trait)) traits.push(trait);
  }

  return {
    fullName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    age: rng.int(19, 58),
    charge: def.charge,
    security: def.security,
    sentenceDays,
    intakeDay,
    releaseDay: intakeDay + sentenceDays,
    backstory: rng.pick(TIES)!,
    traits,
  };
}

const GUARD_RANKS = ['Officer', 'Officer', 'Officer', 'Sgt.'];

export function makeGuardProfile(rng: Rng, day: number): Profile {
  return {
    fullName: `${rng.pick(GUARD_RANKS)} ${rng.pick(LAST_NAMES)}`,
    age: rng.int(24, 56),
    charge: 'Correctional officer',
    security: 'medium',
    sentenceDays: 0,
    intakeDay: day,
    releaseDay: Infinity,
    backstory: 'On shift.',
    traits: [],
  };
}

/** Days left on the sentence, floored at zero. */
export function sentenceRemaining(profile: Profile, day: number, hour: number): number {
  return Math.max(0, profile.releaseDay - day - hour / 24);
}

export function formatRemaining(days: number): string {
  if (!Number.isFinite(days)) return '\u2014';
  if (days <= 0) return 'Released';
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours}h left`;
  }
  const whole = Math.floor(days);
  return whole === 1 ? '1 day left' : `${whole} days left`;
}

/** Record entries from before the player took over read as prior history. */
export function dayLabel(day: number): string {
  return day < 1 ? 'prior' : `D${day}`;
}

export function pushMemory(memory: MemoryEntry[], entry: MemoryEntry): void {
  // Collapse immediate repeats so the record reads as events, not a tick log.
  const latest = memory[0];
  if (latest && latest.text === entry.text && latest.day === entry.day) return;
  memory.unshift(entry);
  if (memory.length > MEMORY_LIMIT) memory.length = MEMORY_LIMIT;
}
