<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { appStore } from '../stores/app';

const state = appStore.state;
const titleOf = (drama: { title?: string; name?: string }) => drama.title || drama.name || '未命名短剧';
const coverOf = (drama: { cover?: string; coverUrl?: string; poster?: string; thumb?: string }) => drama.cover || drama.coverUrl || drama.poster || drama.thumb || '';
const countOf = (value: unknown) => value ? String(value) : '集数未知';
const loggedInLabel = computed(() => state.viewer?.account ? String((state.viewer.account as { username?: string }).username || '已登录') : '登录');

onMounted(() => appStore.loadMore());
</script>

<template>
  <section class="library-view">
    <div class="page-heading"><div><span class="eyebrow">LIBRARY</span><h1>剧库</h1><p>接口与原 Web 端保持一致，界面为 App 重新设计。</p></div><span class="status-dot" :class="{ active: state.viewer?.ready }">{{ state.viewer?.ready ? '已连接' : '连接中' }}</span></div>
    <p v-if="state.error" class="error-text">{{ state.error }}</p>
    <div class="drama-grid">
      <article v-for="drama in state.dramas" :key="drama.id" class="drama-card">
        <div class="poster"><img v-if="coverOf(drama)" :src="appStore.api().resolve(coverOf(drama))" :alt="titleOf(drama)" /><span v-else>暂无海报</span><button class="play-button" title="播放">▶</button></div>
        <div class="drama-meta"><h2>{{ titleOf(drama) }}</h2><p>{{ countOf(drama.totalEpisode) }} · {{ drama.categoryName || drama.category || '未分类' }}</p></div>
      </article>
    </div>
    <button v-if="state.hasMore" class="load-more" :disabled="state.loading" @click="appStore.loadMore()">{{ state.loading ? '加载中…' : '加载更多' }}</button>
    <p v-else class="muted">已加载全部剧集</p>
  </section>
</template>
