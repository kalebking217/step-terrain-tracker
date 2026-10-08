import * as SQLite from 'expo-sqlite';

/* ------------------------------------------------------------------ */
/* Pandolf equation                                                    */
/* ------------------------------------------------------------------ */

export type Terrain = 'pavement' | 'dirt' | 'grass' | 'sand';

/** Terrain coefficient (eta). Values follow the Pandolf/Soule-Goldman tables. */
export const TERRAIN_FACTOR: Record<Terrain, number> = {
  pavement: 1.0, // blacktop / paved road
  dirt: 1.1, // dirt road
  grass: 1.2, // light brush / grass
  sand: 2.1, // loose sand
};

export interface PandolfInput {
  weightKg: number; // W: body mass
  loadKg: number; // L: carried load
  speedMs: number; // V: walking speed in m/s
  gradePct: number; // G: slope in %
  terrain: Terrain;
}

/**
 * Pandolf et al. (1977):
 *   M = 1.5W + 2.0(W+L)(L/W)^2 + eta(W+L)(1.5V^2 + 0.35VG)
 * Returns metabolic rate in watts.
 * Downhill grades are clamped to 0 because the original equation is not valid
 * for negative grades (the Santee correction could be added later).
 */
export function pandolfWatts({ weightKg, loadKg, speedMs, gradePct, terrain }: PandolfInput): number {
  const W = Math.max(weightKg, 1);
  const L = Math.max(loadKg, 0);
  const V = Math.max(speedMs, 0);
  const G = Math.max(gradePct, 0);
  const eta = TERRAIN_FACTOR[terrain];
  return 1.5 * W + 2.0 * (W + L) * Math.pow(L / W, 2) + eta * (W + L) * (1.5 * V * V + 0.35 * V * G);
}

/** watts * seconds = joules; 1 kcal = 4184 J */
export const wattsToKcal = (watts: number, seconds: number) => (watts * seconds) / 4184;

/* ------------------------------------------------------------------ */
/* Geo + OpenStreetMap Overpass terrain lookup                         */
/* ------------------------------------------------------------------ */

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const SURFACE_MAP: Record<string, Terrain> = {
  asphalt: 'pavement', concrete: 'pavement', paved: 'pavement', paving_stones: 'pavement',
  sett: 'pavement', cobblestone: 'pavement', metal: 'pavement', wood: 'pavement', tartan: 'pavement',
  dirt: 'dirt', ground: 'dirt', earth: 'dirt', gravel: 'dirt', fine_gravel: 'dirt', compacted: 'dirt',
  unpaved: 'dirt', mud: 'dirt', pebblestone: 'dirt', clay: 'dirt',
  grass: 'grass', grass_paver: 'grass',
  sand: 'sand',
};

export interface TerrainResult {
  terrain: Terrain;
  label: string; // e.g. "surface=asphalt"
}

/**
 * Finds the nearest OSM way with a recognisable surface; if none is tagged,
 * falls back to area tags (beach/sand, grass/meadow) around the point.
 * Returns null when nothing useful is found.
 */
export async function fetchTerrain(lat: number, lon: number, signal?: AbortSignal): Promise<TerrainResult | null> {
  const around = `around:30,${lat},${lon}`;
  const query =
    `[out:json][timeout:10];(` +
    `way(${around})["surface"];` +
    `way(${around})["natural"~"^(sand|beach|grassland)$"];` +
    `way(${around})["landuse"~"^(grass|meadow)$"];` +
    `);out geom 25;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal,
  });
  if (!res.ok) return null;
  const json = await res.json();

  let bestSurface: { dist: number; result: TerrainResult } | null = null;
  let area: TerrainResult | null = null;

  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const mapped: Terrain | undefined = tags.surface ? SURFACE_MAP[String(tags.surface)] : undefined;

    if (mapped) {
      const pts: { lat: number; lon: number }[] = el.geometry ?? [];
      const dist = pts.length
        ? Math.min(...pts.map((p) => haversine(lat, lon, p.lat, p.lon)))
        : Number.MAX_VALUE;
      if (!bestSurface || dist < bestSurface.dist) {
        bestSurface = { dist, result: { terrain: mapped, label: `surface=${tags.surface}` } };
      }
    } else if (!area) {
      if (tags.natural === 'sand' || tags.natural === 'beach') area = { terrain: 'sand', label: `natural=${tags.natural}` };
      else if (tags.natural === 'grassland') area = { terrain: 'grass', label: 'natural=grassland' };
      else if (tags.landuse === 'grass' || tags.landuse === 'meadow') area = { terrain: 'grass', label: `landuse=${tags.landuse}` };
    }
  }
  return bestSurface?.result ?? area;
}

/* ------------------------------------------------------------------ */
/* expo-sqlite persistence (offline-first)                             */
/* ------------------------------------------------------------------ */

export interface SessionRecord {
  id?: number;
  startedAt: number;
  durationSec: number;
  steps: number;
  calories: number;
  avgSpeedMs: number;
  terrain: Terrain;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('steptracker.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          duration_sec INTEGER NOT NULL,
          steps INTEGER NOT NULL,
          calories REAL NOT NULL,
          avg_speed_ms REAL NOT NULL,
          terrain TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function saveSession(s: SessionRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sessions (started_at, duration_sec, steps, calories, avg_speed_ms, terrain) VALUES (?, ?, ?, ?, ?, ?)',
    s.startedAt, s.durationSec, s.steps, s.calories, s.avgSpeedMs, s.terrain
  );
}

export async function getRecentSessions(limit = 5): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?', limit);
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    durationSec: r.duration_sec,
    steps: r.steps,
    calories: r.calories,
    avgSpeedMs: r.avg_speed_ms,
    terrain: r.terrain as Terrain,
  }));
}