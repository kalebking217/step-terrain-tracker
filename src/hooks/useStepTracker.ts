import { useCallback, useEffect, useRef, useState } from 'react';
import { Pedometer } from 'expo-sensors';
import * as Location from 'expo-location';
import {
  Terrain,
  fetchTerrain,
  haversine,
  pandolfWatts,
  saveSession,
  wattsToKcal,
} from '../utils/trackerLib';

export type TrackerStatus = 'idle' | 'running' | 'paused';

interface Options {
  weightKg: number;
  loadKg?: number;
  heightCm: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useStepTracker({ weightKg, loadKg = 0, heightCm }: Options) {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [steps, setSteps] = useState(0);
  const [speedMs, setSpeedMs] = useState(0);
  const [inclinePct, setInclinePct] = useState(0);
  const [altitude, setAltitude] = useState<number | null>(null);
  const [calories, setCalories] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [terrain, setTerrainState] = useState<Terrain>('pavement');
  const [autoTerrain, setAutoTerrainState] = useState(false);
  const [terrainNote, setTerrainNote] = useState<string | null>(null);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<TrackerStatus>('idle');
  const paramsRef = useRef({ weightKg, loadKg, heightCm });
  paramsRef.current = { weightKg, loadKg, heightCm };
  const terrainRef = useRef<Terrain>('pavement');
  const autoRef = useRef(false);

  const stepsBaseRef = useRef(0);
  const stepsWatchRef = useRef(0);
  const samplesRef = useRef<{ t: number; steps: number }[]>([]);
  const speedRef = useRef(0);
  const gradeRef = useRef(0);
  const caloriesRef = useRef(0);
  const durationRef = useRef(0);
  const lastTickRef = useRef(0);
  const startedAtRef = useRef(0);
  const speedSumRef = useRef(0);

  const pedSub = useRef<{ remove: () => void } | null>(null);
  const locSub = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locGrantedRef = useRef(false);

  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const altEmaRef = useRef<number | null>(null);
  const anchorRef = useRef<{ lat: number; lon: number; alt: number } | null>(null);
  const lastQueryRef = useRef<{ t: number; lat: number; lon: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyTerrain = (t: Terrain) => {
    terrainRef.current = t;
    setTerrainState(t);
  };

  const detectTerrain = useCallback(async () => {
    let pos = lastPosRef.current;
    if (!pos) {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) throw new Error('denied');
        const p = await Location.getCurrentPositionAsync({});
        pos = { lat: p.coords.latitude, lon: p.coords.longitude };
        lastPosRef.current = pos;
      } catch {
        setTerrainNote('Location needed to detect terrain.');
        return;
      }
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    lastQueryRef.current = { t: Date.now(), lat: pos.lat, lon: pos.lon };
    setTerrainLoading(true);
    try {
      const r = await fetchTerrain(pos.lat, pos.lon, ctrl.signal);
      if (r) {
        applyTerrain(r.terrain);
        setTerrainNote(`Detected from OpenStreetMap (${r.label})`);
      } else {
        setTerrainNote('No terrain data nearby. Keeping your selection.');
      }
    } catch {
      setTerrainNote('Terrain lookup failed. Check your connection.');
    } finally {
      clearTimeout(timeout);
      setTerrainLoading(false);
    }
  }, []);

  const setTerrain = useCallback((t: Terrain) => {
    autoRef.current = false;
    setAutoTerrainState(false);
    setTerrainNote(null);
    applyTerrain(t);
  }, []);

  const setAutoTerrain = useCallback(
    (on: boolean) => {
      autoRef.current = on;
      setAutoTerrainState(on);
      if (on) detectTerrain();
      else setTerrainNote(null);
    },
    [detectTerrain]
  );

  const onStep = useCallback((r: { steps: number }) => {
    stepsWatchRef.current = r.steps;
    const total = stepsBaseRef.current + r.steps;
    samplesRef.current.push({ t: Date.now(), steps: total });
    setSteps(total);
  }, []);

  const onPosition = useCallback(
    (loc: Location.LocationObject) => {
      const { latitude: lat, longitude: lon, altitude: alt, accuracy, altitudeAccuracy } = loc.coords;
      if (accuracy != null && accuracy > 30) return;
      lastPosRef.current = { lat, lon };

      if (alt != null && (altitudeAccuracy == null || altitudeAccuracy <= 20)) {
        const ema = altEmaRef.current == null ? alt : altEmaRef.current * 0.7 + alt * 0.3;
        altEmaRef.current = ema;
        setAltitude(ema);

        const a = anchorRef.current;
        if (!a) {
          anchorRef.current = { lat, lon, alt: ema };
        } else {
          const dist = haversine(a.lat, a.lon, lat, lon);
          if (dist >= 15) {
            const g = clamp(((ema - a.alt) / dist) * 100, -30, 30);
            gradeRef.current = gradeRef.current * 0.5 + g * 0.5;
            setInclinePct(Math.round(gradeRef.current * 10) / 10);
            anchorRef.current = { lat, lon, alt: ema };
          }
        }
      }

      if (autoRef.current) {
        const q = lastQueryRef.current;
        const due = !q || (Date.now() - q.t > 30000 && haversine(q.lat, q.lon, lat, lon) > 75);
        if (due) detectTerrain();
      }
    },
    [detectTerrain]
  );

  const tick = useCallback(() => {
    const now = Date.now();
    const dt = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;

    const samples = (samplesRef.current = samplesRef.current.filter((s) => now - s.t <= 8000));
    let instant = 0;
    const last = samples[samples.length - 1];
    if (samples.length >= 2 && last && now - last.t <= 3000) {
      const first = samples[0];
      const span = (last.t - first.t) / 1000;
      if (span > 0.5) {
        const cadence = (last.steps - first.steps) / span;
        const factor = clamp(0.415 + (cadence - 1.8) * 0.35, 0.415, 0.85);
        instant = cadence * (paramsRef.current.heightCm / 100) * factor;
      }
    }
    speedRef.current = speedRef.current * 0.5 + instant * 0.5;
    if (speedRef.current < 0.05) speedRef.current = 0;

    const { weightKg: w, loadKg: l } = paramsRef.current;
    const watts = pandolfWatts({
      weightKg: w,
      loadKg: l,
      speedMs: speedRef.current,
      gradePct: gradeRef.current,
      terrain: terrainRef.current,
    });
    caloriesRef.current += wattsToKcal(watts, dt);
    durationRef.current += dt;
    speedSumRef.current += speedRef.current * dt;

    setSpeedMs(speedRef.current);
    setCalories(caloriesRef.current);
    setDurationSec(Math.floor(durationRef.current));
  }, []);

  const attach = useCallback(async () => {
    lastTickRef.current = Date.now();
    samplesRef.current = [{ t: Date.now(), steps: stepsBaseRef.current }];
    pedSub.current = Pedometer.watchStepCount(onStep);
    tickRef.current = setInterval(tick, 1000);
    if (locGrantedRef.current) {
      locSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 2000 },
        onPosition
      );
    }
  }, [onStep, onPosition, tick]);

  const detach = useCallback(() => {
    pedSub.current?.remove();
    pedSub.current = null;
    locSub.current?.remove();
    locSub.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const setStatusBoth = (s: TrackerStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const start = useCallback(async () => {
    if (statusRef.current !== 'idle') return;
    setError(null);
    try {
      if (!(await Pedometer.isAvailableAsync())) {
        setError('Step counting is not available on this device.');
        return;
      }
      const ped = await Pedometer.requestPermissionsAsync();
      if (!ped.granted) {
        setError('Allow motion/activity access to count steps.');
        return;
      }
      const loc = await Location.requestForegroundPermissionsAsync();
      locGrantedRef.current = loc.granted;
      if (!loc.granted) setError('Location denied: incline and terrain detection are off.');

      stepsBaseRef.current = 0;
      stepsWatchRef.current = 0;
      speedRef.current = 0;
      gradeRef.current = 0;
      caloriesRef.current = 0;
      durationRef.current = 0;
      speedSumRef.current = 0;
      altEmaRef.current = null;
      anchorRef.current = null;
      startedAtRef.current = Date.now();
      setSteps(0); setSpeedMs(0); setInclinePct(0); setAltitude(null);
      setCalories(0); setDurationSec(0);

      setStatusBoth('running');
      await attach();
    } catch (e: any) {
      detach();
      setStatusBoth('idle');
      setError(e?.message ?? 'Could not start tracking.');
    }
  }, [attach, detach]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'running') return;
    detach();
    stepsBaseRef.current += stepsWatchRef.current;
    stepsWatchRef.current = 0;
    speedRef.current = 0;
    setSpeedMs(0);
    setStatusBoth('paused');
  }, [detach]);

  const resume = useCallback(async () => {
    if (statusRef.current !== 'paused') return;
    setStatusBoth('running');
    await attach();
  }, [attach]);

  const stop = useCallback(async () => {
    if (statusRef.current === 'idle') return;
    detach();
    abortRef.current?.abort();
    const totalSteps = stepsBaseRef.current + stepsWatchRef.current;
    const dur = Math.round(durationRef.current);
    setStatusBoth('idle');
    setSpeedMs(0);
    if (dur >= 5) {
      try {
        await saveSession({
          startedAt: startedAtRef.current,
          durationSec: dur,
          steps: totalSteps,
          calories: caloriesRef.current,
          avgSpeedMs: dur > 0 ? speedSumRef.current / dur : 0,
          terrain: terrainRef.current,
        });
      } catch {
        setError('Session finished but could not be saved.');
      }
    }
  }, [detach]);

  useEffect(
    () => () => {
      detach();
      abortRef.current?.abort();
    },
    [detach]
  );

  return {
    status, steps, speedMs, speedKmh: speedMs * 3.6, inclinePct, altitude,
    calories, durationSec, terrain, autoTerrain, terrainNote, terrainLoading, error,
    setTerrain, setAutoTerrain, detectTerrain, start, pause, resume, stop,
  };
}