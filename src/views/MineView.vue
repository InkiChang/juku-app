<script setup lang="ts">
import { computed } from 'vue';
import { appStore } from '../stores/app';

const emit = defineEmits<{ settings: []; login: [] }>();
const state = appStore.state;
const account = computed(() => state.viewer?.account as { username?: string } | undefined);
const rows = [
  { icon: '◷', title: '观看记录', detail: '最近看过的 18 部剧', action: 'history' },
  { icon: '⌘', title: '服务器与播放', detail: '本地后端 / 原始媒体优先', action: 'settings' },
  { icon: '♙', title: '用户管理', detail: '账号、站源权限和仅在线观看设置', action: 'users' },
  { icon: '◎', title: '账号安全', detail: '管理登录和跨设备同步', action: 'account' },
  { icon: 'ⓘ', title: '关于剧库', detail: '版本 0.0.1 · 独立 App', action: 'about' },
];
function rowClick(action: string) {
  if (action === 'settings') emit('settings');
  else if (action === 'users') window.alert('用户管理仅管理员可见');
  else if (action === 'about') window.alert('剧库 App v0.0.1');
}
</script>

<template>
  <section class="screen-view">
    <div class="heading-row mine-heading"><div><span class="eyebrow">ACCOUNT</span><div class="title-line"><h1>我的</h1><button class="icon-button theme-toggle" type="button" :aria-label="appStore.theme.value === 'dark' ? '切换到白色主题' : '切换到黑色主题'" @click="appStore.toggleTheme()">{{ appStore.theme.value === 'dark' ? '☼' : '☾' }}</button></div><p>账号、记录、用户管理和连接设置。</p></div></div>
    <section class="profile-card"><div class="profile-avatar">{{ account?.username?.slice(0, 1) || '客' }}</div><div><strong>{{ account?.username || '访客模式' }}</strong><small>{{ account ? '已登录 · Web / App 记录同步' : '登录后同步观看记录和追剧清单' }}</small></div><button v-if="account" class="icon-button profile-action" type="button" aria-label="退出登录" @click="appStore.logout()">↪</button><button v-else class="text-button profile-action" type="button" @click="emit('login')">登录</button></section>
    <div class="menu-list"><button v-for="row in rows" :key="row.action" class="menu-row" type="button" @click="rowClick(row.action)"><span class="menu-icon">{{ row.icon }}</span><span class="menu-copy"><strong>{{ row.title }}</strong><small>{{ row.detail }}</small></span><span class="chevron">›</span></button></div>
  </section>
</template>
