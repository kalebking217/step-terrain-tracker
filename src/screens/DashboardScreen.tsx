import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStepTracker } from '../hooks/useStepTracker';
import { SessionRecord, Terrain, getRecentSessions } from '../utils/trackerLib';

const TERRAINS: { key: Terrain; label: string; icon: string }[] = [
  { key: 'pavement', label: 'Pavement', icon: '🛣️' },
  { key: 'dirt', label: 'Dirt', icon: '🟤' },
  { key: 'grass', label: 'Grass', icon: '🌱' },
  { key: 'sand', label: 'Sand', icon: '🏖️' },
];

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const num = (txt: string, fallback: number) => {
  const n = parseFloat(txt.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// CRITICAL: Must be default export
export default function DashboardScreen() {
  const [weightTxt, setWeightTxt] = useState('70');
  const [loadTxt, setLoadTxt] = useState('0');
  const [heightTxt, setHeightTxt] = useState('175');
  const [history, setHistory] = useState<SessionRecord[]>([]);

  const t = useStepTracker({
    weightKg: num(weightTxt, 70),
    loadKg: Math.max(0, parseFloat(loadTxt.replace(',', '.')) || 0),
    heightCm: num(heightTxt, 175),
  });

  const refreshHistory = useCallback(() => {
    getRecentSessions(3).then(setHistory).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory, t.status]);

  const active = t.status !== 'idle';
  const slopeDeg = (Math.atan(t.inclinePct / 100) * 180) / Math.PI;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Calories */}
        <View style={s.hero}>
          <Text style={s.muted}>Calories burned</Text>
          <Text style={s.heroNum} accessibilityLabel={`${Math.round(t.calories)} calories burned`}>
            {t.calories.toFixed(1)}
          </Text>
          <Text style={s.muted}>kcal · {fmtTime(t.durationSec)}</Text>
        </View>

        {/* Steps & Speed */}
        <View style={s.row}>
          <View style={[s.card, s.flex]}>
            <Text style={s.muted}>Steps</Text>
            <Text style={s.bigNum}>{t.steps.toLocaleString()}</Text>
          </View>
          <View style={[s.card, s.flex]}>
            <Text style={s.muted}>Speed</Text>
            <Text style={s.bigNum}>{t.speedKmh.toFixed(1)}</Text>
            <Text style={s.muted}>km/h</Text>
          </View>
        </View>

        {/* Incline */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <View>
              <Text style={s.muted}>Incline</Text>
              <Text style={s.bigNum}>
                {t.inclinePct > 0 ? '+' : ''}
                {t.inclinePct.toFixed(1)}%
              </Text>
            </View>
            <View style={s.slopeBox}>
              <View style={[s.slope, { transform: [{ rotate: `${-slopeDeg}deg` }] }]} />
            </View>
          </View>
          <Text style={s.muted}>
            {t.altitude != null ? `Altitude ${t.altitude.toFixed(0)} m` : 'Waiting for GPS altitude'}
          </Text>
        </View>

        {/* Terrain */}
        <View style={s.card}>
          <Text style={s.muted}>Terrain</Text>
          <View style={s.terrainRow}>
            {TERRAINS.map((x) => {
              const on = t.terrain === x.key;
              return (
                <Pressable
                  key={x.key}
                  onPress={() => t.setTerrain(x.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.terrainBtn, on && s.terrainOn]}
                >
                  <Text style={s.terrainIcon}>{x.icon}</Text>
                  <Text style={[s.terrainTxt, on && s.terrainTxtOn]}>{x.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.rowBetween}>
            <Text style={s.label}>Detect from map</Text>
            <View style={s.inline}>
              {t.terrainLoading && <ActivityIndicator size="small" color={C.accent} style={{ marginRight: 8 }} />}
              <Switch
                value={t.autoTerrain}
                onValueChange={t.setAutoTerrain}
                trackColor={{ true: C.accent, false: C.line }}
              />
            </View>
          </View>
          {!!t.terrainNote && <Text style={s.note}>{t.terrainNote}</Text>}
          {!t.autoTerrain && (
            <Pressable onPress={t.detectTerrain} disabled={t.terrainLoading}>
              <Text style={s.link}>Detect once at my location</Text>
            </Pressable>
          )}
        </View>

        {/* Controls */}
        {!!t.error && <Text style={s.error}>{t.error}</Text>}
        <View style={s.row}>
          {t.status === 'idle' && (
            <Pressable style={[s.btn, s.btnPrimary, s.flex]} onPress={t.start}>
              <Text style={s.btnPrimaryTxt}>Start session</Text>
            </Pressable>
          )}
          {t.status === 'running' && (
            <Pressable style={[s.btn, s.btnGhost, s.flex]} onPress={t.pause}>
              <Text style={s.btnGhostTxt}>Pause</Text>
            </Pressable>
          )}
          {t.status === 'paused' && (
            <Pressable style={[s.btn, s.btnPrimary, s.flex]} onPress={t.resume}>
              <Text style={s.btnPrimaryTxt}>Resume</Text>
            </Pressable>
          )}
          {active && (
            <Pressable style={[s.btn, s.btnStop, s.flex]} onPress={t.stop}>
              <Text style={s.btnStopTxt}>Finish and save</Text>
            </Pressable>
          )}
        </View>

        {/* Profile */}
        <View style={s.card}>
          <Text style={s.muted}>Your details</Text>
          <View style={s.row}>
            {[
              ['Weight (kg)', weightTxt, setWeightTxt],
              ['Load (kg)', loadTxt, setLoadTxt],
              ['Height (cm)', heightTxt, setHeightTxt],
            ].map(([label, val, set]) => (
              <View key={label as string} style={s.flex}>
                <Text style={s.fieldLabel}>{label as string}</Text>
                <TextInput
                  style={s.input}
                  value={val as string}
                  onChangeText={set as (v: string) => void}
                  keyboardType="decimal-pad"
                  editable={!active}
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>
        </View>

        {/* History */}
        <View style={s.card}>
          <Text style={s.muted}>Recent sessions</Text>
          {history.length === 0 ? (
            <Text style={s.note}>Finish a session and it will show up here.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id || h.startedAt} style={s.histRow}>
                <Text style={s.label}>{new Date(h.startedAt).toLocaleDateString()}</Text>
                <Text style={s.note}>
                  {Math.round(h.calories)} kcal · {h.steps} steps · {fmtTime(h.durationSec)} · {h.terrain}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const C = {
  bg: '#0E1A17', card: '#16261F', line: '#2A3F36', text: '#EAF2EE',
  muted: '#8FA89C', accent: '#7BE0A4', danger: '#F08A7A',
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 12 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center' },
  hero: { alignItems: 'center', paddingVertical: 24 },
  heroNum: { color: C.accent, fontSize: 72, fontWeight: '800', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 6 },
  bigNum: { color: C.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: C.muted, fontSize: 14 },
  label: { color: C.text, fontSize: 16 },
  note: { color: C.muted, fontSize: 13 },
  link: { color: C.accent, fontSize: 14, marginTop: 4 },
  error: { color: C.danger, fontSize: 14 },
  slopeBox: { width: 110, height: 60, justifyContent: 'center', alignItems: 'center' },
  slope: { width: 100, height: 5, borderRadius: 3, backgroundColor: C.accent },
  terrainRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  terrainBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: C.line,
  },
  terrainOn: { backgroundColor: C.accent, borderColor: C.accent },
  terrainIcon: { fontSize: 22 },
  terrainTxt: { color: C.muted, fontSize: 12, marginTop: 2 },
  terrainTxtOn: { color: C.bg, fontWeight: '700' },
  btn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: C.accent },
  btnPrimaryTxt: { color: C.bg, fontSize: 17, fontWeight: '700' },
  btnGhost: { borderWidth: 1, borderColor: C.accent },
  btnGhostTxt: { color: C.accent, fontSize: 17, fontWeight: '700' },
  btnStop: { backgroundColor: C.card, borderWidth: 1, borderColor: C.danger },
  btnStopTxt: { color: C.danger, fontSize: 17, fontWeight: '700' },
  fieldLabel: { color: C.muted, fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: C.bg, color: C.text, borderRadius: 10, paddingHorizontal: 10,
    paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: C.line,
  },
  histRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line, marginTop: 6 },
});