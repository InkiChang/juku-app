<script setup lang="ts">
import { computed, ref } from 'vue';
import { appStore, sameDrama } from '../stores/app';
import type { Drama } from '../types/api';
import { categoryName, episodeCount, episodeLabel, releaseStatusLabel, sourceLabel } from '../utils/drama';
import { watchedEpisodeSet } from '../utils/history';

const props = defineProps<{ drama: Drama }>();
const emit = defineEmits<{ close: []; play: [drama: Drama, episode?: number] }>();
const title = computed(() => props.drama.title || props.drama.name || '未命名短剧');
const cover = computed(() => {
  const source = props.drama.cover || props.drama.coverUrl || props.drama.cover_url || props.drama.image || props.drama.imageUrl || props.drama.image_url || props.drama.img || props.drama.pic || props.drama.picture || props.drama.poster || props.drama.thumb || props.drama.thumbnail || '/design-review/assets/poster-5.jpg';
  return appStore.api().resolve(source);
});
const episodes = computed(() => Math.min(Number(episodeCount(props.drama).replace(/\D/g, '') || 20), 60));
const watchedEpisodes = computed(() => watchedEpisodeSet(appStore.state.history, props.drama));
function isEpisodeWatched(index: number): boolean {
  return watchedEpisodes.value.has(index);
}
const source = computed(() => sourceLabel(props.drama));
const category = computed(() => categoryName(props.drama));
const status = computed(() => releaseStatusLabel(props.drama));
const onlineDate = computed(() => props.drama.onlineDate || '未知');
const heat = computed(() => formatMetric(props.drama.heat));
const views = computed(() => formatViews(props.drama.views));
const score = computed(() => props.drama.score === undefined || props.drama.score === null || String(props.drama.score).trim() === '' ? '暂无' : String(props.drama.score));
const qualityOptions = [
  { value: 0, label: '最高可用' },
  { value: 2160, label: '2160p 优先' },
  { value: 1440, label: '1440p 优先' },
  { value: 1080, label: '1080p 优先' },
  { value: 720, label: '720p 优先' },
  { value: 540, label: '540p 优先' },
  { value: 480, label: '480p 优先' },
  { value: 360, label: '360p 优先' },
];
const selectedQuality = ref([0, 2160, 1440, 1080, 720, 540, 480, 360].includes(Number(localStorage.getItem('juku.app.downloadQuality'))) ? Number(localStorage.getItem('juku.app.downloadQuality')) : 0);
const downloadSaving = ref(false);
const historyEntry = computed(() => {
  const dramaId = props.drama.id;
  const sourceId = props.drama.sourceId;
  const dramaTitle = String(props.drama.title || props.drama.name || '').trim();
  return [...appStore.state.history]
    .filter(item => {
      const itemId = item.dramaId || item.drama?.id || item.drama?.sourceId;
      const itemTitle = String(item.title || item.drama?.title || item.drama?.name || '').trim();
      return (Boolean(itemId) && (itemId === dramaId || itemId === sourceId)) || (Boolean(dramaTitle) && Boolean(itemTitle) && itemTitle === dramaTitle);
    })
    .sort((left, right) => String(right.updatedAt || right.watchedAt || '').localeCompare(String(left.updatedAt || left.watchedAt || '')))[0];
});
const watchSummary = computed(() => {
  const item = historyEntry.value;
  if (!item) return '开始观看';
  const numberValue = (value: unknown, fallback: number) => {
    const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
    const parsed = match ? Number(match[0]) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const episode = numberValue(item.episodeIndex || item.index || item.episode, 1);
  const position = numberValue(item.position, 0);
  const episodeText = `继续观看 · 第 ${episode > 0 ? episode : 1} 集`;
  return position > 0 ? `${episodeText} · 第 ${Math.floor(position / 60)} 分钟` : episodeText;
});
function formatMetric(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '暂无';
}
function formatViews(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '暂无';
  return /播放/.test(text) ? text : `${text}次播放`;
}
const following = ref(false);
const followSaving = ref(false);
const followMessage = ref('');
const followingKey = computed(() => props.drama.id || props.drama.sourceId || '');
const isFollowing = computed(() => {
  const key = followingKey.value;
  if (!key) return following.value;
  return appStore.state.following.some(item => {
    return sameDrama(item, props.drama) && item.saved !== false;
  });
});
async function toggleFollowing() {
  followSaving.value = true;
  followMessage.value = '';
  const nextSaved = !isFollowing.value;
  try {
    await appStore.updateFollowing(props.drama.id, { saved: nextSaved, completed: false });
    following.value = nextSaved;
    followMessage.value = following.value ? '已加入追剧' : '已取消追剧';
    await appStore.loadHome();
  } catch (cause) {
    followMessage.value = cause instanceof Error ? cause.message : '追剧操作失败';
  } finally { followSaving.value = false; }
}
async function markWatched() {
  followSaving.value = true;
  followMessage.value = '';
  try {
    await appStore.updateFollowing(props.drama.id, { saved: true, completed: true, acknowledge: true });
    followMessage.value = '已标记为已看';
    await appStore.loadHome();
  } catch (cause) {
    followMessage.value = cause instanceof Error ? cause.message : '标记操作失败';
  } finally { followSaving.value = false; }
}
async function enqueueDownload() {
  downloadSaving.value = true;
  followMessage.value = '';
  try {
    localStorage.setItem('juku.app.downloadQuality', String(selectedQuality.value));
    await appStore.api().enqueueDownload([props.drama.id], selectedQuality.value);
    followMessage.value = '已加入下载队列';
  } catch (cause) {
    followMessage.value = cause instanceof Error ? cause.message : '加入下载失败';
  } finally {
    downloadSaving.value = false;
  }
}
function changeQuality(value: string) {
  selectedQuality.value = Number(value) || 0;
  localStorage.setItem('juku.app.downloadQuality', String(selectedQuality.value));
}
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')"><section class="sheet detail-sheet"><div class="sheet-title"><h2>剧集详情</h2><button class="close-button" type="button" aria-label="关闭" @click="emit('close')">×</button></div><div class="detail-hero"><button class="detail-cover-button" type="button" aria-label="播放该剧" @click="emit('play', drama)"><img :src="cover" :alt="title" @error="onImageError"><span class="detail-cover-play">▶</span></button><div class="detail-hero-copy"><h3>{{ title }}</h3><p class="detail-source-line">{{ source }} · {{ category }}</p><div class="chips"><span v-for="tag in (drama.tags || [drama.categoryName || drama.category || '热门'])" :key="tag" class="chip">{{ tag }}</span></div></div></div><button class="detail-primary-action" type="button" @click="emit('play', drama)">▷&nbsp; {{ watchSummary }}</button><div class="detail-tool-row"><label class="detail-quality-label" for="detail-download-quality">下载画质</label><select id="detail-download-quality" class="detail-quality" :value="selectedQuality" aria-label="下载画质" @change="changeQuality(($event.target as HTMLSelectElement).value)"><option v-for="option in qualityOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select><button class="detail-tool-button" type="button" :disabled="followSaving" @click="toggleFollowing">{{ isFollowing ? '取消想看' : '加入想看' }}</button><button class="detail-tool-button" type="button" :disabled="downloadSaving" @click="enqueueDownload">{{ downloadSaving ? '加入中…' : '加入下载' }}</button><button class="detail-tool-button" type="button" :disabled="followSaving" @click="markWatched">标为已看</button></div><p class="detail-description">{{ drama.desc || drama.intro || '暂无剧情简介。' }}</p><div class="detail-stats"><div><span>集数</span><strong>{{ episodeLabel(drama) }}</strong></div><div><span>状态</span><strong>{{ status }}</strong></div><div><span>上线时间</span><strong>{{ onlineDate }}</strong></div><div><span>站点热度</span><strong>{{ heat }}</strong></div><div><span>播放量</span><strong>{{ views }}</strong></div><div><span>站点评分</span><strong>{{ score }}</strong></div></div><p v-if="followMessage" class="muted">{{ followMessage }}</p><p class="detail-footnote">手动标记用于整理清单，实际播放进度仍自动保存。</p><div class="section-head detail-episodes-head"><h3>选集</h3><span>从第 1 集开始</span></div><div class="episodes"><button v-for="episode in episodes" :key="episode" class="episode" type="button" :class="{ active: episode === 1, watched: isEpisodeWatched(episode) }" :aria-label="isEpisodeWatched(episode) ? `第${episode}集，已观看` : `第${episode}集`" @click="emit('play', drama, episode)"><span>{{ episode }}</span><i v-if="isEpisodeWatched(episode)" aria-hidden="true"></i></button></div></section></div>
</template>
