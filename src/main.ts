import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { StatusBar, Style } from '@capacitor/status-bar';

async function configureStatusBar(): Promise<void> {
  // Android edge-to-edge windows can place the WebView beneath the system
  // status bar. Disable overlaying so the app content starts below it.
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#080808' });
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    // The plugin is unavailable in a regular browser preview; CSS safe-area
    // handling remains the fallback there.
  }
}

void configureStatusBar();

createApp(App).mount('#app');
