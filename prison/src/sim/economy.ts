import { GUARD_DAILY_WAGE, PRISONER_DAILY_GRANT } from './catalog';
import type { LedgerEntry } from './types';

const LEDGER_LIMIT = 40;

/**
 * Money, the daily report, and nothing else. Build costs are charged through
 * `spend`, which is the only way terrain and objects can be placed.
 */
export class Economy {
  money: number;
  readonly ledger: LedgerEntry[] = [];
  /** Net change from the most recent daily report, for the UI delta. */
  lastDayNet = 0;

  constructor(startingFunds = 12000) {
    this.money = startingFunds;
  }

  canAfford(amount: number): boolean {
    return this.money >= amount;
  }

  spend(amount: number, label: string, day: number): boolean {
    if (amount > 0 && !this.canAfford(amount)) return false;
    this.money -= amount;
    this.record(day, label, -amount);
    return true;
  }

  earn(amount: number, label: string, day: number): void {
    this.money += amount;
    this.record(day, label, amount);
  }

  private record(day: number, label: string, amount: number): void {
    if (amount === 0) return;
    const latest = this.ledger[0];
    // Coalesce repeated spends from one drag into a single ledger line.
    if (latest && latest.day === day && latest.label === label) {
      latest.amount += amount;
      return;
    }
    this.ledger.unshift({ day, label, amount });
    if (this.ledger.length > LEDGER_LIMIT) this.ledger.length = LEDGER_LIMIT;
  }

  /** Called once per simulated day. Grants in, wages out. */
  settleDay(day: number, prisonerCount: number, guardCount: number): { grant: number; wages: number } {
    const grant = prisonerCount * PRISONER_DAILY_GRANT;
    const wages = guardCount * GUARD_DAILY_WAGE;
    if (grant > 0) this.earn(grant, `State grant \u00d7${prisonerCount}`, day);
    if (wages > 0) this.spend(wages, `Guard wages \u00d7${guardCount}`, day);
    this.lastDayNet = grant - wages;
    return { grant, wages };
  }
}
