import type { DownloadTask, Drama, FollowingItem, PlaybackHistoryItem, PlaybackOpen, PlaybackPlan, RankingItem, ViewerState } from '../types/api';

const VIEWER_ID_KEY = 'juku.app.viewerId';

export class ApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get serverBase(): string {
    return this.baseUrl;
  }

  setServerBase(value: string): void {
    this.baseUrl = value.trim().replace(/\/$/, '');
  }

  resolve(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  async viewer(): Promise<ViewerState> {
    let result = await this.get<ViewerState>('/api/ui/viewer');
    if (!result.ready) result = await this.get<ViewerState>('/api/ui/viewer?confirm=1');
    this.rememberViewer(result);
    return result;
  }

  async login(username: string, password: string): Promise<ViewerState> {
    await this.post('/api/ui/account/login', { username, password });
    return this.viewer();
  }

  async logout(): Promise<void> {
    await this.post('/api/ui/account/logout', {});
    localStorage.removeItem(VIEWER_ID_KEY);
  }

  async dramas(page = 1, limit = 30): Promise<{ data: Drama[]; total?: number; hasMore?: boolean }> {
    const response = await this.get<Drama[] | { data?: Drama[]; total?: number; hasMore?: boolean }>(
      `/api/ui/dramas?page=${page}&limit=${limit}&cached=true`,
    );
    return Array.isArray(response) ? { data: response, hasMore: response.length === limit } : { data: response.data ?? [], total: response.total, hasMore: response.hasMore };
  }

  async search(query: string, limit = 30): Promise<Drama[]> {
    const response = await this.get<Drama[] | { data?: Drama[]; items?: Drama[] }>(`/api/ui/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return Array.isArray(response) ? response : response.data ?? response.items ?? [];
  }

  async playbackHistory(): Promise<PlaybackHistoryItem[]> {
    const response = await this.get<PlaybackHistoryItem[] | { items?: PlaybackHistoryItem[]; data?: PlaybackHistoryItem[] }>('/api/ui/playback/history');
    return Array.isArray(response) ? response : response.items ?? response.data ?? [];
  }

  async following(): Promise<FollowingItem[]> {
    const response = await this.get<FollowingItem[] | { items?: FollowingItem[]; data?: FollowingItem[] }>('/api/ui/following');
    return Array.isArray(response) ? response : response.items ?? response.data ?? [];
  }

  async updateFollowing(dramaId: string, values: { saved?: boolean; completed?: boolean; acknowledge?: boolean }): Promise<FollowingItem | null> {
    const response = await this.post<{ entry?: FollowingItem }>('/api/ui/following', { dramaId, ...values });
    return response.entry ?? null;
  }

  async tasks(): Promise<DownloadTask[]> {
    const response = await this.get<DownloadTask[] | { data?: DownloadTask[]; items?: DownloadTask[] }>('/api/ui/tasks');
    return Array.isArray(response) ? response : response.data ?? response.items ?? [];
  }

  async rankings(boardId = 'hongguo-hot', page = 1, limit = 12): Promise<RankingItem[]> {
    const response = await this.get<RankingItem[] | { items?: RankingItem[]; data?: RankingItem[] }>(`/api/ui/rankings?board=${encodeURIComponent(boardId)}&page=${page}&limit=${limit}`);
    return Array.isArray(response) ? response : response.items ?? response.data ?? [];
  }

  async playbackOpen(dramaId: string): Promise<PlaybackOpen> {
    return this.post<PlaybackOpen>('/api/ui/playback/open', { dramaId, resume: true });
  }

  async playbackPlan(session: string, episode: number, start = 0): Promise<PlaybackPlan> {
    return this.post<PlaybackPlan>('/api/ui/playback/plan', {
      session,
      episode,
      start,
      quality: 0,
      version: 0,
      mode: 'auto',
      client: {
        mp4: true,
        nativeHls: 'HLS' in document.createElement('video'),
        hlsjs: true,
        video: ['h264', 'hevc', 'av1', 'vp9'],
        audio: ['aac', 'ac3', 'eac3', 'opus'],
      },
    });
  }

  async playbackHlsOpen(session: string, episode: number, start = 0): Promise<PlaybackPlan> {
    return this.post<PlaybackPlan>('/api/ui/playback/hls/open', { session, episode, start, quality: 0, version: 0 });
  }

  async playbackControl(session: string, action: string, progress?: Record<string, unknown>): Promise<void> {
    await this.post('/api/ui/playback/control', { session, action, progress });
  }

  async playbackProgress(session: string, progress: { run: number; sequence: number; episode: number; position: number; duration: number; completed: boolean }): Promise<void> {
    await this.post('/api/ui/playback/progress', { session, progress });
  }

  private rememberViewer(viewer: ViewerState): void {
    if (viewer.id) localStorage.setItem(VIEWER_ID_KEY, viewer.id);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    const viewerId = localStorage.getItem(VIEWER_ID_KEY);
    if (viewerId) headers.set('X-Juku-Viewer', viewerId);
    const response = await fetch(this.resolve(path), { ...init, headers, credentials: 'include' });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError('服务器未返回有效 JSON', response.status);
    }
    if (!response.ok) {
      const error = body as { error?: string; code?: string };
      throw new ApiError(error.error || `HTTP ${response.status}`, response.status, error.code);
    }
    const envelope = body as { data?: T };
    return (Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : body) as T;
  }
}
