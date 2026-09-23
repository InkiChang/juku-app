<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { appStore, sameDrama } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
import type { Drama, RankingItem } from '../types/api';
import { categoryName, dramaMetaLine, episodeCount, episodeLabel, rankingMetaLine, releaseStatusLabel, sourceLabel } from '../utils/drama';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama]; openRanking: [boardId: string] }>();
const state = appStore.state;
const activeIndex = ref(0);
const touchStart = ref(0);
const loadingSource = ref(false);
const currentTime = ref(new Date());
let greetingTimer: number | null = null;
let sourceRequestId = 0;
const pendingFollowing = ref(new Set<string>());
const pendingDownloads = ref(new Set<string>());

const sourceOptions = [
  { id: 'hongguo', label: '红果' },
  { id: 'huangguo', label: '黄果' },
  { id: 'huangdou', label: '黄豆' },
];
const greeting = computed(() => {
  const hour = currentTime.value.getHours();
  if (hour >= 5 && hour < 12) return 'GOOD MORNING';
  if (hour >= 12 && hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
});

type RecommendationCard = {
  kind: string;
  kicker: string;
  title: string;
  detail: string;
  cover: string;
  action: string;
  drama?: Drama;
};

const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama, fallback = '/design-review/assets/poster-5.jpg') => {
  const source = drama?.cover || drama?.coverUrl || drama?.cover_url || drama?.image || drama?.imageUrl || drama?.image_url || drama?.img || drama?.pic || drama?.picture || drama?.poster || drama?.thumb || drama?.thumbnail;
  return source ? appStore.api().resolve(source) : fallback;
};
const countOf = (drama?: Drama) => episodeCount(drama);

function entryDrama(entry: { drama?: Drama; dramaId?: string; title?: string; category?: string; totalEpisode?: number }): Drama | undefined {
  if (entry.drama) return entry.drama;
  const known = appStore.findDrama(entry.dramaId);
  if (known) return known;
  if (!entry.dramaId && !entry.title) return undefined;
  return { id: entry.dramaId || `entry-${entry.title}`, title: entry.title, category: entry.category, totalEpisode: entry.totalEpisode };
}

const cards = computed<RecommendationCard[]>(() => {
  const history = state.history.find(item => !item.completed && Number(item.position || 0) > 0) || state.history[0];
  const following = state.following.find(item => Number(item.newEpisodes || 0) > 0 && !item.completed) || state.following[0];
  const recent = [...state.dramas].sort((a, b) => String(b.onlineDate || '').localeCompare(String(a.onlineDate || '')))[0];
  const rankingItem = state.rankings[0];
  const ranking = rankingItem?.drama || entryDrama(rankingItem || {});
  const historyDrama = entryDrama(history || {});
  const followingDrama = entryDrama(following || {});
  return [
    historyDrama ? { kind: '未完成观看', kicker: `未完成观看 · 第 ${history?.index || history?.episode || 1} 集`, title: titleOf(historyDrama), detail: history?.duration ? `已观看 ${Math.floor(Number(history.position || 0) / 60)} 分钟 · 继续上次进度` : '继续上次的观看进度', cover: coverOf(historyDrama), action: '继续播放', drama: historyDrama } : { kind: '未完成观看', kicker: '未完成观看', title: '暂无未完成观看', detail: '开始观看后，进度会自动同步到这里。', cover: '/design-review/assets/poster-5.jpg', action: '继续播放' },
    followingDrama ? { kind: '追剧有新集', kicker: `追剧有新集 · 更新 ${following?.newEpisodes || 1} 集`, title: titleOf(followingDrama), detail: '你的追剧列表有新的更新', cover: coverOf(followingDrama), action: '继续追剧', drama: followingDrama } : { kind: '追剧有新集', kicker: '追剧有新集', title: '暂无追剧更新', detail: '在剧库加入追剧后，新集会出现在这里。', cover: '/design-review/assets/poster-2.jpg', action: '继续追剧' },
    recent ? { kind: '近期上线', kicker: '近期上线 · 新剧推荐', title: titleOf(recent), detail: dramaMetaLine(recent), cover: coverOf(recent), action: '立即播放', drama: recent } : { kind: '近期上线', kicker: '近期上线', title: '暂无新剧数据', detail: '剧库更新后会展示近期上线内容。', cover: '/design-review/assets/poster-4.jpg', action: '立即播放' },
    ranking ? { kind: '热榜名次', kicker: `热榜名次 · NO.${rankingItem?.rank || 1}`, title: titleOf(ranking), detail: rankingMetaLine(ranking), cover: coverOf(ranking), action: '开始观看', drama: ranking } : { kind: '热榜名次', kicker: '热榜名次', title: '暂无热榜数据', detail: '榜单更新后会展示当前站源的热门内容。', cover: '/design-review/assets/poster-1.jpg', action: '开始观看' },
  ];
});

