import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Channels } from '../shared/ipc';

/**
 * The preload bridge is CommonJS and cannot import the contract, so its channel
 * names are written out by hand. This test is what makes that safe: it reads both
 * files and fails when either side knows a channel the other does not.
 */
const preloadSource = readFileSync(path.join(import.meta.dirname, 'preload.cjs'), 'utf8');
const mainSource = readFileSync(path.join(import.meta.dirname, 'ipc.ts'), 'utf8');

describe('preload bridge', () => {
  it('exposes every invoke channel the contract defines', () => {
    for (const [method, channel] of Object.entries(Channels)) {
      if (channel.endsWith('.on')) continue;
      // The contract names the channel `modelEvent`; the bridge method that
      // subscribes to it is `onModelEvent`.
      expect(preloadSource, `preload.cjs is missing on${method} → ${channel}`).toContain(`: '${channel}'`);
    }
  });

  it('subscribes to every push channel the contract defines', () => {
    for (const [method, channel] of Object.entries(Channels)) {
      if (!channel.endsWith('.on')) continue;
      expect(preloadSource, `preload.cjs is missing on${method} → ${channel}`).toContain(`: '${channel}'`);
    }
  });

  it('does not invent channels of its own', () => {
    const known = new Set<string>(Object.values(Channels));
    const mentioned = [...preloadSource.matchAll(/'([a-z]+:[a-z.-]+)'/g)].map((match) => match[1]!);
    for (const channel of mentioned) expect(known, `unknown channel ${channel}`).toContain(channel);
  });

  it('resolves dropped-file paths through webUtils', () => {
    // Electron removed File.path; without this the drop zone cannot learn what
    // the user dropped.
    expect(preloadSource).toContain('webUtils.getPathForFile');
    expect(mainSource).toContain('ipcMain.handle');
  });
});
