<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama } from '../types/api';

const state = appStore.state;
const emit = defineEmits<{ openDrama: [drama: Drama] }>();
const search = ref('');
const titleOf = (drama: { title?: string; name?: string }) => drama.title || drama.name || '未命名短剧';
const coverOf = (drama: { cover?: string; coverUrl?: string; poster?: string; thumb?: string }) => drama.cover || drama.coverUrl || drama.poster || drama.thumb || '';
const countOf = (value: unknown) => value ? String(value) : '集数未知';
const loggedInLabel = computed(() => state.viewer?.account ? String((state.viewer.account as { username?: string }).username || '已登录') : '登录');
const filteredDramas = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return state.dramas;
  return state.dramas.filter(drama => titleOf(drama).toLowerCase().includes(query) || String(drama.desc || drama.intro || '').toLowerCase().includes(query));
});
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}

onMounted(() => appStore.loadMore());
</script>

<template>
  <section class="library-view">
    <div class="heading-row"><div><span class="eyebrow">CATALOG</span><h1>剧库</h1><p>按站源、分类和更新顺序浏览。</p></div><button class="icon-button" type="button" aria-label="刷新剧库" @click="appStore.loadMore()">↻</button></div>
    <p v-if="state.error" class="error-text">{{ state.error }}</p>
    <div class="toolbar"><label class="search-box"><span>⌕</span><input v-model="search" type="search" placeholder="搜索剧名、简介或标签" /></label><button class="filter-button" type="button" aria-label="筛选">☷</button></div>
    <div class="filter-row"><button class="active" type="button">全部站源</button><button type="button">全部分类</button><button type="button">最新上线</button><button type="button">隐藏 VIP</button></div>
    <div class="drama-grid">
      <article v-for="drama in filteredDramas" :key="drama.id" class="drama-card" @click="emit('openDrama', drama)">
        <div class="poster"><img v-if="coverOf(drama)" :src="appStore.api().resolve(coverOf(drama))" :alt="titleOf(drama)" @error="onImageError" /><span v-else>暂无海报</span><button class="play-button" type="button" title="播放" @click.stop="emit('openDrama', drama)">▶</button></div>
        <div class="drama-meta"><h2>{{ titleOf(drama) }}</h2><p>{{ countOf(drama.totalEpisode) }} · {{ drama.categoryName || drama.category || '未分类' }}</p></div>
      </article>
    </div>
    <button v-if="state.hasMore" class="load-more" :disabled="state.loading" @click="appStore.loadMore()">{{ state.loading ? '加载中…' : '加载更多' }}</button>
    <p v-else class="muted">已加载全部剧集</p>
  </section>
</template>
