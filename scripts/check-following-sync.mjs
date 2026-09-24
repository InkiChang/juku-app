import { createServer } from 'vite';
import assert from 'node:assert/strict';

// Use a fresh guest session so this probe never edits an existing user's list.
const nativeFetch = globalThis.fetch;
const origin = process.env.JUKU_TEST_ORIGIN || 'http://localhost:5174';
let cookie = '';
let offline = false;
async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await nativeFetch(new URL(path, origin), { ...init, headers });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  return response;
}
globalThis.fetch = (path, init) => {
  if (offline && String(path).includes('/following')) return Promise.reject(new Error('test offline'));
  return request(path, init);
};
const storage = new Map([['juku.app.apiBaseUrl', origin]]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
let interval;
globalThis.window = { setInterval(fn, ms) { interval = { fn, ms }; return 1; }, clearInterval() {} };
globalThis.document = { createElement: () => ({}), visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let id;
let store;
async function webFollowing() {
  const response = await request('/api/ui/following');
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
async function webChange(values) {
  const response = await request('/api/ui/following', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dramaId: id, ...values }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  ({ appStore: store } = await vite.ssrLoadModule('/src/stores/app.ts'));
  await store.init();
  assert.ok(store.state.viewer.id);
  assert.equal(interval.ms, 300000);
  console.log('PASS independent viewer; 300000ms timer registered');
  const catalog = await store.api().dramas(1, 30);
  id = catalog.data[0].id;
  assert.equal((await webFollowing()).length, 0);
  await store.updateFollowing(id, { saved: true });
  assert.equal((await webFollowing()).find(item => item.dramaId === id)?.saved, true);
  console.log('PASS App save -> real backend GET');
  await webChange({ completed: true });
  await store.syncFollowing();
  assert.equal(store.state.following.find(item => item.dramaId === id)?.completed, true);
  assert.equal(store.state.followingDramas[id]?.id, id);
  assert.equal(store.state.followingDramas[id]?.cover, catalog.data[0].cover);
  console.log('PASS following cover hydrated from exact catalog ID');
  console.log('PASS Web completed change -> App sync');
  await webChange({ saved: false, completed: false });
  await store.syncFollowing();
  assert.equal(store.state.following.length, 0);
  console.log('PASS Web deletion -> App sync');
  offline = true;
  await store.updateFollowing(id, { saved: true }).catch(() => {});
  offline = false;
  await store.syncFollowing();
  assert.equal((await webFollowing()).find(item => item.dramaId === id)?.saved, true);
  console.log('PASS offline addition -> retry -> backend');
  let historyCalls = 0;
  const originalHistory = store.api().playbackHistory.bind(store.api());
  store.api().playbackHistory = async () => { historyCalls++; return originalHistory(); };
  await store.syncFollowing();
  console.log('CHECK history refreshed during sync:', historyCalls > 0 ? 'PASS' : 'FAIL');

  // Hold a server snapshot while the user removes a record on the App.
  let release;
  const originalFollowing = store.api().following.bind(store.api());
  store.api().following = async () => {
    const snapshot = await originalFollowing();
    await new Promise(resolve => { release = resolve; });
    return snapshot;
  };
  const running = store.syncFollowing();
  const deadline = Date.now() + 10000;
  while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(release, 'sync snapshot timed out');
  const mutation = store.updateFollowing(id, { saved: false, completed: false });
  release();
  await Promise.all([running, mutation]);
  const remote = await webFollowing();
  console.log('CHECK concurrent removal: backend count =', remote.length, '; App count =', store.state.following.length);
  if (historyCalls === 0 || remote.length !== store.state.following.length) process.exitCode = 1;
  store.api().following = originalFollowing;
  const { followingRecords } = await vite.ssrLoadModule('/src/utils/following.ts');
  const groups = followingRecords([
    { dramaId: 'saved', saved: true },
    { dramaId: 'done', completed: true },
    { dramaId: 'new', completed: true, newEpisodes: 1 },
  ], [
    { dramaId: 'watching', index: 2, total: 3 },
    { dramaId: 'finished', index: 3, total: 3, completed: true },
  ], () => undefined);
  assert.deepEqual(Object.fromEntries(groups.map(row => [row.drama.id, row.tab])), {
    saved: '想看', done: '已看', new: '在看', watching: '在看', finished: '已看',
  });
  console.log('PASS Web-equivalent grouping including history-only and new episodes');
  await webChange({ saved: true });
  interval.fn();
  await store.syncFollowing();
  assert.equal(store.state.following.find(item => item.dramaId === id)?.saved, true);
  console.log('PASS scheduled callback pulls backend changes');
  const originalCookie = cookie;
  const originalViewer = store.state.viewer.id;
  try {
    cookie = '';
    await store.refreshViewer();
    assert.notEqual(store.state.viewer.id, originalViewer);
    await store.syncFollowing();
    assert.equal(store.state.following.length, 0);
    assert.equal((await webFollowing()).length, 0);
    console.log('PASS separate viewer cannot inherit original viewer cache');
  } finally {
    cookie = originalCookie;
    await store.refreshViewer();
  }
} finally {
  offline = false;
  store?.stopFollowingSync();
  if (id) await webChange({ saved: false, completed: false });
  await vite.close();
  console.log('Test following record cleaned up');
}
