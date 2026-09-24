<script setup lang="ts">
import Hls from 'hls.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { appStore } from '../stores/app';
import { viewerHeadersFor } from '../api/client';
import { networkScheduler } from '../api/requestScheduler';
import { NativePlayback, type NativePlaybackState } from '../native/nativePlayback';
import type { Drama, PlaybackOpen, PlaybackPlan } from '../types/api';
import { episodeLabel, releaseStatusLabel } from '../utils/drama';
import { watchedEpisodeSet } from '../utils/history';

const props = defineProps<{ drama: Drama; initialEpisode?: number }>();
const emit = defineEmits<{ close: [] }>();
const title = props.drama.title || props.drama.name || '未命名短剧';
const session = ref('');
const episode = ref(1);
const loading = ref(true);
const error = ref('');
const plan = ref<PlaybackPlan | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const playerRoot = ref<HTMLElement | null>(null);
const episodes = ref<Array<{ index: number; title?: string; total?: number }>>([]);
const sessionWatchedEpisodes = ref<Set<number>>(new Set());
const watchedEpisodes = computed(() => {
  const merged = watchedEpisodeSet(appStore.state.history, props.drama);
  for (const index of sessionWatchedEpisodes.value) merged.add(index);
  return merged;
});
const playbackEpisodeList = computed(() => episodes.value.length
  ? episodes.value
  : Array.from({ length: Math.min(Number(props.drama.totalEpisode || 12), 120) }, (_, index) => ({ index: index + 1 })));
function isEpisodeWatched(index: number): boolean {
  return watchedEpisodes.value.has(index);
}
const showEpisodes = ref(false);
const showMenu = ref(false);
const showSpeedMenu = ref(false);
const speed = ref(1);
const fastForwarding = ref(false);
const isFullscreen = ref(false);
const immersiveFullscreen = ref(false);
const isPip = ref(false);
const selectedQuality = ref(0);
const actualQuality = ref(0);
const actualVideoQuality = ref(0);
const playbackReleaseStatus = ref('');
const currentTime = ref(0);
const duration = ref(0);
const isPlaying = ref(false);
const descriptionBox = ref<HTMLElement | null>(null);
const descriptionOverlayOpen = ref(false);
const descriptionOverflow = ref(false);
const isPortraitVideo = ref(false);
const nativePlaybackActive = ref(false);
const nativePosition = ref(0);
const nativeDuration = ref(0);
let hls: Hls | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let recoveryTimer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let run = 0;
let resumePosition = 0;
let planMode: 'auto' | 'proxy' = 'auto';
let changingEpisode = false;
let progressInFlight: Promise<void> | null = null;
let lastProgressSentAt = 0;
let lastObservedTime = 0;
let lastProgressAt = Date.now();
let recoveryAttempts = 0;
let recoveryInFlight = false;
let stageTouchStartX = 0;
let stageTouchStartY = 0;
let stageTouchStartedAt = 0;
let stageTouchIgnored = false;
let nativeListeners: Array<{ remove: () => Promise<void> }> = [];
let nativeResizeObserver: ResizeObserver | null = null;

/**
 * HLS.js normally uses browser XHR for both the manifest and every media
 * fragment. The remote service does not expose CORS headers, so Android must
 * fetch those bytes through CapacitorHttp while leaving decode/buffering to
 * the WebView video element. This loader deliberately keeps only a small
 * request reference and ignores late responses after abort.
 */
class CapacitorHlsLoader {
  context: any = null;
  stats: any = {
    aborted: false,
    loaded: 0,
    total: 0,
    retry: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, end: 0 },
  };
  private cancelled = false;
  private requestController: AbortController | null = null;

  load(context: any, _config: any, callbacks: any): void {
    this.context = context;
    this.cancelled = false;
    this.requestController?.abort();
    this.requestController = new AbortController();
    const started = performance.now();
    this.stats.loading.start = started;
    const responseType = context.responseType === 'arraybuffer' ? 'arraybuffer' : 'text';
    const headers = viewerHeadersFor(appStore.api().serverBase);
    void networkScheduler.enqueue(() => CapacitorHttp.request({
      url: context.url,
      method: 'GET',
      headers,
      responseType,
      connectTimeout: 15000,
      readTimeout: 30000,
    }), {
      priority: 'playback',
      label: context.url,
      minIntervalMs: 0,
      signal: this.requestController.signal,
    }).then((response) => {
      if (this.cancelled) return;
      const data = responseType === 'arraybuffer'
        ? decodeNativeBytes(response.data)
        : String(response.data ?? '');
      const elapsed = performance.now();
      this.stats.loading.first = elapsed;
      this.stats.loading.end = elapsed;
      this.stats.loaded = data instanceof ArrayBuffer ? data.byteLength : String(data).length;
      this.stats.total = this.stats.loaded;
      if (response.status < 200 || response.status >= 300) {
        callbacks.onError({ code: response.status, text: `HTTP ${response.status}` }, context, null, this.stats);
        return;
      }
      callbacks.onSuccess({ url: context.url, data, code: response.status }, this.stats, context, null);
    }).catch((error) => {
      if (this.cancelled) return;
      callbacks.onError({ code: 0, text: error instanceof Error ? error.message : String(error) }, context, null, this.stats);
    });
  }

  abort(): void {
    this.cancelled = true;
    this.requestController?.abort();
    this.requestController = null;
    this.stats.aborted = true;
  }

  destroy(): void {
    this.cancelled = true;
    this.requestController?.abort();
    this.requestController = null;
    this.context = null;
  }
}

