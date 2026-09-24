<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore, sameDrama } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
import type { Drama } from '../types/api';
import { categoryName, episodeLabel, releaseStatusLabel, sourceLabel as dramaSourceLabel } from '../utils/drama';

const state = appStore.state;
const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const search = ref('');
const remoteResults = ref<Drama[]>([]);
const searching = ref(false);
const catalogMatches = ref<Drama[] | null>(null);
const visibleCatalogCount = ref(30);
const hideVip = ref(false);
const sortMode = ref('default');
const selectedSource = ref('all');
const selectedCategory = ref('all');
const sourceMenuOpen = ref(false);
const categoryMenuOpen = ref(false);
const sortMenuOpen = ref(false);
const categoryOptions = ref<string[]>([]);
const pendingFollowing = ref(new Set<string>());
const pendingDownloads = ref(new Set<string>());
let sourceRequestToken = 0;
let searchRequestToken = 0;
let catalogPollTimer: number | null = null;

const sourceOptions = [
  { id: 'all', label: '全部站源' },
  { id: 'hongguo', label: '红果' },
  { id: 'huangguo', label: '黄果' },
  { id: 'huangdou', label: '黄豆' },
];
const sortOptions = [
  { id: 'default', label: '默认排序' },
  { id: 'newest', label: '最新上线' },
  { id: 'oldest', label: '最早上线' },
  { id: 'heat', label: '热度最高' },
  { id: 'views', label: '播放最多' },
  { id: 'title', label: '名称排序' },
];

const titleOf = (drama: { title?: string; name?: string }) => drama.title || drama.name || '未命名短剧';
const coverOf = (drama: Drama) => drama.cover || drama.coverUrl || drama.cover_url || drama.image || drama.imageUrl || drama.image_url || drama.img || drama.pic || drama.picture || drama.poster || drama.thumb || drama.thumbnail || '';
const sourceMatches = (drama: Drama, source: string) => {
  if (source === 'all') return true;
  const aliases: Record<string, string> = { hongguo: 'hongguo', redfruit: 'hongguo', 'red-fruit': 'hongguo', '红果': 'hongguo', 'hongguoduanju.com': 'hongguo', huangguo: 'huangguo', huangguoai: 'huangguo', 'huangguo-video': 'huangguo', 'huangguo-ai': 'huangguo', 'huangguoai.com': 'huangguo', 'huangguo.video': 'huangguo', cloudfront: 'huangguo', api: 'huangguo', '黄果': 'huangguo', huangdou: 'huangdou', yellowbean: 'huangdou', 'yellow-bean': 'huangdou', 'tideember.cc': 'huangdou', 'xqjurgek.top': 'huangdou', '黄豆': 'huangdou' };
  for (const hint of [drama.source, drama.id.split(':')[0], drama.channelName, drama.channel_name, drama.site, drama.host]) {
    const raw = String(hint || '').trim().toLowerCase();
    const value = /^https?:\/\//.test(raw) ? (() => { try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return raw; } })() : raw.replace(/^www\./, '').split(':')[0].replace(/[_\s]+/g, '-');
    if (aliases[value]) return aliases[value] === source;
  }
  return !drama.source && ['黄果原创', '成人短剧', '成人漫剧', 'AI魔改'].includes(String(drama.channelName || drama.channel_name || '')) && source === 'huangguo';
};
const categoryOf = (drama: Drama) => {
  const direct = [drama.categoryName, drama.category_name, drama.typeName, drama.type_name, drama.sortName, drama.sort_name, drama.category, drama.categoryNameSnake].map(value => String(value || '').trim()).find(Boolean);
  return direct || (['黄果原创', '成人短剧', '成人漫剧', 'AI魔改'].includes(String(drama.channelName || drama.channel_name || '')) ? String(drama.channelName || drama.channel_name) : '');
};
const categoryLabel = (drama: Drama) => categoryName(drama) === '未分类' ? '未分类' : categoryName(drama);
const isFollowing = (drama: Drama) => state.following.some(item => {
  return sameDrama(item, drama) && item.saved !== false;
});

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
const tagsOf = (drama: Drama) => Array.isArray(drama.tags) ? drama.tags.map(String).filter(Boolean) : [];
const normalizeSearchText = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/[\p{P}\s]+/gu, '') || String(value ?? '').normalize('NFKC').toLowerCase().trim();
const searchableTextOf = (drama: Drama) => normalizeSearchText([drama.title, drama.name, drama.id, drama.desc, drama.intro, drama.remark, drama.channelName, drama.channel_name, categoryOf(drama), tagsOf(drama).join(' ')].filter(Boolean).join(' '));

