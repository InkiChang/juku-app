import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const remoteApiBaseUrl = process.env.JUKU_DEV_REMOTE_API_BASE_URL || '';
const localApiBaseUrl = process.env.JUKU_DEV_LOCAL_API_BASE_URL || 'http://localhost:8998';

function prepareRemoteProxy(proxy: { on: (event: string, handler: (...args: any[]) => void) => void }) {
  proxy.on('proxyReq', (proxyRequest: { removeHeader: (name: string) => void }) => {
    // The backend intentionally rejects foreign browser origins. Through the dev
    // proxy this is a same-origin request, so do not forward localhost as Origin.
    proxyRequest.removeHeader('origin');
  });
  proxy.on('proxyRes', (proxyResponse: { headers: Record<string, string | string[] | undefined> }) => {
    // Production account cookies are Secure. The local Vite page is HTTP, so
    // remove that attribute only on the development proxy response.
    const cookies = proxyResponse.headers['set-cookie'];
    if (Array.isArray(cookies)) {
      proxyResponse.headers['set-cookie'] = cookies.map(cookie => cookie.replace(/;\s*Secure(?=;|$)/gi, ''));
    }
  });
}

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: localApiBaseUrl,
        changeOrigin: true,
      },
      ...(remoteApiBaseUrl ? {
        '/__juku_remote': {
          target: remoteApiBaseUrl,
          changeOrigin: true,
          secure: true,
          rewrite: path => path.replace(/^\/__juku_remote/, ''),
          configure: prepareRemoteProxy,
        },
      } : {}),
    },
  },
  build: {
    sourcemap: true,
  },
});
