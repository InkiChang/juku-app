<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama } from '../types/api';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const state = appStore.state;
const activeIndex = ref(0);
const touchStart = ref(0);

const fallback = [{ kind: '发现新剧', kicker: '剧库内容', title: '从剧库开始观看', detail: '同步观看记录后，这里会优先展示未完成观看和追剧更新。', cover: '/design-review/assets/poster-5.jpg', action: '浏览剧库', drama: undefined as Drama | undefined }];

const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.poster || drama?.thumb;
  return source ? appStore.api().resolve(source) : '';
};
const countOf = (drama?: Drama) => drama?.totalEpisode || drama?.episodeCount || '集数未知';
const categoryOf = (drama: Partial<Drama>) => drama.categoryName || drama.category || '热榜推荐';

function entryDrama(entry: { drama?: Drama; dramaId?: string; title?: string; category?: string; totalEpisode?: number }): Drama | undefined {
  if (entry.drama) return entry.drama;
  const known = appStore.findDrama(entry.dramaId);
  if (known) return known;
  if (!entry.dramaId && !entry.title) return undefined;
  return { id: entry.dramaId || `entry-${entry.title}`, title: entry.title, category: entry.category, totalEpisode: entry.totalEpisode };
}

const cards = computed(() => {
  const history = state.history.find(item => !item.completed && Number(item.position || 0) > 0) || state.history[0];
  const following = state.following.find(item => Number(item.newEpisodes || 0) > 0 && !item.completed) || state.following[0];
  const recent = [...state.dramas].sort((a, b) => String(b.onlineDate || '').localeCompare(String(a.onlineDate || '')))[0];
  const rankingItem = state.rankings[0];
  const ranking = rankingItem?.drama || entryDrama(rankingItem || {});
  const historyDrama = entryDrama(history || {});
  const followingDrama = entryDrama(following || {});
  const dynamic = [
    historyDrama ? { kind: '未完成观看', kicker: `未完成观看 · 第 ${history?.index || history?.episode || 1} 集`, title: titleOf(historyDrama), detail: history?.duration ? `已观看 ${Math.floor(Number(history.position || 0) / 60)} 分钟 · 继续上次进度` : '继续上次的观看进度', cover: coverOf(historyDrama), action: '继续播放', drama: historyDrama } : null,
    followingDrama ? { kind: '追剧有新集', kicker: `追剧有新集 · 更新 ${following?.newEpisodes || 1} 集`, title: titleOf(followingDrama), detail: '你的追剧列表有新的更新', cover: coverOf(followingDrama), action: '继续追剧', drama: followingDrama } : null,
    recent ? { kind: '近期上线', kicker: '近期上线 · 新剧推荐', title: titleOf(recent), detail: `${countOf(recent)} 集 · ${recent.categoryName || recent.category || '最新内容'}`, cover: coverOf(recent), action: '立即播放', drama: recent } : null,
    ranking ? { kind: '热榜名次', kicker: `热榜名次 · NO.${rankingItem?.rank || 1}`, title: titleOf(ranking), detail: rankingItem?.metric || `${countOf(ranking)} 集 · 热门推荐`, cover: coverOf(ranking), action: '开始观看', drama: ranking } : null,
  ].filter(Boolean) as Array<typeof fallback[number] & { drama?: Drama }>;
  const seen = new Set<string>();
  const unique = dynamic.filter(item => {
    const id = item.drama?.id || item.kind;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return unique.length ? unique : fallback;
});

const hotList = computed(() => state.rankings.slice(0, 6).map(item => item.drama).filter(Boolean) as Drama[]);

onMounted(async () => {
  await Promise.allSettled([appStore.loadMore(), appStore.loadHome()]);
});

function move(step: number) { activeIndex.value = (activeIndex.value + step + cards.value.length) % cards.value.length; }
function choose(index: number) { activeIndex.value = index; }
function handleTouchStart(event: TouchEvent) { touchStart.value = event.changedTouches[0]?.clientX || 0; }
function handleTouchEnd(event: TouchEvent) { const distance = (event.changedTouches[0]?.clientX || 0) - touchStart.value; if (Math.abs(distance) > 40) move(distance < 0 ? 1 : -1); }
function cardDrama(card: (typeof cards.value)[number]): Drama | null { return card.drama || null; }
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}
</script>

<template>
  <section class="screen-view home-view">
    <div class="heading-row"><div><span class="eyebrow">GOOD EVENING</span><h1>今天看点什么</h1><p>优先接着看，再从更新和热榜里发现新剧。</p></div><button class="icon-button" type="button" aria-label="刷新推荐" @click="appStore.loadHome()">↻</button></div>
    <section class="hero-carousel" aria-label="今日推荐轮播" @touchstart.passive="handleTouchStart" @touchend.passive="handleTouchEnd">
      <div class="hero-track" :style="{ transform: `translateX(-${activeIndex * 100}%)` }">
        <article v-for="card in cards" :key="card.kind" class="hero-slide">
          <img :src="card.cover" :alt="card.title" @error="onImageError" />
          <div class="hero-overlay"></div>
          <div class="hero-content"><span class="hero-kicker">{{ card.kicker }}</span><h2>{{ card.title }}</h2><p>{{ card.detail }}</p><div v-if="card.drama" class="hero-actions"><button class="primary-button" type="button" @click="emit('playDrama', cardDrama(card)!)">{{ card.action }}</button><button class="secondary-button" type="button" @click="emit('openDrama', cardDrama(card)!)">查看详情</button></div></div>
        </article>
      </div>
      <div class="hero-controls"><button class="hero-control" type="button" aria-label="上一张推荐" @click="move(-1)">‹</button><button class="hero-control" type="button" aria-label="下一张推荐" @click="move(1)">›</button></div>
      <div class="hero-pagination"><button v-for="(_, index) in cards" :key="index" :class="['hero-dot', { active: activeIndex === index }]" type="button" :aria-label="`第 ${index + 1} 张推荐`" @click="choose(index)"></button></div>
    </section>

    <div class="section-head"><h2>站源</h2><span>更新于刚刚</span></div><div class="source-tabs"><button class="active" type="button">红果</button><button type="button">黄果</button><button type="button">黄豆</button></div>
    <div class="section-head"><h2>热播榜</h2><button class="text-button" type="button">查看全部</button></div>
    <div v-if="hotList.length" class="poster-row"><article v-for="(drama, index) in hotList" :key="drama.id" class="poster-card" @click="emit('openDrama', drama)"><div class="poster"><img :src="coverOf(drama)" :alt="titleOf(drama)" @error="onImageError"><span class="poster-badge">NO.{{ index + 1 }}</span><button class="poster-play" type="button" aria-label="播放" @click.stop="emit('playDrama', drama)">▶</button></div><strong>{{ titleOf(drama) }}</strong><small>{{ categoryOf(drama) }} · {{ countOf(drama) }} 集</small></article></div><div v-else class="empty-state"><strong>热榜暂不可用</strong><span>后端返回榜单后，这里会显示实时排名。</span></div>
  </section>
</template>
