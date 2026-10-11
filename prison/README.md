# Time Served

A browser-based prison management simulation. TypeScript, Vite, and a single HTML canvas — no game engine.

This is the first vertical slice: a working facility you inherit, a day that runs on a regime,
inmates who are named people with sentences, and a build mode you can lay out new cells with.

## Running it

```bash
cd prison
npm install
npm run dev          # http://127.0.0.1:5173
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production bundle into dist/
npm run preview      # serve the production bundle
```

## Controls

| Action | Input |
| --- | --- |
| Pan | Left-drag with **Inspect** selected, middle/right-drag anywhere, or arrow keys |
| Zoom | Mouse wheel |
| Pick a tool | Click it, or press its hotkey (`1`–`7`, `Q W E R T Y`, `X`) |
| Build | Drag a rectangle. Walls follow the **perimeter**; floors, furniture and demolish **fill** |
| Inspect | With `1` selected, click an inmate, an officer, or a room |
| Pause / speed | `Space` to pause, `,` and `.` to step speed, or the `1× 2× 3×` buttons |
| Recentre on someone | Double-click them |

The **Cell template** (`2`) is the fastest way in: drag a box at least 4×4 on open ground and it
places walls, floor, a door facing the nearest corridor, a bed and a toilet in one stroke.

## How the systems fit together

The hard rule in this codebase is that **nothing in `src/sim/` knows the DOM or the canvas
exists**. The simulation is a plain data structure plus functions that advance it; the renderer and
UI are read-only consumers. That is what makes it safe to keep adding systems.

```
src/
  core/        math + RNG + a tiny typed event bus (no game knowledge)
  sim/         the simulation. No DOM, no canvas.
  render/      draws a World onto a canvas. Stateless w.r.t. the sim.
  ui/          DOM chrome: toolbar, HUD, inspector, input handling.
  main.ts      wires the three together and owns the frame loop.
```

### The simulation

`World` (`sim/world.ts`) is the whole mutable state: a `TileMap`, a map of placed objects, detected
rooms, agents, the `Clock`, the `Economy`, and a shared `Pathfinder`. `Simulation`
(`sim/simulation.ts`) is the only thing that advances time; it runs fixed 0.05-simulated-second
steps out of a real-time accumulator and decides the order systems run in:

1. **Clock** (`clock.ts`) — advances the hour, reports when a regime slot or a day boundary is
   crossed. One simulated hour is 6 real seconds at 1×, so a day is about 2½ minutes.
2. **Needs** (`needs.ts`) — `sleep`, `hunger`, `hygiene` and `recreation` decay at per-hour rates,
   except for whichever need the agent is currently being served. Also derives `unrest` (the danger
   signal) and `trajectory` (whether the institution is hardening or settling this person).
3. **Behaviour** (`behavior.ts`) — picks an *intent* from the regime block, overridden when a need
   goes critical, then resolves that intent to a concrete object or tile. Objects are reserved at
   the moment an agent starts walking, so inmates don't stampede the same bed.
4. **Guards** (`guards.ts`) — patrol high-traffic rooms, break off to the most agitated inmate
   within reach, and passively suppress unrest by proximity.
5. **Day boundary** — the `Economy` settles grants and wages; intake arrives at 08:00 and releases
   happen at 09:00.

Supporting systems, all independently replaceable:

- **`tilemap.ts`** — flat `Uint8Array`/`Int32Array` layers for floor, wall, object id and room id.
  Single source of truth for terrain; bumps a `version` so caches can invalidate.
- **`pathfinding.ts`** — A\* over the grid, 8-directional, no corner-cutting, doors passable at a
  small extra cost. Scratch buffers are reused, so one `Pathfinder` serves every agent.
- **`rooms.ts`** — rooms are *detected*, never zoned by hand. A flood fill over floored tiles
  (walls and doors are barriers) finds regions, and each region is typed by what is inside it: a bed
  makes a cell, three or more beds make a dormitory, a table makes a canteen, grass makes a yard.
  Empty regions with three or more doors on their boundary are circulation, not rooms.
- **`housing.ts`** — assigns each inmate a bed, preferring real cells over dormitories. Anyone it
  can't house sleeps on the floor, which costs unrest and goes on their record.
- **`build.ts`** — tool definitions plus a `planBuild` / `commitBuild` split. `planBuild` is pure:
  it returns the exact ops, price and blocked tiles for a drag, which is what both the ghost preview
  and the toolbar's price quote read from. Nothing can be placed without going through the economy.
- **`people.ts`** — identity. Name, age, charge, sentence length, release day, a backstory line and
  conflicting traits, plus the `memory` ring buffer that is the inmate's institutional record.
- **`economy.ts`** — money and a coalescing ledger. That's all.
- **`scenario.ts`** — builds the inherited facility and its starting population.

### Rendering

`render/renderer.ts` draws a `World` plus a `ViewState` (hover tile, selection, build preview, a
couple of overlay toggles). It holds no simulation state, so the same inputs always produce the same
frame. Draw order matters for legibility: terrain, floors, room tints, wall shadows, furniture, the
night tint, **then** walls — structure stays bright after dark so the plan of the prison is always
readable — then selection, routes, agents, labels and the build ghost.

`render/palette.ts` is the only place colour is defined, and its chrome tokens are mirrored as CSS
custom properties at the top of `ui/styles.css`. Change colour in those two places and nowhere else.

### UI

Plain DOM over the canvas, because text is crisper and cheaper to lay out that way.
`ui/toolbar.ts` builds itself from the `TOOLS` table, `ui/hud.ts` owns the top bar and facility log,
`ui/inspector.ts` renders the record panel, and `ui/input.ts` has all the pointer and key handling.
They share an `AppContext` assembled in `main.ts`.

`window.__prison` exposes `{ world, sim, renderer, state, select, setTool }` in the browser console
for poking at the simulation.

## What this slice does and doesn't do

Built: pan/zoom tile grid, drag-rectangle build with a live costed preview, automatic room
detection and typing, A\* pathfinding, the four needs and the daily regime, guards that patrol and
respond, unrest as a facility danger signal, money with a daily report, daily intake and
sentence-driven release, and an inspector for inmates, officers and rooms.

Not built yet: contraband and hidden information, inmate goals and schemes, block-local service
routing, a policy/schedule authoring layer, the Record roster screen, staff fallibility, and the
outside world (parole, press, recidivism).