const rankingSections = computed(() => state.rankingBoards
  .filter(board => board.source === state.rankingSource)
  .map(board => ({ board, items: state.rankingLists[board.id] || [] }))
  .filter(section => section.items.length));

watch(() => cards.value.length, () => {
  if (activeIndex.value >= cards.value.length) activeIndex.value = 0;
});

onMounted(async () => {
  greetingTimer = window.setInterval(() => { currentTime.value = new Date(); }, 60_000);
  loadingSource.value = true;
  try { await Promise.allSettled([appStore.loadMore(), appStore.loadHome()]); }
  finally { loadingSource.value = false; }
});
onBeforeUnmount(() => { if (greetingTimer) window.clearInterval(greetingTimer); });

function move(step: number) { activeIndex.value = (activeIndex.value + step + cards.value.length) % cards.value.length; }
function choose(index: number) { activeIndex.value = index; }
function handleTouchStart(event: TouchEvent) { touchStart.value = event.changedTouches[0]?.clientX || 0; }
function handleTouchEnd(event: TouchEvent) { const distance = (event.changedTouches[0]?.clientX || 0) - touchStart.value; if (Math.abs(distance) > 40) move(distance < 0 ? 1 : -1); }
function cardDrama(card: RecommendationCard): Drama | null { return card.drama || null; }
async function onImageError(event: Event, drama?: Drama, cover = '') {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.style.display = 'none';
  if (!drama) return;
  const repaired = await appStore.repairDramaCover(drama.id, cover);
  if (!repaired) return;
  image.style.display = '';
  image.src = appStore.api().resolve(repaired);
}
function isFollowing(drama?: Drama): boolean {
  if (!drama) return false;
  return state.following.some(item => {
    return sameDrama(item, drama) && item.saved !== false;
  });
}
async function toggleFollowing(drama: Drama) {
  if (pendingFollowing.value.has(drama.id)) return;
  pendingFollowing.value = new Set(pendingFollowing.value).add(drama.id);
  const saved = !isFollowing(drama);
  try {
    await appStore.updateFollowing(drama.id, { saved, completed: false });
  } catch (error) {
    state.error = error instanceof Error ? error.message : '追剧操作失败';
  } finally {
    const next = new Set(pendingFollowing.value);
    next.delete(drama.id);
    pendingFollowing.value = next;
  }
}
async function enqueueDownload(drama: Drama) {
  if (pendingDownloads.value.has(drama.id)) return;
  pendingDownloads.value = new Set(pendingDownloads.value).add(drama.id);
  try {
    await appStore.api().enqueueDownload([drama.id]);
  } catch (error) {
    state.error = error instanceof Error ? error.message : '加入下载失败';
  } finally {
    const next = new Set(pendingDownloads.value);
    next.delete(drama.id);
    pendingDownloads.value = next;
  }
}
async function selectSource(source: string) {
  if (source === state.rankingSource && loadingSource.value) return;
  if (source === state.rankingSource && rankingSections.value.length) return;
  const requestId = ++sourceRequestId;
  loadingSource.value = true;
  try { await appStore.loadRankingsForSource(source); }
  finally {
    if (requestId === sourceRequestId) loadingSource.value = false;
  }
}
</script>

