import { clamp } from '../core/math';
import { NEED_KINDS, type Agent, type NeedKind, type Needs } from './types';

/** Need points lost per simulated hour while the need is not being served. */
export const DECAY_PER_HOUR: Record<NeedKind, number> = {
  sleep: 4.6,
  hunger: 5.4,
  hygiene: 2.8,
  recreation: 3.6,
};

/** Below this an inmate will abandon the regime to deal with it. */
export const CRITICAL = 22;
/** Below this the need is flagged amber in the UI. */
export const STRAINED = 45;

export const NEED_LABELS: Record<NeedKind, string> = {
  sleep: 'Sleep',
  hunger: 'Food',
  hygiene: 'Hygiene',
  recreation: 'Recreation',
};

export function makeNeeds(initial = 70): Needs {
  return { sleep: initial, hunger: initial, hygiene: initial, recreation: initial };
}

/** Decays every need except the one currently being restored. */
export function decayNeeds(needs: Needs, simHours: number, servedNeed: NeedKind | null): void {
  for (const kind of NEED_KINDS) {
    if (kind === servedNeed) continue;
    needs[kind] = clamp(needs[kind] - DECAY_PER_HOUR[kind] * simHours, 0, 100);
  }
}

export function restoreNeed(needs: Needs, kind: NeedKind, ratePerHour: number, simHours: number): void {
  needs[kind] = clamp(needs[kind] + ratePerHour * simHours, 0, 100);
}

/** The need most in want of attention. */
export function lowestNeed(needs: Needs): { kind: NeedKind; value: number } {
  let kind: NeedKind = 'sleep';
  let value = Infinity;
  for (const candidate of NEED_KINDS) {
    if (needs[candidate] < value) {
      value = needs[candidate];
      kind = candidate;
    }
  }
  return { kind, value };
}

export function criticalNeeds(needs: Needs): NeedKind[] {
  return NEED_KINDS.filter((kind) => needs[kind] < CRITICAL);
}

/** 0..100 wellbeing, the average of all needs. */
export function wellbeing(needs: Needs): number {
  let sum = 0;
  for (const kind of NEED_KINDS) sum += needs[kind];
  return sum / NEED_KINDS.length;
}

/**
 * Unrest is the facility's danger signal. It climbs while needs go unmet and
 * bleeds off when an inmate is comfortable or a guard is nearby.
 */
export function updateUnrest(agent: Agent, simHours: number, guardPressure: number): void {
  const unmet = criticalNeeds(agent.needs).length;
  const comfort = wellbeing(agent.needs);

  let delta = 0;
  if (unmet > 0) delta += unmet * 7.5;
  else if (comfort > 72) delta -= 9;
  else delta -= 2.5;

  delta -= guardPressure * 12;

  // Volatile inmates spike faster; peacemakers absorb pressure.
  if (agent.profile.traits.includes('Volatile')) delta *= delta > 0 ? 1.4 : 1;
  if (agent.profile.traits.includes('Peacemaker')) delta *= delta > 0 ? 0.6 : 1;

  agent.unrest = clamp(agent.unrest + delta * simHours, 0, 100);
}

/**
 * Trajectory is the doc's central readout: is this institution hardening the
 * person or settling them? It moves an order of magnitude slower than unrest.
 */
export function updateTrajectory(agent: Agent, simHours: number): void {
  const comfort = wellbeing(agent.needs);
  const target = (comfort - 50) / 50 - agent.unrest / 140;
  agent.trajectory = clamp(agent.trajectory + (target - agent.trajectory) * 0.08 * simHours, -1, 1);
}

export function trajectoryLabel(value: number): { label: string; tone: 'good' | 'info' | 'warn' | 'bad' } {
  if (value < -0.45) return { label: 'Hardening', tone: 'bad' };
  if (value < -0.12) return { label: 'Deteriorating', tone: 'warn' };
  if (value < 0.25) return { label: 'Holding steady', tone: 'info' };
  return { label: 'Settling', tone: 'good' };
}
