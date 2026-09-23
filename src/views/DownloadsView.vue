<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { DownloadTask } from '../types/api';

type TaskAction = 'pause' | 'resume' | 'retry' | 'cancel';
type GroupStatus = 'all' | 'active' | 'completed' | 'paused' | 'failed';
type ReleaseStatus = 'all' | 'finished' | 'ongoing' | 'unknown';
interface DownloadGroup {
  id: string; title: string; tasks: DownloadTask[]; episodes: DownloadEpisode[]; total: number; completed: number; active: number; paused: number; failed: number; canceled: number; bytes: number; speed: number; progress: number; releaseStatus: string; qualities: number[]; updatedAt: string;
}
interface DownloadEpisode { index: number; task?: DownloadTask; }

const tasks = ref<DownloadTask[]>([]);
const loading = ref(false);
const error = ref('');
const query = ref('');
const statusFilter = ref<GroupStatus>('all');
const releaseFilter = ref<ReleaseStatus>('all');
const expanded = ref(new Set<string>());
const actionGroup = ref('');
const actionEpisode = ref('');
const qualityOptions = [0, 2160, 1440, 1080, 720, 540, 480, 360];
const storedQuality = Number(localStorage.getItem('juku.app.downloadQuality'));
const downloadQuality = ref(qualityOptions.includes(storedQuality) ? storedQuality : 0);
let pollTimer = 0;
let destroyed = false;