<template>
  <section class="screen-view home-view">
    <div class="heading-row"><div><span class="eyebrow">{{ greeting }}</span><h1>今天看点什么</h1><p>优先接着看，再从更新和热榜里发现新剧。</p></div></div>
    <section class="hero-carousel" aria-label="今日推荐轮播" @touchstart.passive="handleTouchStart" @touchend.passive="handleTouchEnd">
      <div class="hero-track" :style="{ transform: `translateX(-${activeIndex * 100}%)` }">
        <article v-for="card in cards" :key="card.kind" class="hero-slide">
          <img :src="card.cover" :alt="card.title" @error="onImageError($event, card.drama, coverOf(card.drama, ''))" />
          <div class="hero-overlay"></div>
          <div class="hero-content"><span class="hero-kicker">{{ card.kicker }}</span><h2 :class="{ 'hero-title-link': card.drama }" :role="card.drama ? 'button' : undefined" :tabindex="card.drama ? 0 : undefined" @click="card.drama && emit('openDrama', cardDrama(card)!)" @keydown.enter="card.drama && emit('openDrama', cardDrama(card)!)">{{ card.title }}</h2><p>{{ card.detail }}</p><div v-if="card.drama" class="hero-actions"><button class="primary-button" type="button" @click="emit('playDrama', cardDrama(card)!)">{{ card.action }}</button><button class="secondary-button" type="button" @click="emit('openDrama', cardDrama(card)!)">查看详情</button></div></div>
        </article>
      </div>
      <div class="hero-controls"><button class="hero-control" type="button" aria-label="上一张推荐" @click="move(-1)">‹</button><button class="hero-control" type="button" aria-label="下一张推荐" @click="move(1)">›</button></div>
      <div class="hero-pagination"><button v-for="(_, index) in cards" :key="index" :class="['hero-dot', { active: activeIndex === index }]" type="button" :aria-label="`第 ${index + 1} 张推荐`" @click="choose(index)"></button></div>
    </section>

    <div class="section-head"><h2>站源</h2><span>{{ loadingSource || state.rankingLoading ? '正在切换榜单…' : '更新于刚刚' }}</span></div>
    <div class="source-tabs"><button v-for="source in sourceOptions" :key="source.id" :class="{ active: state.rankingSource === source.id }" type="button" @click="selectSource(source.id)">{{ source.label }}</button></div>
    <div class="rankings-stack">
      <section v-for="section in rankingSections" :key="section.board.id" class="ranking-section"><div class="ranking-section-head"><div class="ranking-heading-copy"><h3>{{ section.board.name }}</h3><span>{{ section.board.description }}</span></div><button class="text-button" type="button" @click="emit('openRanking', section.board.id)">查看全部</button></div><div class="poster-row"><article v-for="item in section.items" :key="`${section.board.id}-${item.rank}-${item.drama?.id}`" class="poster-card"><div class="poster" role="button" tabindex="0" :aria-label="`播放 ${titleOf(item.drama)}`" @click="item.drama && emit('playDrama', item.drama)" @keydown.enter="item.drama && emit('playDrama', item.drama)"><img v-if="coverOf(item.drama, '')" :src="coverOf(item.drama, '')" :alt="titleOf(item.drama)" @error="onImageError($event, item.drama, coverOf(item.drama, ''))"><span v-else class="poster-missing">暂无封面</span><span class="poster-badge">NO.{{ item.rank || 0 }}</span><span v-if="item.drama" class="poster-source-badge">{{ sourceLabel(item.drama) }}</span><span v-if="item.drama" class="poster-category-badge">{{ categoryName(item.drama) }}</span></div><strong role="button" tabindex="0" @click="item.drama && emit('openDrama', item.drama)" @keydown.enter="item.drama && emit('openDrama', item.drama)">{{ titleOf(item.drama) }}</strong><small class="poster-meta"><span class="poster-meta-copy">{{ episodeLabel(item.drama) }}|{{ releaseStatusLabel(item.drama) }}</span><span v-if="item.drama" class="poster-meta-actions"><button class="card-action-icon" :class="{ active: isFollowing(item.drama) }" type="button" :aria-label="isFollowing(item.drama) ? '取消追剧' : '加入追剧'" :disabled="pendingFollowing.has(item.drama.id)" @click.stop="toggleFollowing(item.drama)"><AppIcon name="following" :size="15" /></button><button class="card-action-icon" type="button" :aria-label="`下载 ${titleOf(item.drama)}`" :disabled="pendingDownloads.has(item.drama.id)" @click.stop="enqueueDownload(item.drama)"><AppIcon name="download" :size="15" /></button></span></small></article></div></section>
    <div v-if="(loadingSource || state.rankingLoading) && !rankingSections.length" class="empty-state"><strong>正在加载榜单</strong><span>正在读取 {{ sourceOptions.find(source => source.id === state.rankingSource)?.label || '当前站源' }} 的榜单。</span></div>
      <div v-else-if="!rankingSections.length" class="empty-state"><strong>榜单暂不可用</strong><span>当前站源暂未返回榜单内容，请稍后刷新。</span></div>
    </div>
  </section>
</template>