const sourceLabel = computed(() => sourceOptions.find(item => item.id === selectedSource.value)?.label || '全部站源');
const sortLabel = computed(() => sortOptions.find(item => item.id === sortMode.value)?.label || '默认排序');
const hasActiveFilters = computed(() => Boolean(search.value.trim() || selectedSource.value !== 'all' || selectedCategory.value !== 'all' || sortMode.value !== 'default' || hideVip.value));
const serverResultTotal = computed(() => {
  // The server total describes the complete catalog, while allFilteredDramas
  // only describes entries that have already been loaded into the client.
  // Use the server value for an unfiltered catalog and the local match count
  // whenever a search or content filter changes the result set.
  const hasLocalFilter = Boolean(search.value.trim() || selectedCategory.value !== 'all' || hideVip.value);
  if (hasLocalFilter) return allFilteredDramas.value.length;
  if (selectedSource.value === 'all') {
    if (state.libraryTotal > 0) return state.libraryTotal;
    return state.libraryLoading || state.libraryCountUnknown ? undefined : allFilteredDramas.value.length;
  }
  const sourceTotal = state.librarySourceTotals[selectedSource.value];
  if (sourceTotal !== undefined) return sourceTotal;
  return state.libraryLoading || state.libraryCountUnknown ? undefined : allFilteredDramas.value.length;
});
const serverResultSummary = computed(() => {
  if (serverResultTotal.value === undefined) return state.libraryLoading || state.libraryCountUnknown ? '正在统计…' : '数量未知';
  return `${serverResultTotal.value} 部`;
});
const baseDramas = computed(() => {
  const query = normalizeSearchText(search.value);
  const usingCatalogMatches = catalogMatches.value !== null;
  const usingRemoteResults = Boolean(query && remoteResults.value.length);
  const source = (usingCatalogMatches ? catalogMatches.value : (usingRemoteResults ? remoteResults.value : state.dramas)) || [];
  return source.filter(drama => {
    if (!sourceMatches(drama, selectedSource.value)) return false;
    if (selectedCategory.value !== 'all' && categoryOf(drama) !== selectedCategory.value) return false;
    if (!query || usingRemoteResults) return true;
    return searchableTextOf(drama).includes(query);
  });
});
const allFilteredDramas = computed(() => [...baseDramas.value]
  .filter(drama => !hideVip.value || (drama.vip !== true && drama.vip !== 'true'))
  .sort((a, b) => {
    if (sortMode.value === 'newest' || sortMode.value === 'oldest') {
      const left = String(a.onlineDate || '');
      const right = String(b.onlineDate || '');
      return sortMode.value === 'oldest' ? left.localeCompare(right) : right.localeCompare(left);
    }
    if (sortMode.value === 'heat' || sortMode.value === 'views') {
      const field = sortMode.value;
      const metric = (drama: Drama) => Number(String(field === 'heat' ? drama.heat : drama.views ?? '').replace(/[^\d.\-]/g, '')) || 0;
      const left = metric(a);
      const right = metric(b);
      return right - left;
    }
    if (sortMode.value === 'title') return titleOf(a).localeCompare(titleOf(b), 'zh-CN');
    // Match the Web library's default landing order: Hongguo first, then other sources.
    const sourceRank = (drama: Drama) => sourceMatches(drama, 'hongguo') ? 0 : sourceMatches(drama, 'huangguo') ? 1 : sourceMatches(drama, 'huangdou') ? 2 : 3;
    return sourceRank(a) - sourceRank(b);
  }));
