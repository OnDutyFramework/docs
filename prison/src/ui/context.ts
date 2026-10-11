import type { Renderer, Selection, ViewState } from '../render/renderer';
import type { ToolId } from '../sim/build';
import type { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';

export interface AppState {
  tool: ToolId;
  view: ViewState;
  hint: string;
  hintTone: 'info' | 'warn';
}

/** Everything the UI modules need, assembled once in main.ts. */
export interface AppContext {
  world: World;
  sim: Simulation;
  renderer: Renderer;
  state: AppState;
  setTool(tool: ToolId): void;
  select(selection: Selection): void;
  notify(message: string, tone?: 'info' | 'warn'): void;
}
