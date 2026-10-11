import { GUARD_HIRE_COST } from '../sim/catalog';
import { SPEEDS, type SpeedIndex } from '../sim/simulation';
import type { AppContext } from './context';
import { byId, dangerColor, el, esc, money, rampColor } from './dom';

const SPEED_LABELS = ['\u2016', '1\u00d7', '2\u00d7', '3\u00d7'];
const SPEED_TITLES = ['Pause (Space)', 'Normal speed', 'Double speed', 'Triple speed'];

interface StatCell {
  value: HTMLElement;
  sub: HTMLElement;
  bar: HTMLElement | null;
}

/** Top bar, event feed, legend and the operations panel. */
export class Hud {
  private speeds = byId<HTMLElement>('speeds');
  private statsRoot = byId<HTMLElement>('stats');
  private feed = byId<HTMLElement>('feed');
  private legend = byId<HTMLElement>('legend');
  private ops = byId<HTMLElement>('ops');
  private dayLabel = byId<HTMLElement>('day-label');
  private clockTime = byId<HTMLElement>('clock-time');
  private regimeLabel = byId<HTMLElement>('regime-label');
  private regimeFill = byId<HTMLElement>('regime-fill');
  private hint = byId<HTMLElement>('hint');

  private cells = new Map<string, StatCell>();
  private speedButtons: HTMLButtonElement[] = [];
  private hireButton!: HTMLButtonElement;
  private routesToggle!: HTMLButtonElement;
  private tintsToggle!: HTMLButtonElement;
  private lastLogId = -1;

  constructor(private ctx: AppContext) {}

  mount(): void {
    this.mountSpeeds();
    this.mountStats();
    this.mountLegend();
    this.mountOps();
    this.feed.appendChild(el('span', 'micro', 'Facility log'));
    this.update();
  }

  private mountSpeeds(): void {
    SPEEDS.forEach((_, index) => {
      const button = el('button');
      button.type = 'button';
      button.textContent = SPEED_LABELS[index];
      button.title = SPEED_TITLES[index];
      button.setAttribute('aria-pressed', String(index === this.ctx.sim.speedIndex));
      button.addEventListener('click', () => this.ctx.sim.setSpeed(index as SpeedIndex));
      this.speeds.appendChild(button);
      this.speedButtons.push(button);
    });
  }

  private mountStats(): void {
    const define = (key: string, label: string, withBar: boolean) => {
      const wrap = el('div', key === 'funds' ? 'stat money' : 'stat');
      wrap.appendChild(el('span', 'micro', label));
      const value = el('b', undefined, '\u2014');
      wrap.appendChild(value);
      const sub = el('span', 'sub', '');
      wrap.appendChild(sub);
      let bar: HTMLElement | null = null;
      if (withBar) {
        const gauge = el('div', 'gauge');
        bar = el('i');
        gauge.appendChild(bar);
        wrap.appendChild(gauge);
      }
      this.statsRoot.appendChild(wrap);
      this.cells.set(key, { value, sub, bar });
    };

    define('funds', 'Funds', false);
    this.statsRoot.appendChild(el('div', 'divider'));
    define('inmates', 'Inmates', false);
    define('officers', 'Officers', false);
    this.statsRoot.appendChild(el('div', 'divider'));
    define('wellbeing', 'Wellbeing', true);
    define('danger', 'Unrest', true);
  }

  private mountLegend(): void {
    this.legend.appendChild(el('span', 'micro', 'Reading the field'));
    const grid = el('div', 'legend-grid');
    const rows: Array<[string, string, boolean]> = [
      ['#5bd99a', 'Minimum security', true],
      ['#f0923e', 'Medium security', true],
      ['#f2566a', 'Maximum security', true],
      ['#ef7a3d', 'Inmate', false],
      ['#3f63ad', 'Officer', false],
      ['#f2566a', 'No bed assigned', false],
    ];
    for (const [color, label, ring] of rows) {
      const item = el('div', 'legend-item');
      item.style.color = color;
      const swatch = el('i', ring ? 'ring' : undefined);
      if (!ring) swatch.style.background = color;
      item.appendChild(swatch);
      const text = el('span', undefined, label);
      text.style.color = 'var(--text-muted)';
      item.appendChild(text);
      grid.appendChild(item);
    }
    this.legend.appendChild(grid);
  }

