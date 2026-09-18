export interface Drama {
  id: string;
  source?: string;
  sourceId?: string;
  title?: string;
  name?: string;
  desc?: string;
  intro?: string;
  cover?: string;
  coverUrl?: string;
  poster?: string;
  thumb?: string;
  category?: string;
  categoryName?: string;
  totalEpisode?: number | string;
  onlineDate?: string;
  releaseStatus?: string;
  vip?: boolean | string | null;
  episodes?: unknown[];
  episodeCount?: number | string;
  heat?: string | number;
  views?: string | number;
  tags?: string[];
}

export interface ViewerState {
  ready: boolean;
  id?: string;
  account?: Record<string, unknown>;
  sources?: string[];
  onlineOnly?: boolean;
  requireLogin?: boolean;
  allowRegistration?: boolean;
  guestImportAvailable?: boolean;
}

export interface PlaybackOpen {
  session: string;
  dramaId?: string;
  source?: string;
  title?: string;
  releaseStatus?: string;
  mode?: string;
  resumePaused?: boolean;
  resumeMessage?: string;
  initialIndex: number;
  initialPosition: number;
  episodes: Array<{ index: number; episode?: string; number?: number; title?: string; chapterId?: string; vip?: boolean }>;
}

export interface PlaybackPlan {
  url?: string;
  run?: number;
  delivery?: string;
  processing?: string;
  player?: string;
  mime?: string;
  reason?: string;
  directURL?: string;
  duration?: number;
  source?: string;
  qualities?: Array<{ value: number; label?: string }>;
  index?: string;
}

export interface PlaybackHistoryItem {
  drama?: Drama;
  dramaId?: string;
  episode?: number | string;
  title?: string;
  source?: string;
  index?: number;
  total?: number;
  completed?: boolean;
  mode?: string;
  watchedAt?: string;
  episodeIndex?: number;
  position?: number;
  duration?: number;
  progress?: number;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface FollowingItem {
  drama?: Drama;
  dramaId?: string;
  status?: string;
  title?: string;
  source?: string;
  category?: string;
  totalEpisode?: number;
  newEpisodes?: number;
  saved?: boolean;
  completed?: boolean;
  addedAt?: string;
  watchedEpisode?: number | string;
  index?: number;
  latestEpisode?: number | string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface RankingItem {
  rank?: number;
  drama?: Drama;
  metric?: string;
  [key: string]: unknown;
}

export interface DownloadTask {
  id?: string;
  dramaId?: string;
  dramaTitle?: string;
  title?: string;
  index?: number;
  total?: number;
  status?: string;
  phase?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  error?: string;
  playable?: boolean;
  path?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
