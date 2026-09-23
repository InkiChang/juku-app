import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'top.inkicheng.jukuapp',
  appName: '剧库',
  webDir: 'dist',
  server: {
    allowNavigation: ['*'],
  },
  plugins: {
    CapacitorHttp: {
      // Keep the global fetch/XHR patch disabled. HLS.js uses its own native
      // loader in PlayerSheet so ordinary API/catalog requests keep their
      // normal memory and cancellation behaviour.
      enabled: false,
    },
    CapacitorCookies: {
      enabled: true,
    },
  },
};

export default config;
