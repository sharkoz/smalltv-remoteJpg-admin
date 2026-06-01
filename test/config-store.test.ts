import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/config/store.js';
import type { Device, Dashboard } from '../src/domain/types.js';

let dir: string;
let cfgPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stv-cfg-'));
  cfgPath = join(dir, 'config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const device: Device = {
  id: 'kitchen-tv',
  name: 'Kitchen',
  pollIntervalMs: 5000,
  assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 10000 }],
};

const dashboard: Dashboard = {
  id: 'clock-paris',
  pluginId: 'clock',
  name: 'Paris Clock',
  config: { timezone: 'Europe/Paris' },
  displayDurationMs: 10000,
};

describe('ConfigStore', () => {
  it('starts empty when no file exists', () => {
    const store = ConfigStore.load(cfgPath);
    expect(store.getDevices()).toEqual([]);
    expect(store.getDashboards()).toEqual([]);
  });

  it('persists and reloads devices and dashboards (round-trip)', () => {
    const store = ConfigStore.load(cfgPath);
    store.upsertDashboard(dashboard);
    store.upsertDevice(device);

    expect(existsSync(cfgPath)).toBe(true);

    const reloaded = ConfigStore.load(cfgPath);
    expect(reloaded.getDevice('kitchen-tv')).toEqual(device);
    expect(reloaded.getDashboard('clock-paris')).toEqual(dashboard);
  });

  it('upsert replaces an existing entry by id', () => {
    const store = ConfigStore.load(cfgPath);
    store.upsertDevice(device);
    store.upsertDevice({ ...device, name: 'Renamed' });
    expect(store.getDevices()).toHaveLength(1);
    expect(store.getDevice('kitchen-tv')?.name).toBe('Renamed');
  });

  it('removes entries and reports whether anything changed', () => {
    const store = ConfigStore.load(cfgPath);
    store.upsertDevice(device);
    expect(store.removeDevice('kitchen-tv')).toBe(true);
    expect(store.removeDevice('kitchen-tv')).toBe(false);
    expect(store.getDevices()).toEqual([]);
  });

  it('returns defensive copies (mutating the result does not affect the store)', () => {
    const store = ConfigStore.load(cfgPath);
    store.upsertDevice(device);
    const d = store.getDevice('kitchen-tv')!;
    d.name = 'mutated';
    expect(store.getDevice('kitchen-tv')?.name).toBe('Kitchen');
  });

  it('rejects malformed config on load', () => {
    writeFileSync(cfgPath, JSON.stringify({ version: 2, devices: 'nope' }), 'utf8');
    expect(() => ConfigStore.load(cfgPath)).toThrow(/Invalid config/);
  });

  it('writes valid JSON with version 1', () => {
    const store = ConfigStore.load(cfgPath);
    store.upsertDashboard(dashboard);
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
    expect(written.version).toBe(1);
    expect(written.dashboards[0].id).toBe('clock-paris');
  });
});
