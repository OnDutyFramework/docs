import type { RegimeBlock } from './types';

/** Real seconds per simulated hour at 1x speed. One day ≈ 2.4 minutes. */
export const SECONDS_PER_HOUR = 6;
export const HOURS_PER_DAY = 24;

export interface RegimeSlot {
  startHour: number;
  endHour: number;
  block: RegimeBlock;
  label: string;
}

/**
 * The daily regime. Prisoners default to the activity of the current slot and
 * only deviate when a need becomes critical. Edit this table to retune a day.
 */
export const REGIME: readonly RegimeSlot[] = [
  { startHour: 0, endHour: 7, block: 'sleep', label: 'Lights out' },
  { startHour: 7, endHour: 9, block: 'eat', label: 'Breakfast' },
  { startHour: 9, endHour: 12, block: 'yard', label: 'Yard' },
  { startHour: 12, endHour: 14, block: 'eat', label: 'Lunch' },
  { startHour: 14, endHour: 17, block: 'free', label: 'Free time' },
  { startHour: 17, endHour: 19, block: 'eat', label: 'Dinner' },
  { startHour: 19, endHour: 22, block: 'free', label: 'Association' },
  { startHour: 22, endHour: 24, block: 'sleep', label: 'Lights out' },
];

export class Clock {
  /** Day 1 is the first day of operation. */
  day = 1;
  /** Hours elapsed in the current day, fractional. */
  hour = 6.5;

  private lastSlotIndex = -1;

  /** Advances the clock. Returns which boundaries were crossed this step. */
  advance(simSeconds: number): { dayAdvanced: boolean; slotChanged: boolean } {
    this.hour += simSeconds / SECONDS_PER_HOUR;
    let dayAdvanced = false;
    while (this.hour >= HOURS_PER_DAY) {
      this.hour -= HOURS_PER_DAY;
      this.day++;
      dayAdvanced = true;
    }
    const slot = this.slotIndex();
    const slotChanged = slot !== this.lastSlotIndex;
    this.lastSlotIndex = slot;
    return { dayAdvanced, slotChanged };
  }

  slotIndex(): number {
    for (let i = 0; i < REGIME.length; i++) {
      const slot = REGIME[i];
      if (this.hour >= slot.startHour && this.hour < slot.endHour) return i;
    }
    return REGIME.length - 1;
  }

  slot(): RegimeSlot {
    return REGIME[this.slotIndex()];
  }

  block(): RegimeBlock {
    return this.slot().block;
  }

  /** 0..1 progress through the current regime slot. */
  slotProgress(): number {
    const slot = this.slot();
    return (this.hour - slot.startHour) / (slot.endHour - slot.startHour);
  }

  /** 0..1 where 0 is midnight — drives the day/night tint. */
  dayProgress(): number {
    return this.hour / HOURS_PER_DAY;
  }

  formatTime(): string {
    const h = Math.floor(this.hour) % 24;
    const m = Math.floor((this.hour % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
