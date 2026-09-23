<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { PlaybackHistoryItem } from '../types/api';
import { sourceLabel } from '../utils/drama';

const emit = defineEmits<{ back: [] }>();
const loading = ref(false);
const error = ref('');
const records = computed(() => [...appStore.state.history].sort((a, b) => time(b) - time(a)));

function time(item: PlaybackHistoryItem): number {
  return Date.parse(String(item.watchedAt || item.updatedAt || '')) || 0;
}
function clock(value: unknown): string {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function progress(item: PlaybackHistoryItem): string {
  if (String(item.taskId || '').startsWith('merged:')) return item.completed ? '全集已看完' : `全集看到 ${clock(item.position)}`;
  const episode = String(item.index || item.episodeIndex || item.episode || 1).replace(/^第/, '').replace(/集$/, '');
  if (item.completed) return Number(item.total) > 0 && Number(item.index) >= Number(item.total) ? '已看至最新' : `第${episode}集已看完`;
  return `看到第${episode}集 ${clock(item.position)}`;
}
function watchedTime(value: unknown): string {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  if (elapsed < 60000) return '刚刚';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}分钟前`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date >= yesterday) return `${date >= today ? '今天' : '昨天'} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  return date.toLocaleDateString('zh-CN', { year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'numeric', day: 'numeric' });
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try { await appStore.loadHistory(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '观看记录同步失败'; }
  finally { loading.value = false; }
}
function handlePullRefresh() { void refresh(); }
onMounted(() => { void refresh(); window.addEventListener('juku:pull-refresh', handlePullRefresh); });
onBeforeUnmount(() => window.removeEventListener('juku:pull-refresh', handlePullRefresh));
</script>

<template>
  <section class="screen-view history-page">
    <header class="detail-page-head history-page-head">
      <button class="icon-button" type="button" aria-label="返回我的" @click="emit('back')">‹</button>
      <div><span class="eyebrow">HISTORY</span><h1>观看记录</h1><p>{{ loading ? '正在同步观看记录…' : `${records.length} 部 · 按最近观看排序` }}</p></div>
    </header>
    <p v-if="error" class="error-text" role="alert">{{ error }} <button class="text-button" type="button" @click="refresh">重试</button></p>
    <div v-if="records.length" class="history-list">
      <article v-for="item in records" :key="item.dramaId || item.title" class="history-row">
        <strong>{{ item.drama?.title || item.drama?.name || item.title || item.dramaId || '未命名短剧' }}</strong>
        <small>{{ [sourceLabel({ source: item.source, id: item.dramaId || '' }), progress(item), watchedTime(item.watchedAt || item.updatedAt)].filter(Boolean).join(' · ') }}</small>
      </article>
    </div>
    <div v-else-if="!loading && !error" class="empty-state"><strong>暂无观看记录</strong><span>播放后会自动同步到 Web 端。</span></div>
    <p v-else-if="loading && !records.length" class="muted">正在读取观看记录…</p>
  </section>
</template>
