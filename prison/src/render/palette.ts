import type { ObjectKind, RoomKind, SecurityLevel } from '../sim/types';

/**
 * Single source of truth for colour. The chrome tokens are mirrored as CSS
 * custom properties in ui/styles.css — keep the two in step.
 */
export const C = {
  ink: '#0a0e14',
  panel: '#121823',
  raised: '#1a2230',
  border: '#26303f',
  hairline: '#1f2835',

  text: '#e6ebf2',
  textDim: '#9ba7b8',
  textMuted: '#6b7686',

  accent: '#54d6e8',
  accentDeep: '#1b5f6b',
  gold: '#f5b942',
  green: '#5bd99a',
  amber: '#f0923e',
  red: '#f2566a',
  violet: '#8d7cf0',

  // playfield
  terrain: '#131921',
  terrainSpeck: '#1b2330',
  concrete: '#2b3442',
  concreteGrout: '#333d4d',
  polished: '#334052',
  polishedGrout: '#3e4c60',
  yard: '#263a2c',
  yardSpeck: '#2f4836',

  wall: '#a8b3c3',
  wallTop: '#cdd7e4',
  wallSide: '#7c8796',
  wallShadow: 'rgba(5, 8, 13, 0.5)',

  door: '#f5b942',
  doorDark: '#9a6f1d',

  night: '#0b1733',
  lamp: '#ffd9a0',
} as const;

export const ROOM_TINT: Record<RoomKind, string> = {
  unassigned: 'rgba(107, 118, 134, 0.10)',
  cell: 'rgba(141, 124, 240, 0.13)',
  canteen: 'rgba(240, 146, 62, 0.13)',
  yard: 'rgba(91, 217, 154, 0.10)',
  common: 'rgba(84, 214, 232, 0.12)',
  bathroom: 'rgba(127, 185, 201, 0.13)',
  holding: 'rgba(242, 86, 106, 0.12)',
  corridor: 'rgba(155, 167, 184, 0.05)',
};

export const ROOM_ACCENT: Record<RoomKind, string> = {
  unassigned: C.textMuted,
  cell: C.violet,
  canteen: C.amber,
  yard: C.green,
  common: C.accent,
  bathroom: '#7fb9c9',
  holding: C.red,
  corridor: C.textMuted,
};

export const OBJECT_COLORS: Record<ObjectKind, { base: string; accent: string }> = {
  bed: { base: '#4c5a78', accent: '#c3cddd' },
  toilet: { base: '#8f9db1', accent: '#dfe7f0' },
  table: { base: '#8a6242', accent: '#b98a5d' },
  bench: { base: '#6d4f36', accent: '#9a7450' },
  shower: { base: '#3f6475', accent: '#86c3d4' },
  tv: { base: '#1b2330', accent: '#54d6e8' },
};

/** Security level is the ring colour around an inmate — readable at a glance. */
export const SECURITY_COLORS: Record<SecurityLevel, string> = {
  minimum: '#5bd99a',
  medium: '#f0923e',
  maximum: '#f2566a',
};

export const PRISONER_SUIT = '#ef7a3d';
export const PRISONER_SUIT_DARK = '#c75c26';
export const GUARD_UNIFORM = '#3f63ad';
export const GUARD_UNIFORM_DARK = '#2b4580';
export const SKIN = '#e8c9a8';

export const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
