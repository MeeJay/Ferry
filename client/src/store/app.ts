import { create } from 'zustand';
import type { Me, PublicConfig } from '@ferry/shared';
import { api } from '@/api/client';
import { applyAccent } from '@/lib/theme';

interface AppState {
  config: PublicConfig | null;
  me: Me | null;
  ready: boolean;
  init: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setMe: (me: Me | null) => void;
  setConfig: (c: PublicConfig) => void;
  logout: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  config: null,
  me: null,
  ready: false,
  async init() {
    const [config, me] = await Promise.all([
      api.get<PublicConfig>('/api/public/config'),
      api.get<Me>('/api/auth/me').catch(() => null),
    ]);
    get().setConfig(config);
    set({ me, ready: true });
  },
  async refreshMe() {
    set({ me: await api.get<Me>('/api/auth/me').catch(() => null) });
  },
  setMe: (me) => set({ me }),
  setConfig(config) {
    applyAccent(config.branding.accent);
    document.title = config.branding.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon && config.branding.favicon) icon.href = config.branding.favicon;
    set({ config });
  },
  async logout() {
    const r = await api.post<{ redirect?: string | null }>('/api/auth/logout');
    set({ me: null });
    // Obligate accounts also sign out of Obligate, which sends them back to our login page.
    if (r?.redirect) window.location.href = r.redirect;
  },
}));