function decodeNativeBytes(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
  }
  const encoded = String(value ?? '');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function lockLandscapeIfSupported(): Promise<void> {
  if (isPortraitVideo.value) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await ScreenOrientation.lock({ orientation: 'landscape-primary' });
      return;
    } catch { /* fall back to the browser orientation API below */ }
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (value: 'landscape') => Promise<void> };
    await orientation.lock?.('landscape');
  } catch { /* orientation lock is optional in browser previews */ }
}

async function unlockOrientation(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ScreenOrientation.unlock();
      return;
    } catch { /* fall back to the browser orientation API below */ }
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation.unlock?.();
  } catch { /* ignored on platforms without orientation control */ }
}

function hlsDirectory(url: string): URL {
  const resolved = new URL(url, window.location.href);
  resolved.pathname = resolved.pathname.replace(/[^/]*$/, '');
  resolved.search = '';
  resolved.hash = '';
  return resolved;
}

function normalizeHlsRequest(url: string, base: URL): string {
  // Capacitor's WebView can resolve relative HLS segment URLs against its
  // localhost origin. Re-anchor those requests to the remote HLS directory.
  try {
    const candidate = new URL(url, window.location.href);
    const isLocalWebView = candidate.hostname === 'localhost'
      || candidate.hostname === '127.0.0.1'
      || candidate.hostname === '::1';
    if (isLocalWebView || url.startsWith('/') || !/^https?:/i.test(url)) {
      // The backend currently emits segments at the host root (for example
      // /segment.ts), while the playlist lives under /api/ui/playback/hls/.
      // Keep the playlist-relative pathname rather than appending it to the
      // manifest directory.
      return new URL(`${candidate.pathname}${candidate.search}${candidate.hash}`, base.origin).toString();
    }
    return candidate.toString();
  } catch {
    return new URL(url.replace(/^\/+/, ''), base).toString();
  }
}


const tagChips = computed(() => {
  const values = [
    ...(props.drama.tags || []),
    props.drama.categoryName,
    props.drama.category,
  ].map(value => String(value || '').trim()).filter(Boolean);
  const unique = [...new Set(values)];
  return (unique.length ? unique : ['新剧']).slice(0, 3);
});

const description = computed(() => String(props.drama.desc || props.drama.intro || '').trim());

const statusLabel = computed(() => releaseStatusLabel(props.drama));

const playbackStatusLabel = computed(() => {
  const playbackDrama = playbackReleaseStatus.value
    ? { ...props.drama, releaseStatus: playbackReleaseStatus.value }
    : props.drama;
  const resolved = releaseStatusLabel(playbackDrama);
  if (resolved !== '状态未知') return resolved;
  const total = episodes.value.reduce((max, item) => Math.max(max, Number(item.total || 0)), 0);
  if (total > 0 && episode.value >= total) return '已完结';
  return resolved;
});

const totalEpisodeLabel = computed(() => {
  const count = episodes.value.length || Number(props.drama.totalEpisode || 0);
  return count > 0 ? `全 ${count} 集` : episodeLabel(props.drama);
});

const sourceLabel = computed(() => {
  const raw = String(props.drama.source || props.drama.channelName || props.drama.channel_name || props.drama.site || props.drama.host || '').trim();
  if (!raw) return '';
  const value = raw.toLowerCase();
  if (value.includes('hongguo') || value.includes('redfruit') || raw.includes('红果')) return '红果';
  if (value.includes('huangguo') || raw.includes('黄果')) return '黄果';
  if (value.includes('huangdou') || value.includes('yellowbean') || raw.includes('黄豆')) return '黄豆';
  return raw;
});

const qualityOptions = computed(() => {
  const values = new Map<number, string>();
  values.set(0, actualQuality.value > 0 ? `自动（${actualQuality.value}p）` : '自动');
  for (const item of plan.value?.qualities || []) {
    const value = Number(item.value);
    if (Number.isInteger(value) && value > 0) values.set(value, item.label || `${value}p`);
  }
  return [...values.entries()].map(([value, label]) => ({ value, label }));
});

