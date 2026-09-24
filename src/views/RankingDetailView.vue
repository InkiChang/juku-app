<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama, RankingBoard, RankingItem } from '../types/api';
import { categoryName, episodeLabel, releaseStatusLabel } from '../utils/drama';

const props = defineProps<{ board: RankingBoard }>();
const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama]; back: [] }>();

const items = ref<RankingItem[]>([]);
const page = ref(1);
const hasMore = ref(true);
const loading = ref(false);
const error = ref('');
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.cover_url || drama?.image || drama?.imageUrl || drama?.image_url || drama?.img || drama?.pic || drama?.picture || drama?.poster || drama?.thumb || drama?.thumbnail;
  return source ? appStore.api().resolve(source) : '';
};

function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}

async function loadNextPage() {
  if (loading.value || !hasMore.value) return;
  loading.value = true;
    error.value = '';
  try {
    const result = await appStore.api().rankings(props.board.id, page.value, 20);
    if (props.board.source === 'huangdou' || props.board.source === 'huangguo') {
      await appStore.loadSourceDramasForCovers(props.board.source, 0, result.items);
    }
    const nextItems = appStore.hydrateRankingItems(result.items);
    items.value.push(...nextItems);
    hasMore.value = result.hasMore ?? (result.totalPages ? page.value < result.totalPages : nextItems.length === 20);
    page.value += 1;
    await nextTick();
    observer?.observe(sentinel.value || document.body);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '读取榜单失败';
  } finally {
    loading.value = false;
  }
}

function observeSentinel() {
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) void loadNextPage();
  }, { rootMargin: '240px 0px' });
  observer.observe(sentinel.value);
}

onMounted(async () => {
  await loadNextPage();
  await nextTick();
  observeSentinel();
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="screen-view ranking-detail-view">
    <div class="detail-page-head">
      <button class="icon-button ranking-back" type="button" aria-label="返回首页" @click="emit('back')">‹</button>
      <div><span class="eyebrow">RANKING</span><h1>{{ props.board.name }}</h1><p>{{ props.board.description || '按站点返回顺序展示榜单内容。' }}</p></div>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <div v-if="!items.length && loading" class="empty-state"><strong>正在加载榜单</strong><span>先读取前 20 条内容。</span></div>
    <div v-else class="ranking-detail-list">
      <article v-for="item in items" :key="`${props.board.id}-${item.rank}-${item.drama?.id || item.drama?.sourceId || item.rank}`" class="ranking-detail-item">
        <span class="ranking-detail-rank">{{ item.rank || '—' }}</span>
        <div class="ranking-detail-poster" role="button" tabindex="0" :aria-label="`播放 ${titleOf(item.drama)}`" @click="item.drama && emit('playDrama', item.drama)" @keydown.enter="item.drama && emit('playDrama', item.drama)"><img v-if="coverOf(item.drama)" :src="coverOf(item.drama)" :alt="titleOf(item.drama)" @error="onImageError"><span v-else>暂无封面</span></div>
        <div class="ranking-detail-copy"><strong role="button" tabindex="0" @click="item.drama && emit('openDrama', item.drama)" @keydown.enter="item.drama && emit('openDrama', item.drama)">{{ titleOf(item.drama) }}</strong><span class="ranking-detail-meta"><span>{{ episodeLabel(item.drama) }}</span><span class="ranking-detail-meta-separator">|</span><span>{{ releaseStatusLabel(item.drama) }}</span><span>{{ categoryName(item.drama) }}</span></span></div>
        <button v-if="item.drama" class="ranking-detail-play" type="button" aria-label="查看详情" @click.stop="emit('openDrama', item.drama)">›</button>
      </article>
    </div>
    <div ref="sentinel" class="ranking-detail-sentinel" aria-hidden="true"></div>
    <div v-if="loading && items.length" class="ranking-detail-status">正在加载更多…</div>
    <div v-else-if="!hasMore && items.length" class="ranking-detail-status">已加载全部榜单</div>
  </section>
</template>
