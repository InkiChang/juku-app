import type { AdminAccount, AdminAccounts, AdminPolicy, DownloadTask, Drama, FollowingItem, LibraryStatus, PlaybackHistoryItem, PlaybackOpen, PlaybackPlan, RankingBoard, RankingPage, RankingItem, SearchResult, ViewerState } from '../types/api';
import { Capacitor, CapacitorCookies, CapacitorHttp } from '@capacitor/core';
import { requestBaseUrl } from '../config/runtime';
import { networkScheduler, priorityForApiPath } from './requestScheduler';

const VIEWER_ID_KEY = 'juku.app.viewerId';
const VIEWER_SOURCES_KEY = 'juku.app.viewerSources';
const VIEWER_ONLINE_ONLY_KEY = 'juku.app.viewerOnlineOnly';

function viewerStorageKey(baseUrl: string): string {
  return `${VIEWER_ID_KEY}:${encodeURIComponent(baseUrl || 'same-origin')}`;
}

function viewerContextStorageKey(prefix: string, baseUrl: string): string {
  return `${prefix}:${encodeURIComponent(baseUrl || 'same-origin')}`;
}

/** Headers required by media/session routes, matching the Web UI viewer client. */
export function viewerHeadersFor(baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const viewerId = localStorage.getItem(viewerStorageKey(baseUrl));
  const sources = localStorage.getItem(viewerContextStorageKey(VIEWER_SOURCES_KEY, baseUrl));
  const onlineOnly = localStorage.getItem(viewerContextStorageKey(VIEWER_ONLINE_ONLY_KEY, baseUrl));
  if (viewerId) headers['X-Juku-Viewer'] = viewerId;
  if (sources) headers['X-Juku-Sources'] = sources;
  if (onlineOnly) headers['X-Juku-Online-Only'] = onlineOnly;
  return headers;
}

type DramaPageResult = {
  data: Drama[];
  total?: number;
  hasMore?: boolean;
  sourceTotals?: Record<string, number>;
  loading?: boolean;
  paginationUnknown?: boolean;
  /** False while a legacy endpoint has only returned its first page. */
  totalKnown?: boolean;
};

type DramaResponsePayload = {
  data?: unknown;
  items?: unknown;
  total?: number;
  hasMore?: boolean;
  hasMoreBySource?: Record<string, boolean>;
  loading?: boolean;
  loadingMore?: boolean;
  metadata?: { running?: boolean; total?: number; checked?: number; [key: string]: unknown };
  page?: number | null;
  limit?: number | null;
  revision?: number | string;
  sources?: unknown;
  sourceTotals?: unknown;
};

function normalizeDramaResponse(value: unknown): { payload: DramaResponsePayload; data: Drama[] } {
  if (Array.isArray(value)) return { payload: { data: value }, data: value as Drama[] };
  const raw = (value || {}) as DramaResponsePayload;
  const nested = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data as DramaResponsePayload
    : undefined;
  const payload = nested ? {
    ...raw,
    ...nested,
    total: raw.total ?? nested.total,
    hasMore: raw.hasMore ?? nested.hasMore,
    sources: raw.sources ?? nested.sources,
    sourceTotals: raw.sourceTotals ?? nested.sourceTotals,
  } : raw;
  const data = Array.isArray(payload.data)
    ? payload.data as Drama[]
    : Array.isArray(payload.items)
      ? payload.items as Drama[]
      : [];
  return { payload, data };
}

function sourceTotalsOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const totals: Record<string, number> = {};
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, state] of entries) {
    const objectState = state && typeof state === 'object' ? state as Record<string, unknown> : undefined;
    const source = String(objectState?.source ?? objectState?.id ?? objectState?.name ?? key).trim();
    if (!source) continue;
    const raw = typeof state === 'number' || typeof state === 'string'
      ? state
      : objectState?.count ?? objectState?.total;
    const count = Number(raw);
    if (Number.isFinite(count) && count >= 0) totals[source] = count;
  }
  return totals;
}

function responseSourceTotals(payload: DramaResponsePayload): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const values of [sourceTotalsOf(payload.sources), sourceTotalsOf(payload.sourceTotals)]) {
    for (const [source, count] of Object.entries(values)) {
      totals[source] = Math.max(totals[source] ?? 0, count);
    }
  }
  return totals;
}

function canonicalSource(value: string): string {
  const source = value.trim().toLowerCase().replace(/^www\./, '').replace(/[_\s]+/g, '-');
  const aliases: Record<string, string> = {
    all: 'all', 'all-sources': 'all', '全部站源': 'all', total: 'all',
    hongguo: 'hongguo', redfruit: 'hongguo', 'red-fruit': 'hongguo', '红果': 'hongguo', 'hongguoduanju.com': 'hongguo',
    huangguo: 'huangguo', huangguoai: 'huangguo', 'huangguo-video': 'huangguo', 'huangguo-ai': 'huangguo', 'huangguoai.com': 'huangguo', 'huangguo.video': 'huangguo', cloudfront: 'huangguo', api: 'huangguo', '黄果': 'huangguo',
    huangdou: 'huangdou', yellowbean: 'huangdou', 'yellow-bean': 'huangdou', 'tideember.cc': 'huangdou', 'xqjurgek.top': 'huangdou', '黄豆': 'huangdou',
  };
  return aliases[source] || source;
}

/**
 * Catalog requests are cached by scope. An unfiltered request must never
 * reuse or merge a source-scoped page because that would make a complete
 * all-source total inherit the previous source's count (often just 30 rows).
 */
function catalogScope(source?: string): string {
  return source ? canonicalSource(source) : 'all';
}

function sourceTotalOf(values: Record<string, number>, source?: string): number | undefined {
  if (!source) return undefined;
  const wanted = canonicalSource(source);
  const matches = Object.entries(values).filter(([key]) => canonicalSource(key) === wanted);
  if (!matches.length) return undefined;
  // Some deployments expose both an aggregate `huangguo` counter and its
  // `cloudfront`/`huangguoai`/`huangguo-video` children. Prefer the aggregate
  // when present; otherwise sum the child providers.
  const aggregate = matches
    .filter(([key]) => isAggregateSourceKey(key, wanted))
    .reduce((max, [, value]) => Math.max(max, Number(value) || 0), 0);
  const childTotal = matches
    .filter(([key]) => !isAggregateSourceKey(key, wanted))
    .reduce((sum, [, value]) => sum + Number(value), 0);
  return aggregate > 0 ? Math.max(aggregate, childTotal) : childTotal;
}