const activeQualityLabel = computed(() => {
  const value = actualVideoQuality.value || actualQuality.value;
  return value > 0 ? `实际 ${value}p` : '自动';
});

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function isNativeDirectPlan(value: PlaybackPlan | null): boolean {
  return Boolean(Capacitor.isNativePlatform()
    && value
    && (value.directURL || value.delivery === 'redirect')
    && value.player !== 'legacy');
}

async function syncNativeRect(): Promise<void> {
  if (!nativePlaybackActive.value) return;
  const target = video.value || playerRoot.value?.querySelector('.video-stage');
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  if (rect.width <= 0 || rect.height <= 0) return;
  await NativePlayback.setRect({
    x: Math.round(rect.left * scale),
    y: Math.round(rect.top * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  }).catch(() => undefined);
}

async function releaseNativePlayback(): Promise<void> {
  const listeners = nativeListeners.splice(0);
  await Promise.all(listeners.map(listener => listener.remove().catch(() => undefined)));
  await NativePlayback.release().catch(() => undefined);
  nativePlaybackActive.value = false;
  nativePosition.value = 0;
  nativeDuration.value = 0;
}

async function attachNativeListeners(): Promise<void> {
  const stateListener = await NativePlayback.addListener('state', (state: NativePlaybackState) => {
    nativePosition.value = Math.max(0, Number(state.position || 0));
    nativeDuration.value = Math.max(0, Number(state.duration || 0));
    currentTime.value = nativePosition.value;
    duration.value = nativeDuration.value || Number(plan.value?.duration || 0);
    isPlaying.value = Boolean(state.isPlaying);
    if (nativePosition.value > lastObservedTime + 0.15) {
      lastObservedTime = nativePosition.value;
      lastProgressAt = Date.now();
      recoveryAttempts = 0;
    }
    if (Number(state.width) > 0 && Number(state.height) > 0) {
      isPortraitVideo.value = Number(state.height) > Number(state.width);
      actualVideoQuality.value = Math.min(Number(state.width), Number(state.height));
    }
    void nextTick().then(() => {
      void syncNativeRect();
      measureDescription();
    });
  });
  const endedListener = await NativePlayback.addListener('ended', () => { void handleEnded(); });
  const errorListener = await NativePlayback.addListener('error', (event) => {
    error.value = event.message || '原生播放器无法读取此视频';
  });
  nativeListeners.push(stateListener, endedListener, errorListener);
}

async function mountNativeMedia(start = 0): Promise<void> {
  const directURL = plan.value?.directURL || (plan.value?.url ? appStore.api().resolve(plan.value.url) : '');
  if (!directURL) throw new Error('暂无直链播放地址');
  await releaseNativePlayback();
  nativePlaybackActive.value = true;
  await attachNativeListeners();
  await NativePlayback.open({
    url: directURL,
    mimeType: plan.value?.mime,
    headers: viewerHeadersFor(appStore.api().serverBase),
    start,
  });
  await nextTick();
  await syncNativeRect();
}

async function mountMedia(start = 0): Promise<void> {
  if (!video.value || !plan.value) throw new Error('暂无可用播放地址');
  if (isNativeDirectPlan(plan.value)) {
    await mountNativeMedia(start);
    return;
  }
  await releaseNativePlayback();
  hls?.destroy();
  hls = null;
  const mediaURL = plan.value.url || plan.value.directURL;
  if (!mediaURL) throw new Error(plan.value.reason || '暂无可用播放地址');
  const resolved = appStore.api().resolve(mediaURL);
  const currentVideo = video.value;
  // Keep credentials available for same-origin/proxy media requests. HLS.js
  // also receives the viewer context below because native API calls and the
  // WebView media stack do not share the CapacitorHttp request object.
  currentVideo.crossOrigin = 'use-credentials';
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('视频连接超时，请重试')), 30000);
    const cleanup = () => {
      window.clearTimeout(timer);
      currentVideo.removeEventListener('loadedmetadata', onReady);
      currentVideo.removeEventListener('error', onVideoError);
    };
    const finish = (cause?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cause) {
        hls?.destroy();
        hls = null;
        reject(cause);
      } else resolve();
    };
    const onReady = () => finish();
    const onVideoError = () => finish(new Error('浏览器无法读取此视频'));
    currentVideo.addEventListener('loadedmetadata', onReady, { once: true });
    currentVideo.addEventListener('error', onVideoError, { once: true });
    try {
      const isHlsMedia = plan.value?.player === 'hls'
        || plan.value?.mime?.includes('mpegurl')
        || /\.m3u8(?:$|[?#])/i.test(mediaURL);
      if (isHlsMedia && Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 180,
          maxBufferSize: 48 * 1024 * 1024,
          backBufferLength: 20,
          capLevelToPlayerSize: false,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 500,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          ...(Capacitor.isNativePlatform() ? { loader: CapacitorHlsLoader as any } : {}),
          xhrSetup: (xhr) => {
            xhr.withCredentials = true;
            for (const [key, value] of Object.entries(viewerHeadersFor(appStore.api().serverBase))) {
              xhr.setRequestHeader(key, value);
            }
          },
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            const detail = data.response?.code ? `（HTTP ${data.response.code}）` : '';
            finish(new Error(data.type === Hls.ErrorTypes.NETWORK_ERROR ? `视频连接失败${detail}` : `此媒体无法播放${detail}`));
          }
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(resolved));
        hls.attachMedia(currentVideo);
      } else {
        currentVideo.src = resolved;
        currentVideo.load();
      }
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error('无法初始化播放器'));
    }
  });
}

