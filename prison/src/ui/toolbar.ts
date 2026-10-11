import { TOOLS, type ToolDef, type ToolId } from '../sim/build';
import type { AppContext } from './context';
import { byId, el } from './dom';

const GROUP_ORDER: ReadonlyArray<ToolDef['group']> = [
  'cursor',
  'template',
  'structure',
  'surface',
  'furniture',
  'destructive',
];

/** The build toolbar: one button per tool, grouped, with hotkeys and prices. */
export class Toolbar {
  private root = byId<HTMLElement>('toolbar');
  private buttons = new Map<ToolId, HTMLButtonElement>();

  constructor(private ctx: AppContext) {}

  mount(): void {
    for (const group of GROUP_ORDER) {
      const tools = TOOLS.filter((tool) => tool.group === group);
      if (tools.length === 0) continue;
      const wrap = el('div', 'tool-group');
      for (const tool of tools) wrap.appendChild(this.makeButton(tool));
      this.root.appendChild(wrap);
    }

    window.addEventListener('keydown', (event) => this.onKey(event));
    this.refresh();
  }

  private makeButton(tool: ToolDef): HTMLButtonElement {
    const button = el('button', tool.id === 'demolish' ? 'tool danger' : 'tool');
    button.type = 'button';
    button.dataset.tool = tool.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', tool.label);
    button.title = `${tool.label} (${tool.hotkey}) \u2014 ${tool.hint}`;

    button.appendChild(el('span', 'key', tool.hotkey));
    button.appendChild(el('span', 'label', tool.label));
    button.appendChild(el('span', 'cost', priceLabel(tool)));
    button.addEventListener('click', () => this.ctx.setTool(tool.id));

    this.buttons.set(tool.id, button);
    return button;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toUpperCase();
    for (const tool of TOOLS) {
      if (tool.hotkey === key) {
        event.preventDefault();
        this.ctx.setTool(tool.id);
        return;
      }
    }
    if (event.key === 'Escape') this.ctx.setTool('select');
  }

  refresh(): void {
    for (const [id, button] of this.buttons) {
      button.setAttribute('aria-pressed', String(id === this.ctx.state.tool));
    }
  }
}

function priceLabel(tool: ToolDef): string {
  if (tool.id === 'select') return 'free';
  if (tool.id === 'demolish') return '+30%';
  if (tool.id === 'cell') return 'from $700';
  if (tool.group === 'surface' || tool.group === 'structure') return `$${tool.cost}/tile`;
  return `$${tool.cost}`;
}