function sourceTotalsSum(values: Record<string, number>): number {
  let sourceSum = 0;
  let explicitAll = 0;
  const grouped = new Map<string, number>();
  const aggregates = new Map<string, number>();
  for (const [source, count] of Object.entries(values)) {
    const numeric = Number(count) || 0;
    const canonical = canonicalSource(source);
    if (canonical === 'all') {
      explicitAll = Math.max(explicitAll, numeric);
      continue;
    }
    grouped.set(canonical, (grouped.get(canonical) || 0) + numeric);
    if (isAggregateSourceKey(source, canonical)) aggregates.set(canonical, Math.max(aggregates.get(canonical) || 0, numeric));
  }
  for (const [source, count] of grouped) sourceSum += aggregates.get(source) ?? count;
  // A few deployments expose only `sources.all`; others expose per-source
  // counters, and some expose both. Never let a page-sized `total` win over
  // an explicit all-source count.
  return Math.max(sourceSum, explicitAll);
}

/**
 * Pick the all-source count without letting a page-sized counter replace the
 * server's complete catalog count. A root total larger than the current page
 * is authoritative; source counters are the fallback when the root total is
 * missing or is clearly only the current page size.
 */
function allCatalogTotal(declaredTotal: number, groupedTotal: number, loaded: number): number | undefined {
  const declared = Number.isFinite(declaredTotal) && declaredTotal >= 0 ? declaredTotal : undefined;
  const rows = Math.max(0, Number(loaded) || 0);
  if (declared !== undefined && (declared > rows || rows > 30 && declared >= rows)) return declared;
  if (groupedTotal > 0) return Math.max(groupedTotal, rows);
  if (declared !== undefined && rows === 0) return declared;
  return undefined;
}

