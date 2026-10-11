import { clamp } from '../core/math';
import { servedNeed, updatePrisoner } from './behavior';
import { SECONDS_PER_HOUR } from './clock';
import { guardPressureOn, updateGuard } from './guards';
import { assignHousing, unhousedCount } from './housing';
import { decayNeeds, updateTrajectory, updateUnrest, wellbeing } from './needs';
import { formatRemaining, sentenceRemaining } from './people';
import type { Agent } from './types';
import type { World } from './world';

/** Fixed simulation step, in simulated seconds. */
export const SIM_STEP = 0.05;
const MAX_STEPS_PER_FRAME = 24;

export const SPEEDS = [0, 1, 2, 3] as const;
export type SpeedIndex = 0 | 1 | 2 | 3;

/** Unrest at which an inmate becomes an incident worth logging. */
const AGITATED = 72;

/** Gate hours: arrivals and releases both happen in the morning. */
const INTAKE_HOUR = 8;
const RELEASE_HOUR = 9;

/**
 * Drives the world forward in fixed steps and owns the order systems run in.
 * Everything time-dependent lives here so the render layer can be a pure
 * function of world state.
 */
export class Simulation {
  readonly world: World;
  speedIndex: SpeedIndex = 1;
  /** Simulated seconds elapsed since the run began. */
  elapsed = 0;

  private accumulator = 0;
  private guardPressure = new Map<number, number>();
  private agitated = new Set<number>();
  private lastIntakeDay = 1;
  private lastReleaseDay = 1;

  constructor(world: World) {
    this.world = world;
  }

  get paused(): boolean {
    return this.speedIndex === 0;
  }

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  setSpeed(index: SpeedIndex): void {
    this.speedIndex = index;
  }

  togglePause(): void {
    this.speedIndex = this.speedIndex === 0 ? 1 : 0;
  }

  /** Called once per animation frame with real elapsed seconds. */
  update(realDelta: number): void {
    const { world } = this;

    if (world.roomsAreDirty) {
      world.rebuildRooms();
      world.recomputeCapacity();
      assignHousing(world);
    }

    if (this.paused) {
      this.refreshStats();
      return;
    }

    // Cache guard proximity once per frame rather than once per step.
    this.guardPressure.clear();
    for (const agent of world.agents.values()) {
      if (agent.role === 'prisoner') this.guardPressure.set(agent.id, guardPressureOn(world, agent));
    }

    this.accumulator += realDelta * this.speed;
    let steps = 0;
    while (this.accumulator >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step(SIM_STEP);
      this.accumulator -= SIM_STEP;
      steps++;
    }
    // Avoid unbounded catch-up after a tab stall.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.refreshStats();
  }

  private step(simSeconds: number): void {
    const { world } = this;
    const simHours = simSeconds / SECONDS_PER_HOUR;
    this.elapsed += simSeconds;

    const { dayAdvanced, slotChanged } = world.clock.advance(simSeconds);

    for (const agent of world.agents.values()) {
      if (agent.role === 'prisoner') {
        const served = servedNeed(world, agent);
        decayNeeds(agent.needs, simHours, served ? served.need : null);
        updatePrisoner(world, agent, simSeconds, simHours);
        updateUnrest(agent, simHours, this.guardPressure.get(agent.id) ?? 0);
        updateTrajectory(agent, simHours);
        this.checkIncident(agent);
      } else {
        updateGuard(world, agent, simSeconds, simHours);
      }
    }

    if (slotChanged) {
      const slot = world.clock.slot();
      world.bus.emit('regime:changed', { block: slot.block });
      world.logEvent(`Regime: ${slot.label}`, 'info');
    }

    if (dayAdvanced) {
      this.onDayAdvanced();
    }

    if (world.clock.day !== this.lastIntakeDay && world.clock.hour >= INTAKE_HOUR) {
      this.lastIntakeDay = world.clock.day;
      this.runIntake();
    }
    if (world.clock.day !== this.lastReleaseDay && world.clock.hour >= RELEASE_HOUR) {
      this.lastReleaseDay = world.clock.day;
      this.runReleases();
    }
  }

