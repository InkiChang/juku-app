import { computed, reactive } from 'vue';
import { ApiClient, ApiError } from '../api/client';
import { getDefaultApiBaseUrl, savedApiBaseUrl, saveApiBaseUrl } from '../config/runtime';
import type { Drama, FollowingItem, PlaybackHistoryItem, RankingItem, ViewerState } from '../types/api';

const state = reactive({
  ready: false,
  loading: false,
  error: '',
  apiBaseUrl: '',
  viewer: null as ViewerState | null,
  dramas: [] as Drama[],
  page: 0,
  hasMore: true,
  history: [] as PlaybackHistoryItem[],
  following: [] as FollowingItem[],
  rankings: [] as RankingItem[],
  theme: (localStorage.getItem('juku.app.theme') || 'dark') as 'dark' | 'light',
});

let client: ApiClient;

export const appStore = {
  state,
  isLoggedIn: computed(() => Boolean(state.viewer?.account)),
  theme: computed(() => state.theme),
  async init(): Promise<void> {
    state.apiBaseUrl = savedApiBaseUrl() || (await getDefaultApiBaseUrl());
    client = new ApiClient(state.apiBaseUrl);
    try {
      await this.refreshViewer();
    } catch (error) {
      state.viewer = { ready: false };
      state.error = error instanceof ApiError ? error.message : '暂未连接账号，会以访客模式继续';
    }
    state.ready = true;
  },
  api(): ApiClient {
    if (!client) throw new Error('应用尚未初始化');
    return client;
  },
  async switchServer(value: string): Promise<void> {
    const candidate = value.trim().replace(/\/$/, '');
    if (!candidate) throw new Error('请输入服务器地址');
    const probe = new ApiClient(candidate);
    await probe.viewer();
    client.setServerBase(candidate);
    state.apiBaseUrl = candidate;
    saveApiBaseUrl(candidate);
    state.dramas = [];
    state.page = 0;
    state.hasMore = true;
    await this.refreshViewer();
  },
  async refreshViewer(): Promise<void> {
    state.viewer = await client.viewer();
  },
  async login(username: string, password: string): Promise<void> {
    state.viewer = await client.login(username, password);
  },
  async logout(): Promise<void> {
    await client.logout();
    await this.refreshViewer();
  },
  setTheme(theme: 'dark' | 'light'): void {
    state.theme = theme;
    localStorage.setItem('juku.app.theme', theme);
  },
  toggleTheme(): void {
    this.setTheme(state.theme === 'dark' ? 'light' : 'dark');
  },
  async loadHome(): Promise<void> {
    if (!client) return;
    if (!state.dramas.length) await this.loadMore();
    const [history, following, rankings] = await Promise.allSettled([
      client.playbackHistory(),
      client.following(),
      client.rankings(),
    ]);
    state.history = history.status === 'fulfilled' ? history.value : [];
    state.following = following.status === 'fulfilled' ? following.value : [];
    state.rankings = rankings.status === 'fulfilled' ? rankings.value : [];
  },
  findDrama(id?: string): Drama | undefined {
    if (!id) return undefined;
    return state.dramas.find(drama => drama.id === id || drama.sourceId === id);
  },
  async searchLibrary(query: string): Promise<Drama[]> {
    const results = await client.search(query);
    const known = new Map(state.dramas.map(drama => [drama.id, drama]));
    for (const drama of results) known.set(drama.id, drama);
    state.dramas = [...known.values()];
    return results;
  },
  async loadMore(): Promise<void> {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    state.error = '';
    try {
      const result = await client.dramas(state.page + 1, 30);
      state.dramas.push(...result.data);
      state.page += 1;
      state.hasMore = result.hasMore ?? result.data.length === 30;
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : '读取剧库失败';
    } finally {
      state.loading = false;
    }
  },
};