const filteredDramas = computed(() => allFilteredDramas.value.slice(0, catalogMatches.value ? visibleCatalogCount.value : undefined));

function stopCatalogPoll() {
  if (catalogPollTimer !== null) window.clearTimeout(catalogPollTimer);
  catalogPollTimer = null;
}

function scheduleCatalogPoll() {
  if (catalogPollTimer !== null || !state.libraryLoading && !state.libraryCountUnknown) return;
  catalogPollTimer = window.setTimeout(async () => {
    catalogPollTimer = null;
    if (!state.libraryLoading && !state.libraryCountUnknown) return;
    try {
      const catalog = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
      // Do not replace an active search result with the in-progress catalogue.
      // The next search/clear action will use the refreshed cache.
      if (!search.value.trim()) catalogMatches.value = catalog;
    } catch {
      // Keep the current rows visible; the next scheduled poll retries.
    }
    scheduleCatalogPoll();
  }, 1500);
}

async function executeSearch() {
  const query = search.value.trim();
  if (!query) {
    searchRequestToken += 1;
    remoteResults.value = [];
    catalogMatches.value = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
    visibleCatalogCount.value = 30;
    searching.value = false;
    scheduleCatalogPoll();
    return;
  }
  const requestToken = ++searchRequestToken;
  searching.value = true;
  state.error = '';
  const keyword = normalizeSearchText(query);
  const catalog = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
  scheduleCatalogPoll();
  const localMatches = catalog.filter(drama => searchableTextOf(drama).includes(keyword));
  if (requestToken !== searchRequestToken || query !== search.value.trim()) return;
  catalogMatches.value = localMatches;
  visibleCatalogCount.value = 30;
  remoteResults.value = localMatches;
  try {
  const result = selectedSource.value === 'all' || selectedSource.value === 'hongguo'
    ? await appStore.searchLibrary(query)
    : { items: [], query };
    if (requestToken !== searchRequestToken || query !== search.value.trim()) return;
    if (result.items.length) {
      const merged = new Map(localMatches.map(drama => [drama.id, drama]));
      for (const drama of result.items) {
        if (sourceMatches(drama, selectedSource.value)) merged.set(drama.id, drama);
      }
      catalogMatches.value = [...merged.values()];
      remoteResults.value = catalogMatches.value;
    }
  }
  catch (error) {
    if (requestToken === searchRequestToken) state.error = error instanceof Error ? error.message : '搜索失败';
  }
  finally {
    if (requestToken === searchRequestToken) searching.value = false;
  }
}

async function handleSearchInput() {
  searchRequestToken += 1;
  remoteResults.value = [];
  searching.value = false;
  const token = searchRequestToken;
  const catalog = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
  scheduleCatalogPoll();
  if (token !== searchRequestToken) return;
  catalogMatches.value = catalog;
  visibleCatalogCount.value = 30;
}

async function selectSource(source: string) {
  const requestToken = ++sourceRequestToken;
  selectedSource.value = source;
  selectedCategory.value = 'all';
  catalogMatches.value = null;
  visibleCatalogCount.value = 30;
  remoteResults.value = [];
  sourceMenuOpen.value = false;
  categoryMenuOpen.value = false;
  sortMenuOpen.value = false;
  catalogMatches.value = await appStore.libraryCatalog(source === 'all' ? undefined : source);
  visibleCatalogCount.value = 30;
  scheduleCatalogPoll();
  if (requestToken !== sourceRequestToken) return;
  await loadCategories(source);
}

async function selectCategory(category: string) {
  selectedCategory.value = category;
  categoryMenuOpen.value = false;
  visibleCatalogCount.value = 30;
  if (category === 'all') {
    catalogMatches.value = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
    scheduleCatalogPoll();
    return;
  }
  const catalog = await appStore.libraryCatalog(selectedSource.value === 'all' ? undefined : selectedSource.value);
  scheduleCatalogPoll();
  catalogMatches.value = catalog.filter(drama => categoryOf(drama) === category);
}

