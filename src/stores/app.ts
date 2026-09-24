import { computed, reactive } from 'vue';
import { StatusBar, Style } from '@capacitor/status-bar';
import { ApiClient, ApiError } from '../api/client';
import { getDefaultApiBaseUrl, savedApiBaseUrl, saveApiBaseUrl } from '../config/runtime';
import type { Drama, FollowingItem, PlaybackHistoryItem, RankingBoard, RankingItem, SearchResult, ViewerState } from '../types/api';
import { sourceLabel } from '../utils/drama';

function hasDramaValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function mergeDrama(primary: Drama, fallback: Drama): Drama {
  const merged = { ...fallback, ...primary } as Drama;
  for (const key of Object.keys(fallback) as Array<keyof Drama>) {
    if (!hasDramaValue(primary[key])) merged[key] = fallback[key] as never;
  }
  return merged;
}

function dramaQuality(drama: Drama): number {
  const episode = Number(drama.totalEpisode || drama.total_episode || drama.episodeCount || drama.episode_count || 0);
  return (Number.isFinite(episode) ? Math.min(episode, 10000) / 10000 : 0)
    + (hasDramaValue(drama.releaseStatus) ? 2 : 0)
    + (hasDramaValue(drama.remark) ? 2 : 0)
    + (hasDramaValue(drama.categoryName || drama.category) ? 1 : 0)
    + (hasDramaValue(drama.cover || drama.coverUrl || drama.cover_url) ? 1 : 0);
}

function canonicalLibrarySource(value: string): string {
  const source = value.trim().toLowerCase();
  if (source === 'all' || source === 'all-sources' || source === '全部站源' || source === 'total') return 'all';
  if (source === 'hongguo' || source === 'redfruit' || source === 'red-fruit' || source === '红果') return 'hongguo';
  if (source === 'huangdou' || source === 'yellowbean' || source === 'yellow-bean' || source === '黄豆') return 'huangdou';
  if (source === 'huangguo' || source === 'cloudfront' || source === 'api' || source.startsWith('huangguo') || source === '黄果') return 'huangguo';
  return source;
}

function isAggregateLibrarySourceKey(value: string, canonical: string): boolean {
  const raw = value.trim().toLowerCase().replace(/^www\./, '').replace(/[_\s]+/g, '-');
  if (canonical === 'hongguo') return ['hongguo', 'redfruit', 'red-fruit', '红果'].includes(raw);
  if (canonical === 'huangguo') return ['huangguo', '黄果'].includes(raw);
  if (canonical === 'huangdou') return ['huangdou', 'yellowbean', 'yellow-bean', '黄豆'].includes(raw);
  return raw === canonical;
}

function normalizeLibrarySourceTotals(values: Record<string, number> | undefined, total?: number): Record<string, number> {
  const result: Record<string, number> = {};
  const grouped: Record<string, number> = {};
  const aggregate: Record<string, number> = {};
  let explicitAll = 0;
  for (const [source, count] of Object.entries(values || {})) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    const canonical = canonicalLibrarySource(source);
    if (canonical === 'all') {
      explicitAll = Math.max(explicitAll, numeric);
      continue;
    }
    grouped[canonical] = (grouped[canonical] || 0) + numeric;
    if (isAggregateLibrarySourceKey(source, canonical)) aggregate[canonical] = Math.max(aggregate[canonical] || 0, numeric);
  }
  for (const [source, count] of Object.entries(grouped)) {
    const childCount = Object.entries(values || {}).reduce((sum, [rawSource, rawCount]) => {
      if (canonicalLibrarySource(rawSource) !== source) return sum;
      return isAggregateLibrarySourceKey(rawSource, source) ? sum : sum + Number(rawCount || 0);
    }, 0);
    result[source] = aggregate[source] === undefined ? count : Math.max(aggregate[source], childCount);
  }
  const sourceSum = Object.values(result).reduce((sum, count) => sum + count, 0);
  const declaredTotal = Number(total);
  // Some remote deployments return the current page size as `total` while
  // their per-source counts are complete. Prefer the complete source sum in
  // that case, while retaining a larger declared total when it is valid.
  result.all = Math.max(explicitAll, Number.isFinite(declaredTotal) ? declaredTotal : 0, sourceSum);
  return result;
}

function hasAuthoritativeLibraryCount(input: {
  total?: number;
  sourceTotals?: Record<string, number>;
  loading?: boolean;
  loaded: number;
}): boolean {
  const loaded = Math.max(0, Number(input.loaded) || 0);
  const sourceSignal = Object.values(input.sourceTotals || {}).some(count => Number(count) > loaded);
  // A loading response may report the current page length as `total`.
  // Prefer a larger source/total signal, otherwise wait for a completed poll.
  if (sourceSignal) return true;
  if (!Number.isFinite(input.total)) return false;
  // `refreshLibrary()` requests 30 rows. A response containing more than one
  // page is therefore a complete legacy snapshot, even when the backend is
  // still refreshing one of its source workers and marks `loading=true`.
  // Treating an equal snapshot total as provisional leaves the UI without a
  // count (and older callers then fall back to the visible 30-row page).
  if (loaded > 30 && Number(input.total) >= loaded) return true;
  return !input.loading || Number(input.total) > loaded;
}

