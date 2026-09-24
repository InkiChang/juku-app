<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { LibrarySourceState, LibraryStatus } from '../types/api';

const emit = defineEmits<{ back: [] }>();
const providers = [
  { id: 'cloudfront', label: '黄果旧 API' },
  { id: 'huangguoai', label: '黄果网页' },
  { id: 'huangguo-video', label: '黄果备用网页' },
  { id: 'huangdou', label: '黄豆' },
  { id: 'hongguo', label: '红果' },
];
const statusLabels: Record<string, string> = {
  loading: '正在获取', ready: '已就绪', success: '已更新', done: '已更新',
  failed: '暂不可用', error: '暂不可用', partial: '部分更新',
  cached: '使用缓存', pending: '等待更新',
};
const snapshot = ref<LibraryStatus>({ sources: {} });
const loading = ref(false);
const requestSource = ref('');
const error = ref('');
const sourceErrors = ref<Record<string, string>>({});
const pollStartedAt = ref(0);
const pollTimedOut = ref(false);
let pollTimer: number | null = null;
const maxPollDurationMs = 60_000;

function normalizeSource(value: string): string {
  return ['cloudfront', 'huangguoai', 'huangguo-video'].includes(value) ? 'huangguo' : value;
}
const allowedProviders = computed(() => {
  const allowed = appStore.state.viewer?.sources;
  if (!allowed?.length) return providers;
  return providers.filter(provider => allowed.includes(normalizeSource(provider.id)));
});
const readyCount = computed(() => allowedProviders.value.filter(provider => {
  const value = snapshot.value.sources[provider.id];
  return ['ready', 'success', 'done', 'cached'].includes(value?.status || '') && !value?.error;
}).length);
const totalDramas = computed(() => allowedProviders.value.reduce((sum, provider) => sum + Number(snapshot.value.sources[provider.id]?.count || 0), 0));
const catalogTotal = computed(() => {
  const declared = Number(snapshot.value.total ?? snapshot.value.metadata?.total);
  return Number.isFinite(declared) && declared >= 0 ? declared : totalDramas.value;
});
const lastChecked = computed(() => {
  const dates = [snapshot.value.loadedAt, ...allowedProviders.value.map(provider => snapshot.value.sources[provider.id]?.updatedAt)]
    .map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return dates.length ? formatDate(new Date(Math.max(...dates)).toISOString()) : '尚未检查';
});