function selectSort(sort: string) {
  sortMode.value = sort;
  sortMenuOpen.value = false;
}

async function loadCategories(source = selectedSource.value) {
  categoryOptions.value = await appStore.loadLibraryCategories(source);
}

async function resetFilters() {
  searchRequestToken += 1;
  sourceRequestToken += 1;
  search.value = '';
  remoteResults.value = [];
  catalogMatches.value = await appStore.libraryCatalog();
  visibleCatalogCount.value = 30;
  scheduleCatalogPoll();
  selectedSource.value = 'all';
  selectedCategory.value = 'all';
  sortMode.value = 'default';
  hideVip.value = false;
  sourceMenuOpen.value = false;
  categoryMenuOpen.value = false;
  sortMenuOpen.value = false;
  void loadCategories('all');
}

async function loadMore() {
  if (catalogMatches.value) {
    visibleCatalogCount.value = Math.min(catalogMatches.value.length, visibleCatalogCount.value + 30);
    return;
  }
  if (state.loading || !state.hasMore) return;
  const before = state.dramas.length;
  await appStore.loadMore();
  if (!state.error && state.dramas.length === before && state.hasMore) {
    state.error = '暂时没有更多剧集，请稍后重试';
  }
}

async function onImageError(event: Event, drama: Drama) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.style.display = 'none';
  const poster = image.parentElement;
  if (!poster) return;
  let missing = poster.querySelector('.poster-missing');
  if (!missing) {
    missing = document.createElement('span');
    missing.className = 'poster-missing';
    missing.textContent = '封面加载中';
    poster.appendChild(missing);
  }
  const repaired = await appStore.repairDramaCover(drama.id, coverOf(drama));
  if (!repaired) {
    missing.textContent = '暂无封面';
    return;
  }
  missing.remove();
  image.style.display = '';
  image.onerror = null;
  image.src = appStore.api().resolve(repaired);
}

onMounted(async () => {
  await appStore.refreshLibrary();
  catalogMatches.value = await appStore.libraryCatalog();
  scheduleCatalogPoll();
  await loadCategories();
  window.addEventListener('juku:pull-refresh', handlePullRefresh);
});
onBeforeUnmount(() => {
  stopCatalogPoll();
  window.removeEventListener('juku:pull-refresh', handlePullRefresh);
});

async function handlePullRefresh() {
  await appStore.refreshLibrary();
  remoteResults.value = [];
  catalogMatches.value = await appStore.libraryCatalog();
  visibleCatalogCount.value = 30;
  scheduleCatalogPoll();
  await loadCategories();
}
</script>