function isAggregateSourceKey(value: string, canonical = canonicalSource(value)): boolean {
  const raw = value.trim().toLowerCase().replace(/^www\./, '').replace(/[_\s]+/g, '-');
  if (canonical === 'all') return raw === 'all' || raw === '全部站源';
  return raw === canonical || raw === '红果' && canonical === 'hongguo'
    || raw === '黄果' && canonical === 'huangguo'
    || raw === '黄豆' && canonical === 'huangdou';
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const catalogCacheVersion = 1;
const catalogCacheTtl = 15 * 60 * 1000;
const catalogCacheMaxRows = 12000;
const catalogCachePrefix = 'juku.app.catalog.v1:';

function catalogCacheIdentity(baseUrl: string): string {
  try { return localStorage.getItem(viewerStorageKey(baseUrl)) || 'guest'; } catch { return 'guest'; }
}

function catalogCacheKey(baseUrl: string, scope: string): string {
  return `${catalogCachePrefix}${encodeURIComponent(baseUrl)}:${encodeURIComponent(catalogCacheIdentity(baseUrl))}:${encodeURIComponent(scope)}`;
}

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
  private catalogHydrationPaused = false;
  private catalogInFlight = new Map<string, Promise<Drama[]>>();
  private catalogRefreshInFlight = new Map<string, Promise<void>>();
  private catalogPersistentScopes = new Set<string>();
  private catalogPersistTimer: number | null = null;
  private dramaCatalogCache: {
    baseUrl: string;
    scope: string;
    data: Drama[];
    total?: number;
    hasMore?: boolean;
    sourceTotals?: Record<string, number>;
    sourceTotalsTrusted?: boolean;
    hasMoreBySource?: Record<string, boolean>;
    loading?: boolean;
    /** The endpoint did not expose pagination metadata; keep probing pages. */
    paginationUnknown?: boolean;
    /** Actual page size observed from the endpoint (some servers cap limit). */
    pageSize?: number;
    /** Next page to request when this cache is known to be paginated. */
    nextPage?: number;
    paginationMode?: 'page' | 'legacy';
    paginationExplicit?: boolean;
    savedAt?: number;
  } | null = null;

  /** Return the most recent server totals without exposing the catalog cache. */
  libraryTotals(): { total?: number; sourceTotals?: Record<string, number>; hasMore?: boolean; loading?: boolean; paginationUnknown?: boolean; loaded: number } {
    const cache = this.dramaCatalogCache;
    return {
      total: cache?.total,
      sourceTotals: cache?.sourceTotalsTrusted === false ? undefined : cache?.sourceTotals,
      hasMore: cache?.hasMore,
      loading: cache?.loading,
      paginationUnknown: cache?.paginationUnknown,
      loaded: cache?.data.length || 0,
    };
  }

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Native HTTP and the WebView do not always share the same cookie jar on Android.
   * Keep the viewer cookie explicit so the login endpoint can see the cookie created
   * by the initial anonymous /viewer request. Values are never logged or persisted
   * in localStorage. */
  private cookieUrl(): string {
    // Use the actual API URL rather than the WebView origin (https://localhost).
    // Android keeps native cookies partitioned by URL, so using the app origin
    // here makes the viewer cookie invisible to requests to the remote backend.
    return this.resolve('/api/ui/viewer');
  }

  private async nativeCookieHeader(): Promise<string> {
    if (!Capacitor.isNativePlatform()) return '';
    try {
      const cookies = await CapacitorCookies.getCookies({ url: this.cookieUrl() });
      return Object.entries(cookies || {}).map(([key, value]) => `${key}=${value}`).join('; ');
    } catch {
      return '';
    }
  }

  private async persistNativeSetCookie(headers: unknown): Promise<void> {
    if (!Capacitor.isNativePlatform() || !headers || typeof headers !== 'object') return;
    const rawHeaders = headers as Record<string, unknown>;
    const raw = rawHeaders['set-cookie'] ?? rawHeaders['Set-Cookie'] ?? rawHeaders['SET-COOKIE'];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const entry of values) {
      const cookie = String(entry || '');
      const first = cookie.split(';', 1)[0] || '';
      const separator = first.indexOf('=');
      if (separator <= 0) continue;
      const key = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!key || !value) continue;
      try {
        const expiresAttribute = cookie.match(/(?:^|;)\s*Expires=([^;]+)/i)?.[1];
        const expires = expiresAttribute ? new Date(expiresAttribute).toISOString() : undefined;
        await CapacitorCookies.setCookie({ url: this.cookieUrl(), key, value, path: '/', ...(expires ? { expires } : {}) });
      } catch {
        // CapacitorHttp may already have stored the cookie in the native jar.
      }
    }
  }

  get serverBase(): string {
    return this.baseUrl;
  }

  setServerBase(value: string): void {
    if (this.catalogPersistTimer !== null && typeof window !== 'undefined') window.clearTimeout(this.catalogPersistTimer);
    this.baseUrl = value.trim().replace(/\/$/, '');
    this.dramaCatalogCache = null;
    this.catalogInFlight.clear();
    this.catalogRefreshInFlight.clear();
    this.catalogPersistentScopes.clear();
  }

  /** Pause background catalogue pagination while the player owns the network. */
  setCatalogHydrationPaused(paused: boolean): void {
    this.catalogHydrationPaused = paused;
  }

  /** Return only rows already hydrated; never starts a network crawl. */
  catalogSnapshot(source?: string): Drama[] {
    const rows = this.dramaCatalogCache?.data || [];
    return source ? rows.filter(drama => this.matchesSource(drama, source)) : [...rows];
  }

  resolve(path: string): string {
    return path.startsWith('http') ? path : `${requestBaseUrl(this.baseUrl)}${path}`;
  }

  private async ensurePersistentCatalog(scope: string): Promise<void> {
    if (this.catalogPersistentScopes.has(scope)) return;
    this.catalogPersistentScopes.add(scope);
    const candidates = scope === 'all' ? ['all'] : ['all', scope];
    for (const candidate of candidates) {
      try {
        const raw = localStorage.getItem(catalogCacheKey(this.baseUrl, candidate));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as {
          version?: number;
          baseUrl?: string;
          scope?: string;
          savedAt?: number;
          cache?: ApiClient['dramaCatalogCache'];
        };
        if (parsed.version !== catalogCacheVersion || parsed.baseUrl !== this.baseUrl || parsed.scope !== candidate || !parsed.cache?.data?.length) continue;
        this.dramaCatalogCache = {
          ...parsed.cache,
          baseUrl: this.baseUrl,
          scope: candidate,
          data: Array.isArray(parsed.cache.data) ? parsed.cache.data : [],
          savedAt: Number(parsed.savedAt || parsed.cache.savedAt || 0),
        };
        return;
      } catch {
        localStorage.removeItem(catalogCacheKey(this.baseUrl, candidate));
      }
    }
  }

  private persistCatalogCache(): void {
    const cache = this.dramaCatalogCache;
    if (!cache?.data?.length) return;
    try {
      const trimmed = cache.data.length > catalogCacheMaxRows ? cache.data.slice(0, catalogCacheMaxRows) : cache.data;
      localStorage.setItem(catalogCacheKey(this.baseUrl, cache.scope), JSON.stringify({
        version: catalogCacheVersion,
        baseUrl: this.baseUrl,
        scope: cache.scope,
        savedAt: cache.savedAt || Date.now(),
        cache: { ...cache, data: trimmed },
      }));
    } catch {
      // Local storage quota is non-fatal; the in-memory cache remains usable.
    }
  }

  private scheduleCatalogPersist(): void {
    if (this.catalogPersistTimer !== null || typeof window === 'undefined') return;
    this.catalogPersistTimer = window.setTimeout(() => {
      this.catalogPersistTimer = null;
      this.persistCatalogCache();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('juku:catalog-updated', { detail: { baseUrl: this.baseUrl, scope: this.dramaCatalogCache?.scope || 'all' } }));
      }
    }, 250);
  }

  private refreshCatalogInBackground(scope: string, source?: string): void {
    if (this.catalogHydrationPaused || this.catalogRefreshInFlight.has(scope)) return;
    const request = (async () => {
      try {
        await this.hydrateCatalogInternal(source, true);
      } catch {
        // Stale cache remains available when a background refresh fails.
      }
    })();
    this.catalogRefreshInFlight.set(scope, request);
    void request.finally(() => {
      if (this.catalogRefreshInFlight.get(scope) === request) this.catalogRefreshInFlight.delete(scope);
    });
  }

  async viewer(): Promise<ViewerState> {
    let result = await this.get<ViewerState>('/api/ui/viewer');
    if (!result.ready) result = await this.get<ViewerState>('/api/ui/viewer?confirm=1');
    this.rememberViewer(result);
    return result;
  }

  async login(username: string, password: string): Promise<ViewerState> {
    // The backend deliberately requires an anonymous viewer cookie before it
    // accepts account credentials. Establish/refresh that cookie explicitly on
    // native clients before submitting the login form.
    await this.viewer();
    try {
      await this.post('/api/ui/account/login', { username, password }, 15000);
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== 'viewer_required') throw cause;
      await this.viewer();
      await this.post('/api/ui/account/login', { username, password }, 15000);
    }
    return this.viewer();
  }

  async logout(): Promise<void> {
    let failure: unknown;
    try {
      // Keep app shutdown responsive when the phone is offline. Local/native
      // session cleanup still runs in finally below.
      await this.post('/api/ui/account/logout', {}, 2500);
    } catch (error) {
      // A closed/offline server must not leave a native session behind. The
      // local cookie and viewer id are cleared below even when this request
      // cannot reach the backend.
      failure = error;
    } finally {
      localStorage.removeItem(viewerStorageKey(this.baseUrl));
      if (Capacitor.isNativePlatform()) {
        try { await CapacitorCookies.clearCookies({ url: this.cookieUrl() }); } catch { /* best effort */ }
      }
    }
    if (failure) throw failure;
  }

  async changePassword(password: string, newPassword: string): Promise<void> {
    await this.post('/api/ui/account/password', { password, newPassword });
  }

  async importGuestRecords(): Promise<{ ok?: boolean; history?: number; following?: number }> {
    return this.post('/api/ui/account/import', {});
  }

  adminPolicy(): Promise<AdminPolicy> {
    return this.request('/api/ui/admin/settings', { method: 'GET', cache: 'no-store' });
  }

  adminAccounts(): Promise<AdminAccounts> {
    return this.request('/api/ui/admin/accounts', { method: 'GET', cache: 'no-store' }, false);
  }

  saveAdminPolicy(policy: AdminPolicy): Promise<AdminPolicy> {
    return this.post('/api/ui/admin/settings', policy);
  }

  createAdminAccount(input: { username: string; password: string; sources: string[]; onlineOnly: boolean }): Promise<{ account: AdminAccount }> {
    return this.post('/api/ui/admin/accounts', input);
  }

  saveAccountPermissions(input: { username: string; sources: string[]; onlineOnly: boolean }): Promise<{ account: AdminAccount }> {
    return this.post('/api/ui/admin/accounts/permissions', input);
  }

  async dramas(page = 1, limit = 30, source?: string, refresh = false, force = false, legacyMore = false): Promise<DramaPageResult> {
    const scope = catalogScope(source);
    await this.ensurePersistentCatalog(scope);
    const cache = !refresh && !force && this.dramaCatalogCache?.baseUrl === this.baseUrl
      && (this.dramaCatalogCache.scope === scope || this.dramaCatalogCache.scope === 'all' && scope !== 'all')
      ? this.dramaCatalogCache
      : null;
    const start = Math.max(0, (page - 1) * limit);
    // A paginated response may have only populated the first page. Reuse the
    // cache only when the requested range is already present, otherwise fetch
    // the missing page from the server.
    if (cache && (cache.data.length >= start + limit || cache.hasMore === false && !cache.paginationUnknown)) {
      if (!refresh && !force && (!cache.savedAt || Date.now() - cache.savedAt >= catalogCacheTtl)) {
        this.refreshCatalogInBackground(scope);
      }
      return this.sliceDramaCatalog(page, limit, source);
    }
    const sourceQuery = source ? `&source=${encodeURIComponent(source)}` : '';
    const updateQuery = refresh ? '&update=1' : '';
    // `more=1` is a legacy snapshot continuation command, not a general
    // pagination flag. Only send it after the response has been identified as
    // the local/Web legacy protocol; modern servers must receive page/limit
    // without this flag or they may switch to a source-specific loader.
    const requestQuery = legacyMore
      ? `/api/ui/dramas?more=1${sourceQuery}${updateQuery}`
      : `/api/ui/dramas?page=${page}&limit=${limit}&cached=${refresh ? 'false' : 'true'}${sourceQuery}${updateQuery}`;
    const response = await this.get<Drama[] | DramaResponsePayload>(
      requestQuery,
      false,
      refresh ? 20000 : undefined,
    );
    let { payload, data: incoming } = normalizeDramaResponse(response);
    let incomingSourceTotals = responseSourceTotals(payload);
    let declaredTotal = Number(payload.total);
    // `loading` means the catalogue itself is still being assembled. The
    // metadata worker may continue running after the complete catalogue and
    // its total are already available, so it must not make a page-sized total
    // look provisional.
    let incomingLoading = Boolean(payload.loading || payload.loadingMore);

    // Some older deployments return only the first 30 rows for a paginated
    // request and report that page size as the complete total. Try the same
    // endpoint without page/limit first; the local/web server returns its
    // complete snapshot in that form. This keeps the normal path to one
    // request while recovering full totals from those deployments.
    const suspiciousFirstPage = page === 1 && incoming.length > 0 && incoming.length <= 30
      && (limit >= incoming.length || !Number.isInteger(payload.page) || !Number.isInteger(payload.limit));
    // Native CapacitorHttp parses the response into a Java object before it
    // reaches the WebView. Some older backends ignore page/limit and return a
    // complete multi-megabyte catalog for the snapshot probe; on Android that
    // can exceed the WebView heap and blank the whole app. Native clients keep
    // the bounded page response and authoritative source metadata instead.
    if (suspiciousFirstPage && !Capacitor.isNativePlatform()) {
      try {
        const snapshot = await this.get<Drama[] | DramaResponsePayload>(
          `/api/ui/dramas?cached=${refresh ? 'false' : 'true'}${sourceQuery}${updateQuery}`,
          false,
          refresh ? 20000 : undefined,
        );
        const parsedSnapshot = normalizeDramaResponse(snapshot);
        const snapshotTotals = responseSourceTotals(parsedSnapshot.payload);
        const snapshotTotal = Number(parsedSnapshot.payload.total);
        if (parsedSnapshot.data.length > incoming.length
          || Object.keys(snapshotTotals).length > 0
          || Number.isFinite(snapshotTotal) && snapshotTotal > incoming.length) {
          payload = parsedSnapshot.payload;
          incoming = parsedSnapshot.data;
          incomingSourceTotals = snapshotTotals;
          declaredTotal = snapshotTotal;
          incomingLoading = Boolean(parsedSnapshot.payload.loading || parsedSnapshot.payload.loadingMore);
        }
      } catch {
        // The probe is best-effort; continue with paginated fallback below.
      }
      // Older remote servers expose the authoritative total only through the
      // status form of this endpoint. It may still return the first page, so
      // use it only for metadata and keep the page rows above.
      if (incoming.length <= 30 && !Object.keys(incomingSourceTotals).length && (!Number.isFinite(declaredTotal) || declaredTotal <= incoming.length)) {
        try {
          const status = await this.get<Drama[] | DramaResponsePayload>(`/api/ui/dramas?status=${Date.now()}${sourceQuery}`, false, refresh ? 20000 : undefined);
          const parsedStatus = normalizeDramaResponse(status);
          const statusTotals = responseSourceTotals(parsedStatus.payload);
          const statusTotal = Number(parsedStatus.payload.total);
          if (Object.keys(statusTotals).length || Number.isFinite(statusTotal) && statusTotal > incoming.length) {
            incomingSourceTotals = statusTotals;
            declaredTotal = statusTotal;
            payload = {
              ...payload,
              total: statusTotal,
              sources: parsedStatus.payload.sources,
              sourceTotals: parsedStatus.payload.sourceTotals,
              hasMore: parsedStatus.payload.hasMore ?? payload.hasMore,
            };
            incomingLoading = Boolean(parsedStatus.payload.loading || parsedStatus.payload.loadingMore);
          }
        } catch {
          // Keep the page response as the fallback when status is unavailable.
        }
      }
    }

    // During an asynchronous refresh some deployments report the number of
    // rows currently in memory as `total` (usually 30) and expose zero-valued
    // source counters. Those values are a progress snapshot, not the final
    // catalogue size. Keep them out of the cache until a later poll publishes
    // a real total or a source count larger than the current page.
    // A source response may include several provider counters. Treat their
    // scoped aggregate as a complete-count signal, rather than checking one
    // counter at a time: a page can legitimately contain 30 rows while two
    // providers each report 30+ rows.
    const incomingScopedTotal = source
      ? sourceTotalOf(incomingSourceTotals, source)
      : sourceTotalsSum(incomingSourceTotals);
    const sourceCountSignal = incomingScopedTotal !== undefined
      ? incomingScopedTotal > incoming.length
      : false;
    // A refresh response can be either a page-sized progress snapshot (the
    // common remote case: 30 rows) or a complete legacy snapshot. Only the
    // former is provisional. If a full snapshot already contains more than
    // one page, its row count is meaningful even while a background source
    // updater is still running; clearing it would make the UI fall back to an
    // unknown/page-sized count after the snapshot probe.
    const provisionalCount = incoming.length <= 30
      && incomingLoading
      && (!Number.isFinite(declaredTotal) || declaredTotal <= incoming.length)
      && !sourceCountSignal;
    if (provisionalCount) {
      declaredTotal = Number.NaN;
      incomingSourceTotals = {};
    }

    const globalSourceTotal = sourceTotalsSum(incomingSourceTotals);
    const sourceDeclaredTotal = sourceTotalOf(incomingSourceTotals, source);
    const effectiveTotal = sourceDeclaredTotal
      ?? (Number.isFinite(declaredTotal) ? Math.max(declaredTotal, globalSourceTotal, incoming.length) : Math.max(globalSourceTotal, incoming.length));
    // Some deployed backends paginate correctly but omit the page/limit
    // echo fields. A declared total larger than the current payload is enough
    // to distinguish that response from the legacy full-snapshot format.
    // Only merge pages into a cache with the same request scope. In
    // particular, do not merge a source-scoped cache into an all-source
    // request (or vice versa): source counters from that cache are otherwise
    // mistaken for the complete catalog total.
    const previousCache = (!refresh || force) && this.dramaCatalogCache?.baseUrl === this.baseUrl
      && this.dramaCatalogCache.scope === scope
      ? this.dramaCatalogCache
      : null;
    const explicitPagination = Number.isInteger(payload.page) || Number.isInteger(payload.limit);
    const stalePageTotal = page === 1 && incoming.length > 0 && incoming.length <= 30
      && Number.isFinite(declaredTotal) && declaredTotal <= incoming.length
      && !sourceCountSignal;
    const unknownFirstPage = page === 1 && incoming.length > 0 && incoming.length <= 30
      && (stalePageTotal || !explicitPagination && !Number.isFinite(declaredTotal));
    const serverPaged = previousCache?.paginationUnknown === true || unknownFirstPage || explicitPagination
      || payload.hasMore === true || incomingLoading || (
      Number.isInteger(payload.page) && Number.isInteger(payload.limit)
      || effectiveTotal > incoming.length
    );
    if (serverPaged) {
      const filtered = source ? incoming.filter(drama => this.matchesSource(drama, source)) : incoming;
      const previous = previousCache?.data || [];
      const refreshingFirstPage = refresh && page === 1;
      const positions = new Map<string, number>();
      const merged: Drama[] = refreshingFirstPage ? [] : [...previous];
      if (!refreshingFirstPage) {
        previous.forEach((drama, index) => positions.set(drama.id, index));
      }
      for (const drama of incoming) {
        const existing = positions.get(drama.id);
        if (existing === undefined) {
          positions.set(drama.id, merged.length);
          merged.push(drama);
        } else {
          merged[existing] = { ...merged[existing], ...drama };
        }
      }
      if (refreshingFirstPage) {
        const freshIds = new Set(incoming.map(drama => drama.id));
        for (const drama of previous) {
          if (freshIds.has(drama.id)) continue;
          positions.set(drama.id, merged.length);
          merged.push(drama);
        }
      }
      const mergedSourceTotals = { ...(previousCache?.sourceTotals || {}), ...incomingSourceTotals };
      const mergedHasMoreBySource = { ...(previousCache?.hasMoreBySource || {}), ...(payload.hasMoreBySource || {}) };
      const responseHasAuthoritativeSize = Number.isFinite(declaredTotal)
        && !incomingLoading
        && Number(declaredTotal) >= incoming.length
        && (Number(declaredTotal) > incoming.length || incoming.length > 30);
      const unknownPagination = Boolean(unknownFirstPage || previousCache?.paginationUnknown && !responseHasAuthoritativeSize);
      const paginationMode = previousCache?.paginationMode || (explicitPagination || Number.isFinite(declaredTotal) && declaredTotal > incoming.length ? 'page' : 'legacy');
      const paginationExplicit = Boolean(previousCache?.paginationExplicit || explicitPagination);
      // The server may cap a requested limit (for example, always returning
      // 30 rows). Use the observed row count as the cursor width so page 2
      // does not skip rows 31-200.
      const observedPageSize = incoming.length > 0 ? incoming.length : Number(payload.limit);
      const pageSize = Math.max(previousCache?.pageSize || 0, observedPageSize || 1);
      const reachedEnd = unknownPagination && incoming.length < pageSize;
      const mergedScopedTotal = source
        ? sourceTotalOf(mergedSourceTotals, source)
        : sourceTotalsSum(mergedSourceTotals);
      const mergedSourceCountSignal = mergedScopedTotal !== undefined
        ? mergedScopedTotal > incoming.length
        : false;
      // A legacy snapshot can contain the complete catalog while its grouped
      // source counters add up exactly to the number of loaded rows. In that
      // case `>` would be too strict and the app would lose per-source totals
      // even though the snapshot is already complete. A full snapshot is
      // distinguishable from the remote first page because it contains more
      // than the 30-row page size.
      const fullSnapshotSourceSignal = incoming.length > 30
        && mergedScopedTotal !== undefined
        && mergedScopedTotal >= incoming.length;
      // `sources.*.count` is often a page-sized count on remote paginated
      // responses. Do not promote it to the source total merely because the
      // response included page/limit fields; it is authoritative only when
      // the scoped counter exceeds the page or the server explicitly marks
      // this as the final page.
      const sourceTotalsAuthoritative = mergedSourceCountSignal
        || fullSnapshotSourceSignal
        || !unknownPagination && payload.hasMore === false && !incomingLoading;
      const groupedTotal = sourceTotalsAuthoritative ? sourceTotalsSum(mergedSourceTotals) : 0;
      const sourceSpecificTotal = sourceTotalOf(mergedSourceTotals, source);
      // For a source-scoped request, a complete source counter is the most
      // useful total. For the unfiltered catalog, however, the root-level
      // `total` is authoritative when it is larger than a source counter.
      // Remote deployments commonly return the first page's source counter
      // (for example `hongguo: 30`) alongside the all-source total (for
      // example `total: 1039`). Using the grouped source counter for the
      // unfiltered view made the UI stop paging at 30 rows and display the
      // wrong all-source count.
      const declaredCatalogTotal = Number.isFinite(declaredTotal) ? declaredTotal : Number.NaN;
      const resolvedAllTotal = allCatalogTotal(declaredCatalogTotal, groupedTotal, incoming.length);
      const total = sourceTotalsAuthoritative && sourceSpecificTotal !== undefined
        ? sourceSpecificTotal
        : unknownPagination
          ? resolvedAllTotal ?? (reachedEnd ? merged.length : undefined)
          // An explicitly paginated response with no authoritative total is
          // still incomplete even when `unknownPagination` is false. In
          // particular, never turn its first 30 rows into the catalog total.
          : resolvedAllTotal ?? (payload.hasMore === false && !incomingLoading && (incoming.length !== 30 || merged.length > 30) ? merged.length : undefined);
      // A few deployments expose a stale/omitted `hasMore` flag. When the
      // declared total still exceeds the range returned for this page, keep
      // paging even if that flag is explicitly false.
      const inferredHasMore = total !== undefined && filtered.length > 0 && start + filtered.length < Number(total);
      // When the first page was identified as a page-sized/stale total, keep
      // probing until a short page or a repeated page is observed. For normal
      // paginated responses, an explicit false `hasMore` remains authoritative.
      const hasMore = payload.hasMore === true || inferredHasMore
        || unknownPagination && !reachedEnd && incoming.length > 0;
      this.dramaCatalogCache = {
        baseUrl: this.baseUrl,
        scope,
        data: merged,
        total,
        hasMore,
        sourceTotals: mergedSourceTotals,
        sourceTotalsTrusted: sourceTotalsAuthoritative,
        hasMoreBySource: mergedHasMoreBySource,
        loading: incomingLoading,
        paginationUnknown: unknownPagination && hasMore,
        pageSize,
        nextPage: hasMore ? page + 1 : undefined,
        paginationMode,
        paginationExplicit,
        savedAt: Date.now(),
      };
      this.scheduleCatalogPersist();
      return {
        data: filtered,
        total,
        hasMore,
        sourceTotals: sourceTotalsAuthoritative ? mergedSourceTotals : undefined,
        loading: incomingLoading,
        paginationUnknown: unknownPagination && hasMore,
        totalKnown: total !== undefined,
      };
    }
    // Older servers return one complete snapshot and ignore page/limit. Keep
    // the snapshot intact, then expose the requested slice to the caller.
    const total = sourceDeclaredTotal
      ?? allCatalogTotal(declaredTotal, globalSourceTotal, incoming.length)
      ?? incoming.length;
    this.dramaCatalogCache = {
      baseUrl: this.baseUrl,
      scope,
      data: incoming,
      total,
      hasMore: Boolean(payload.hasMore),
      sourceTotals: incomingSourceTotals,
      sourceTotalsTrusted: true,
      hasMoreBySource: payload.hasMoreBySource || {},
      pageSize: incoming.length || limit,
      loading: incomingLoading,
      paginationMode: explicitPagination || Number.isFinite(declaredTotal) && declaredTotal > incoming.length ? 'page' : 'legacy',
      paginationExplicit: explicitPagination,
      savedAt: Date.now(),
    };
    this.scheduleCatalogPersist();
    const catalog = source ? this.dramaCatalogCache.data.filter(drama => this.matchesSource(drama, source)) : this.dramaCatalogCache.data;
    const data = catalog.slice(start, start + limit);
    return { data, total, hasMore: start + data.length < total, sourceTotals: incomingSourceTotals, loading: incomingLoading, totalKnown: true };
  }

  libraryStatus(): Promise<LibraryStatus> {
    return this.request<LibraryStatus>(
      // The status payload also contains catalog rows. Request a single row
      // because SourceStatusView only needs loading/source counters and
      // metadata; downloading the full catalog here stalls native JSON
      // parsing on Android.
      `/api/ui/dramas?status=${Date.now()}&page=1&limit=1`,
      { method: 'GET', cache: 'no-store' },
      false,
      15000,
    );
  }

  updateLibrarySource(source: string): Promise<LibraryStatus> {
    return this.request<LibraryStatus>(
      `/api/ui/dramas?update=1&source=${encodeURIComponent(source)}&page=1&limit=1`,
      { method: 'GET', cache: 'no-store' },
      false,
      15000,
    );
  }

  private sliceDramaCatalog(page: number, limit: number, source?: string, input?: Drama[]): { data: Drama[]; total?: number; hasMore: boolean } {
    const cache = this.dramaCatalogCache;
    const catalog = input || (source ? cache?.data.filter(drama => this.matchesSource(drama, source)) : cache?.data) || [];
    const start = Math.max(0, (page - 1) * limit);
    const data = catalog.slice(start, start + limit);
    const sourceTotal = sourceTotalOf(cache?.sourceTotals || {}, source);
    const total = source ? sourceTotal ?? cache?.total : cache?.total;
    return { data, total, hasMore: total === undefined ? Boolean(cache?.hasMore ?? true) : start + data.length < total };
  }

  async catalog(source?: string): Promise<Drama[]> {
    const scope = catalogScope(source);
    await this.ensurePersistentCatalog(scope);
    const running = this.catalogInFlight.get(scope);
    if (running) return running;
    const request = this.catalogInternal(source);
    this.catalogInFlight.set(scope, request);
    try {
      return await request;
    } finally {
      if (this.catalogInFlight.get(scope) === request) this.catalogInFlight.delete(scope);
    }
  }

  private async catalogInternal(source?: string): Promise<Drama[]> {
    const scope = catalogScope(source);
    await this.ensurePersistentCatalog(scope);
    const existing = this.dramaCatalogCache?.baseUrl === this.baseUrl ? this.dramaCatalogCache : null;
    if (existing?.data?.length) {
      const snapshot = source ? existing.data.filter(drama => this.matchesSource(drama, source)) : [...existing.data];
      if (!this.catalogHydrationPaused && (existing.hasMore || existing.paginationUnknown || !existing.savedAt || Date.now() - existing.savedAt >= catalogCacheTtl)) {
        this.refreshCatalogInBackground(scope, source);
      }
      return snapshot;
    }
    return this.hydrateCatalogInternal(source);
  }

  private async hydrateCatalogInternal(source?: string, refreshFirst = false): Promise<Drama[]> {
    const existing = this.dramaCatalogCache?.baseUrl === this.baseUrl ? this.dramaCatalogCache : null;
    if (this.catalogHydrationPaused) {
      return source
        ? (existing?.data || []).filter(drama => this.matchesSource(drama, source))
        : [...(existing?.data || [])];
    }
    // The visible page is intentionally 30 rows, but catalog hydration must
    // restart at page 1 with the largest practical request. Otherwise a
    // server that caps `limit` at 30 can make the next request jump to offset
    // 200 and silently lose rows 31-200.
    if (refreshFirst || !existing || existing.scope !== 'all' || existing.loading || existing.data.length < 200 || existing.paginationUnknown) {
      await this.dramas(1, 200, undefined, refreshFirst, true);
    }
    // Some deployments expose page/limit pagination while older deployments
    // return the whole snapshot. Continue only when the response explicitly
    // indicates more paginated data is available. While the backend is still
    // loading its source catalogs, poll page 1 so the app can observe the
    // eventual full count instead of freezing at the initial 30 rows.
    // Do a short foreground wait so a fast local refresh is reflected before
    // the first render. Slow remote refreshes continue in the background via
    // the view's polling loop instead of blocking the whole app for minutes.
    const maxLoadingPolls = 6;
    let loadingPolls = 0;
    while (!this.catalogHydrationPaused && this.dramaCatalogCache?.loading && loadingPolls < maxLoadingPolls) {
      await wait(500);
      await this.dramas(1, 200, undefined, false, true);
      loadingPolls += 1;
    }
    let page = this.dramaCatalogCache?.nextPage || 2;
    let pageLimit = Math.max(1, this.dramaCatalogCache?.pageSize || 200);
    let pageNumberLimit = 1000;
    let duplicatePageRetries = 0;
    while (!this.catalogHydrationPaused && this.dramaCatalogCache?.hasMore && page <= pageNumberLimit) {
      const before = this.dramaCatalogCache.data.length;
      // Reuse the endpoint's observed page width. If a server caps `limit`
      // at 30, requesting page 2 with limit 200 would otherwise jump to an
      // offset near 200 and omit rows 31-200.
      pageLimit = Math.max(1, this.dramaCatalogCache?.pageSize || pageLimit);
      const result = await this.dramas(page, pageLimit, undefined);
      const after = this.dramaCatalogCache?.data.length ?? before;
      if (!result.hasMore) break;
      if (after <= before) {
        // If the source catalog is still being assembled, a repeated page is
        // not an end-of-catalog signal; give the backend another chance to
        // publish new rows before stopping pagination.
        if (this.dramaCatalogCache?.loading && loadingPolls < maxLoadingPolls) {
          await wait(500);
          await this.dramas(1, 200, undefined, false, true);
          loadingPolls += 1;
          page = this.dramaCatalogCache?.nextPage || page;
          continue;
        }
        // The backend is still assembling the catalogue. Keep the cache in
        // its loading/unknown state so a later poll can publish the real
        // total; never turn the current page length into a final count.
        if (this.dramaCatalogCache?.loading) break;
        // Legacy Web backends use a separate continuation command. Try it
        // only after a normal page request repeats the cached snapshot; never
        // send it on the normal remote-pagination path.
        // `more=1` is only a continuation for the unfiltered Web snapshot;
        // do not invoke it while hydrating a source-scoped catalog because
        // the local backend maps that command to Hongguo and would return
        // unrelated rows for Huangguo/Huangdou.
        if (source === undefined && !this.dramaCatalogCache?.paginationExplicit && duplicatePageRetries < 4) {
          duplicatePageRetries += 1;
          try {
            // Leave `source` unset here. The legacy command itself selects the
            // Hongguo continuation; passing it as a response filter would
            // overwrite the all-source total with only Hongguo's count.
            const continued = await this.dramas(page, pageLimit, undefined, false, false, true);
            const continuedAfter = this.dramaCatalogCache?.data.length ?? before;
            if (continuedAfter > before || continued.hasMore && this.dramaCatalogCache?.loading) {
              duplicatePageRetries = 0;
              page = this.dramaCatalogCache?.nextPage || page;
              continue;
            }
          } catch {
            // A modern endpoint may reject the legacy command; page probing
            // remains the source of truth for that deployment.
          }
          await wait(300);
          continue;
        }
        // Some legacy servers accept `more=1` but do not expose a loading
        // flag. Give the continuation request a few short retries before
        // concluding that page/limit is unsupported and stopping at the
        // first page. This avoids freezing the all-source total at 30 while
        // retaining a bounded request count for truly static endpoints.
        if (this.dramaCatalogCache?.paginationUnknown && duplicatePageRetries < 4) {
          duplicatePageRetries += 1;
          await wait(300);
          continue;
        }
        // A legacy endpoint may ignore page/limit and repeat its first page.
        // Stop probing, but keep any authoritative total/source statistics
        // already returned by the server. Replacing them with the number of
        // loaded rows makes a remote catalog such as 12,831 appear as 30.
        if (this.dramaCatalogCache) {
          this.dramaCatalogCache.hasMore = false;
          // Keep paginationUnknown true when no authoritative metadata was
          // returned. A subsequent catalogue call should probe again rather
          // than freezing a remote catalogue at its first page size.
          this.dramaCatalogCache.paginationUnknown = this.dramaCatalogCache.total === undefined;
        }
        break;
      }
      duplicatePageRetries = 0;
      page += 1;
    }
    // An unknown-pagination endpoint becomes authoritative once a short final
    // page is observed. For defensive compatibility, use the loaded count as
    // the total when the server omitted all total metadata.
    const completedCache = this.dramaCatalogCache;
    if (completedCache && completedCache.total === undefined && !completedCache.hasMore && !completedCache.loading && !completedCache.paginationUnknown) {
      const sourceTotal = sourceTotalsSum(completedCache.sourceTotals || {});
      completedCache.total = sourceTotal > 0 ? sourceTotal : completedCache.data.length;
    }
    return source ? this.dramaCatalogCache!.data.filter(drama => this.matchesSource(drama, source)) : [...(this.dramaCatalogCache?.data || [])];
  }

  async dramaCategories(source?: string): Promise<string[]> {
    const catalog = await this.catalog(source);
    const scoped = source ? catalog.filter(drama => this.matchesSource(drama, source)) : catalog;
    const categories = new Set<string>();
    for (const drama of scoped) {
      const category = this.categoryValue(drama);
      if (category) categories.add(category);
    }
    return [...categories].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  private categoryValue(drama: Drama): string {
    const direct = [drama.categoryName, drama.category_name, drama.typeName, drama.type_name, drama.sortName, drama.sort_name, drama.category, drama.categoryNameSnake]
      .map(value => String(value || '').trim()).find(Boolean);
    if (direct) return direct;
    const channel = String(drama.channelName || drama.channel_name || '').trim();
    return ['黄果原创', '成人短剧', '成人漫剧', 'AI魔改'].includes(channel) ? channel : '';
  }

  private matchesSource(drama: Drama, source: string): boolean {
    const aliases: Record<string, string> = {
      hongguo: 'hongguo', redfruit: 'hongguo', 'red-fruit': 'hongguo', '红果': 'hongguo', 'hongguoduanju.com': 'hongguo',
      huangguo: 'huangguo', huangguoai: 'huangguo', 'huangguo-video': 'huangguo', 'huangguo-ai': 'huangguo', 'huangguoai.com': 'huangguo', 'huangguo.video': 'huangguo', cloudfront: 'huangguo', api: 'huangguo', '黄果': 'huangguo',
      huangdou: 'huangdou', yellowbean: 'huangdou', 'yellow-bean': 'huangdou', 'tideember.cc': 'huangdou', 'xqjurgek.top': 'huangdou', '黄豆': 'huangdou',
    };
    const hints = [drama.source, drama.id.split(':')[0], drama.channelName, drama.channel_name, drama.site, drama.host];
    for (const hint of hints) {
      const raw = String(hint || '').trim().toLowerCase();
      let value = raw;
      if (/^https?:\/\//.test(raw)) {
        try { value = new URL(raw).hostname.replace(/^www\./, ''); } catch { /* ignore malformed source hint */ }
      } else value = raw.replace(/^www\./, '').split(':')[0].replace(/[_\s]+/g, '-');
      const normalized = aliases[value];
      if (normalized) return normalized === source;
    }
    if (!drama.source && ['黄果原创', '成人短剧', '成人漫剧', 'AI魔改'].includes(String(drama.channelName || drama.channel_name || ''))) return source === 'huangguo';
    return false;
  }

  async search(query: string, limit = 30): Promise<SearchResult> {
    const response = await this.get<Drama[] | { data?: Drama[]; items?: Drama[]; query?: string; warning?: string; limited?: boolean }>(`/api/ui/search?q=${encodeURIComponent(query)}&limit=${limit}`, false);
    if (Array.isArray(response)) return { items: response, query };
    return { items: response.data ?? response.items ?? [], query: response.query ?? query, warning: response.warning, limited: response.limited };
  }

  async coverRepair(dramaId: string, cover: string): Promise<{ dramaId?: string; cover?: string; retryAfter?: number }> {
    return this.post('/api/ui/cover/repair', { dramaId, cover });
  }

  async playbackHistory(): Promise<PlaybackHistoryItem[]> {
    const response = await this.request<PlaybackHistoryItem[] | { items?: PlaybackHistoryItem[]; data?: PlaybackHistoryItem[] }>(
      `/api/ui/playback/history?sync=${Date.now()}`,
      { method: 'GET', cache: 'no-store' },
    );
    return Array.isArray(response) ? response : response.items ?? response.data ?? [];
  }

  async following(): Promise<FollowingItem[]> {
    // The following list is shared with the web client; never reuse a stale browser/proxy response.
    const response = await this.request<FollowingItem[] | { items?: FollowingItem[]; data?: FollowingItem[] }>(`/api/ui/following?sync=${Date.now()}`, { method: 'GET', cache: 'no-store' });
    return Array.isArray(response) ? response : response.items ?? response.data ?? [];
  }

  async updateFollowing(dramaId: string, values: { saved?: boolean; completed?: boolean; acknowledge?: boolean }): Promise<FollowingItem | null> {
    const response = await this.post<{ entry?: FollowingItem }>('/api/ui/following', { dramaId, ...values });
    return response.entry ?? null;
  }

  async enqueueDownload(ids: string[], quality = 0): Promise<void> {
    await this.post('/api/ui/download', { ids, quality });
  }

  async tasks(): Promise<DownloadTask[]> {
    const response = await this.get<DownloadTask[] | { data?: DownloadTask[]; items?: DownloadTask[] }>('/api/ui/tasks');
    return Array.isArray(response) ? response : response.data ?? response.items ?? [];
  }

  async updateDownloadTasks(action: 'pause' | 'resume' | 'retry' | 'cancel', dramaIds: string[]): Promise<DownloadTask[]> {
    const response = await this.post<DownloadTask[] | { data?: DownloadTask[] }>(`/api/ui/tasks/${action}`, { dramaIds });
    return Array.isArray(response) ? response : response.data ?? [];
  }

  async updateDownloadTask(action: 'resume' | 'retry', id: string): Promise<DownloadTask[]> {
    const response = await this.post<DownloadTask[] | { data?: DownloadTask[] }>(`/api/ui/tasks/${action}`, { ids: [id] });
    return Array.isArray(response) ? response : response.data ?? [];
  }

  async rankingBoards(): Promise<RankingBoard[]> {
    const response = await this.get<{ boards?: RankingBoard[] }>('/api/ui/rankings', true, 15000);
    return response.boards ?? [];
  }

  async rankings(boardId = 'hongguo-hot', page = 1, limit = 12): Promise<RankingPage> {
    const response = await this.get<RankingItem[] | RankingPage | { items?: RankingItem[]; data?: RankingItem[] }>(`/api/ui/rankings?board=${encodeURIComponent(boardId)}&page=${page}&limit=${limit}`, true, 15000);
    if (Array.isArray(response)) return { items: response, page, hasMore: response.length === limit, boardId };
    const payload = response as RankingPage & { data?: RankingItem[] };
    return {
      ...payload,
      items: payload.items ?? payload.data ?? [],
      page: payload.page ?? page,
      boardId: payload.boardId ?? boardId,
    };
  }

  async playbackOpen(dramaId: string): Promise<PlaybackOpen> {
    return this.post<PlaybackOpen>('/api/ui/playback/open', { dramaId, resume: true });
  }

  async playbackPlan(session: string, episode: number, start = 0, mode: 'auto' | 'proxy' | 'compatible' | 'audio' | 'legacy' = 'auto', quality = 0): Promise<PlaybackPlan> {
    return this.post<PlaybackPlan>('/api/ui/playback/plan', {
      session,
      episode,
      start,
      quality,
      version: 0,
      mode,
      client: {
        mp4: true,
        nativeHls: 'HLS' in document.createElement('video'),
        hlsjs: true,
        video: ['h264', 'hevc', 'av1', 'vp9'],
        audio: ['aac', 'ac3', 'eac3', 'opus'],
      },
    });
  }

  async playbackHlsOpen(session: string, episode: number, start = 0, quality = 0): Promise<PlaybackPlan> {
    return this.post<PlaybackPlan>('/api/ui/playback/hls/open', { session, episode, start, quality, version: 0 });
  }

  async playbackControl(session: string, action: string, progress?: Record<string, unknown>): Promise<void> {
    await this.post('/api/ui/playback/control', { session, action, progress });
  }

  async playbackProgress(session: string, progress: { run: number; sequence: number; episode: number; position: number; duration: number; completed: boolean }): Promise<void> {
    await this.post('/api/ui/playback/progress', { session, progress });
  }

  private rememberViewer(viewer: ViewerState): void {
    if (viewer.id) localStorage.setItem(viewerStorageKey(this.baseUrl), viewer.id);
    const sourcesKey = viewerContextStorageKey(VIEWER_SOURCES_KEY, this.baseUrl);
    const onlineOnlyKey = viewerContextStorageKey(VIEWER_ONLINE_ONLY_KEY, this.baseUrl);
    if (Array.isArray(viewer.sources)) localStorage.setItem(sourcesKey, viewer.sources.join(','));
    else localStorage.removeItem(sourcesKey);
    if (viewer.onlineOnly !== undefined) localStorage.setItem(onlineOnlyKey, String(viewer.onlineOnly === true));
    else localStorage.removeItem(onlineOnlyKey);
  }

  private async get<T>(path: string, unwrapData = true, timeoutMs?: number): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, unwrapData, timeoutMs);
  }

  private async post<T = unknown>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }, true, timeoutMs);
  }

  private async request<T>(path: string, init: RequestInit, unwrapData = true, timeoutMs?: number): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    for (const [key, value] of Object.entries(viewerHeadersFor(this.baseUrl))) headers.set(key, value);
    const controller = timeoutMs ? new AbortController() : undefined;
    const timeout = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined;
    let responseStatus = 0;
    try {
      const body = await networkScheduler.enqueue(async () => {
        let result: unknown;
        if (Capacitor.isNativePlatform()) {
          const cookieHeader = await this.nativeCookieHeader();
          if (cookieHeader) headers.set('Cookie', cookieHeader);
          const nativeResponse = await CapacitorHttp.request({
            url: this.resolve(path),
            method: init.method || 'GET',
            headers: Object.fromEntries(headers.entries()),
            data: init.body ? JSON.parse(String(init.body)) : undefined,
            responseType: 'json',
            connectTimeout: timeoutMs || 15000,
            readTimeout: timeoutMs || 30000,
          });
          responseStatus = nativeResponse.status;
          await this.persistNativeSetCookie(nativeResponse.headers);
          result = nativeResponse.data;
        } else {
          const response = await fetch(this.resolve(path), {
            ...init,
            headers,
            credentials: 'include',
            signal: controller?.signal,
          });
          responseStatus = response.status;
          try {
            result = await response.json();
          } catch {
            throw new ApiError('服务器未返回有效 JSON', response.status);
          }
        }
        return result;
      }, {
        priority: priorityForApiPath(path),
        label: this.resolve(path),
        signal: controller?.signal,
        minIntervalMs: /\/playback\//i.test(path) ? 0 : /\/dramas|\/rankings/i.test(path) ? 180 : 80,
      });
      if (responseStatus < 200 || responseStatus >= 300) {
        const error = body as { error?: string; code?: string };
        throw new ApiError(error.error || `HTTP ${responseStatus}`, responseStatus, error.code);
      }
      const envelope = body as { data?: T };
      return (unwrapData && Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : body) as T;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      if (controller?.signal.aborted) throw new ApiError('服务器刷新超时，请稍后重试；已有内容仍可继续使用。');
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(`无法连接服务器（${message}）。请检查地址、证书和网络；浏览器跨域预览需要使用开发代理。`);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }
}