async function resolvePlan(start: number, mode: 'auto' | 'proxy'): Promise<PlaybackPlan> {
  // Try the normal negotiation first. If the backend exposes directURL, the
  // Android native plugin can play it without routing media segments through
  // the server. Proxy/HLS plans continue through the existing WebView path.
  let planError: unknown = null;
  try {
    const planned = await appStore.api().playbackPlan(session.value, episode.value, start, mode, selectedQuality.value);
    if (planned.url || planned.directURL) {
      return planned;
    }
  } catch (cause) {
    // A source resolver can fail with 502 while the server's compatibility
    // HLS route is still able to produce a playable local stream. Keep that
    // route as an explicit fallback instead of surfacing the first error.
    planError = cause;
  }
  // Legacy plans intentionally leave the media URL empty. The HLS session
  // endpoint remains the final compatibility fallback.
  try {
    const native = await appStore.api().playbackHlsOpen(session.value, episode.value, start, selectedQuality.value);
    native.player = 'hls';
    return native;
  } catch (fallbackError) {
    throw planError || fallbackError;
  }
}

function applyStartPosition(start: number): void {
  if (nativePlaybackActive.value) {
    if (start > 0) void NativePlayback.seek({ position: start });
    return;
  }
  if (!video.value || start <= 0) return;
  const duration = Number(video.value.duration || plan.value?.duration || 0);
  video.value.currentTime = duration > 0 ? Math.min(start, Math.max(0, duration - 0.05)) : start;
}

function syncVideoState(): void {
  if (nativePlaybackActive.value) return;
  const nextTime = Number(video.value?.currentTime || 0);
  if (nextTime > lastObservedTime + 0.15) {
    lastObservedTime = nextTime;
    lastProgressAt = Date.now();
    recoveryAttempts = 0;
  }
  currentTime.value = nextTime;
  duration.value = Number(video.value?.duration || plan.value?.duration || 0);
  if (nextTime > 0 && episode.value > 0 && !sessionWatchedEpisodes.value.has(episode.value)) {
    sessionWatchedEpisodes.value = new Set(sessionWatchedEpisodes.value).add(episode.value);
  }
}

function togglePlayback(): void {
  if (nativePlaybackActive.value) {
    void (isPlaying.value ? NativePlayback.pause() : NativePlayback.play());
    return;
  }
  if (!video.value) return;
  if (video.value.paused) {
    void playVideoFromGesture();
  }
  else video.value.pause();
}

async function playVideoFromGesture(): Promise<void> {
  if (nativePlaybackActive.value) {
    await NativePlayback.play().catch(() => { error.value = '视频暂时无法播放，请重试'; });
    return;
  }
  const media = video.value;
  if (!media) return;
  try {
    media.muted = false;
    await media.play();
    return;
  } catch {
    try {
      media.muted = true;
      await media.play();
      return;
    } catch {
      error.value = media.error ? `视频无法播放（错误 ${media.error.code}）` : '视频暂时无法播放，请重试';
    }
  }
}

function handleVideoMetadata(): void {
  syncVideoState();
  const media = video.value;
  isPortraitVideo.value = Boolean(media && media.videoHeight > media.videoWidth);
  if (media && media.videoWidth > 0 && media.videoHeight > 0) {
    // Quality values in the backend represent the shorter video edge, so a
    // portrait 1080x1920 stream is still reported as 1080p.
    actualVideoQuality.value = Math.min(media.videoWidth, media.videoHeight);
  }
  void nextTick().then(measureDescription);
}

function measureDescription(): void {
  const element = descriptionBox.value;
  if (!element) return;
  descriptionOverflow.value = element.scrollHeight > element.clientHeight + 1;
}

function toggleDescription(): void {
  descriptionOverlayOpen.value = !descriptionOverlayOpen.value;
}

function setPlaybackSpeed(value: number): void {
  speed.value = value;
  if (!fastForwarding.value) {
    if (nativePlaybackActive.value) void NativePlayback.setRate({ rate: value });
    else if (video.value) video.value.playbackRate = value;
  }
  showSpeedMenu.value = false;
}

function toggleSpeedMenu(): void {
  showSpeedMenu.value = !showSpeedMenu.value;
  showMenu.value = false;
}

function toggleSettingsMenu(): void {
  showMenu.value = !showMenu.value;
  showSpeedMenu.value = false;
}

