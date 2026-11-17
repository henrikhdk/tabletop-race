/**
 * The World Food Grand Prix calendar: fictional circuits, each a food city.
 * Layouts are original; each borrows only the *style* of a kind of famous
 * track (island park, hillside park, stadium, esses-and-hairpin, temple of
 * speed, night street circuit). No real names, layouts or data.
 *
 * Board-local coordinates in meters (X right, Z towards the viewer). Every
 * layout stays inside x [-0.5, 0.5], z [-0.17, 0.2] so the shared diorama
 * (water, north island, grandstands, panels) fits around it.
 */
export interface CircuitPalette {
  land: string;
  landEdge: string;
  waterDeep: string;
  waterShallow: string;
  asphalt: string;
  glow: string;
  /** tree tint (multiplied by a random brightness) */
  tree: [number, number, number];
  kerbA: string;
  kerbB: string;
}

export interface CircuitDef {
  id: string;
  name: string;
  /** host team / food */
  country: string;
  food: string;
  /** the kind of track it plays like, shown in the lobby */
  style: string;
  tagline: string;
  /** two flag-ish accent colours for the lobby card */
  flag: [string, string];
  points: ReadonlyArray<readonly [number, number]>;
  palette: CircuitPalette;
  /** scatter seed for trees and city blocks */
  seed: number;
  /** race distance; tuned so a race lasts about 45 s */
  laps: number;
}

