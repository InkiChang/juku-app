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
  initialIndex: number;
  initialPosition: number;
  episodes: Array<{ index: number; title?: string }>;
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
}

export interface PlaybackHistoryItem {
  drama?: Drama;
  dramaId?: string;
  episode?: number | string;
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
  watchedEpisode?: number | string;
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