async function autoplayVideo(): Promise<void> {
  if (nativePlaybackActive.value) {
    await NativePlayback.play().catch(() => { error.value = '视频暂时无法播放，请重试'; });
    return;
  }
  if (!video.value) return;
  video.value.playbackRate = speed.value;
  try {
    await video.value.play();
  } catch {
    // Mobile browsers may block audible autoplay. Muted autoplay is still
    // useful here, and the native video control can restore audio on tap.
    try {
      video.value.muted = true;
      await video.value.play();
    } catch { /* user gesture is still required by this browser */ }
  }
}

function startFastForward(event: PointerEvent): void {
  event.preventDefault();
  fastForwarding.value = true;
  if (nativePlaybackActive.value) void NativePlayback.setRate({ rate: 2 });
  else if (video.value) video.value.playbackRate = 2;
}

function stopFastForward(): void {
  if (!fastForwarding.value) return;
  fastForwarding.value = false;
  if (nativePlaybackActive.value) void NativePlayback.setRate({ rate: speed.value });
  else if (video.value) video.value.playbackRate = speed.value;
}

async function toggleFullscreen(): Promise<void> {
  const media = video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  const root = playerRoot.value;
  if (isFullscreen.value || document.fullscreenElement) {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    isFullscreen.value = false;
    immersiveFullscreen.value = false;
    void unlockOrientation();
    void StatusBar.show().catch(() => undefined);
    return;
  }

  // Mark the in-app fullscreen state before calling browser APIs. Android
  // WebView may resolve requestFullscreen without resizing its surface; the
  // CSS fallback must still hide the metadata dock and make the video occupy
  // the complete app window.
  isFullscreen.value = true;
  immersiveFullscreen.value = true;
  // Apply CSS fullscreen before native calls so Android WebView controls do
  // not appear unresponsive while orientation/status-bar promises settle.
  await nextTick();
  void StatusBar.hide().catch(() => undefined);
  void lockLandscapeIfSupported();
  try {
    if (root?.requestFullscreen) {
      await Promise.race([
        root.requestFullscreen(),
        new Promise<void>(resolve => window.setTimeout(resolve, 700)),
      ]);
      if (document.fullscreenElement) immersiveFullscreen.value = false;
    } else if (media?.webkitEnterFullscreen) {
      media.webkitEnterFullscreen();
      immersiveFullscreen.value = !document.fullscreenElement;
    }
  } catch {
    // Keep the in-app immersive fallback active when WebView rejects the
    // browser fullscreen request.
  }
}

async function togglePip(): Promise<void> {
  if (!video.value || !('requestPictureInPicture' in video.value)) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.value.requestPictureInPicture();
  } catch { /* PiP is optional on some mobile browsers */ }
  showMenu.value = false;
}

function seek(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) {
    if (nativePlaybackActive.value) void NativePlayback.seek({ position: value });
    else if (video.value) video.value.currentTime = value;
  }
  if (!nativePlaybackActive.value) syncVideoState();
}

async function handleEnded(): Promise<void> {
  if (changingEpisode) return;
  await sendProgress(true, true);
  const total = Math.max(episodes.value.length, Number(props.drama.totalEpisode || 0));
  const next = episodes.value.find(item => item.index > episode.value)?.index || episode.value + 1;
  if (!total || next > total) return;
  changingEpisode = true;
  try {
    episode.value = next;
    currentTime.value = 0;
    duration.value = 0;
    lastObservedTime = 0;
    lastProgressAt = Date.now();
    recoveryAttempts = 0;
    await loadEpisode(0);
  } finally {
    changingEpisode = false;
  }
}

function episodeIndexes(): number[] {
  const values = episodes.value.map(item => Number(item.index)).filter(value => Number.isFinite(value) && value > 0);
  if (values.length) return [...new Set(values)].sort((left, right) => left - right);
  const total = Number(props.drama.totalEpisode || 0);
  return total > 0 ? Array.from({ length: Math.min(total, 120) }, (_, index) => index + 1) : [];
}

function changeEpisodeBySwipe(direction: 'next' | 'previous'): void {
  if (changingEpisode || loading.value || !session.value) return;
  const indexes = episodeIndexes();
  if (!indexes.length) return;
  const currentIndex = indexes.indexOf(episode.value);
  const position = currentIndex >= 0 ? currentIndex : indexes.findIndex(index => index > episode.value);
  const target = direction === 'next'
    ? indexes[position >= 0 ? position + 1 : 0]
    : indexes[position > 0 ? position - 1 : 0];
  if (!target || target === episode.value) return;
  changingEpisode = true;
  showEpisodes.value = false;
  showMenu.value = false;
  showSpeedMenu.value = false;
  episode.value = target;
  currentTime.value = 0;
  duration.value = 0;
  lastObservedTime = 0;
  lastProgressAt = Date.now();
  recoveryAttempts = 0;
  void loadEpisode(0).finally(() => { changingEpisode = false; });
}