  private onDayAdvanced(): void {
    const { world } = this;
    const prisoners = world.prisoners().length;
    const guards = world.guards().length;
    const { grant, wages } = world.economy.settleDay(world.clock.day, prisoners, guards);
    world.bus.emit('day:advanced', { day: world.clock.day });
    world.bus.emit('economy:changed', { money: world.economy.money });
    const net = grant - wages;
    world.logEvent(
      `Day ${world.clock.day} \u2014 grant $${grant.toLocaleString()}, wages $${wages.toLocaleString()} (${
        net >= 0 ? '+' : '\u2212'
      }$${Math.abs(net).toLocaleString()})`,
      net >= 0 ? 'good' : 'warn',
    );

    const unhoused = unhousedCount(world);
    if (unhoused > 0) {
      world.logEvent(`${unhoused} inmate${unhoused === 1 ? '' : 's'} without a bed`, 'bad');
    }
  }

  /**
   * Arrivals track available capacity rather than flooding the player: the
   * design intent is churn you can read, not an endless anonymous queue.
   */
  private runIntake(): void {
    const { world } = this;
    const free = Math.max(0, world.stats.capacity - world.prisoners().length);
    const demand = 1 + world.rng.int(0, 3);
    const count = Math.min(demand, free + 1);
    if (count <= 0) return;

    for (let i = 0; i < count; i++) {
      const agent = world.spawnPrisoner();
      // Nudge arrivals apart so they don't stack on the gate tile.
      agent.x += world.rng.range(-0.4, 0.4);
      agent.y += world.rng.range(-0.4, 0.4);
    }
    assignHousing(world);
    world.logEvent(`Intake: ${count} new arrival${count === 1 ? '' : 's'} at the gate`, 'info');
  }

  private runReleases(): void {
    const { world } = this;
    const leaving: Agent[] = [];
    for (const agent of world.prisoners()) {
      if (sentenceRemaining(agent.profile, world.clock.day, world.clock.hour) <= 0) leaving.push(agent);
    }
    for (const agent of leaving) {
      const comfort = Math.round(wellbeing(agent.needs));
      const tone = agent.trajectory > 0.15 ? 'good' : agent.trajectory < -0.3 ? 'bad' : 'info';
      world.logEvent(
        `Released: ${agent.profile.fullName} after ${agent.profile.sentenceDays} days \u2014 ${
          agent.trajectory > 0.15 ? 'leaves settled' : agent.trajectory < -0.3 ? 'leaves hardened' : 'leaves unchanged'
        } (wellbeing ${comfort})`,
        tone,
      );
      world.bus.emit('prisoner:released', { agentId: agent.id, name: agent.profile.fullName });
      world.removeAgent(agent.id);
      world.stats.released++;
    }
    if (leaving.length > 0) assignHousing(world);
  }

  private checkIncident(agent: Agent): void {
    if (agent.unrest >= AGITATED && !this.agitated.has(agent.id)) {
      this.agitated.add(agent.id);
      this.world.stats.incidents++;
      this.world.remember(agent, 'Became agitated. Needs were not being met.', 'bad');
      this.world.logEvent(`${agent.profile.fullName} is agitated \u2014 ${agent.lastDecision}`, 'bad');
    } else if (agent.unrest < AGITATED * 0.7 && this.agitated.has(agent.id)) {
      this.agitated.delete(agent.id);
    }
  }

  private refreshStats(): void {
    const { world } = this;
    const prisoners = world.prisoners();
    let unrestSum = 0;
    let unrestMax = 0;
    let comfortSum = 0;
    for (const agent of prisoners) {
      unrestSum += agent.unrest;
      unrestMax = Math.max(unrestMax, agent.unrest);
      comfortSum += wellbeing(agent.needs);
    }
    const count = prisoners.length || 1;
    world.stats.population = prisoners.length;
    world.stats.guards = world.guards().length;
    world.stats.danger = clamp(0.6 * (unrestSum / count) + 0.4 * unrestMax, 0, 100);
    world.stats.comfort = comfortSum / count;
  }

  /** Human-readable countdown for an inmate, used by the inspector. */
  remainingLabel(agent: Agent): string {
    return formatRemaining(sentenceRemaining(agent.profile, this.world.clock.day, this.world.clock.hour));
  }
}
