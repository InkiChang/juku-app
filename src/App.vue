<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppShell from './components/AppShell.vue';
import DramaSheet from './components/DramaSheet.vue';
import PlayerSheet from './components/PlayerSheet.vue';
import DownloadsView from './views/DownloadsView.vue';
import FollowingView from './views/FollowingView.vue';
import HomeView from './views/HomeView.vue';
import HistoryView from './views/HistoryView.vue';
import LibraryView from './views/LibraryView.vue';
import LoginView from './views/LoginView.vue';
import MineView from './views/MineView.vue';
import UsersView from './views/UsersView.vue';
import RankingDetailView from './views/RankingDetailView.vue';
import SettingsView from './views/SettingsView.vue';
import AccountSecurityView from './views/AccountSecurityView.vue';
import SourceStatusView from './views/SourceStatusView.vue';
import { appStore } from './stores/app';
import { NativePlayback } from './native/nativePlayback';
import type { Drama, RankingBoard } from './types/api';

const screen = ref('home');
const selectedDrama = ref<Drama | null>(null);
const selectedRankingBoard = ref<RankingBoard | null>(null);
const playerDrama = ref<Drama | null>(null);
const playerEpisode = ref<number | null>(null);
const state = appStore.state;
const showSettings = computed(() => screen.value === 'settings');
const pullDistance = ref(0);
const pullRefreshing = ref(false);
const pullReady = computed(() => pullDistance.value >= 72);
let pullStartY = 0;
let pullStartX = 0;
let pullTracking = false;
let exitInProgress = false;

onMounted(async () => {
  window.addEventListener('juku:system-back', handleSystemBack);
  await appStore.init();
});

async function handleSystemBack(): Promise<void> {
  if (exitInProgress) return;
  if (playerDrama.value || selectedDrama.value) {
    closeSheets();
    return;
  }
  if (screen.value === 'ranking') {
    selectedRankingBoard.value = null;
    screen.value = 'home';
    return;
  }
  if (['history', 'users', 'account', 'sources', 'settings', 'login'].includes(screen.value)) {
    screen.value = screen.value === 'login' ? 'mine' : 'mine';
    return;
  }
  if (screen.value !== 'home') {
    screen.value = 'home';
    return;
  }
  exitInProgress = true;
  try {
    // Sign out before finishing the native task. This is best-effort so an
    // offline phone can still close immediately without retaining a cookie.
    await appStore.logout({ bestEffort: true });
  } finally {
    await NativePlayback.exitApp().catch(() => undefined);
    exitInProgress = false;
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('juku:system-back', handleSystemBack);
});

function navigate(next: string) { screen.value = next; }
function openDrama(drama: Drama) { selectedDrama.value = appStore.enrichDrama(drama); }
function playDrama(drama: Drama, episode?: number) {
  selectedDrama.value = null;
  appStore.setPlaybackActive(true);
  playerDrama.value = appStore.enrichDrama(drama);
  playerEpisode.value = episode || null;
}
function openRanking(boardId: string) {
  selectedRankingBoard.value = state.rankingBoards.find(board => board.id === boardId) || null;
  if (selectedRankingBoard.value) screen.value = 'ranking';
}
function closeSheets() {
  const wasPlaying = Boolean(playerDrama.value);
  selectedDrama.value = null;
  playerDrama.value = null;
  playerEpisode.value = null;
  appStore.setPlaybackActive(false);
  if (wasPlaying) void nextTick().then(() => new Promise(resolve => window.setTimeout(resolve, 350))).then(() => appStore.loadHome());
}

function handlePullStart(event: TouchEvent) {
  if (pullRefreshing.value || window.scrollY > 0) return;
  const touch = event.touches[0];
  pullStartY = touch?.clientY || 0;
  pullStartX = touch?.clientX || 0;
  pullTracking = true;
}