function selectEpisode(index: number): void {
  if (changingEpisode || index === episode.value) return;
  changingEpisode = true;
  episode.value = index;
  showEpisodes.value = false;
  void loadEpisode(0).finally(() => { changingEpisode = false; });
}

function stageTouchStart(event: TouchEvent): void {
  const touch = event.changedTouches[0];
  if (!touch || loading.value || (event.target instanceof Element && event.target.closest('.player-fast-forward-zone'))) {
    stageTouchIgnored = true;
    return;
  }
  stageTouchIgnored = false;
  stageTouchStartX = touch.clientX;
  stageTouchStartY = touch.clientY;
  stageTouchStartedAt = Date.now();
}

function stageTouchEnd(event: TouchEvent): void {
  if (stageTouchIgnored) return;
  const touch = event.changedTouches[0];
  if (!touch || !stageTouchStartedAt) return;
  const deltaX = touch.clientX - stageTouchStartX;
  const deltaY = touch.clientY - stageTouchStartY;
  const elapsed = Date.now() - stageTouchStartedAt;
  stageTouchStartedAt = 0;
  if (elapsed > 900 || Math.abs(deltaY) < 56 || Math.abs(deltaY) <= Math.abs(deltaX) * 1.2) return;
  if (event.cancelable) event.preventDefault();
  changeEpisodeBySwipe(deltaY < 0 ? 'next' : 'previous');
}

function stageTouchCancel(): void {
  stageTouchStartedAt = 0;
  stageTouchIgnored = false;
}

async function changeQuality(value: string): Promise<void> {
  const next = Number(value);
  if (!Number.isFinite(next) || next === selectedQuality.value) return;
  const wasPlaying = nativePlaybackActive.value ? isPlaying.value : Boolean(video.value && !video.value.paused);
  const position = nativePlaybackActive.value ? nativePosition.value : Number(video.value?.currentTime || 0);
  selectedQuality.value = next;
  showMenu.value = false;
  await loadEpisode(position);
  if (wasPlaying) void playVideoFromGesture();
}

function fullscreenChanged(): void {
  if (document.fullscreenElement) {
    isFullscreen.value = true;
    immersiveFullscreen.value = false;
  } else if (!immersiveFullscreen.value) {
    isFullscreen.value = false;
  }
}

function pipChanged(): void {
  isPip.value = Boolean(document.pictureInPictureElement);
}

async function loadEpisode(start = 0) {
  if (!session.value) return;
  loading.value = true;
  error.value = '';
  isPortraitVideo.value = false;
  actualVideoQuality.value = 0;
  try {
    planMode = 'auto';
    plan.value = await resolvePlan(start, planMode);
    actualQuality.value = Number(plan.value.quality || 0);
    if (plan.value.qualities?.length && !plan.value.qualities.some(item => Number(item.value) === selectedQuality.value)) selectedQuality.value = 0;
    run = Number(plan.value.run || 0);
    await nextTick();
    try {
      await mountMedia(start);
      applyStartPosition(start);
      await autoplayVideo();
      await nextTick();
      measureDescription();
    } catch (firstError) {
      // A direct upstream URL may be unreachable from the phone. Ask the backend
      // for its same-origin proxy plan before giving up on the episode.
      planMode = 'proxy';
      plan.value = await resolvePlan(start, planMode);
      actualQuality.value = Number(plan.value.quality || 0);
      if (plan.value.qualities?.length && !plan.value.qualities.some(item => Number(item.value) === selectedQuality.value)) selectedQuality.value = 0;
      run = Number(plan.value.run || 0);
      await nextTick();
      try {
        await mountMedia(start);
        applyStartPosition(start);
        await autoplayVideo();
        await nextTick();
        measureDescription();
      } catch {
        // Keep the original failure when the proxy cannot produce a playable URL.
        throw firstError;
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '暂时无法获取播放地址';
  } finally {
    loading.value = false;
  }
}

async function sendProgress(completed = false, force = false): Promise<void> {
  if (!session.value || (!video.value && !nativePlaybackActive.value) || !run) return;
  const now = Date.now();
  // `timeupdate` can fire several times per second. The backend only needs a
  // durable checkpoint, so keep normal updates at the same cadence as the
  // background timer while allowing episode-end/close to flush immediately.
  if (!force && !completed && now - lastProgressSentAt < 9000) {
    if (progressInFlight) await progressInFlight;
    return;
  }
  if (progressInFlight) await progressInFlight;
  const duration = nativePlaybackActive.value
    ? Number(nativeDuration.value || plan.value?.duration || 0)
    : Number(video.value?.duration || plan.value?.duration || 0);
  const position = nativePlaybackActive.value
    ? Number(nativePosition.value || 0)
    : Number(video.value?.currentTime || 0);
  if (position > 0 && episode.value > 0 && !sessionWatchedEpisodes.value.has(episode.value)) {
    sessionWatchedEpisodes.value = new Set(sessionWatchedEpisodes.value).add(episode.value);
  }
  sequence += 1;
  lastProgressSentAt = now;
  const request = appStore.api().playbackProgress(session.value, { run, sequence, episode: episode.value, position, duration, completed }).catch(() => undefined);
  progressInFlight = request;
  try { await request; } finally {
    if (progressInFlight === request) progressInFlight = null;
  }
}

function startProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => sendProgress(), 10000);
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = setInterval(() => { void recoverStalledPlayback(); }, 5000);
}

