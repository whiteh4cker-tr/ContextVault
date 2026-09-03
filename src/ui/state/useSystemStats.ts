import { useEffect, useState } from 'react';
import { api as defaultApi } from '../api';
import type { IpcApi } from '../../shared/ipc';
import type { SystemStats } from '../../shared/types';

/** Live memory figures for the AppBar gauge; null until the first tick. */
export function useSystemStats(api: IpcApi = defaultApi): SystemStats | null {
  const [stats, setStats] = useState<SystemStats | null>(null);
  useEffect(() => api.onSystemStats(setStats), [api]);
  return stats;
}