<template>
  <section class="library-view">
    <div class="library-header">
      <div class="heading-row"><div><span class="eyebrow">CATALOG</span><h1>剧库</h1><p>按站源、分类和更新顺序浏览。</p></div></div>
      <p v-if="state.error" class="error-text">{{ state.error }}</p>
      <div class="toolbar"><div class="search-box"><input v-model="search" type="search" placeholder="搜索剧名、简介或标签" @input="handleSearchInput" @keydown.enter.prevent="executeSearch" /><button class="search-submit-button" type="button" aria-label="搜索" :disabled="searching" @click="executeSearch"><span v-if="searching" class="search-loading">…</span><span v-else class="search-submit-icon" aria-hidden="true"></span></button></div></div>
      <div class="filter-row library-filter-row">
        <button :class="{ active: selectedSource !== 'all' || sourceMenuOpen }" type="button" @click="sourceMenuOpen = !sourceMenuOpen; categoryMenuOpen = false">{{ sourceLabel }}</button>
        <button :class="{ active: selectedCategory !== 'all' || categoryMenuOpen }" type="button" @click="categoryMenuOpen = !categoryMenuOpen; sourceMenuOpen = false">{{ selectedCategory === 'all' ? '全部分类' : selectedCategory }}</button>
        <button :class="{ active: sortMode !== 'default' || sortMenuOpen }" type="button" @click="sortMenuOpen = !sortMenuOpen; sourceMenuOpen = false; categoryMenuOpen = false">{{ sortLabel }}</button>
        <button :class="{ active: hideVip }" type="button" @click="hideVip = !hideVip">隐藏 VIP</button>
        <button v-if="hasActiveFilters" class="reset-filter-button" type="button" @click="resetFilters">重置</button>
      </div>
      <div v-if="sourceMenuOpen" class="filter-options" aria-label="站源选项"><button v-for="source in sourceOptions" :key="source.id" :class="{ selected: selectedSource === source.id }" type="button" @click="selectSource(source.id)">{{ source.label }}</button></div>
      <div v-if="categoryMenuOpen" class="filter-options" aria-label="分类选项"><button :class="{ selected: selectedCategory === 'all' }" type="button" @click="selectCategory('all')">全部分类</button><button v-for="category in categoryOptions" :key="category" :class="{ selected: selectedCategory === category }" type="button" @click="selectCategory(category)">{{ category }}</button></div>
      <div v-if="sortMenuOpen" class="filter-options" aria-label="排序选项"><button v-for="sort in sortOptions" :key="sort.id" :class="{ selected: sortMode === sort.id }" type="button" @click="selectSort(sort.id)">{{ sort.label }}</button></div>
    </div>

      <div class="library-result-head"><span>{{ sourceLabel }} · {{ serverResultSummary }}<span v-if="serverResultTotal !== undefined && filteredDramas.length < serverResultTotal"> / 当前显示 {{ filteredDramas.length }} 部</span></span><span v-if="searching">正在搜索…</span></div>
    <div class="drama-grid">
      <article v-for="drama in filteredDramas" :key="drama.id" class="drama-card">
        <div class="poster" role="button" tabindex="0" :aria-label="`播放 ${titleOf(drama)}`" @click="emit('playDrama', drama)" @keydown.enter="emit('playDrama', drama)"><img v-if="coverOf(drama)" :src="appStore.api().resolve(coverOf(drama))" :alt="titleOf(drama)" @error="onImageError($event, drama)" /><span v-else class="poster-missing">暂无海报</span><span class="poster-source-badge">{{ dramaSourceLabel(drama) }}</span><span class="poster-category-badge">{{ categoryLabel(drama) }}</span></div>
        <div class="drama-meta"><h2 role="button" tabindex="0" @click="emit('openDrama', drama)" @keydown.enter="emit('openDrama', drama)">{{ titleOf(drama) }}</h2><p class="drama-meta-line"><span class="drama-meta-copy">{{ episodeLabel(drama) }}|{{ releaseStatusLabel(drama) }}</span><span class="drama-actions"><button class="card-action-icon" :class="{ active: isFollowing(drama) }" type="button" :aria-label="isFollowing(drama) ? '取消追剧' : '加入追剧'" :disabled="pendingFollowing.has(drama.id)" @click.stop="toggleFollowing(drama)"><AppIcon name="following" :size="15" /></button><button class="card-action-icon" type="button" :aria-label="`下载 ${titleOf(drama)}`" :disabled="pendingDownloads.has(drama.id)" @click.stop="enqueueDownload(drama)"><AppIcon name="download" :size="15" /></button></span></p></div>
      </article>
    </div>
    <div v-if="!filteredDramas.length" class="empty-state"><strong>暂无匹配剧集</strong><span>尝试切换站源、分类或清除筛选条件。</span></div>
    <button v-if="filteredDramas.length < allFilteredDramas.length || state.hasMore && !catalogMatches" class="load-more" :disabled="state.loading" type="button" @click="loadMore">{{ state.loading ? '加载中…' : '加载更多' }}</button>
    <p v-else class="muted">已显示全部匹配剧集</p>
  </section>
</template>