function handlePullMove(event: TouchEvent) {
  if (!pullTracking || pullRefreshing.value) return;
  const touch = event.touches[0];
  const dy = (touch?.clientY || 0) - pullStartY;
  const dx = (touch?.clientX || 0) - pullStartX;
  if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
    pullDistance.value = 0;
    return;
  }
  pullDistance.value = Math.min(112, dy * 0.55);
  if (event.cancelable) event.preventDefault();
}

async function handlePullEnd() {
  if (!pullTracking) return;
  pullTracking = false;
  if (!pullReady.value || pullRefreshing.value) {
    pullDistance.value = 0;
    return;
  }
  pullRefreshing.value = true;
  pullDistance.value = 76;
  try {
    await new Promise(resolve => window.setTimeout(resolve, 650));
    if (screen.value === 'home') {
      await appStore.refreshLibrary();
      await appStore.loadHome();
    } else {
      window.dispatchEvent(new Event('juku:pull-refresh'));
    }
  } finally {
    pullRefreshing.value = false;
    pullDistance.value = 0;
  }
}
</script>

<template>
  <div class="app-root" :data-theme="appStore.theme.value" @touchstart="handlePullStart" @touchmove="handlePullMove" @touchend="handlePullEnd" @touchcancel="handlePullEnd">
    <div v-if="pullDistance || pullRefreshing" class="pull-refresh-indicator" :class="{ ready: pullReady, refreshing: pullRefreshing }" :style="{ transform: `translate(-50%, ${Math.min(76, pullDistance)}px)` }" role="status" aria-live="polite">
      <span class="pull-refresh-spinner" aria-hidden="true"></span><span>{{ pullRefreshing ? '正在刷新…' : pullReady ? '松开刷新' : '下拉刷新' }}</span>
    </div>
    <main v-if="state.ready" class="app-content">
      <HomeView v-if="screen === 'home'" @open-drama="openDrama" @play-drama="playDrama" @open-ranking="openRanking" />
      <RankingDetailView v-else-if="screen === 'ranking' && selectedRankingBoard" :board="selectedRankingBoard" @open-drama="openDrama" @play-drama="playDrama" @back="screen = 'home'" />
      <LibraryView v-else-if="screen === 'library'" @open-drama="openDrama" @play-drama="playDrama" />
      <FollowingView v-else-if="screen === 'following'" @open-drama="openDrama" @play-drama="playDrama" />
      <DownloadsView v-else-if="screen === 'downloads'" />
      <MineView v-else-if="screen === 'mine'" @settings="screen = 'settings'" @login="screen = 'login'" @history="screen = 'history'" @users="screen = 'users'" @account="screen = 'account'" @sources="screen = 'sources'" />
      <HistoryView v-else-if="screen === 'history'" @back="screen = 'mine'" />
      <UsersView v-else-if="screen === 'users'" @back="screen = 'mine'" />
      <AccountSecurityView v-else-if="screen === 'account'" @back="screen = 'mine'" @login="screen = 'login'" />
      <SourceStatusView v-else-if="screen === 'sources'" @back="screen = 'mine'" />
      <LoginView v-else-if="screen === 'login'" @done="screen = 'mine'" />
      <SettingsView v-else-if="showSettings" @done="screen = 'mine'" />
    </main>
    <main v-else class="loading-state"><div class="loader"></div><p>{{ state.error || '正在连接本地后端…' }}</p><button v-if="state.error" class="secondary-button" type="button" @click="appStore.init()">重新连接</button></main>

    <AppShell v-if="state.ready && !['login', 'settings', 'ranking', 'history', 'users', 'account', 'sources'].includes(screen)" :active="screen" @navigate="navigate" />
    <DramaSheet v-if="selectedDrama" :drama="selectedDrama" @close="closeSheets" @play="playDrama" />
    <PlayerSheet v-if="playerDrama" :drama="playerDrama" :initial-episode="playerEpisode || undefined" @close="closeSheets" />
  </div>
</template>
