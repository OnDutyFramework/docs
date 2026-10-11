import type { NeedKind, ObjectKind } from './types';

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  cost: number;
  /** Need this object restores while in use, if any. */
  satisfies: NeedKind | null;
  /** Need points restored per simulated hour of use. */
  restoreRate: number;
  /** Agents stand on an adjacent tile and face the object rather than entering it. */
  useFromAdjacent: boolean;
  /** How long an agent stays, in simulated hours, when not need-driven. */
  defaultUseHours: number;
  description: string;
}

export const OBJECTS: Record<ObjectKind, ObjectDef> = {
  bed: {
    kind: 'bed',
    label: 'Bed',
    cost: 120,
    satisfies: 'sleep',
    restoreRate: 22,
    useFromAdjacent: false,
    defaultUseHours: 8,
    description: 'Defines a cell. Each prisoner is assigned one on intake.',
  },
  toilet: {
    kind: 'toilet',
    label: 'Toilet',
    cost: 90,
    satisfies: 'hygiene',
    restoreRate: 90,
    useFromAdjacent: false,
    defaultUseHours: 0.4,
    description: 'Restores hygiene quickly. Cells without one build resentment.',
  },
  table: {
    kind: 'table',
    label: 'Canteen table',
    cost: 160,
    satisfies: 'hunger',
    restoreRate: 110,
    useFromAdjacent: true,
    defaultUseHours: 0.8,
    description: 'Prisoners eat here during meal blocks. Defines a canteen.',
  },
  bench: {
    kind: 'bench',
    label: 'Bench',
    cost: 70,
    satisfies: 'recreation',
    restoreRate: 30,
    useFromAdjacent: false,
    defaultUseHours: 1.5,
    description: 'Somewhere to sit during free time.',
  },
  shower: {
    kind: 'shower',
    label: 'Shower',
    cost: 140,
    satisfies: 'hygiene',
    restoreRate: 150,
    useFromAdjacent: false,
    defaultUseHours: 0.5,
    description: 'Shared hygiene. Defines a bathroom.',
  },
  tv: {
    kind: 'tv',
    label: 'Television',
    cost: 180,
    satisfies: 'recreation',
    restoreRate: 55,
    useFromAdjacent: true,
    defaultUseHours: 2,
    description: 'Strong recreation. Defines a common room.',
  },
};

/** Terrain brush prices, charged per tile placed. */
export const TERRAIN_COST = {
  wall: 18,
  door: 60,
  floorConcrete: 9,
  floorYard: 5,
  floorPolished: 14,
  demolishRefundRate: 0.3,
} as const;

export const GUARD_HIRE_COST = 400;
export const GUARD_DAILY_WAGE = 110;
export const PRISONER_DAILY_GRANT = 95;
export const CELL_PREFAB_COST = 420;
