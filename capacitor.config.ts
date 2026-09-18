import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'top.inkicheng.jukuapp',
  appName: '剧库',
  webDir: 'dist',
  server: {
    allowNavigation: ['*'],
  },
};

export default config;