const groups = computed<DownloadGroup[]>(() => {
  const grouped = new Map<string, DownloadTask[]>();
  for (const task of tasks.value) {
    const key = String(task.dramaId || task.dramaTitle || task.id || 'unknown');
    grouped.set(key, [...(grouped.get(key) || []), task]);
  }
  return [...grouped.entries()].map(([id, values]) => {
    const ordered = [...values].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
    const indexed = new Map<number, DownloadTask>();
    for (const task of ordered) {
      const index = Number(task.index || 0);
      if (index > 0) indexed.set(index, task);
    }
    const expectedTotal = Math.max(
      indexed.size,
      ...values.map(task => Number(task.total || 0)),
      ...indexed.keys(),
    );
    const episodes = Array.from({ length: expectedTotal }, (_, index) => ({ index: index + 1, task: indexed.get(index + 1) }));
    const episodeTasks = episodes.flatMap(episode => episode.task ? [episode.task] : []);
    const unindexedTasks = values.filter(task => Number(task.index || 0) <= 0);
    const completed = episodeTasks.filter(task => task.status === 'success').length;
    const active = episodeTasks.filter(task => ['queued', 'parsing', 'running'].includes(String(task.status))).length
      + unindexedTasks.filter(task => ['queued', 'parsing', 'running'].includes(String(task.status))).length;
    const paused = episodeTasks.filter(task => task.status === 'paused').length;
    const failed = episodeTasks.filter(task => task.status === 'failed').length;
    const canceled = episodeTasks.filter(task => task.status === 'canceled').length;
    return {
      id, title: String(values.find(task => task.dramaTitle)?.dramaTitle || values.find(task => task.title)?.title || '短剧任务'), tasks: ordered, episodes, total: expectedTotal || values.length, completed, active, paused, failed, canceled,
      bytes: values.reduce((sum, task) => sum + Number(task.downloadedBytes || 0), 0),
      speed: values.reduce((sum, task) => sum + Number(task.speedBytesPerSecond || 0), 0),
      progress: values.length ? Math.round(values.reduce((sum, task) => sum + clampProgress(task), 0) / values.length) : 0,
      releaseStatus: String(values.find(task => task.releaseStatus)?.releaseStatus || 'unknown'),
      qualities: [...new Set(values.map(task => Number(task.downloadQuality || 0)))],
      updatedAt: values.reduce((latest, task) => String(task.updatedAt || '') > latest ? String(task.updatedAt) : latest, ''),
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});

const visibleGroups = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN');
  return groups.value.filter(group => {
    if (keyword && !group.title.toLocaleLowerCase('zh-CN').includes(keyword)) return false;
    if (releaseFilter.value !== 'all' && group.releaseStatus !== releaseFilter.value) return false;
    if (statusFilter.value === 'active' && !group.active) return false;
    if (statusFilter.value === 'completed' && group.completed !== group.total) return false;
    if (statusFilter.value === 'paused' && !group.paused) return false;
    if (statusFilter.value === 'failed' && !(group.failed || group.canceled)) return false;
    return true;
  });
});
const summary = computed(() => ({
  running: tasks.value.filter(task => ['queued', 'parsing', 'running'].includes(String(task.status))).length,
  completedEpisodes: tasks.value.filter(task => task.status === 'success').length,
  bytes: tasks.value.reduce((sum, task) => sum + Number(task.downloadedBytes || 0), 0),
}));

function clampProgress(task: DownloadTask): number {
  const value = task.status === 'success' ? 100 : Number(task.progress || 0);
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}
function qualityLabel(value: number): string { return value ? `${value}p` : '最高可用'; }
function releaseLabel(value: string): string { return ({ finished: '已完结', ongoing: '连载中', unknown: '状态未知' } as Record<string, string>)[value] || '状态未知'; }
function groupStatus(group: DownloadGroup): string {
  if (group.active) return group.active === group.total ? '下载中' : `${group.active} 集下载中`;
  if (group.paused) return '已暂停';
  if (group.failed) return `${group.failed} 集失败`;
  if (group.canceled) return '已取消';
  if (group.completed === group.total) return '已完成';
  return '等待处理';
}
function groupStatusTone(group: DownloadGroup): string {
  if (group.failed || group.canceled) return 'danger';
  if (group.active) return 'active';
  if (group.completed === group.total) return 'success';
  return 'muted';
}
function groupMeta(group: DownloadGroup): string {
  const quality = group.qualities.length === 1 ? qualityLabel(group.qualities[0]) : '分集画质';
  return `${releaseLabel(group.releaseStatus)} · 共 ${group.total} 集 · 完成 ${group.completed} · ${quality}`;
}
function taskStatus(task: DownloadTask): string {
  return ({ queued: '排队中', parsing: '解析中', running: '下载中', paused: '已暂停', success: '已完成', failed: '失败', canceled: '已取消' } as Record<string, string>)[String(task.status)] || '等待处理';
}
function episodeState(episode: DownloadEpisode): string {
  const status = String(episode.task?.status || 'missing');
  if (status === 'success') return 'completed';
  if (['queued', 'parsing', 'running'].includes(status)) return 'active';
  if (status === 'paused') return 'paused';
  return 'pending';
}
function episodeActionable(episode: DownloadEpisode): boolean {
  return !episode.task || ['failed', 'canceled', 'paused'].includes(String(episode.task.status));
}
function episodeActionKey(group: DownloadGroup, episode: DownloadEpisode): string {
  return `${group.id}:${episode.index}`;
}
function episodeAriaLabel(episode: DownloadEpisode): string {
  const status = episode.task ? taskStatus(episode.task) : '未下载';
  const action = episodeActionable(episode) ? '，点击重新下载' : '';
  return `第 ${episode.index} 集，${status}${action}`;
}
function toggleGroup(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expanded.value = next;
}
function saveQuality(value: string) {
  downloadQuality.value = Number(value) || 0;
  localStorage.setItem('juku.app.downloadQuality', String(downloadQuality.value));
}
async function runGroupAction(group: DownloadGroup, action: TaskAction) {
  if (action === 'cancel' && !window.confirm(`取消《${group.title}》未完成的下载任务？已完成文件不会删除。`)) return;
  actionGroup.value = group.id;
  error.value = '';
  try {
    const next = await appStore.api().updateDownloadTasks(action, [group.id]);
    tasks.value = next.length ? next : await appStore.api().tasks();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '任务操作失败'; }
  finally { actionGroup.value = ''; schedulePoll(); }
}
async function runEpisodeAction(group: DownloadGroup, episode: DownloadEpisode) {
  if (!episodeActionable(episode)) return;
  const key = episodeActionKey(group, episode);
  actionEpisode.value = key;
  error.value = '';
  try {
    let next: DownloadTask[] = [];
    if (episode.task?.id) {
      const action = episode.task.status === 'paused' ? 'resume' : 'retry';
      next = await appStore.api().updateDownloadTask(action, episode.task.id);
    } else {
      await appStore.api().enqueueDownload([group.id], downloadQuality.value);
    }
    tasks.value = next.length ? next : await appStore.api().tasks();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : `第 ${episode.index} 集重新下载失败`; }
  finally { actionEpisode.value = ''; schedulePoll(); }
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try { tasks.value = await appStore.api().tasks(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '下载任务读取失败'; }
  finally { loading.value = false; schedulePoll(); }
}
function schedulePoll() {
  window.clearTimeout(pollTimer);
  if (destroyed) return;
  const hasActive = tasks.value.some(task => ['queued', 'parsing', 'running'].includes(String(task.status)));
  pollTimer = window.setTimeout(() => void refresh(), document.hidden ? 30000 : hasActive ? 2000 : 15000);
}
function handleVisibility() { if (!document.hidden) void refresh(); }

onMounted(() => { void refresh(); window.addEventListener('juku:pull-refresh', refresh); document.addEventListener('visibilitychange', handleVisibility); });
onBeforeUnmount(() => { destroyed = true; window.clearTimeout(pollTimer); window.removeEventListener('juku:pull-refresh', refresh); document.removeEventListener('visibilitychange', handleVisibility); });
</script>

<template>
  <section class="screen-view downloads-view">
    <div class="heading-row download-heading"><div><span class="eyebrow">DOWNLOADS</span><h1>下载</h1><p>按剧集管理分集、进度和存储。</p></div><span class="storage-scope">服务器任务</span></div>
    <p v-if="error" class="error-text download-error">{{ error }}</p>
    <div class="download-summary"><div><strong>{{ summary.running }}</strong><span>正在进行</span></div><div><strong>{{ summary.completedEpisodes }}</strong><span>已完成分集</span></div><div><strong>{{ formatBytes(summary.bytes) }}</strong><span>任务累计写入</span></div></div>
    <div class="download-toolbar">
      <label class="download-search"><input v-model="query" type="search" autocomplete="off" placeholder="搜索下载合集" aria-label="搜索下载合集"><span class="search-submit-icon" aria-hidden="true"></span></label>
      <div class="download-filter-grid"><select v-model="statusFilter" aria-label="下载状态筛选"><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已完成</option><option value="paused">已暂停</option><option value="failed">失败或取消</option></select><select v-model="releaseFilter" aria-label="剧集完结状态筛选"><option value="all">全部完结状态</option><option value="finished">已完结</option><option value="ongoing">连载中</option><option value="unknown">状态未知</option></select></div>
      <div class="download-quality-row"><label>新任务画质<select :value="downloadQuality" aria-label="新下载任务画质" @change="saveQuality(($event.target as HTMLSelectElement).value)"><option v-for="quality in qualityOptions" :key="quality" :value="quality">{{ qualityLabel(quality) }}</option></select></label><span>{{ visibleGroups.length }} / {{ groups.length }} 部</span></div>
    </div>
    <div v-if="visibleGroups.length" class="download-group-list">
      <article v-for="group in visibleGroups" :key="group.id" class="download-group-card" :class="{ open: expanded.has(group.id) }">
        <div class="download-group-head"><div class="download-group-title"><strong>{{ group.title }}</strong><span class="download-status" :class="groupStatusTone(group)">{{ groupStatus(group) }}</span></div><p>{{ groupMeta(group) }}</p></div>
        <div class="download-group-progress"><i :style="{ width: `${group.progress}%` }"></i></div>
        <div class="download-progress-meta"><span>{{ group.progress }}% · 已写入 {{ formatBytes(group.bytes) }}</span><span v-if="group.speed">{{ formatBytes(group.speed) }}/s</span></div>
        <div class="download-group-actions"><button v-if="group.active" type="button" :disabled="actionGroup === group.id" @click="runGroupAction(group, 'pause')">暂停</button><button v-if="group.paused" type="button" :disabled="actionGroup === group.id" @click="runGroupAction(group, 'resume')">继续</button><button v-if="group.failed + group.canceled" type="button" :disabled="actionGroup === group.id" @click="runGroupAction(group, 'retry')">重试失败</button><button type="button" :aria-expanded="expanded.has(group.id)" @click="toggleGroup(group.id)">{{ expanded.has(group.id) ? '收起分集' : '查看分集' }}<span class="download-chevron" :class="{ open: expanded.has(group.id) }"></span></button><button v-if="group.active || group.paused" class="download-cancel" type="button" :disabled="actionGroup === group.id" @click="runGroupAction(group, 'cancel')">取消</button></div>
        <div v-if="expanded.has(group.id)" class="download-episode-panel">
          <div class="download-episode-summary"><span>已下载 {{ group.completed }} / {{ group.total }} 集</span><span><i></i> 已完成</span></div>
          <div class="download-episode-grid">
            <button v-for="episode in group.episodes" :key="episode.index" type="button" class="download-episode-tile" :class="episodeState(episode)" :aria-label="episodeAriaLabel(episode)" :disabled="!episodeActionable(episode) || actionEpisode === episodeActionKey(group, episode)" @click="runEpisodeAction(group, episode)">
              <span>{{ episode.index }}</span><i v-if="episodeState(episode) === 'completed'" aria-hidden="true"></i><b v-if="actionEpisode === episodeActionKey(group, episode)" aria-hidden="true"></b>
            </button>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="empty-state"><strong>{{ loading && !tasks.length ? '正在读取下载任务…' : tasks.length ? '没有匹配的下载合集' : '还没有下载任务' }}</strong><span>{{ tasks.length ? '试试其他搜索或筛选条件。' : '在剧集详情加入下载后，会按剧集汇总显示在这里。' }}</span></div>
    <p class="download-scope-note">当前数据来自后端下载任务，文件保存在服务器。手机本地离线下载接入后，将沿用相同的合集管理界面。</p>
  </section>
</template>
