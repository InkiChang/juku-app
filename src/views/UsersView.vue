<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { appStore } from '../stores/app';
import type { AdminAccount, AdminPolicy, SourceChoice } from '../types/api';

const emit = defineEmits<{ back: [] }>();
const viewer = computed(() => appStore.state.viewer);
const isAdmin = computed(() => viewer.value?.account?.admin === true && viewer.value?.account?.requirePasswordChange !== true);
const policy = reactive<AdminPolicy>({ requireLogin: false, allowRegistration: true });
const savedPolicy = ref<AdminPolicy | null>(null);
const accounts = ref<AdminAccount[]>([]);
const choices = ref<SourceChoice[]>([]);
const query = ref('');
const expanded = ref('');
const drafts = reactive<Record<string, { sources: string[]; onlineOnly: boolean }>>({});
const newUser = reactive({ username: '', password: '', sources: [] as string[], onlineOnly: false });
const loading = ref(false);
const busy = ref('');
const error = ref('');
const notice = ref('');
const visibleAccounts = computed(() => accounts.value.filter(item => item.username.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const policyChanged = computed(() => savedPolicy.value && (policy.requireLogin !== savedPolicy.value.requireLogin || policy.allowRegistration !== savedPolicy.value.allowRegistration));

function toggleSource(selected: string[], id: string) {
  const index = selected.indexOf(id);
  if (index < 0) selected.push(id);
  else selected.splice(index, 1);
}
function changed(account: AdminAccount) {
  const draft = drafts[account.username];
  return draft && (draft.onlineOnly !== account.onlineOnly || choices.value.some(choice => draft.sources.includes(choice.id) !== account.sources.includes(choice.id)));
}
async function load() {
  if (!isAdmin.value || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [settings, result] = await Promise.all([appStore.api().adminPolicy(), appStore.api().adminAccounts()]);
    if (!isAdmin.value) return;
    Object.assign(policy, settings);
    savedPolicy.value = { ...settings };
    accounts.value = result.data;
    choices.value = result.sourceChoices || viewer.value?.sourceChoices || [];
    for (const account of result.data) drafts[account.username] = { sources: [...account.sources], onlineOnly: account.onlineOnly };
    newUser.sources = choices.value.map(choice => choice.id);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取用户管理信息'; }
  finally { loading.value = false; }
}
async function savePolicy() {
  if (!isAdmin.value || busy.value || !policyChanged.value) return;
  busy.value = 'policy'; error.value = ''; notice.value = '';
  try {
    const saved = await appStore.api().saveAdminPolicy({ ...policy });
    savedPolicy.value = { ...saved };
    if (viewer.value) Object.assign(viewer.value, saved);
    notice.value = '访问设置已保存。';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败'; }
  finally { busy.value = ''; }
}
async function createUser() {
  if (!isAdmin.value || busy.value) return;
  if (!newUser.sources.length) { error.value = '请至少选择一个可用站源'; return; }
  busy.value = 'create'; error.value = ''; notice.value = '';
  try {
    const username = newUser.username.trim();
    await appStore.api().createAdminAccount({ username, password: newUser.password, sources: [...newUser.sources], onlineOnly: newUser.onlineOnly });
    newUser.username = ''; newUser.password = ''; newUser.onlineOnly = false;
    await load();
    notice.value = '已创建用户 ' + username;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败'; }
  finally { busy.value = ''; }
}
async function savePermissions(account: AdminAccount) {
  const draft = drafts[account.username];
  if (!isAdmin.value || !draft || busy.value || !changed(account)) return;
  if (!draft.sources.length) { error.value = '请至少选择一个可用站源'; return; }
  busy.value = account.username; error.value = ''; notice.value = '';
  try {
    const response = await appStore.api().saveAccountPermissions({ username: account.username, sources: [...draft.sources], onlineOnly: draft.onlineOnly });
    accounts.value = accounts.value.map(item => item.username === account.username ? response.account : item);
    drafts[account.username] = { sources: [...response.account.sources], onlineOnly: response.account.onlineOnly };
    notice.value = '已更新 ' + account.username + ' 的权限';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败'; }
  finally { busy.value = ''; }
}
function handlePullRefresh() { void load(); }
onMounted(() => { void load(); window.addEventListener('juku:pull-refresh', handlePullRefresh); });
onBeforeUnmount(() => window.removeEventListener('juku:pull-refresh', handlePullRefresh));
</script>

<template>
  <section class="screen-view users-page">
    <header class="detail-page-head"><button class="icon-button" type="button" aria-label="返回我的" @click="emit('back')">‹</button><div><span class="eyebrow">ACCOUNTS</span><h1>用户管理</h1><p>访问方式与账号权限</p></div></header>
    <p v-if="!isAdmin" class="error-text">当前账号没有管理员权限。<button class="text-button" type="button" @click="emit('back')">返回</button></p>
    <template v-else>
      <p v-if="error" class="error-text" role="alert">{{ error }} <button v-if="!accounts.length" class="text-button" type="button" @click="load">重试</button></p>
      <p v-if="notice" class="users-notice" role="status">{{ notice }}</p>
      <p v-if="loading && !accounts.length" class="muted">正在读取账号信息…</p>
      <template v-if="savedPolicy">
        <section class="users-section"><h2>访问设置</h2><div class="users-panel">
          <label class="users-check"><input v-model="policy.requireLogin" type="checkbox"><span><strong>必须登录</strong><small>关闭时允许匿名观看</small></span></label>
          <label class="users-check"><input v-model="policy.allowRegistration" type="checkbox"><span><strong>允许自行注册</strong><small>关闭后仅管理员可创建账号</small></span></label>
          <button class="secondary-button" type="button" :disabled="!policyChanged || !!busy" @click="savePolicy">{{ busy === 'policy' ? '保存中…' : '保存访问设置' }}</button>
        </div></section>
        <section class="users-section"><h2>创建用户</h2><form class="users-panel users-form" @submit.prevent="createUser">
          <label>用户名<input v-model="newUser.username" minlength="2" maxlength="32" autocomplete="off" autocapitalize="none" required></label>
          <label>初始密码<input v-model="newUser.password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label>
          <fieldset class="users-sources"><legend>可用站源</legend><label v-for="choice in choices" :key="choice.id"><input :checked="newUser.sources.includes(choice.id)" type="checkbox" @change="toggleSource(newUser.sources, choice.id)">{{ choice.name }}</label></fieldset>
          <label class="users-check"><input v-model="newUser.onlineOnly" type="checkbox"><span><strong>仅在线观看</strong><small>禁止下载和导出</small></span></label>
          <button class="primary-button" type="submit" :disabled="!!busy">{{ busy === 'create' ? '创建中…' : '创建用户' }}</button>
        </form></section>
        <section class="users-section"><div class="users-section-heading"><h2>已有用户 <small>{{ accounts.length }}</small></h2></div><input v-model="query" class="users-search" type="search" maxlength="32" placeholder="搜索用户名" aria-label="搜索用户名">
          <p v-if="!visibleAccounts.length" class="muted">没有匹配的账号。</p>
          <div v-for="account in visibleAccounts" :key="account.username" class="users-account">
            <button class="users-account-head" type="button" :aria-expanded="expanded === account.username" @click="expanded = expanded === account.username ? '' : account.username"><span><strong>{{ account.username }}</strong><small>{{ account.admin ? '管理员 · 全部权限' : account.onlineOnly ? '仅在线观看' : '可观看和下载' }}</small></span><span aria-hidden="true">{{ expanded === account.username ? '⌃' : '⌄' }}</span></button>
            <div v-if="expanded === account.username" class="users-account-body">
              <fieldset class="users-sources"><legend>可用站源</legend><label v-for="choice in choices" :key="choice.id"><input :checked="drafts[account.username]?.sources.includes(choice.id)" :disabled="account.admin || !!busy" type="checkbox" @change="toggleSource(drafts[account.username].sources, choice.id)">{{ choice.name }}</label></fieldset>
              <template v-if="!account.admin"><label class="users-check"><input v-model="drafts[account.username].onlineOnly" :disabled="!!busy" type="checkbox"><span><strong>仅在线观看</strong></span></label><button class="secondary-button" type="button" :disabled="!changed(account) || !!busy || !drafts[account.username]?.sources.length" @click="savePermissions(account)">{{ busy === account.username ? '保存中…' : '保存权限' }}</button></template>
            </div>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>