function formatDate(value?: string): string {
  if (!value || value.startsWith('0001')) return '尚未更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未更新';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function statusLabel(state?: LibrarySourceState): string {
  if (!state) return '未检查';
  return statusLabels[state.status || ''] || (state.error ? '暂不可用' : '已有缓存');
}
function statusTone(state?: LibrarySourceState): string {
  if (state?.error || ['failed', 'error'].includes(state?.status || '')) return 'danger';
  if (['loading', 'pending'].includes(state?.status || '')) return 'active';
  if (['partial', 'cached'].includes(state?.status || '')) return 'warning';
  if (['ready', 'success', 'done'].includes(state?.status || '')) return 'success';
  return 'muted';
}
function stopPolling() {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
}
function schedulePolling() {
  stopPolling();
  if (!snapshot.value.loading) {
    pollStartedAt.value = 0;
    pollTimedOut.value = false;
    return;
  }
  if (!pollStartedAt.value) pollStartedAt.value = Date.now();
  if (Date.now() - pollStartedAt.value >= maxPollDurationMs) {
    pollTimedOut.value = true;
    return;
  }
  pollTimer = window.setTimeout(() => { void load(true); }, 2500);
}
async function load(silent = false) {
  if (loading.value && !silent) return;
  if (!silent) loading.value = true;
  error.value = '';
  try {
    snapshot.value = await appStore.api().libraryStatus();
    if (!snapshot.value.loading) pollTimedOut.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取站源状态';
  } finally {
    if (!silent) loading.value = false;
    schedulePolling();
  }
}
async function updateSource(id: string) {
  if (snapshot.value.loading || requestSource.value) return;
  requestSource.value = id;
  error.value = '';
  const nextErrors = { ...sourceErrors.value };
  delete nextErrors[id];
  sourceErrors.value = nextErrors;
  try {
    const result = await appStore.api().updateLibrarySource(id);
    snapshot.value = result;
    if (result.updateAccepted === false) sourceErrors.value = { ...sourceErrors.value, [id]: '已有更新任务，本次未提交。' };
  } catch (cause) {
    sourceErrors.value = { ...sourceErrors.value, [id]: cause instanceof Error ? cause.message : '更新请求失败' };
  } finally {
    requestSource.value = '';
    schedulePolling();
  }
}
function handlePullRefresh() { void load(); }
onMounted(() => { void load(); window.addEventListener('juku:pull-refresh', handlePullRefresh); });
onBeforeUnmount(() => { stopPolling(); window.removeEventListener('juku:pull-refresh', handlePullRefresh); });
</script>

<template>
  <section class="screen-view source-status-page">
    <header class="detail-page-head">
      <button class="icon-button" type="button" aria-label="返回我的" @click="emit('back')">‹</button>
      <div><span class="eyebrow">SOURCE STATUS</span><h1>站源状态</h1><p>各站源剧库抓取与更新时间</p></div>
    </header>

    <section class="source-status-summary" aria-label="站源状态汇总">
      <div><strong>{{ readyCount }}/{{ allowedProviders.length }}</strong><span>可用站源</span></div>
      <div><strong>{{ catalogTotal }}</strong><span>已抓取剧集</span></div>
      <div><strong>{{ lastChecked }}</strong><span>最后检查</span></div>
    </section>

    <p v-if="error" class="error-text source-status-error" role="alert">{{ error }} <button class="text-button" type="button" @click="load()">重试</button></p>
    <p v-if="loading && !Object.keys(snapshot.sources).length" class="muted source-status-loading">正在读取站源状态…</p>

    <div class="source-status-list">
      <article v-for="provider in allowedProviders" :key="provider.id" class="source-status-item">
        <div class="source-status-main">
          <div class="source-status-copy">
            <strong>{{ provider.label }}</strong>
            <span>{{ Number.isFinite(snapshot.sources[provider.id]?.count) ? `${snapshot.sources[provider.id]?.count} 部` : '数量未知' }} · {{ formatDate(snapshot.sources[provider.id]?.updatedAt) }}</span>
          </div>
          <div class="source-status-actions">
            <span class="source-status-badge" :class="statusTone(snapshot.sources[provider.id])">{{ requestSource === provider.id ? '正在提交' : statusLabel(snapshot.sources[provider.id]) }}</span>
            <button class="source-update-button" type="button" :disabled="!!requestSource || !!snapshot.loading" :aria-busy="requestSource === provider.id || snapshot.loading && snapshot.sources[provider.id]?.status === 'loading'" @click="updateSource(provider.id)">
              {{ requestSource === provider.id || snapshot.loading && snapshot.sources[provider.id]?.status === 'loading' ? '更新中…' : '更新' }}
            </button>
          </div>
        </div>
        <p v-if="sourceErrors[provider.id] || snapshot.sources[provider.id]?.error" class="source-status-row-error" role="status">{{ sourceErrors[provider.id] || snapshot.sources[provider.id]?.error }}</p>
      </article>
    </div>

    <p v-if="pollTimedOut" class="source-status-row-error" role="status">后台更新仍在运行，暂未在 60 秒内完成；当前状态为最近一次可用结果，可稍后重新进入此页面查看。</p>
    <p class="source-status-note">{{ snapshot.loading || requestSource ? '正在更新剧库，已有内容仍可继续使用；完成后状态会自动刷新。' : '点击对应站源的“更新”可查新、续载和补齐资料；失败时保留已有内容。' }}</p>
  </section>
</template>
