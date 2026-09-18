<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppShell from './components/AppShell.vue';
import LoginView from './views/LoginView.vue';
import LibraryView from './views/LibraryView.vue';
import SettingsView from './views/SettingsView.vue';
import { appStore } from './stores/app';

const page = ref<'library' | 'login' | 'settings'>('library');
const state = appStore.state;
const accountLabel = computed(() => state.viewer?.account ? String((state.viewer.account as { username?: string }).username || '账号') : '登录');

onMounted(async () => {
  try { await appStore.init(); } catch (cause) { state.error = cause instanceof Error ? cause.message : '无法连接服务器'; }
});

function closePanel() { page.value = 'library'; }
function reload() { window.location.reload(); }
</script>

<template>
  <div class="app-root">
    <AppShell :title="accountLabel" @settings="page = 'settings'" @login="page = state.viewer?.account ? 'settings' : 'login'" />
    <main v-if="state.ready" class="workspace">
      <LibraryView v-if="page === 'library'" />
      <LoginView v-else-if="page === 'login'" />
      <SettingsView v-else />
    </main>
    <main v-else class="loading-state"><div class="loader"></div><p>{{ state.error || '正在连接本地后端…' }}</p><button v-if="state.error" class="secondary-button" @click="reload">重新连接</button></main>
    <nav class="bottom-nav"><button :class="{ active: page === 'library' }" @click="closePanel">⌂<span>剧库</span></button><button>♡<span>追剧</span></button><button>⇩<span>下载</span></button></nav>
  </div>
</template>