async function recoverStalledPlayback(): Promise<void> {
  const media = video.value;
  if (!session.value || loading.value || recoveryInFlight || changingEpisode || !isPlaying.value) return;
  if (!nativePlaybackActive.value && !media) return;
  if (Date.now() - lastProgressAt < 20_000 || recoveryAttempts >= 3) return;
  recoveryInFlight = true;
  recoveryAttempts += 1;
  const position = nativePlaybackActive.value ? nativePosition.value : Number(media?.currentTime || 0);
  try {
    await loadEpisode(position);
    if (!error.value) {
      await playVideoFromGesture();
      lastProgressAt = Date.now();
    }
  } finally {
    recoveryInFlight = false;
  }
}

async function openPlayback() {
  try {
    const opened = await appStore.api().playbackOpen(props.drama.id) as PlaybackOpen;
    session.value = opened.session;
    const requestedEpisode = Number(props.initialEpisode || 0);
    episode.value = requestedEpisode > 0 ? requestedEpisode : (opened.initialIndex || 1);
    resumePosition = requestedEpisode > 0 ? 0 : Number(opened.initialPosition || 0);
    playbackReleaseStatus.value = String(opened.releaseStatus || '').trim();
    episodes.value = (opened.episodes || []).map(item => ({ index: item.index || item.number || 1, title: item.title || item.episode, total: item.total }));
    await loadEpisode(resumePosition);
    startProgress();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录后才能同步播放记录';
    loading.value = false;
  }
}

onMounted(() => {
  appStore.setPlaybackActive(true);
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('enterpictureinpicture', pipChanged);
  document.addEventListener('leavepictureinpicture', pipChanged);
  nativeResizeObserver = new ResizeObserver(() => { void syncNativeRect(); });
  if (playerRoot.value) nativeResizeObserver.observe(playerRoot.value);
  lastProgressAt = Date.now();
  void openPlayback();
});

watch(description, () => {
  descriptionOverlayOpen.value = false;
  void nextTick().then(measureDescription);
});
async function persistPlayback() {
  if (!session.value) return;
  await sendProgress(false, true);
  await appStore.api().playbackControl(session.value, 'close', {
    run,
    sequence: sequence + 1,
    episode: episode.value,
    position: nativePlaybackActive.value ? nativePosition.value : (video.value?.currentTime || 0),
    duration: nativePlaybackActive.value ? (nativeDuration.value || plan.value?.duration || 0) : (video.value?.duration || plan.value?.duration || 0),
    completed: false,
  }).catch(() => undefined);
  try { await appStore.loadHistory(); } catch { /* history refresh is best effort */ }
}