type DramaIdentity = {
  id?: string;
  sourceId?: string;
  dramaId?: string;
  source?: string;
  drama?: Pick<Drama, 'id' | 'sourceId' | 'source'>;
};

/** Return every server/catalog identity that may refer to the same drama. */
export function dramaIdentitySet(value?: DramaIdentity | null): Set<string> {
  if (!value) return new Set();
  const ids = new Set<string>();
  const source = String(value.source || value.drama?.source || '').trim().toLowerCase().replace(/^www\./, '');
  const add = (candidate: unknown) => {
    const id = String(candidate ?? '').trim();
    if (!id) return;
    ids.add(id);
    const separator = id.indexOf(':');
    const tail = separator >= 0 ? id.slice(separator + 1).trim() : id;
    if (source && tail) ids.add(`${source}:${tail}`);
  };
  add(value.id);
  add(value.sourceId);
  if ('dramaId' in value) add(value.dramaId);
  if ('drama' in value && value.drama) {
    add(value.drama.id);
    add(value.drama.sourceId);
  }
  return ids;
}

export function sameDrama(left?: DramaIdentity | null, right?: DramaIdentity | null): boolean {
  const rightIds = dramaIdentitySet(right);
  return [...dramaIdentitySet(left)].some(id => rightIds.has(id));
}

const state = reactive({
  ready: false,
  loading: false,
  error: '',
  apiBaseUrl: '',
  viewer: null as ViewerState | null,
  dramas: [] as Drama[],
  libraryTotal: 0,
  librarySourceTotals: {} as Record<string, number>,
  libraryLoading: false,
  libraryCountUnknown: false,
  libraryCategories: {} as Record<string, string[]>,
  rankingDramas: {} as Record<string, Drama>,
  page: 0,
  hasMore: true,
  history: [] as PlaybackHistoryItem[],
  following: [] as FollowingItem[],
  followingDramas: {} as Record<string, Drama>,
  rankings: [] as RankingItem[],
  rankingBoards: [] as RankingBoard[],
  rankingLists: {} as Record<string, RankingItem[]>,
  rankingSource: 'hongguo',
  rankingLoading: false,
  theme: (localStorage.getItem('juku.app.theme') || 'dark') as 'dark' | 'light',
});

let client: ApiClient;
let historyRequestSequence = 0;
let rankingLoadToken = 0;
let homeLoadInFlight: Promise<void> | null = null;
const rankingCacheTtl = 5 * 60 * 1000;
const sourceDramaLoads = new Map<string, { promise: Promise<void> }>();
const rankingSourceLoads = new Map<string, Promise<void>>();
const followingSyncInterval = 5 * 60 * 1000;
const followingCachePrefix = 'juku.app.following.v1:';
const coverRepairCooldownMs = 120_000;
const coverRepairResultTtlMs = 10 * 60_000;
const coverRepairInFlight = new Map<string, Promise<string | undefined>>();
const coverRepairResults = new Map<string, { cover: string; expiresAt: number }>();
const coverRepairAttempts = new Map<string, number>();
let followingSyncTimer: number | null = null;
let followingQueue: Promise<unknown> = Promise.resolve();
let changingIdentity = false;
function queueFollowing<T>(run: () => Promise<T>): Promise<T> {
  const result = followingQueue.then(run);
  followingQueue = result.catch(() => {});
  return result;
}
let followingVisibilityHandler: (() => void) | null = null;

type RankingCacheEntry = { savedAt: number; items: RankingItem[] };
type RankingCache = Record<string, RankingCacheEntry>;
const categoryCacheTtl = 15 * 60 * 1000;

function categoryCacheKey(serverBase: string, source: string): string {
  const viewer = localStorage.getItem(`juku.app.viewerId:${encodeURIComponent(serverBase)}`) || 'guest';
  return `juku.app.categories.v1:${encodeURIComponent(serverBase)}:${encodeURIComponent(viewer)}:${encodeURIComponent(source)}`;
}

function readCategoryCache(serverBase: string, source: string): { savedAt: number; values: string[] } | null {
  try {
    const raw = localStorage.getItem(categoryCacheKey(serverBase, source));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; values?: string[] };
    if (!Array.isArray(parsed.values) || !parsed.values.length) return null;
    return { savedAt: Number(parsed.savedAt || 0), values: parsed.values.map(String).filter(Boolean) };
  } catch {
    return null;
  }
}

function writeCategoryCache(serverBase: string, source: string, values: string[]): void {
  try { localStorage.setItem(categoryCacheKey(serverBase, source), JSON.stringify({ savedAt: Date.now(), values })); } catch { /* storage quota is non-fatal */ }
}

function rankingBoardsCacheKey(serverBase: string): string {
  const viewer = localStorage.getItem(`juku.app.viewerId:${encodeURIComponent(serverBase)}`) || 'guest';
  return `juku.app.ranking-boards.v1:${encodeURIComponent(serverBase)}:${encodeURIComponent(viewer)}`;
}

function readRankingBoardsCache(serverBase: string): { savedAt: number; boards: RankingBoard[] } | null {
  try {
    const raw = localStorage.getItem(rankingBoardsCacheKey(serverBase));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; boards?: RankingBoard[] };
    if (!Array.isArray(parsed.boards) || !parsed.boards.length) return null;
    return { savedAt: Number(parsed.savedAt || 0), boards: parsed.boards };
  } catch {
    return null;
  }
}

