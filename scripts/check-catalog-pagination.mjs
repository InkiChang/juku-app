import assert from 'node:assert/strict';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };

function row(index, source = 'hongguo') { return { id: `${source}:${index}`, source, title: `剧集 ${index}` }; }
function response(body) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { ApiClient } = await vite.ssrLoadModule('/src/api/client.ts');
  let calls = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url), 'http://test.local');
    calls.push(parsed.search);
    const page = Number(parsed.searchParams.get('page') || 1);
    const data = page === 1 ? Array.from({ length: 30 }, (_, i) => row(i + 1)) : page === 2 ? Array.from({ length: 30 }, (_, i) => row(i + 31)) : Array.from({ length: 5 }, (_, i) => row(i + 61));
    return response({ data, total: 65, hasMore: page < 3 });
  };
  const client = new ApiClient('http://test.local');
  const catalog = await client.catalog();
  assert.equal(catalog.length, 65);
  assert.equal(client.libraryTotals().total, 65);
  assert.ok(calls.every(query => !query.includes('more=1')));
  console.log('PASS modern page/limit catalog: 65 rows, no legacy more flag');

  calls = [];
  let legacyCall = 0;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url), 'http://test.local');
    calls.push(parsed.search);
    if (parsed.searchParams.get('more') === '1') {
      legacyCall += 1;
      return response({ data: Array.from({ length: 65 }, (_, i) => row(i + 1)), total: 65, hasMore: false });
    }
    return response({ data: Array.from({ length: 30 }, (_, i) => row(i + 1)), total: 65, hasMore: true });
  };
  const legacy = new ApiClient('http://test.local');
  const legacyCatalog = await legacy.catalog();
  assert.equal(legacyCatalog.length, 65);
  assert.equal(legacyCall, 1);
  assert.ok(calls.some(query => query.includes('page=2')));
  console.log('PASS duplicate hidden-page response falls back to one legacy continuation');

  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 30,
    sourceTotals: { hongguo: 50, cloudfront: 10, huangguoai: 20, 'huangguo-video': 30, huangdou: 40 },
    hasMore: false,
  });
  const totals = new ApiClient('http://test.local');
  await totals.catalog();
  assert.equal(totals.libraryTotals().total, 150);
  console.log('PASS sourceTotals overrides page-sized total and groups Huangguo providers');

  // An all-source response may expose the first page's source counter while
  // the root payload already knows the complete catalog size. The root total
  // must win for the unfiltered view instead of being reduced to 30.
  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 1039,
    sourceTotals: { hongguo: 30 },
    hasMore: true,
  });
  const declaredAllTotal = new ApiClient('http://test.local');
  const firstDeclaredPage = await declaredAllTotal.dramas(1, 30);
  assert.equal(firstDeclaredPage.total, 1039);
  assert.equal(declaredAllTotal.libraryTotals().total, 1039);
  assert.equal(firstDeclaredPage.hasMore, true);
  console.log('PASS root all-source total is retained over page-sized source counter');

  // When the root total is a complete count, it is authoritative even if
  // provider counters are larger because they overlap or use another scope.
  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 100,
    sourceTotals: { hongguo: 70, huangdou: 80 },
    hasMore: true,
    page: 1,
    limit: 30,
  });
  const rootWins = new ApiClient('http://test.local');
  const rootWinsPage = await rootWins.dramas(1, 30);
  assert.equal(rootWinsPage.total, 100);
  assert.equal(rootWins.libraryTotals().total, 100);
  console.log('PASS complete root total wins over overlapping provider counters');

  let declaredPage = 0;
  globalThis.fetch = async url => {
    declaredPage = Number(new URL(String(url), 'http://test.local').searchParams.get('page') || 1);
    const data = declaredPage === 1
      ? Array.from({ length: 30 }, (_, i) => row(i + 1))
      : declaredPage === 2
        ? Array.from({ length: 30 }, (_, i) => row(i + 31))
        : declaredPage === 3
          ? Array.from({ length: 5 }, (_, i) => row(i + 61))
          : [];
    return response({ data, total: 1039, sourceTotals: { hongguo: 30 }, hasMore: declaredPage < 3 });
  };
  const declaredCatalog = new ApiClient('http://test.local');
  const declaredRows = await declaredCatalog.catalog();
  assert.equal(declaredRows.length, 65);
  assert.equal(declaredCatalog.libraryTotals().total, 1039);
  console.log('PASS catalog continues pagination while preserving larger root total');

  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 30,
    loading: true,
    hasMore: false,
    sources: { hongguo: { count: 0 }, huangdou: { count: 0 } },
  });
  const loading = new ApiClient('http://test.local');
  const first = await loading.dramas(1, 30);
  assert.equal(first.total, undefined);
  assert.equal(loading.libraryTotals().total, undefined);
  assert.equal(loading.libraryTotals().loading, true);
  console.log('PASS loading snapshot does not promote page-sized total 30');

  globalThis.fetch = async () => response({
    data: Array.from({ length: 65 }, (_, i) => row(i + 1)),
    total: 65,
    loading: false,
    hasMore: false,
  });
  const hydrated = await loading.catalog();
  assert.equal(hydrated.length, 65);
  assert.equal(loading.libraryTotals().total, 65);
  console.log('PASS completed poll replaces provisional snapshot with authoritative total');

  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 30,
    loading: false,
    hasMore: false,
  });
  const pageSized = new ApiClient('http://test.local');
  const pageSizedCatalog = await pageSized.catalog();
  assert.equal(pageSizedCatalog.length, 30);
  assert.equal(pageSized.libraryTotals().total, undefined);
  assert.equal(pageSized.libraryTotals().paginationUnknown, true);
  console.log('PASS page-sized total 30 without loading metadata remains unknown');

  // Explicit page/limit metadata does not make a page-sized root/source
  // counter authoritative. A remote endpoint can still be paginated while
  // reporting `total: 30` for the current page.
  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 30,
    sourceTotals: { hongguo: 30 },
    hasMore: true,
    page: 1,
    limit: 30,
  });
  const explicitUnknown = new ApiClient('http://test.local');
  const explicitPage = await explicitUnknown.dramas(1, 30);
  assert.equal(explicitPage.total, undefined);
  assert.equal(explicitPage.sourceTotals, undefined);
  assert.equal(explicitUnknown.libraryTotals().total, undefined);
  console.log('PASS explicit paginated page-sized totals stay unknown');

  // A complete root total may still be exposed while per-source counters are
  // page-sized. Keep the root total, but do not leak `hongguo: 30` as a
  // source total to the UI.
  globalThis.fetch = async () => response({
    data: Array.from({ length: 30 }, (_, i) => row(i + 1)),
    total: 1039,
    sourceTotals: { hongguo: 30 },
    hasMore: true,
    page: 1,
    limit: 30,
  });
  const rootWithPageSource = new ApiClient('http://test.local');
  const rootWithPageSourceResult = await rootWithPageSource.dramas(1, 30);
  assert.equal(rootWithPageSourceResult.total, 1039);
  assert.equal(rootWithPageSourceResult.sourceTotals, undefined);
  assert.equal(rootWithPageSource.libraryTotals().sourceTotals, undefined);
  console.log('PASS root total survives while page-sized source counters stay hidden');
} finally {
  await vite.close();
}