export const CIRCUITS: CircuitDef[] = [
  {
    id: 'poutine',
    name: 'Île Poutine',
    country: 'Canada',
    food: 'poutine',
    style: 'Island park · stop-and-go',
    tagline: 'Hairpin, long straight, and a wall of gravy at the last chicane.',
    flag: ['#e8333b', '#f5f5f5'],
    points: [
      [-0.3, -0.1],
      [-0.4, -0.095],
      [-0.47, -0.055],
      [-0.445, 0.0],
      [-0.48, 0.055],
      [-0.42, 0.105],
      [-0.3, 0.115],
      [-0.18, 0.085],
      [-0.06, 0.12],
      [0.05, 0.085],
      [0.16, 0.115],
      [0.23, 0.075],
      [0.34, 0.095],
      [0.44, 0.075],
      [0.495, 0.02],
      [0.465, -0.035],
      [0.38, -0.055],
      [0.15, -0.09],
      [-0.1, -0.125],
      [-0.165, -0.125],
      [-0.195, -0.095],
      [-0.235, -0.115],
    ],
    palette: {
      land: '#3c4a3e',
      landEdge: '#2a332c',
      waterDeep: '#0b2f52',
      waterShallow: '#1a5f8c',
      asphalt: '#2f333b',
      glow: '#38f5ff',
      tree: [0.05, 0.22, 0.09],
      kerbA: '#e8333b',
      kerbB: '#f2f2f2',
    },
    seed: 7,
    laps: 3,
  },
  {
    id: 'paodequeijo',
    name: 'Pão de Queijo Park',
    country: 'Brasil',
    food: 'pão de queijo',
    style: 'Hillside park · flowing esses',
    tagline: 'Dive into the cheesy S, then flat out up the hill.',
    flag: ['#1fae4b', '#ffd23a'],
    points: [
      [-0.1, 0.18],
      [0.1, 0.18],
      [0.25, 0.17],
      [0.36, 0.12],
      [0.33, 0.06],
      [0.4, 0.0],
      [0.47, -0.06],
      [0.45, -0.13],
      [0.36, -0.15],
      [0.22, -0.12],
      [0.12, -0.05],
      [0.02, -0.06],
      [-0.06, -0.13],
      [-0.18, -0.15],
      [-0.3, -0.12],
      [-0.36, -0.05],
      [-0.28, 0.02],
      [-0.38, 0.07],
      [-0.46, 0.12],
      [-0.4, 0.17],
      [-0.25, 0.18],
    ],
    palette: {
      land: '#2f5a33',
      landEdge: '#20401f',
      waterDeep: '#0a3a45',
      waterShallow: '#15807a',
      asphalt: '#33302c',
      glow: '#ffd23a',
      tree: [0.04, 0.3, 0.08],
      kerbA: '#1fae4b',
      kerbB: '#ffd23a',
    },
    seed: 11,
    laps: 3,
  },
  {
    id: 'taco',
    name: 'Taco Harbour',
    country: 'México',
    food: 'taco',
    style: 'Stadium twisty · long main straight',
    tagline: 'A fiesta of a stadium section. Do not drop the filling.',
    flag: ['#ff7a1a', '#2ee6c8'],
    points: [
      [-0.3, 0.18],
      [0.0, 0.18],
      [0.3, 0.18],
      [0.44, 0.15],
      [0.47, 0.06],
      [0.4, 0.02],
      [0.45, -0.05],
      [0.4, -0.13],
      [0.25, -0.15],
      [0.05, -0.15],
      [-0.05, -0.12],
      [-0.02, -0.05],
      [-0.1, 0.0],
      [-0.18, -0.04],
      [-0.16, -0.11],
      [-0.26, -0.15],
      [-0.4, -0.14],
      [-0.47, -0.06],
      [-0.46, 0.08],
      [-0.42, 0.15],
    ],
    palette: {
      land: '#7a5a34',
      landEdge: '#57401f',
      waterDeep: '#08455a',
      waterShallow: '#1fb3b0',
      asphalt: '#3a3530',
      glow: '#ff7a1a',
      tree: [0.12, 0.26, 0.06],
      kerbA: '#ff7a1a',
      kerbB: '#f5f0e0',
    },
    seed: 23,
    laps: 3,
  },
  {
    id: 'maki',
    name: 'Maki Bay',
    country: 'Japan',
    food: 'sushi',
    style: 'Esses, hairpin and a fast sweeper',
    tagline: 'Roll through the esses. Wasabi at the hairpin.',
    flag: ['#f5f5f5', '#e8334a'],
    points: [
      [-0.2, 0.17],
      [0.1, 0.17],
      [0.32, 0.16],
      [0.44, 0.09],
      [0.42, 0.0],
      [0.32, -0.02],
      [0.24, -0.08],
      [0.14, -0.04],
      [0.05, -0.1],
      [-0.04, -0.05],
      [-0.13, -0.11],
      [-0.22, -0.15],
      [-0.36, -0.15],
      [-0.45, -0.1],
      [-0.44, -0.02],
      [-0.35, 0.01],
      [-0.3, 0.07],
      [-0.4, 0.1],
      [-0.45, 0.15],
      [-0.36, 0.18],
    ],
    palette: {
      land: '#38443c',
      landEdge: '#252d28',
      waterDeep: '#0c2440',
      waterShallow: '#2a5f9c',
      asphalt: '#2c2f36',
      glow: '#ff6fa8',
      tree: [0.32, 0.12, 0.2],
      kerbA: '#e8334a',
      kerbB: '#f5f5f5',
    },
    seed: 31,
    laps: 3,
  },
  {
    id: 'forno',
    name: 'Forno Velocità',
    country: 'Italia',
    food: 'pizza',
    style: 'Temple of speed · chicanes',
    tagline: 'Flat out, wood-fired. Brake for the chicanes, not for crust.',
    flag: ['#1fae4b', '#e8333b'],
    points: [
      [-0.3, 0.18],
      [0.08, 0.18],
      [0.16, 0.16],
      [0.22, 0.18],
      [0.35, 0.18],
      [0.45, 0.13],
      [0.48, 0.05],
      [0.45, -0.05],
      [0.38, -0.12],
      [0.3, -0.1],
      [0.24, -0.14],
      [0.1, -0.15],
      [-0.2, -0.15],
      [-0.38, -0.13],
      [-0.47, -0.05],
      [-0.47, 0.07],
      [-0.42, 0.15],
    ],
    palette: {
      land: '#6b6a35',
      landEdge: '#4a4a22',
      waterDeep: '#0b2f52',
      waterShallow: '#2d6f9c',
      asphalt: '#33333a',
      glow: '#ff3b5c',
      tree: [0.1, 0.25, 0.06],
      kerbA: '#e8333b',
      kerbB: '#f5f5f5',
    },
    seed: 41,
    laps: 4,
  },
  {
    id: 'drivethru',
    name: 'Midnight Drive-Thru',
    country: 'Bonus',
    food: 'late-night snacks',
    style: 'Night street circuit · 90° corners',
    tagline: 'Neon, tight walls and the 24-hour order window.',
    flag: ['#b06bff', '#38f5ff'],
    points: [
      [-0.3, 0.17],
      [0.1, 0.17],
      [0.2, 0.16],
      [0.22, 0.08],
      [0.32, 0.06],
      [0.45, 0.05],
      [0.47, -0.03],
      [0.45, -0.13],
      [0.3, -0.15],
      [0.18, -0.13],
      [0.16, -0.05],
      [0.04, -0.03],
      [-0.08, -0.04],
      [-0.1, -0.12],
      [-0.25, -0.15],
      [-0.42, -0.14],
      [-0.46, -0.04],
      [-0.4, 0.03],
      [-0.46, 0.1],
      [-0.42, 0.16],
    ],
    palette: {
      land: '#1c1f2b',
      landEdge: '#11131c',
      waterDeep: '#060b1c',
      waterShallow: '#1a2350',
      asphalt: '#23252e',
      glow: '#b06bff',
      tree: [0.05, 0.12, 0.2],
      kerbA: '#b06bff',
      kerbB: '#38f5ff',
    },
    seed: 53,
    laps: 3,
  },
];

export function circuitById(id: string | null | undefined): CircuitDef {
  return CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
}
