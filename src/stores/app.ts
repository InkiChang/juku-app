import { computed, reactive } from 'vue';
import { ApiClient, ApiError } from '../api/client';
import { getDefaultApiBaseUrl, savedApiBaseUrl, saveApiBaseUrl } from '../config/runtime';
import type { Drama, ViewerState } from '../types/api';

const state = reactive({
  ready: false,
  loading: false,
  error: '',
  apiBaseUrl: '',
  viewer: null as ViewerState | null,
  dramas: [] as Drama[],
  page: 0,
  hasMore: true,
});

let client: ApiClient;

export const appStore = {
  state,
  isLoggedIn: computed(() => Boolean(state.viewer?.account)),
  async init(): Promise<void> {
    state.apiBaseUrl = savedApiBaseUrl() || (await getDefaultApiBaseUrl());
    client = new ApiClient(state.apiBaseUrl);
    await this.refreshViewer();
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
