import { clamp01 } from '../core/math';
import { OBJECTS } from '../sim/catalog';
import { bedOf } from '../sim/housing';
import { CRITICAL, NEED_LABELS, trajectoryLabel, wellbeing } from '../sim/needs';
import { dayLabel, formatRemaining, sentenceRemaining } from '../sim/people';
import { ROOM_META } from '../sim/rooms';
import { NEED_KINDS, type Agent, type ObjectKind, type Room } from '../sim/types';
import { ROOM_ACCENT, SECURITY_COLORS } from '../render/palette';
import type { AppContext } from './context';
import { byId, dangerColor, esc, rampColor } from './dom';

/**
 * The record panel. Per the design doc this is half the game's interface, so it
 * leads with who the person is and how much of their sentence is left, and only
 * then shows the simulation's internals.
 */
export class Inspector {
  private root = byId<HTMLElement>('inspector');

  constructor(private ctx: AppContext) {}

  mount(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.close')) {
        this.ctx.select(null);
        return;
      }
      const roster = target.closest<HTMLElement>('[data-agent]');
      if (roster) {
        this.ctx.select({ kind: 'agent', id: Number(roster.dataset.agent) });
      }
      const roomLink = target.closest<HTMLElement>('[data-room]');
      if (roomLink) {
        this.ctx.select({ kind: 'room', id: Number(roomLink.dataset.room) });
      }
    });
  }

  update(): void {
    const selection = this.ctx.state.view.selection;
    if (!selection) {
      this.root.hidden = true;
      return;
    }

    if (selection.kind === 'agent') {
      const agent = this.ctx.world.agents.get(selection.id);
      if (!agent) {
        this.ctx.select(null);
        return;
      }
      this.root.hidden = false;
      this.root.innerHTML = agent.role === 'prisoner' ? this.renderInmate(agent) : this.renderGuard(agent);
      return;
    }

    const room = this.ctx.world.rooms[selection.id];
    if (!room) {
      this.ctx.select(null);
      return;
    }
    this.root.hidden = false;
    this.root.innerHTML = this.renderRoom(room);
  }

  // -------------------------------------------------------------- inmate

  private renderInmate(agent: Agent): string {
    const { world, sim } = this.ctx;
    const { profile } = agent;
    const remainingDays = sentenceRemaining(profile, world.clock.day, world.clock.hour);
    const servedDays = Math.max(0, profile.sentenceDays - remainingDays);
    const progress = clamp01(servedDays / Math.max(1, profile.sentenceDays));
    const bed = bedOf(world, agent);
    const bedRoom = bed ? world.rooms[bed.roomId] : null;
    const here = world.roomOf(agent);
    const trajectory = trajectoryLabel(agent.trajectory);
    const comfort = wellbeing(agent.needs);

    return `
      <div class="insp-head">
        <div>
          <span class="micro kind" style="color:${SECURITY_COLORS[profile.security]}">
            Inmate record \u00b7 ${esc(profile.security)} security
          </span>
          <h2>${esc(profile.fullName)}</h2>
          <div class="meta">${profile.age} years old \u00b7 ${esc(profile.charge)}</div>
        </div>
        <button class="close" type="button" aria-label="Close">\u00d7</button>
      </div>

      <div class="insp-body">
        <div class="section sentence">
          <span class="micro">Sentence</span>
          <div class="sentence-top">
            <span class="sentence-charge">${profile.sentenceDays}-day sentence</span>
            <span class="sentence-left">${esc(formatRemaining(remainingDays))}</span>
          </div>
          <div class="sentence-track"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>
          <div class="sentence-scale">
            <span>${Math.floor(servedDays)} of ${profile.sentenceDays} days served</span>
            <span>Release: day ${Math.max(1, Math.round(profile.releaseDay))}</span>
          </div>
        </div>

        <div class="section">
          <span class="micro">Background</span>
          <p class="backstory">${esc(profile.backstory)}</p>
          <div class="traits">
            ${profile.traits.map((trait) => `<span class="trait">${esc(trait)}</span>`).join('')}
          </div>
        </div>

        <div class="section">
          <span class="micro">Right now</span>
          <div class="now">
            <span class="now-dot" style="background:${activityColor(agent)}"></span>
            <span class="now-text">${esc(agent.lastDecision)}</span>
            <span class="now-where">${here ? esc(ROOM_META[here.kind].label) : 'Outdoors'}</span>
          </div>
        </div>

        <div class="section">
          <span class="micro">Needs</span>
          ${NEED_KINDS.map((kind) => {
            const value = agent.needs[kind];
            const critical = value < CRITICAL;
            return `
              <div class="need${critical ? ' is-critical' : ''}">
                <span class="need-name">${NEED_LABELS[kind]}</span>
                <span class="need-track"><i style="width:${value.toFixed(0)}%;background:${rampColor(value)}"></i></span>
                <span class="need-value">${value.toFixed(0)}</span>
              </div>`;
          }).join('')}
        </div>

        <div class="section">
          <div class="duo">
            <div class="duo-item">
              <span class="micro">Unrest</span>
              <b style="color:${dangerColor(100 - agent.unrest)}">${Math.round(agent.unrest)}</b>
            </div>
            <div class="duo-item">
              <span class="micro">Trajectory</span>
              <span class="caption tone-${trajectory.tone}">${trajectory.label}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <span class="micro">Housing</span>
          <div class="kv"><span>Assigned cell</span><span>${
            bedRoom
              ? `<a href="#" data-room="${bedRoom.id}" style="color:${ROOM_ACCENT[bedRoom.kind]}">${esc(
                  ROOM_META[bedRoom.kind].label,
                )} #${bedRoom.id}</a>`
              : '<span class="tone-bad">none</span>'
          }</span></div>
          <div class="kv"><span>Wellbeing</span><span>${Math.round(comfort)} / 100</span></div>
          <div class="kv"><span>In custody since</span><span>${
            profile.intakeDay < 1 ? 'transferred in' : `day ${profile.intakeDay}`
          }</span></div>
        </div>

        <div class="section">
          <span class="micro">Record \u2014 what this institution did</span>
          <div class="record">
            ${
              agent.memory.length === 0
                ? '<p class="empty">Nothing on file yet.</p>'
                : agent.memory
                    .slice(0, 10)
                    .map(
                      (entry) =>
                        `<div class="record-row"><time>${dayLabel(entry.day)} ${esc(entry.time)}</time><span class="tone-${
                          entry.tone
                        }">${esc(entry.text)}</span></div>`,
                    )
                    .join('')
            }
          </div>
        </div>

        <div class="section">
          <span class="micro">Debug</span>
          <div class="kv"><span>Activity</span><span>${esc(agent.activity)}</span></div>
          <div class="kv"><span>Route length</span><span>${
            agent.path ? `${agent.path.length - agent.pathCursor} tiles` : 'idle'
          }</span></div>
          <div class="kv"><span>Sim speed</span><span>${sim.speed}\u00d7</span></div>
        </div>
      </div>`;
  }

  // --------------------------------------------------------------- guard

  private renderGuard(agent: Agent): string {
    const focus = agent.focusAgentId === null ? null : this.ctx.world.agents.get(agent.focusAgentId);
    const here = this.ctx.world.roomOf(agent);
    return `
      <div class="insp-head">
        <div>
          <span class="micro kind" style="color:var(--accent)">Staff record \u00b7 corrections</span>
          <h2>${esc(agent.profile.fullName)}</h2>
          <div class="meta">${agent.profile.age} years old \u00b7 on shift</div>
        </div>
        <button class="close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="insp-body">
        <div class="section">
          <span class="micro">Right now</span>
          <div class="now">
            <span class="now-dot"></span>
            <span class="now-text">${esc(agent.lastDecision)}</span>
            <span class="now-where">${here ? esc(ROOM_META[here.kind].label) : 'Outdoors'}</span>
          </div>
        </div>
        <div class="section">
          <div class="kv"><span>Status</span><span>${esc(agent.activity)}</span></div>
          <div class="kv"><span>Responding to</span><span>${
            focus ? `<a href="#" data-agent="${focus.id}">${esc(focus.profile.fullName)}</a>` : 'nobody'
          }</span></div>
          <div class="kv"><span>Daily wage</span><span>$110</span></div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- room

  private renderRoom(room: Room): string {
    const { world } = this.ctx;
    const meta = ROOM_META[room.kind];
    const counts = new Map<ObjectKind, number>();
    for (const id of room.objectIds) {
      const object = world.objects.get(id);
      if (!object) continue;
      counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
    }

    const occupants = world
      .prisoners()
      .filter((agent) => agent.homeRoomId === room.id)
      .sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));

    const presentNow = world.prisoners().filter((agent) => world.map.roomAt(Math.floor(agent.x), Math.floor(agent.y)) === room.id);

    return `
      <div class="insp-head">
        <div>
          <span class="micro kind" style="color:${ROOM_ACCENT[room.kind]}">Room \u00b7 auto-detected</span>
          <h2>${esc(meta.label)} #${room.id}</h2>
          <div class="meta">${esc(meta.blurb)}</div>
        </div>
        <button class="close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="insp-body">
        <div class="section">
          <span class="micro">Structure</span>
          <div class="kv"><span>Floor area</span><span>${room.area} tiles</span></div>
          <div class="kv"><span>Enclosure</span><span>${
            room.enclosed ? 'sealed' : '<span class="tone-warn">open to outside</span>'
          }</span></div>
          <div class="kv"><span>Occupied now</span><span>${presentNow.length}</span></div>
        </div>

        <div class="section">
          <span class="micro">Contents</span>
          ${
            counts.size === 0
              ? '<p class="empty">Empty. Room type is inferred from what you put in it.</p>'
              : [...counts]
                  .map(
                    ([kind, count]) =>
                      `<div class="kv"><span>${esc(OBJECTS[kind].label)}</span><span>\u00d7${count}</span></div>`,
                  )
                  .join('')
          }
        </div>

        <div class="section">
          <span class="micro">Assigned inmates</span>
          ${
            occupants.length === 0
              ? '<p class="empty">Nobody is housed here.</p>'
              : `<div class="roster">${occupants
                  .map(
                    (agent) => `
                    <button type="button" data-agent="${agent.id}">
                      <span class="pip" style="background:${SECURITY_COLORS[agent.profile.security]}"></span>
                      <span>${esc(agent.profile.fullName)}</span>
                      <span class="right">${esc(
                        formatRemaining(sentenceRemaining(agent.profile, world.clock.day, world.clock.hour)),
                      )}</span>
                    </button>`,
                  )
                  .join('')}</div>`
          }
        </div>
      </div>`;
  }
}

function activityColor(agent: Agent): string {
  switch (agent.activity) {
    case 'sleeping':
      return 'var(--violet)';
    case 'eating':
      return 'var(--amber)';
    case 'washing':
      return '#7fb9c9';
    case 'exercising':
      return 'var(--green)';
    case 'walking':
      return 'var(--accent)';
    default:
      return 'var(--text-muted)';
  }
}
