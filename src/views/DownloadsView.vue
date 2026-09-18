<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
import type { DownloadTask } from '../types/api';

const tasks = ref<DownloadTask[]>([]);
const active = ref('全部任务');
const loading = ref(false);
const error = ref('');
const tabs = ['全部任务', '进行中', '已完成'];
const filteredTasks = computed(() => tasks.value.filter(task => active.value === '全部任务' || active.value === '进行中' && ['queued', 'parsing', 'running', 'paused'].includes(String(task.status)) || active.value === '已完成' && task.status === 'success'));
const summary = computed(() => ({
  running: tasks.value.filter(task => ['queued', 'parsing', 'running'].includes(String(task.status))).length,
  completedEpisodes: tasks.value.filter(task => task.status === 'success').length,
  bytes: tasks.value.reduce((sum, task) => sum + Number(task.downloadedBytes || 0), 0),
}));
const bytesLabel = computed(() => {
  const bytes = summary.value.bytes;
  if (!bytes) return '0B';
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`;
  if (bytes > 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`;
  return `${Math.round(bytes / 1024)}K`;
});
async function refresh() {
  loading.value = true;
  error.value = '';
  try { tasks.value = await appStore.api().tasks(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '下载任务读取失败'; }
  finally { loading.value = false; }
}
function taskTitle(task: DownloadTask) { return task.dramaTitle || task.title || '短剧任务'; }
function taskStatus(task: DownloadTask) { return ({ queued: '排队中', parsing: '解析中', running: '下载中', paused: '已暂停', success: '已完成', failed: '失败', canceled: '已取消' } as Record<string, string>)[String(task.status)] || '未知状态'; }
function taskDetail(task: DownloadTask) { return `${task.index ? `第 ${task.index}${task.total ? ` / ${task.total}` : ''} 集` : '任务详情'}${task.error ? ` · ${task.error}` : ''}`; }
onMounted(refresh);
</script>

<template>
  <section class="screen-view">
    <div class="heading-row"><div><span class="eyebrow">OFFLINE TASKS</span><h1>下载</h1><p>任务在手机端执行，完成后可离线观看。</p></div><button class="icon-button" type="button" aria-label="刷新下载任务" @click="refresh"><AppIcon name="refresh" label="刷新下载任务" /></button></div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <div class="download-summary"><div><strong>{{ summary.running }}</strong><span>进行中</span></div><div><strong>{{ summary.completedEpisodes }}</strong><span>已完成分集</span></div><div><strong>{{ bytesLabel }}</strong><span>累计写入</span></div></div>
    <div class="filter-row"><button v-for="tab in tabs" :key="tab" :class="{ active: active === tab }" type="button" @click="active = tab">{{ tab }}</button></div>
    <div v-if="filteredTasks.length" class="task-list"><article v-for="(task, index) in filteredTasks" :key="task.id || `${taskTitle(task)}-${index}`" class="task-card"><div class="task-head"><strong>{{ taskTitle(task) }}</strong><span>{{ taskStatus(task) }}</span></div><small>{{ taskDetail(task) }}</small><div class="progress"><i :style="{ width: `${Math.min(100, Math.max(0, Number(task.progress || (task.status === 'success' ? 100 : 0))))}%` }"></i></div></article></div>
    <div v-else class="empty-state"><strong>{{ loading ? '正在读取下载任务…' : '还没有下载任务' }}</strong><span>从剧集详情开始下载后，任务会在这里同步显示。</span></div>
    <p class="form-note">下载使用手机存储空间；服务端只负责提供原始 MP4/HLS 地址，不承担重解码。</p>
  </section>
</template>
