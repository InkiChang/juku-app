<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
import type { IconName } from '../config/icons';

const emit = defineEmits<{ settings: []; login: []; history: []; users: []; account: []; sources: [] }>();
const state = appStore.state;
const account = computed(() => state.viewer?.account as { username?: string; admin?: boolean } | undefined);
const historyLoading = ref(false);
const historyError = ref('');
const rows = computed(() => [
  { icon: 'history', title: '观看记录', detail: historyLoading.value ? '正在同步观看记录…' : historyError.value ? '同步失败，点击查看' : state.history.length ? `最近看过的 ${state.history.length} 部剧` : '暂无观看记录', action: 'history' },
  { icon: 'server', title: '服务器与播放', detail: '本地后端 / 原始媒体优先', action: 'settings' },
  { icon: 'refresh', title: '站源状态', detail: '查看各站源剧库数量和更新时间', action: 'sources' },
  ...(account.value?.admin ? [{ icon: 'userManagement', title: '用户管理', detail: '账号、站源权限和仅在线观看设置', action: 'users' }] : []),
  { icon: 'accountSecurity', title: '账号安全', detail: '管理登录和跨设备同步', action: 'account' },
  { icon: 'about', title: '关于剧库', detail: '版本 0.0.1 · 独立 App', action: 'about' },
]);
async function refreshHistory() {
  if (historyLoading.value) return;
  historyLoading.value = true;
  historyError.value = '';
  try { await appStore.loadHistory(); }
  catch (cause) { historyError.value = cause instanceof Error ? cause.message : '观看记录同步失败'; }
  finally { historyLoading.value = false; }
}
function rowClick(action: string) {
  if (action === 'settings') emit('settings');
  else if (action === 'history') emit('history');
  else if (action === 'users') emit('users');
  else if (action === 'account') emit('account');
  else if (action === 'sources') emit('sources');
  else if (action === 'about') window.alert('剧库 App v0.0.1');
}
function handlePullRefresh() { void Promise.allSettled([appStore.refreshViewer(), refreshHistory()]); }
onMounted(() => { void refreshHistory(); window.addEventListener('juku:pull-refresh', handlePullRefresh); });
onBeforeUnmount(() => window.removeEventListener('juku:pull-refresh', handlePullRefresh));
</script>

<template>
  <section class="screen-view">
    <div class="heading-row mine-heading"><div><span class="eyebrow">ACCOUNT</span><div class="title-line"><h1>我的</h1><button class="icon-button theme-toggle" type="button" :aria-label="appStore.theme.value === 'dark' ? '切换到白色主题' : '切换到黑色主题'" @click="appStore.toggleTheme()"><AppIcon :name="appStore.theme.value === 'dark' ? 'lightTheme' : 'darkTheme'" :label="appStore.theme.value === 'dark' ? '切换到白色主题' : '切换到黑色主题'" /></button></div><p>账号、记录、用户管理和连接设置。</p></div></div>
    <section class="profile-card"><div class="profile-avatar">{{ account?.username?.slice(0, 1) || '客' }}</div><div><strong>{{ account?.username || '访客模式' }}</strong><small>{{ account ? '已登录 · Web / App 记录同步' : '登录后同步观看记录和追剧清单' }}</small></div><button v-if="account" class="icon-button profile-action" type="button" aria-label="退出登录" @click="appStore.logout()">↪</button><button v-else class="text-button profile-action" type="button" @click="emit('login')">登录</button></section>
    <div class="menu-list"><button v-for="row in rows" :key="row.action" class="menu-row" type="button" @click="rowClick(row.action)"><AppIcon class="menu-icon" :name="row.icon as IconName" :label="row.title" /><span class="menu-copy"><strong>{{ row.title }}</strong><small>{{ row.detail }}</small></span><span class="chevron">›</span></button></div>
  </section>
</template>