onBeforeUnmount(() => {
  appStore.setPlaybackActive(false);
  if (progressTimer) clearInterval(progressTimer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  document.removeEventListener('fullscreenchange', fullscreenChanged);
  document.removeEventListener('enterpictureinpicture', pipChanged);
  document.removeEventListener('leavepictureinpicture', pipChanged);
  nativeResizeObserver?.disconnect();
  nativeResizeObserver = null;
  void persistPlayback();
  void unlockOrientation();
  void StatusBar.show().catch(() => undefined);
  hls?.destroy();
  void releaseNativePlayback();
});
</script>

<template>
  <div ref="playerRoot" class="sheet-backdrop player-backdrop" :class="{ 'player-root-fullscreen': isFullscreen }" @click.self="emit('close')">
    <section class="sheet player-sheet" :class="{ 'portrait-video': isPortraitVideo, 'landscape-video': !isPortraitVideo }" aria-label="播放页面">
      <header class="player-top">
        <button class="player-icon-button" type="button" aria-label="返回" @click="emit('close')">‹</button>
        <div class="player-heading">
          <strong>第{{ episode }}集</strong>
        </div>
        <div class="player-top-actions">
          <button class="player-speed-button" type="button" @click="toggleSpeedMenu"><span aria-hidden="true">◷</span>{{ fastForwarding ? '2.0x' : `${speed.toFixed(1)}x` }}</button>
          <button class="player-icon-button" type="button" aria-label="更多播放设置" @click="toggleSettingsMenu">⋮</button>
        </div>
      </header>

      <div class="player-video-shell">
        <div class="video-stage" @touchstart="stageTouchStart" @touchend="stageTouchEnd" @touchcancel="stageTouchCancel">
          <video v-if="plan?.url || plan?.directURL" ref="video" playsinline :poster="appStore.api().resolve(props.drama.cover || props.drama.coverUrl || '/design-review/assets/poster-5.jpg')" @click="togglePlayback" @play="isPlaying = true" @pause="isPlaying = false" @timeupdate="syncVideoState" @loadedmetadata="handleVideoMetadata" @durationchange="syncVideoState" @ended="handleEnded"></video>
          <div v-else class="video-placeholder"><span>{{ loading ? '正在获取播放地址…' : error || '暂无可用播放地址' }}</span></div>
          <button v-if="!loading && video && !isPlaying" class="player-play-overlay" type="button" aria-label="播放" @click="togglePlayback">▶</button>
          <div class="player-fast-forward-zone" role="button" aria-label="按住右侧 2 倍速播放" @pointerdown="startFastForward" @pointerup="stopFastForward" @pointercancel="stopFastForward" @pointerleave="stopFastForward">
            <span v-if="fastForwarding">2.0x</span>
          </div>
          <div v-if="loading" class="player-loading"><span></span>正在准备播放</div>
        </div>
      </div>

      <div class="player-info-dock">
        <div class="player-info-copy">
          <h1 class="player-title">{{ title }}</h1>
          <div class="player-tag-row">
            <span v-for="tag in tagChips" :key="tag" class="player-tag">{{ tag }}</span>
            <span v-if="sourceLabel" class="player-source-label">{{ sourceLabel }}</span>
          </div>
          <div v-if="description" class="player-description-wrap">
            <div ref="descriptionBox" class="player-description" aria-label="剧集简介">
              <span>{{ description }}</span>
              <button v-if="descriptionOverflow" class="player-description-more" type="button" @click="toggleDescription">显示更多</button>
            </div>
            <div v-if="descriptionOverlayOpen" class="player-description-popover" role="dialog" aria-label="完整剧集简介">
              <p>{{ description }}</p>
              <button type="button" @click="toggleDescription">收起</button>
            </div>
          </div>
        </div>

        <div class="player-bottom-bar">
          <div class="player-overlay-meta">
            <span>{{ sourceLabel || '正在播放' }}</span>
            <span>{{ episodes.length ? `共 ${episodes.length} 集` : `第 ${episode} 集` }}</span>
            <span>{{ activeQualityLabel }}</span>
            <span>{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
          </div>
          <div class="player-seek-row">
            <span>{{ formatTime(currentTime) }}</span>
            <input class="player-seeker" type="range" min="0" :max="Math.max(duration, 0)" step="0.1" :value="currentTime" aria-label="播放进度" @input="seek">
            <span>{{ formatTime(duration) }}</span>
          </div>
          <div class="player-bottom-actions">
            <button class="episode-collapse-button" type="button" @click="showEpisodes = !showEpisodes">选集 <span class="episode-summary">{{ playbackStatusLabel }} · {{ totalEpisodeLabel }}</span><span class="episode-chevron" :class="{ expanded: showEpisodes }" aria-hidden="true"></span></button>
            <button class="player-tool-button" type="button" aria-label="全屏播放" @click="toggleFullscreen"><span class="fullscreen-glyph" :class="{ exit: isFullscreen }" aria-hidden="true"></span></button>
          </div>
        </div>
      </div>

      <div v-if="showEpisodes" class="player-episode-drawer">
        <div class="player-drawer-head"><strong>全部剧集</strong><button type="button" @click="showEpisodes = false">收起</button></div>
        <div class="player-list">
          <button v-for="item in playbackEpisodeList" :key="item.index" :class="{ active: item.index === episode, watched: isEpisodeWatched(item.index) }" :aria-label="isEpisodeWatched(item.index) ? `第${item.index}集，已观看` : `第${item.index}集`" type="button" @click="selectEpisode(item.index)"><span>{{ item.index }}</span><i v-if="isEpisodeWatched(item.index)" aria-hidden="true"></i></button>
        </div>
      </div>

      <div v-if="showMenu" class="player-settings-menu">
        <div class="player-menu-head"><strong>播放设置</strong><button type="button" @click="showMenu = false">×</button></div>
        <label>清晰度 / 分辨率<select :value="selectedQuality" @change="changeQuality(($event.target as HTMLSelectElement).value)"><option v-for="option in qualityOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <button type="button" @click="togglePip">{{ isPip ? '退出画中画' : '画中画' }}</button>
        <button type="button" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏播放' }}</button>
      </div>

      <div v-if="showSpeedMenu" class="player-speed-menu">
        <strong>播放速度</strong>
        <button v-for="value in [0.5, 1, 1.25, 1.5, 2]" :key="value" type="button" :class="{ active: speed === value }" @click="setPlaybackSpeed(value)">{{ value.toFixed(2) }}x</button>
      </div>

      <div v-if="error" class="error-text player-error">{{ error }}</div>
    </section>
  </div>
</template>
