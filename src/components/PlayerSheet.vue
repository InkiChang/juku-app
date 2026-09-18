<script setup lang="ts">
import Hls from 'hls.js';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama, PlaybackOpen, PlaybackPlan } from '../types/api';

const props = defineProps<{ drama: Drama }>();
const emit = defineEmits<{ close: [] }>();
const title = props.drama.title || props.drama.name || '未命名短剧';
const session = ref('');
const episode = ref(1);
const loading = ref(true);
const error = ref('');
const plan = ref<PlaybackPlan | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const episodes = ref<Array<{ index: number; title?: string }>>([]);
let hls: Hls | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let run = 0;
let resumePosition = 0;

async function mountMedia() {
  if (!video.value || !plan.value) return;
  hls?.destroy();
  hls = null;
  const mediaURL = plan.value.url || plan.value.directURL;
  if (!mediaURL) return;
  const resolved = appStore.api().resolve(mediaURL);
  if (plan.value.player === 'hls' && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.loadSource(resolved);
    hls.attachMedia(video.value);
  } else {
    video.value.src = resolved;
    video.value.load();
  }
}

async function loadEpisode(start = 0) {
  if (!session.value) return;
  loading.value = true;
  error.value = '';
  try {
    try {
      plan.value = await appStore.api().playbackHlsOpen(session.value, episode.value, start);
      plan.value.player = 'hls';
    } catch {
      plan.value = await appStore.api().playbackPlan(session.value, episode.value, start);
    }
    run = Number(plan.value.run || 0);
    await nextTick();
    await mountMedia();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '暂时无法获取播放地址';
  } finally {
    loading.value = false;
  }
}

function sendProgress(completed = false) {
  if (!session.value || !video.value || !run) return;
  const duration = Number(video.value.duration || plan.value?.duration || 0);
  const position = Number(video.value.currentTime || 0);
  sequence += 1;
  appStore.api().playbackProgress(session.value, { run, sequence, episode: episode.value, position, duration, completed }).catch(() => undefined);
}

function startProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => sendProgress(), 10000);
}

async function openPlayback() {
  try {
    const opened = await appStore.api().playbackOpen(props.drama.id) as PlaybackOpen;
    session.value = opened.session;
    episode.value = opened.initialIndex || 1;
    resumePosition = Number(opened.initialPosition || 0);
    episodes.value = (opened.episodes || []).map(item => ({ index: item.index || item.number || 1, title: item.title || item.episode }));
    await loadEpisode(resumePosition);
    startProgress();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录后才能同步播放记录';
    loading.value = false;
  }
}

onMounted(openPlayback);
onBeforeUnmount(() => {
  if (progressTimer) clearInterval(progressTimer);
  sendProgress();
  hls?.destroy();
  if (session.value) appStore.api().playbackControl(session.value, 'close', { run, sequence: sequence + 1, episode: episode.value, position: video.value?.currentTime || 0, duration: video.value?.duration || plan.value?.duration || 0, completed: false }).catch(() => undefined);
});
</script>

<template>
  <div class="sheet-backdrop player-backdrop" @click.self="emit('close')"><section class="sheet player-sheet"><div class="player-top"><button class="close-button" type="button" aria-label="返回" @click="emit('close')">‹</button><strong>{{ title }} · 第 {{ episode }} 集</strong><button class="close-button" type="button" aria-label="关闭" @click="emit('close')">×</button></div><div class="video-stage"><video v-if="plan?.url || plan?.directURL" ref="video" controls playsinline :poster="appStore.api().resolve(props.drama.cover || props.drama.coverUrl || '/design-review/assets/poster-5.jpg')" @timeupdate="() => sendProgress()" @ended="() => sendProgress(true)"></video><div v-else class="video-placeholder"><span>{{ loading ? '正在获取播放地址…' : error || '暂无可用播放地址' }}</span></div></div><div class="player-controls"><div class="timeline"><i :style="{ width: `${video?.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0}%` }"></i></div><div class="player-row"><span>手机优先硬件解码</span><span>{{ plan?.player === 'hls' ? 'HLS 流媒体' : '原始媒体' }} · 自动下一集</span></div><div v-if="error" class="error-text">{{ error }}</div></div><div class="player-list"><button v-for="item in (episodes.length ? episodes : Array.from({ length: Math.min(Number(props.drama.totalEpisode || 12), 24) }, (_, index) => ({ index: index + 1 })))" :key="item.index" :class="{ active: item.index === episode }" type="button" @click="episode = item.index; loadEpisode(0)">{{ item.index }}</button></div></section></div>
</template>
