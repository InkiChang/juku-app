<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppShell from './components/AppShell.vue';
import DramaSheet from './components/DramaSheet.vue';
import PlayerSheet from './components/PlayerSheet.vue';
import DownloadsView from './views/DownloadsView.vue';
import FollowingView from './views/FollowingView.vue';
import HomeView from './views/HomeView.vue';
import LibraryView from './views/LibraryView.vue';
import LoginView from './views/LoginView.vue';
import MineView from './views/MineView.vue';
import SettingsView from './views/SettingsView.vue';
import { appStore } from './stores/app';
import type { Drama } from './types/api';

const screen = ref('home');
const selectedDrama = ref<Drama | null>(null);
const playerDrama = ref<Drama | null>(null);
const state = appStore.state;
const showSettings = computed(() => screen.value === 'settings');

onMounted(async () => {
  await appStore.init();
});

function navigate(next: string) { screen.value = next; }
function openDrama(drama: Drama) { selectedDrama.value = drama; }
function playDrama(drama: Drama) { selectedDrama.value = null; playerDrama.value = drama; }
function closeSheets() { selectedDrama.value = null; playerDrama.value = null; }
</script>

<template>
  <div class="app-root" :data-theme="appStore.theme.value">
    <main v-if="state.ready" class="app-content">
      <HomeView v-if="screen === 'home'" @open-drama="openDrama" @play-drama="playDrama" />
      <LibraryView v-else-if="screen === 'library'" @open-drama="openDrama" />
      <FollowingView v-else-if="screen === 'following'" @open-drama="openDrama" @play-drama="playDrama" />
      <DownloadsView v-else-if="screen === 'downloads'" />
      <MineView v-else-if="screen === 'mine'" @settings="screen = 'settings'" @login="screen = 'login'" />
      <LoginView v-else-if="screen === 'login'" @done="screen = 'mine'" />
      <SettingsView v-else-if="showSettings" @done="screen = 'mine'" />
    </main>
    <main v-else class="loading-state"><div class="loader"></div><p>{{ state.error || '正在连接本地后端…' }}</p><button v-if="state.error" class="secondary-button" type="button" @click="appStore.init()">重新连接</button></main>

    <AppShell v-if="state.ready && !['login', 'settings'].includes(screen)" :active="screen" @navigate="navigate" />
    <DramaSheet v-if="selectedDrama" :drama="selectedDrama" @close="closeSheets" @play="playDrama" />
    <PlayerSheet v-if="playerDrama" :drama="playerDrama" @close="closeSheets" />
  </div>
</template>