function writeRankingBoardsCache(serverBase: string, boards: RankingBoard[]): void {
  try {
    localStorage.setItem(rankingBoardsCacheKey(serverBase), JSON.stringify({ savedAt: Date.now(), boards }));
  } catch { /* storage quota is non-fatal */ }
}

type FollowingCache = {
  entries: FollowingItem[];
  changes: Record<string, FollowingItem>;
  syncedAt: string;
};

function rankingCacheKey(serverBase: string): string {
  const viewer = localStorage.getItem(`juku.app.viewerId:${encodeURIComponent(serverBase)}`) || 'guest';
  return `juku.app.rankings.v3:${encodeURIComponent(serverBase)}:${encodeURIComponent(viewer)}`;
}

function readRankingCache(serverBase: string): RankingCache {
  try {
    const raw = localStorage.getItem(rankingCacheKey(serverBase));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RankingCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRankingCache(serverBase: string, cache: RankingCache): void {
  try { localStorage.setItem(rankingCacheKey(serverBase), JSON.stringify(cache)); } catch { /* storage quota is non-fatal */ }
}

function followingCacheKey(serverBase: string, viewer?: ViewerState | null): string {
  const viewerId = String(viewer?.id || 'guest').trim();
  return `${followingCachePrefix}${encodeURIComponent(serverBase)}:${encodeURIComponent(viewerId)}`;
}

function coverRepairKey(serverBase: string, dramaId: string, cover: string): string {
  return `${serverBase.trim()}\n${dramaId.trim()}\n${cover.trim()}`;
}

function readFollowingCache(serverBase: string, viewer?: ViewerState | null): FollowingCache {
  try {
    const raw = localStorage.getItem(followingCacheKey(serverBase, viewer));
    if (!raw) return { entries: [], changes: {}, syncedAt: '' };
    const parsed = JSON.parse(raw) as Partial<FollowingCache>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      changes: parsed.changes && typeof parsed.changes === 'object' ? parsed.changes : {},
      syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : '',
    };
  } catch {
    return { entries: [], changes: {}, syncedAt: '' };
  }
}

function writeFollowingCache(serverBase: string, viewer: ViewerState | null, cache: FollowingCache): void {
  try { localStorage.setItem(followingCacheKey(serverBase, viewer), JSON.stringify(cache)); } catch { /* storage quota is non-fatal */ }
}

function followingTime(value?: FollowingItem | null): number {
  const raw = value?.updatedAt || value?.watchedAt || value?.addedAt;
  const time = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export const appStore = {
  state,
  isLoggedIn: computed(() => Boolean(state.viewer?.account)),
  theme: computed(() => state.theme),
  async init(): Promise<void> {
    state.apiBaseUrl = savedApiBaseUrl() || (await getDefaultApiBaseUrl());
    client = new ApiClient(state.apiBaseUrl);
    try {
      await this.refreshViewer();
      const cachedFollowing = readFollowingCache(state.apiBaseUrl, state.viewer);
      if (cachedFollowing.entries.length) state.following = cachedFollowing.entries;
    } catch (error) {
      state.viewer = { ready: false };
      state.error = error instanceof ApiError ? error.message : '暂未连接账号，会以访客模式继续';
    }
    state.ready = true;
    this.startFollowingSync();
  },
  api(): ApiClient {
    if (!client) throw new Error('应用尚未初始化');
    return client;
  },
  setPlaybackActive(active: boolean): void {
    if (client) client.setCatalogHydrationPaused(active);
  },
  async switchServer(value: string): Promise<void> {
    const candidate = value.trim().replace(/\/$/, '');
    if (!candidate) throw new Error('请输入服务器地址');
    changingIdentity = true;
    await followingQueue;
    const probe = new ApiClient(candidate);
    try { await probe.viewer(); } catch (error) { changingIdentity = false; throw error; }
    client = probe;
    state.apiBaseUrl = candidate;
    saveApiBaseUrl(candidate);
    state.dramas = [];
    state.libraryTotal = 0;
    state.librarySourceTotals = {};
    state.libraryLoading = false;
    state.libraryCountUnknown = false;
    state.libraryCategories = {};
    state.page = 0;
    state.hasMore = true;
    this.stopFollowingSync();
    try { await this.refreshViewer(); } finally { changingIdentity = false; }
    state.history = [];
    const cachedFollowing = readFollowingCache(state.apiBaseUrl, state.viewer);
    state.following = cachedFollowing.entries;
    this.startFollowingSync();
  },
  async refreshViewer(): Promise<void> {
    state.viewer = await client.viewer();
  },
  async login(username: string, password: string): Promise<void> {
    changingIdentity = true;
    await followingQueue;
    try { state.viewer = await client.login(username, password); } finally { changingIdentity = false; }
    state.history = [];
    const cachedFollowing = readFollowingCache(state.apiBaseUrl, state.viewer);
    state.following = cachedFollowing.entries;
    await this.syncFollowing();
  },
  async logout(options: { bestEffort?: boolean } = {}): Promise<void> {
    changingIdentity = true;
    await followingQueue;
    let failure: unknown;
    try {
      try {
        await client.logout();
      } catch (error) {
        failure = error;
      }
      // Do not rely on a follow-up viewer request to determine auth state:
      // on app exit the network may be unavailable, but the local session is
      // already invalidated by ApiClient.logout's finally block.
      state.viewer = { ready: false };
      state.following = [];
      state.history = [];
    } finally { changingIdentity = false; }
    if (failure && !options.bestEffort) throw failure;
  },
  setTheme(theme: 'dark' | 'light'): void {
    state.theme = theme;
    localStorage.setItem('juku.app.theme', theme);
    void StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#080808' : '#f7f4ef' }).catch(() => {});
    void StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark }).catch(() => {});
  },
  toggleTheme(): void {
    this.setTheme(state.theme === 'dark' ? 'light' : 'dark');
  },
  async loadHome(): Promise<void> {
    if (!client) return;
    if (homeLoadInFlight) return homeLoadInFlight;
    const request = (async () => {
      if (!state.dramas.length) await this.loadMore();
      // Following sync may hydrate the complete remote catalogue. Keep it out
      // of the foreground home refresh so a slow/large remote service cannot
      // leave the pull-to-refresh indicator spinning indefinitely.
      void this.syncFollowing().catch(error => {
        state.error = error instanceof Error ? error.message : '追剧同步失败，将自动重试';
      });
      // Rankings are supplemental to the home refresh. A slow remote ranking
      // endpoint must not keep the pull-to-refresh indicator open after the
      // catalogue itself has refreshed.
      const cachedBoards = readRankingBoardsCache(client.serverBase);
      if (cachedBoards?.boards.length) {
        state.rankingBoards = cachedBoards.boards;
        void this.loadRankingsForSource(state.rankingSource);
      }
      void client.rankingBoards().then(boards => {
        state.rankingBoards = boards;
        writeRankingBoardsCache(client.serverBase, boards);
        return this.loadRankingsForSource(state.rankingSource);
      }).catch(error => {
        state.error = error instanceof Error ? error.message : '榜单刷新失败，将自动重试';
      });
    })();
    homeLoadInFlight = request;
    try {
      await request;
    } finally {
      if (homeLoadInFlight === request) homeLoadInFlight = null;
    }
  },
  async loadHistory(): Promise<PlaybackHistoryItem[]> {
    if (!client) return state.history;
    const requestClient = client;
    const viewerId = state.viewer?.id;
    const sequence = ++historyRequestSequence;
    const history = await requestClient.playbackHistory();
    if (client === requestClient && state.viewer?.id === viewerId && sequence === historyRequestSequence && !changingIdentity) {
      state.history = history;
    }
    return history;
  },
  startFollowingSync(): void {
    if (followingSyncTimer !== null || typeof window === 'undefined') return;
    const refresh = () => { void this.syncFollowing().catch(error => {
      state.error = error instanceof Error ? error.message : '追剧同步失败，将自动重试';
    }); };
    followingSyncTimer = window.setInterval(refresh, followingSyncInterval);
    followingVisibilityHandler = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', followingVisibilityHandler);
  },
  stopFollowingSync(): void {
    if (followingSyncTimer === null || typeof window === 'undefined') return;
    window.clearInterval(followingSyncTimer);
    followingSyncTimer = null;
    if (followingVisibilityHandler) document.removeEventListener('visibilitychange', followingVisibilityHandler);
    followingVisibilityHandler = null;
  },
  async refreshFollowing(): Promise<FollowingItem[]> {
    return this.syncFollowing();
  },
  async updateFollowing(dramaId: string, values: { saved?: boolean; completed?: boolean; acknowledge?: boolean }): Promise<FollowingItem | null> {
    if (!client) throw new Error('应用尚未初始化');
    if (changingIdentity) throw new Error('正在切换账号或服务器，请稍后重试');
    return queueFollowing(async () => {
    const cache = readFollowingCache(client.serverBase, state.viewer);
    const current = [...state.following, ...cache.entries].find(item => dramaIdentitySet(item).has(dramaId));
    const desired: FollowingItem = {
      ...(current || {}),
      dramaId,
      saved: values.saved ?? current?.saved ?? false,
      completed: values.completed ?? current?.completed ?? false,
      updatedAt: new Date().toISOString(),
      acknowledge: values.acknowledge === true,
    };
    cache.changes[dramaId] = desired;
    cache.entries = cache.entries.filter(item => !sameDrama(item, desired));
    if (desired.saved || desired.completed) cache.entries.unshift(desired);
    state.following = cache.entries;
    writeFollowingCache(client.serverBase, state.viewer, cache);
    let entry: FollowingItem | null = null;
    try {
      entry = await client.updateFollowing(dramaId, {
        saved: desired.saved, completed: desired.completed, acknowledge: values.acknowledge,
      });
    } catch (error) {
      const next = state.following.filter(item => !sameDrama(item, desired));
      if (desired.saved || desired.completed) next.unshift(desired);
      state.following = next;
      throw error;
    }
    delete cache.changes[dramaId];
    cache.entries = cache.entries.filter(item => !sameDrama(item, desired));
    if (entry && (entry.saved || entry.completed)) cache.entries.unshift(entry);
    state.following = cache.entries;
    writeFollowingCache(client.serverBase, state.viewer, cache);
    return entry;
    });
  },
  async syncFollowing(): Promise<FollowingItem[]> {
    if (!client || changingIdentity) return state.following;
    return queueFollowing(async () => {
      if (changingIdentity) return state.following;
      const syncClient = client;
      const viewerId = state.viewer?.id;
      const historySequence = ++historyRequestSequence;
      const cache = readFollowingCache(client.serverBase, state.viewer);
      const [remote, history] = await Promise.all([client.following(), client.playbackHistory()]);
      const remoteById = new Map<string, FollowingItem>();
      for (const item of remote) {
        for (const id of dramaIdentitySet(item)) remoteById.set(id, item);
      }

      // Only explicit pending edits are uploaded; clean caches never resurrect deletions.

      // Local pending changes win only when they are newer than the server copy.
      let pushedChange = false;
      for (const [id, desired] of Object.entries(cache.changes)) {
        const remoteItem = remoteById.get(id) || [...remote].find(item => sameDrama(item, desired));
        if (remoteItem && followingTime(remoteItem) > followingTime(desired)) {
          delete cache.changes[id];
          continue;
        }
        try {
          await client.updateFollowing(id, {
            saved: desired.saved,
            completed: desired.completed,
            acknowledge: desired.acknowledge === true,
          });
          delete cache.changes[id];
          pushedChange = true;
        } catch {
          // Keep the change queued for the next five-minute sync attempt.
        }
      }

      const refreshed = pushedChange ? await client.following() : remote;
      const merged = [...refreshed];
      for (const desired of Object.values(cache.changes)) {
        if (!(desired.saved || desired.completed)) {
          for (let index = merged.length - 1; index >= 0; index -= 1) {
            if (sameDrama(merged[index], desired)) merged.splice(index, 1);
          }
          continue;
        }
        const index = merged.findIndex(item => sameDrama(item, desired));
        if (index >= 0) merged[index] = followingTime(merged[index]) >= followingTime(desired) ? merged[index] : desired;
        else merged.push(desired);
      }
      cache.entries = merged;
      cache.syncedAt = new Date().toISOString();
      writeFollowingCache(client.serverBase, state.viewer, cache);
      state.following = merged;
      if (client === syncClient && state.viewer?.id === viewerId && historyRequestSequence === historySequence && !changingIdentity) {
        state.history = history;
      }
      const ids = new Set<string>();
      for (const item of [...merged, ...history]) {
        for (const id of dramaIdentitySet(item)) ids.add(id);
      }
      try {
        // Following sync must not trigger a multi-thousand-row catalog crawl;
        // use only the rows already hydrated by the visible library/home.
        const catalog = syncClient.catalogSnapshot();
        if (client === syncClient && state.viewer?.id === viewerId) {
          const hydrated: Record<string, Drama> = {};
          for (const drama of catalog) {
            if (!dramaIdentitySet(drama).size || ![...dramaIdentitySet(drama)].some(id => ids.has(id))) continue;
            for (const id of dramaIdentitySet(drama)) hydrated[id] = drama;
          }
          state.followingDramas = hydrated;
        }
      } catch { /* Keep existing covers when catalog refresh is unavailable. */ }
      return merged;
    });
  },
  async loadRankingsForSource(source: string): Promise<void> {
    if (!client) return;
    const running = rankingSourceLoads.get(source);
    if (running) return running;
    const request = this.loadRankingsForSourceInternal(source);
    rankingSourceLoads.set(source, request);
    try {
      await request;
    } finally {
      if (rankingSourceLoads.get(source) === request) rankingSourceLoads.delete(source);
    }
  },
  async loadRankingsForSourceInternal(source: string): Promise<void> {
    if (!client) return;
    const loadToken = ++rankingLoadToken;
    state.rankingSource = source;
    state.rankingLoading = true;
    state.rankings = [];
    const boards = state.rankingBoards.filter(board => board.source === source);
    const cache = readRankingCache(client.serverBase);
    const next = { ...state.rankingLists };

    for (const board of boards) {
      const cached = cache[board.id];
      if (!cached?.items?.length) continue;
      next[board.id] = this.hydrateRankingItems(cached.items);
    }
    state.rankingLists = next;
    if (loadToken === rankingLoadToken) state.rankings = this.firstRankingItems(boards, next);

    const rankingFetches = boards.map(async board => {
      const cached = cache[board.id];
      if (cached?.items?.length && Date.now() - cached.savedAt < rankingCacheTtl) return;
      try {
        const items = this.hydrateRankingItems((await client.rankings(board.id)).items);
        next[board.id] = items;
        cache[board.id] = { savedAt: Date.now(), items };
        writeRankingCache(client.serverBase, cache);
        if (loadToken === rankingLoadToken) {
          state.rankingLists = { ...next };
          state.rankings = this.firstRankingItems(boards, next);
        }
      } catch {
        // Keep a stale cache visible when the upstream source is unavailable.
      }
    });

    const coverFetch = Promise.allSettled(rankingFetches).then(async () => {
      const rankingItems = boards.flatMap(board => next[board.id] || []);
      await this.hydrateRankingsFromCatalog(source, loadToken);
      if (source === 'huangdou' || source === 'huangguo') {
        return this.loadSourceDramasForCovers(source, loadToken, rankingItems);
      }
    });
    void Promise.allSettled([...rankingFetches, coverFetch]).finally(() => {
      if (loadToken === rankingLoadToken) {
        const hydrated = { ...state.rankingLists };
        for (const board of boards) {
          if (hydrated[board.id]?.length) hydrated[board.id] = this.hydrateRankingItems(hydrated[board.id]);
        }
        state.rankingLists = hydrated;
        state.rankings = this.firstRankingItems(boards, hydrated);
        state.rankingLoading = false;
      }
    });
  },
  firstRankingItems(boards: RankingBoard[], lists: Record<string, RankingItem[]>): RankingItem[] {
    for (const board of boards) {
      if (lists[board.id]?.length) return lists[board.id];
    }
    return [];
  },
  hydrateRankingItems(items: RankingItem[]): RankingItem[] {
    return items.map(item => {
      if (!item.drama) return item;
      const known = this.findDrama(item.drama.id || item.drama.sourceId);
      if (!known) return item;
      const cover = item.drama.cover || item.drama.coverUrl || item.drama.cover_url || item.drama.image || item.drama.imageUrl || item.drama.image_url || item.drama.img || item.drama.pic || item.drama.picture || item.drama.poster || item.drama.thumb || item.drama.thumbnail || known.cover || known.coverUrl || known.cover_url || known.image || known.imageUrl || known.image_url || known.img || known.pic || known.picture || known.poster || known.thumb || known.thumbnail;
      return {
        ...item,
        drama: {
          ...mergeDrama(item.drama, known),
          cover: cover || undefined,
          coverUrl: item.drama.coverUrl || cover || undefined,
        },
      };
    });
  },
  async hydrateRankingsFromCatalog(source: string, loadToken: number): Promise<void> {
    if (!client) return;
    const catalog = client.catalogSnapshot(source);
    const rankingDramas = { ...state.rankingDramas };
    for (const drama of catalog) {
      rankingDramas[drama.id] = drama;
      if (drama.sourceId) rankingDramas[drama.sourceId] = drama;
    }
    state.rankingDramas = rankingDramas;
    if (loadToken !== rankingLoadToken) return;
    const boards = state.rankingBoards.filter(board => board.source === source);
    const next = { ...state.rankingLists };
    for (const board of boards) {
      if (next[board.id]?.length) next[board.id] = this.hydrateRankingItems(next[board.id]);
    }
    state.rankingLists = next;
    state.rankings = this.firstRankingItems(boards, next);
  },
  async loadSourceDramasForCovers(source: string, loadToken: number, extraItems: RankingItem[] = []): Promise<void> {
    const existing = sourceDramaLoads.get(source);
    if (existing) {
      await existing.promise;
      const unresolved = extraItems.some(item => {
        const drama = item.drama;
        if (!drama) return false;
        const known = this.findDrama(drama.id || drama.sourceId);
        return !known || !(known.cover || known.coverUrl || known.cover_url || known.image || known.imageUrl || known.image_url || known.img || known.pic || known.picture || known.poster || known.thumb || known.thumbnail);
      });
      if (!unresolved) return;
      sourceDramaLoads.delete(source);
    }
    const promise = (async () => {
      try {
        const sourceBoards = state.rankingBoards.filter(board => board.source === source);
        const targetIds = new Set<string>();
        for (const board of sourceBoards) {
          for (const item of state.rankingLists[board.id] || []) {
            if (item.drama?.id) targetIds.add(item.drama.id);
            if (item.drama?.sourceId) targetIds.add(item.drama.sourceId);
          }
        }
        for (const item of extraItems) {
          if (item.drama?.id) targetIds.add(item.drama.id);
          if (item.drama?.sourceId) targetIds.add(item.drama.sourceId);
        }
        if (!targetIds.size) return;
        // Ranking cards only need a bounded cover-enrichment pass. Crawling
        // every page of a source here duplicates LibraryView hydration and
        // can consume the network while a video is playing.
        const first = await client.dramas(1, 200, source);
        const rankingDramas = { ...state.rankingDramas };
        const consume = (dramas: Drama[]) => {
          for (const drama of dramas) {
            rankingDramas[drama.id] = drama;
            if (drama.sourceId) rankingDramas[drama.sourceId] = drama;
            targetIds.delete(drama.id);
            if (drama.sourceId) targetIds.delete(drama.sourceId);
          }
        };
        consume(first.data);
        // Do not fan out pagination requests for cover lookup. Unresolved
        // cards can fall back to the normal cover repair endpoint.
        state.rankingDramas = rankingDramas;
        const next = { ...state.rankingLists };
        const cache = readRankingCache(client.serverBase);
        for (const board of sourceBoards) {
          if (!next[board.id]?.length) continue;
          next[board.id] = this.hydrateRankingItems(next[board.id]);
          cache[board.id] = { savedAt: cache[board.id]?.savedAt || Date.now(), items: next[board.id] };
        }
        writeRankingCache(client.serverBase, cache);
        if (loadToken === rankingLoadToken) {
          state.rankingLists = next;
          state.rankings = this.firstRankingItems(sourceBoards, next);
        }
      } catch {
        // Rankings remain usable without cover enrichment.
      }
    })();
    sourceDramaLoads.set(source, { promise });
    return promise;
  },
  findDrama(id?: string): Drama | undefined {
    if (!id) return undefined;
    const libraryDrama = state.dramas.find(drama => drama.id === id || drama.sourceId === id);
    const rankedDrama = state.rankingDramas[id] || state.dramas.find(drama => drama.id === id || drama.sourceId === id);
    if (!libraryDrama) return rankedDrama;
    const libraryHasCover = Boolean(libraryDrama.cover || libraryDrama.coverUrl || libraryDrama.cover_url || libraryDrama.image || libraryDrama.imageUrl || libraryDrama.image_url || libraryDrama.img || libraryDrama.pic || libraryDrama.picture || libraryDrama.poster || libraryDrama.thumb || libraryDrama.thumbnail);
    return libraryHasCover ? libraryDrama : rankedDrama || libraryDrama;
  },
  enrichDrama(drama: Drama): Drama {
    const title = String(drama.title || drama.name || '').trim();
    const source = sourceLabel(drama);
    const rankedItems = Object.values(state.rankingLists).flatMap(items => items.map(item => item.drama).filter((item): item is Drama => Boolean(item)));
    const candidates = [...Object.values(state.rankingDramas), ...rankedItems];
    const matching = title ? candidates.filter(candidate => {
      const candidateTitle = String(candidate.title || candidate.name || '').trim();
      return candidateTitle === title && (source === '未知站源' || sourceLabel(candidate) === source);
    }) : [];
    const exactRanked = state.rankingDramas[drama.id] || (drama.sourceId ? state.rankingDramas[drama.sourceId] : undefined);
    const known = [...matching, ...(exactRanked && !matching.includes(exactRanked) ? [exactRanked] : [])]
      .sort((left, right) => dramaQuality(right) - dramaQuality(left))[0];
    if (known) return mergeDrama(known, drama);
    const exactLibrary = state.dramas.find(candidate => candidate.id === drama.id || candidate.sourceId === drama.id || candidate.id === drama.sourceId || candidate.sourceId === drama.sourceId);
    return exactLibrary ? mergeDrama(exactLibrary, drama) : drama;
  },
  async searchLibrary(query: string): Promise<SearchResult> {
    const result = await client.search(query);
    const results = result.items;
    const known = new Map(state.dramas.map(drama => [drama.id, drama]));
    for (const drama of results) known.set(drama.id, drama);
    state.dramas = [...known.values()];
    return result;
  },
  async libraryCatalog(source?: string): Promise<Drama[]> {
    if (!client) return [];
    const catalog = await client.catalog(source);
    // `refreshLibrary()` intentionally fetches only the first visible page.
    // Catalog hydration can continue pagination, so copy the authoritative
    // totals back into the reactive store before LibraryView renders counts.
    const totals = client.libraryTotals();
    state.libraryLoading = Boolean(totals.loading);
    state.libraryCountUnknown = Boolean(totals.paginationUnknown && totals.total === undefined);
    const hasAuthoritativeCount = hasAuthoritativeLibraryCount(totals);
    if (hasAuthoritativeCount) {
      state.librarySourceTotals = normalizeLibrarySourceTotals(totals.sourceTotals, totals.total ?? state.libraryTotal);
      state.libraryTotal = state.librarySourceTotals.all ?? totals.total ?? state.libraryTotal;
    } else if (!state.libraryLoading && !state.libraryCountUnknown && totals.hasMore === false && catalog.length > 30) {
      // A legacy/paginated server can omit count metadata. Only use the
      // loaded row count after the endpoint is no longer loading/unknown;
      // otherwise a first page (usually 30) is provisional.
      if (source) {
        const key = canonicalLibrarySource(source);
        const knownSourceTotal = Number(state.librarySourceTotals[key]) || 0;
        const nextSourceTotal = Math.max(knownSourceTotal, catalog.length);
        if (nextSourceTotal > knownSourceTotal) {
          state.librarySourceTotals = {
            ...state.librarySourceTotals,
            [key]: nextSourceTotal,
            all: Math.max(state.libraryTotal, nextSourceTotal),
          };
          state.libraryTotal = Math.max(state.libraryTotal, nextSourceTotal);
        }
      } else if (catalog.length > state.libraryTotal) {
        state.libraryTotal = catalog.length;
        state.librarySourceTotals = { ...state.librarySourceTotals, all: catalog.length };
      }
    }
    state.hasMore = totals.hasMore ?? state.hasMore;
    return catalog;
  },
  async refreshLibrary(): Promise<void> {
    if (!client || state.loading) return;
    state.loading = true;
    state.error = '';
    try {
      const result = await client.dramas(1, 30, undefined, true);
      state.dramas = result.data;
      state.libraryLoading = Boolean(result.loading);
      state.libraryCountUnknown = Boolean(result.paginationUnknown && result.total === undefined);
      const hasAuthoritativeCount = hasAuthoritativeLibraryCount({
        total: result.total,
        sourceTotals: result.sourceTotals,
        loading: result.loading,
        loaded: result.data.length,
      });
      if (hasAuthoritativeCount) {
        state.librarySourceTotals = normalizeLibrarySourceTotals(result.sourceTotals, result.total);
        state.libraryTotal = state.librarySourceTotals.all ?? result.total ?? state.libraryTotal;
      } else if (!state.libraryLoading && !state.libraryCountUnknown && !result.totalKnown && state.libraryTotal === 0) {
        // Keep the total unknown while the catalog hydration pass follows the
        // pagination cursor; do not expose the first page size as the total.
        state.librarySourceTotals = {};
      } else if (!state.libraryLoading && !state.libraryCountUnknown
        && result.totalKnown === true
        && result.hasMore === false
        && result.paginationUnknown !== true
        && result.data.length > 30
        && state.libraryTotal === 0) {
        // Only use the loaded row count when the response is a complete
        // snapshot. A paginated remote response may contain 30 rows while
        // its authoritative total is still loading; promoting that page
        // length here makes the UI show "30 部" until the next poll.
        state.libraryTotal = result.data.length;
        state.librarySourceTotals = normalizeLibrarySourceTotals(undefined, state.libraryTotal);
      }
      state.page = 1;
      state.hasMore = result.hasMore ?? result.data.length === 30;
      state.libraryCategories = {};
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : '更新剧库失败';
    } finally {
      state.loading = false;
    }
  },
  async repairDramaCover(dramaId: string, cover: string): Promise<string | undefined> {
    const normalizedCover = String(cover || '').trim();
    const normalizedDramaId = String(dramaId || '').trim();
    if (!client || !normalizedCover || !normalizedDramaId) return undefined;

    const key = coverRepairKey(client.serverBase, normalizedDramaId, normalizedCover);
    const now = Date.now();
    const cached = coverRepairResults.get(key);
    if (cached && cached.expiresAt > now) return cached.cover;
    if (cached) coverRepairResults.delete(key);

    const inFlight = coverRepairInFlight.get(key);
    if (inFlight) return inFlight;

    const attemptedAt = coverRepairAttempts.get(key) || 0;
    if (attemptedAt && now - attemptedAt < coverRepairCooldownMs) return undefined;
    coverRepairAttempts.set(key, now);

    const request = client.coverRepair(normalizedDramaId, normalizedCover)
      .then(result => {
        const repaired = String(result.cover || '').trim();
        // A backend that cannot improve the URL must not cause the image to
        // retry the same failing source on every render.
        if ((result.dramaId && result.dramaId !== normalizedDramaId) || !repaired || repaired === normalizedCover) {
          return undefined;
        }
        coverRepairResults.set(key, { cover: repaired, expiresAt: Date.now() + coverRepairResultTtlMs });
        const update = (drama?: Drama) => {
          if (!drama || drama.id !== normalizedDramaId) return;
          drama.cover = repaired;
          drama.coverUrl = repaired;
        };
        update(state.dramas.find(drama => drama.id === normalizedDramaId));
        update(state.rankingDramas[normalizedDramaId]);
        return repaired;
      })
      .catch(() => undefined)
      .finally(() => {
        coverRepairInFlight.delete(key);
      });
    coverRepairInFlight.set(key, request);
    return request;
  },
  async loadLibraryCategories(source = 'all'): Promise<string[]> {
    if (!client) return [];
    const cached = state.libraryCategories[source];
    if (cached?.length) return cached;
    const persistent = readCategoryCache(client.serverBase, source);
    if (persistent?.values.length) {
      state.libraryCategories = { ...state.libraryCategories, [source]: persistent.values };
      if (Date.now() - persistent.savedAt < categoryCacheTtl) return persistent.values;
      void client.dramaCategories(source === 'all' ? undefined : source).then(categories => {
        if (categories.length) {
          writeCategoryCache(client.serverBase, source, categories);
          state.libraryCategories = { ...state.libraryCategories, [source]: categories };
        }
      }).catch(() => {});
      return persistent.values;
    }
    const categories = await client.dramaCategories(source === 'all' ? undefined : source);
    state.libraryCategories = { ...state.libraryCategories, [source]: categories };
    if (categories.length) writeCategoryCache(client.serverBase, source, categories);
    return categories;
  },
  async loadMore(): Promise<void> {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    state.error = '';
    try {
      const result = await client.dramas(state.page + 1, 30);
      const known = new Set(state.dramas.map(drama => drama.id));
      for (const drama of result.data) {
        if (!known.has(drama.id)) {
          state.dramas.push(drama);
          known.add(drama.id);
        }
      }
      state.page += 1;
      state.libraryLoading = Boolean(result.loading);
      state.libraryCountUnknown = Boolean(result.paginationUnknown && result.total === undefined);
      const hasAuthoritativeCount = hasAuthoritativeLibraryCount({
        total: result.total,
        sourceTotals: result.sourceTotals,
        loading: result.loading,
        loaded: client.libraryTotals().loaded,
      });
      if (hasAuthoritativeCount) {
        const sourceTotals = result.sourceTotals || Object.fromEntries(
          Object.entries(state.librarySourceTotals).filter(([source]) => source !== 'all'),
        );
        state.librarySourceTotals = normalizeLibrarySourceTotals(sourceTotals, result.total ?? state.libraryTotal);
        state.libraryTotal = state.librarySourceTotals.all ?? result.total ?? state.libraryTotal;
      }
      state.hasMore = result.hasMore ?? result.data.length === 30;
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : '读取剧库失败';
    } finally {
      state.loading = false;
    }
  },
};