  private mountOps(): void {
    const row1 = el('div', 'ops-row');
    this.hireButton = el('button', 'action');
    this.hireButton.type = 'button';
    this.hireButton.textContent = `Hire officer \u2014 $${GUARD_HIRE_COST}`;
    this.hireButton.addEventListener('click', () => this.hire());
    row1.appendChild(this.hireButton);

    const row2 = el('div', 'ops-row');
    this.routesToggle = this.makeToggle('Routes', () => {
      this.ctx.state.view.showRoutes = !this.ctx.state.view.showRoutes;
    });
    this.tintsToggle = this.makeToggle('Room tints', () => {
      this.ctx.state.view.showRoomTints = !this.ctx.state.view.showRoomTints;
    });
    row2.appendChild(this.routesToggle);
    row2.appendChild(this.tintsToggle);

    this.ops.appendChild(row1);
    this.ops.appendChild(row2);
  }

  private makeToggle(label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'toggle');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      onClick();
      this.update();
    });
    return button;
  }

  private hire(): void {
    const { world } = this.ctx;
    if (!world.economy.spend(GUARD_HIRE_COST, 'Officer recruitment', world.clock.day)) {
      this.ctx.notify('Not enough funds to hire another officer.', 'warn');
      return;
    }
    const guard = world.spawnGuard();
    world.logEvent(`${guard.profile.fullName} joined the roster`, 'good');
    this.ctx.notify(`${guard.profile.fullName} reported for duty.`);
  }

  update(): void {
    const { world, sim, state } = this.ctx;
    const { clock, stats, economy } = world;

    this.dayLabel.textContent = `Day ${clock.day}`;
    this.clockTime.textContent = clock.formatTime();
    this.regimeLabel.textContent = clock.slot().label;
    this.regimeFill.style.width = `${Math.round(clock.slotProgress() * 100)}%`;

    this.speedButtons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === sim.speedIndex));
    });

    this.setCell('funds', money(economy.money), netLabel(economy.lastDayNet), null);
    this.setCell('inmates', String(stats.population), `${stats.capacity} beds \u00b7 ${stats.released} released`, null);
    this.setCell('officers', String(stats.guards), `${stats.incidents} incidents`, null);
    this.setCell(
      'wellbeing',
      String(Math.round(stats.comfort)),
      'needs met',
      { value: stats.comfort, color: rampColor(stats.comfort) },
    );
    this.setCell(
      'danger',
      String(Math.round(stats.danger)),
      stats.danger > 60 ? 'volatile' : stats.danger > 30 ? 'tense' : 'settled',
      { value: stats.danger, color: dangerColor(stats.danger) },
    );

    this.hireButton.disabled = !economy.canAfford(GUARD_HIRE_COST);
    this.routesToggle.setAttribute('aria-pressed', String(state.view.showRoutes));
    this.tintsToggle.setAttribute('aria-pressed', String(state.view.showRoomTints));

    this.hint.textContent = state.hint;
    this.hint.className = state.hintTone === 'warn' ? 'hint warn' : 'hint';
    this.hint.style.opacity = state.hint ? '1' : '0';

    this.updateFeed();
  }

  private setCell(
    key: string,
    value: string,
    sub: string,
    gauge: { value: number; color: string } | null,
  ): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    if (cell.value.textContent !== value) cell.value.textContent = value;
    if (cell.sub.textContent !== sub) cell.sub.textContent = sub;
    if (cell.bar && gauge) {
      cell.bar.style.width = `${Math.round(Math.max(2, Math.min(100, gauge.value)))}%`;
      cell.bar.style.background = gauge.color;
    }
  }

  private updateFeed(): void {
    const entries = this.ctx.world.log.slice(0, 8);
    const newest = entries[0]?.id ?? -1;
    if (newest === this.lastLogId) return;
    this.lastLogId = newest;

    const rows = entries
      .map(
        (entry) =>
          `<div class="feed-row"><time>D${entry.day} ${esc(entry.time)}</time><span class="tone-${entry.tone}">${esc(
            entry.text,
          )}</span></div>`,
      )
      .join('');
    this.feed.innerHTML = `<span class="micro">Facility log</span>${rows}`;
  }
}

function netLabel(net: number): string {
  if (net === 0) return 'awaiting first report';
  return `${net >= 0 ? '+' : '\u2212'}$${Math.abs(net).toLocaleString('en-US')} yesterday`;
}
