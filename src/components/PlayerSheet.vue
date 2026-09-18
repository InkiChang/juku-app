<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
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

async function loadEpisode() {
  if (!session.value) return;
  loading.value = true;
  error.value = '';
  try { plan.value = await appStore.api().playbackPlan(session.value, episode.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '暂时无法获取播放地址'; }
  finally { loading.value = false; }
}
async function openPlayback() {
  try {
    const opened = await appStore.api().playbackOpen(props.drama.id) as PlaybackOpen;
    session.value = opened.session;
    episode.value = opened.initialIndex || 1;
    episodes.value = opened.episodes || [];
    await loadEpisode();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录后才能同步播放记录'; loading.value = false; }
}
onMounted(openPlayback);
onBeforeUnmount(() => { if (session.value && video.value) appStore.api().playbackControl(session.value, 'pause', { position: video.value.currentTime }).catch(() => undefined); });
</script>

<template>
  <div class="sheet-backdrop player-backdrop" @click.self="emit('close')"><section class="sheet player-sheet"><div class="player-top"><button class="close-button" type="button" aria-label="返回" @click="emit('close')">‹</button><strong>{{ title }} · 第 {{ episode }} 集</strong><button class="close-button" type="button" aria-label="关闭" @click="emit('close')">×</button></div><div class="video-stage"><video v-if="plan?.url || plan?.directURL" ref="video" :src="plan.url || plan.directURL" controls playsinline :poster="appStore.api().resolve(props.drama.cover || props.drama.coverUrl || '/design-review/assets/poster-5.jpg')"></video><div v-else class="video-placeholder"><span>{{ loading ? '正在获取播放地址…' : error || '暂无可用播放地址' }}</span></div></div><div class="player-controls"><div class="timeline"><i style="width: 38%"></i></div><div class="player-row"><span>手机优先硬件解码</span><span>自动下一集 · 1.0×</span></div><div v-if="error" class="error-text">{{ error }}</div></div><div class="player-list"><button v-for="item in (episodes.length ? episodes : Array.from({ length: Math.min(Number(props.drama.totalEpisode || 12), 24) }, (_, index) => ({ index: index + 1 })))" :key="item.index" :class="{ active: item.index === episode }" type="button" @click="episode = item.index; loadEpisode()">{{ item.index }}</button></div></section></div>
</template>
