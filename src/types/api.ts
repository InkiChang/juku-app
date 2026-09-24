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
  cover_url?: string;
  image?: string;
  imageUrl?: string;
  image_url?: string;
  img?: string;
  pic?: string;
  picture?: string;
  poster?: string;
  thumb?: string;
  thumbnail?: string;
  category?: string;
  categoryName?: string;
  category_name?: string;
  categoryNameSnake?: string;
  typeName?: string;
  type_name?: string;
  sortName?: string;
  sort_name?: string;
  channelName?: string;
  channel_name?: string;
  site?: string;
  host?: string;
  remark?: string;
  totalEpisode?: number | string;
  total_episode?: number | string;
  chapterCount?: number | string;
  chapter_count?: number | string;
  onlineDate?: string;
  releaseStatus?: string;
  vip?: boolean | string | null;
  episodes?: unknown[];
  episodeCount?: number | string;
  episode_count?: number | string;
  total?: number | string;
  heat?: string | number;
  views?: string | number;
  score?: string | number;
  tags?: string[];
}

export interface SearchResult {
  items: Drama[];
  query?: string;
  warning?: string;
  limited?: boolean;
}

export interface ViewerState {
  ready: boolean;
  id?: string;
  account?: Record<string, unknown>;
  sources?: string[];
  onlineOnly?: boolean;
  requireLogin?: boolean;
  allowRegistration?: boolean;
  sourceChoices?: SourceChoice[];
  guestImportAvailable?: boolean;
}

export interface SourceChoice { id: string; name: string }
export interface LibrarySourceState {
  status?: string;
  count?: number;
  error?: string;
  updatedAt?: string;
}
export interface LibraryStatus {
  loadedAt?: string;
  loading?: boolean;
  loadingSource?: string;
  updateAccepted?: boolean;
  total?: number;
  metadata?: {
    running?: boolean;
    checked?: number;
    total?: number;
    updated?: number;
    failed?: number;
    [key: string]: unknown;
  };
  sources: Record<string, LibrarySourceState>;
}
export interface AdminPolicy { requireLogin: boolean; allowRegistration: boolean }
export interface AdminAccount {
  username: string;
  admin: boolean;
  onlineOnly: boolean;
  sources: string[];
  createdAt?: string;
}
export interface AdminAccounts { data: AdminAccount[]; sourceChoices: SourceChoice[] }

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
  episodes: Array<{ index: number; episode?: string; number?: number; title?: string; chapterId?: string; vip?: boolean; total?: number }>;
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
  quality?: number;
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

export interface RankingPage {
  items: RankingItem[];
  hasMore?: boolean;
  totalPages?: number;
  page?: number;
  updatedText?: string;
  boardId?: string;
}

export interface RankingBoard {
  id: string;
  source: string;
  name: string;
  description?: string;
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
  elapsedSeconds?: number;
  remainingSeconds?: number;
  attempt?: number;
  releaseStatus?: string;
  downloadQuality?: number;
  error?: string;
  playable?: boolean;
  path?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
