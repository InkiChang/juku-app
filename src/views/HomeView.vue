<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama } from '../types/api';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const state = appStore.state;
const activeIndex = ref(0);
const touchStart = ref(0);

const fallback = [
  { kind: '未完成观看', kicker: '未完成观看 · 第 18 集', title: '180万照妖镜', detail: '已观看 12 分钟 · 还剩 6 分钟', cover: '/design-review/assets/poster-5.jpg', action: '继续播放' },
  { kind: '追剧有新集', kicker: '追剧有新集 · 更新 4 集', title: '误入豪门的她', detail: '看到第 42 集 · 昨天更新了 4 集', cover: '/design-review/assets/poster-2.jpg', action: '继续追剧' },
  { kind: '近期上线', kicker: '近期上线 · 今日上架', title: '命运回响', detail: '全 36 集完结 · 都市悬疑新剧', cover: '/design-review/assets/poster-4.jpg', action: '立即播放' },
  { kind: '热榜名次', kicker: '热榜名次 · NO.1', title: '重启人生后我赢麻了', detail: '红果热榜第 1 名 · 72 集完结', cover: '/design-review/assets/poster-1.jpg', action: '开始观看' },
];

const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.poster || drama?.thumb;
  return source ? appStore.api().resolve(source) : '';
};
const countOf = (drama?: Drama) => drama?.totalEpisode || drama?.episodeCount || '集数未知';
const categoryOf = (drama: Partial<Drama>) => drama.categoryName || drama.category || '热榜推荐';

const cards = computed(() => {
  const history = state.history[0];
  const following = state.following[0];
  const recent = state.dramas[0];
  const ranking = state.rankings[0]?.drama;
  const dynamic = [
    history?.drama ? { kind: '未完成观看', kicker: `未完成观看 · 第 ${history.episode || history.episodeIndex || 1} 集`, title: titleOf(history.drama), detail: '继续上次的观看进度', cover: coverOf(history.drama), action: '继续播放', drama: history.drama } : null,
    following?.drama ? { kind: '追剧有新集', kicker: `追剧有新集 · ${following.latestEpisode || '有新集'}`, title: titleOf(following.drama), detail: '你的追剧列表有新的更新', cover: coverOf(following.drama), action: '继续追剧', drama: following.drama } : null,
    recent ? { kind: '近期上线', kicker: '近期上线 · 新剧推荐', title: titleOf(recent), detail: `${countOf(recent)} 集 · ${recent.categoryName || recent.category || '最新内容'}`, cover: coverOf(recent), action: '立即播放', drama: recent } : null,
    ranking ? { kind: '热榜名次', kicker: `热榜名次 · NO.${state.rankings[0]?.rank || 1}`, title: titleOf(ranking), detail: state.rankings[0]?.metric || `${countOf(ranking)} 集 · 热门推荐`, cover: coverOf(ranking), action: '开始观看', drama: ranking } : null,
  ].filter(Boolean) as Array<typeof fallback[number] & { drama?: Drama }>;
  return fallback.map((item, index) => dynamic[index] || item);
});

const hotList = computed(() => state.rankings.slice(0, 6).map(item => item.drama).filter(Boolean) as Drama[]);
const fallbackHot = [
  { title: '重启人生后我赢麻了', totalEpisode: 72, categoryName: '红果 · 热榜 1', cover: '/design-review/assets/poster-1.jpg', id: 'fallback-1' },
  { title: '误入豪门的她', totalEpisode: 64, categoryName: '红果 · 热榜 2', cover: '/design-review/assets/poster-2.jpg', id: 'fallback-2' },
  { title: '归来仍是掌中宝', totalEpisode: 80, categoryName: '红果 · 热榜 3', cover: '/design-review/assets/poster-3.jpg', id: 'fallback-3' },
  { title: '天才萌宝拐个爹', totalEpisode: 90, categoryName: '红果 · 热榜 4', cover: '/design-review/assets/poster-6.jpg', id: 'fallback-4' },
];

onMounted(async () => {
  await Promise.allSettled([appStore.loadMore(), appStore.loadHome()]);
});

function move(step: number) { activeIndex.value = (activeIndex.value + step + cards.value.length) % cards.value.length; }
function choose(index: number) { activeIndex.value = index; }
function handleTouchStart(event: TouchEvent) { touchStart.value = event.changedTouches[0]?.clientX || 0; }
function handleTouchEnd(event: TouchEvent) { const distance = (event.changedTouches[0]?.clientX || 0) - touchStart.value; if (Math.abs(distance) > 40) move(distance < 0 ? 1 : -1); }
function cardDrama(card: (typeof cards.value)[number]): Drama {
  return card.drama || { id: `fallback-${card.kind}`, title: card.title, cover: card.cover };
}
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
          <div class="hero-content"><span class="hero-kicker">{{ card.kicker }}</span><h2>{{ card.title }}</h2><p>{{ card.detail }}</p><div class="hero-actions"><button class="primary-button" type="button" @click="emit('playDrama', cardDrama(card))">{{ card.action }}</button><button class="secondary-button" type="button" @click="emit('openDrama', cardDrama(card))">查看详情</button></div></div>
        </article>
      </div>
      <div class="hero-controls"><button class="hero-control" type="button" aria-label="上一张推荐" @click="move(-1)">‹</button><button class="hero-control" type="button" aria-label="下一张推荐" @click="move(1)">›</button></div>
      <div class="hero-pagination"><button v-for="(_, index) in cards" :key="index" :class="['hero-dot', { active: activeIndex === index }]" type="button" :aria-label="`第 ${index + 1} 张推荐`" @click="choose(index)"></button></div>
    </section>

    <div class="section-head"><h2>站源</h2><span>更新于刚刚</span></div><div class="source-tabs"><button class="active" type="button">红果</button><button type="button">黄果</button><button type="button">黄豆</button></div>
    <div class="section-head"><h2>热播榜</h2><button class="text-button" type="button">查看全部</button></div>
    <div class="poster-row"><article v-for="(drama, index) in (hotList.length ? hotList : fallbackHot)" :key="drama.id" class="poster-card" @click="emit('openDrama', drama)"><div class="poster"><img :src="coverOf(drama) || drama.cover" :alt="titleOf(drama)" @error="onImageError"><span class="poster-badge">NO.{{ index + 1 }}</span><button class="poster-play" type="button" aria-label="播放" @click.stop="emit('playDrama', drama)">▶</button></div><strong>{{ titleOf(drama) }}</strong><small>{{ categoryOf(drama) }} · {{ countOf(drama) }} 集</small></article></div>
  </section>
</template>
