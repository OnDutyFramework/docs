// Self-hosted so the game's typography does not depend on a CDN at runtime.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './ui/styles.css';

import { Renderer, type Selection } from './render/renderer';
import { TOOL_BY_ID, type ToolId } from './sim/build';
import { createStartingPrison } from './sim/scenario';
import { Simulation } from './sim/simulation';
import type { AppContext, AppState } from './ui/context';
import { byId } from './ui/dom';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { Inspector } from './ui/inspector';
import { Toolbar } from './ui/toolbar';

const world = createStartingPrison();
const sim = new Simulation(world);

const canvas = byId<HTMLCanvasElement>('field');
const renderer = new Renderer(canvas, world);

const state: AppState = {
  tool: 'select',
  view: {
    hoverTile: null,
    selection: null,
    preview: null,
    showRoutes: false,
    showRoomTints: true,
  },
  hint: '',
  hintTone: 'info',
};

let hintTimer = 0;

const ctx: AppContext = {
  world,
  sim,
  renderer,
  state,
  setTool(tool: ToolId) {
    state.tool = tool;
    state.view.preview = null;
    canvas.classList.toggle('is-inspecting', tool === 'select');
    toolbar.refresh();
    const def = TOOL_BY_ID.get(tool);
    if (def) ctx.notify(def.hint);
  },
  select(selection: Selection) {
    state.view.selection = selection;
    inspector.update();
  },
  notify(message: string, tone: 'info' | 'warn' = 'info') {
    state.hint = message;
    state.hintTone = tone;
    hintTimer = 5;
  },
};

const toolbar = new Toolbar(ctx);
const hud = new Hud(ctx);
const inspector = new Inspector(ctx);
const input = new InputController(ctx);

toolbar.mount();
hud.mount();
inspector.mount();
input.mount();

renderer.resize();
renderer.camera.centreOn(29, 25);
renderer.camera.zoom = 21;

canvas.classList.add('is-inspecting');
ctx.notify('Click an inmate to open their record. Drag with the Cell template to build.');

window.addEventListener('resize', () => renderer.resize());
if (document.fonts) void document.fonts.ready.then(() => renderer.resize());

let last = performance.now();
let hudAccumulator = 0;

function frame(now: number): void {
  const delta = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.tick(delta);
  sim.update(delta);
  renderer.draw(state.view, delta);

  hudAccumulator += delta;
  if (hudAccumulator >= 0.1) {
    hudAccumulator = 0;
    hud.update();
    inspector.update();
  }

  if (hintTimer > 0) {
    hintTimer -= delta;
    if (hintTimer <= 0) {
      state.hint = '';
      state.hintTone = 'info';
    }
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Debug handle: lets the dev console (and the smoke test) poke at the sim.
declare global {
  interface Window {
    __prison?: {
      world: typeof world;
      sim: Simulation;
      renderer: Renderer;
      state: AppState;
      select: (selection: Selection) => void;
      setTool: (tool: ToolId) => void;
    };
  }
}

window.__prison = {
  world,
  sim,
  renderer,
  state,
  select: ctx.select,
  setTool: ctx.setTool,
};
