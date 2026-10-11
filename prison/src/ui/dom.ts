export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Escapes interpolated strings before they go into innerHTML. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function money(value: number): string {
  const sign = value < 0 ? '\u2212' : '';
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

/** Green → amber → red ramp used by every gauge in the UI. */
export function rampColor(value: number): string {
  if (value >= 65) return 'var(--green)';
  if (value >= 40) return 'var(--accent)';
  if (value >= 22) return 'var(--amber)';
  return 'var(--red)';
}

/** Inverse ramp for values where high is bad (danger, unrest). */
export function dangerColor(value: number): string {
  if (value >= 70) return 'var(--red)';
  if (value >= 45) return 'var(--amber)';
  if (value >= 22) return 'var(--accent)';
  return 'var(--green)';
}
