<script setup lang="ts">
import { computed, ref } from 'vue';
import { appStore } from '../stores/app';

const emit = defineEmits<{ back: []; login: [] }>();
const account = computed(() => appStore.state.viewer?.account as { username?: string; requirePasswordChange?: boolean } | undefined);
const guestImportAvailable = computed(() => appStore.state.viewer?.guestImportAvailable === true);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const busy = ref('');
const error = ref('');
const notice = ref('');

async function changePassword() {
  if (!account.value || busy.value) return;
  error.value = '';
  notice.value = '';
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  busy.value = 'password';
  try {
    await appStore.api().changePassword(currentPassword.value, newPassword.value);
    await appStore.refreshViewer();
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    notice.value = '密码已修改，其他设备的旧登录已失效。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '密码修改失败';
  } finally {
    busy.value = '';
  }
}

async function importRecords() {
  if (!account.value || busy.value || !guestImportAvailable.value) return;
  busy.value = 'import';
  error.value = '';
  notice.value = '';
  try {
    const result = await appStore.api().importGuestRecords();
    await appStore.refreshViewer();
    await Promise.allSettled([appStore.loadHistory(), appStore.syncFollowing()]);
    const counts = [result.history ? `${result.history} 条观看记录` : '', result.following ? `${result.following} 条追剧记录` : ''].filter(Boolean).join('、');
    notice.value = counts ? `已接回${counts}。` : '本机原有记录已接入当前账号。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '本机记录接入失败';
  } finally {
    busy.value = '';
  }
}

async function logout() {
  if (busy.value) return;
  busy.value = 'logout';
  error.value = '';
  try {
    await appStore.logout();
    emit('back');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '退出登录失败';
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <section class="screen-view account-security-page">
    <header class="detail-page-head">
      <button class="icon-button" type="button" aria-label="返回我的" @click="emit('back')">‹</button>
      <div><span class="eyebrow">SECURITY</span><h1>账号安全</h1><p>{{ account ? `当前账号：${account.username}` : '登录与跨设备记录同步' }}</p></div>
    </header>

    <template v-if="account">
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-if="notice" class="users-notice" role="status">{{ notice }}</p>

      <section class="account-security-section">
        <h2>跨设备同步</h2>
        <div class="account-status-card">
          <span class="account-status-dot" aria-hidden="true"></span>
          <div><strong>已连接账号同步</strong><small>观看记录与追剧清单会保存到当前后端；Web 和 App 登录同一账号即可同步。</small></div>
        </div>
        <button v-if="guestImportAvailable" class="secondary-button account-wide-button" type="button" :disabled="!!busy" @click="importRecords">{{ busy === 'import' ? '正在接入…' : '接回本机原有记录' }}</button>
      </section>

      <section class="account-security-section">
        <h2>{{ account.requirePasswordChange ? '修改初始密码' : '修改密码' }}</h2>
        <form class="form-panel account-password-form" @submit.prevent="changePassword">
          <p v-if="account.requirePasswordChange" class="form-note">首次登录需要设置新密码后才能继续使用其他功能。</p>
          <label>当前密码<input v-model="currentPassword" type="password" minlength="10" maxlength="128" autocomplete="current-password" required></label>
          <label>新密码<input v-model="newPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label>
          <label>确认新密码<input v-model="confirmPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label>
          <p class="form-note">密码长度为 10–128 个字符。修改后，其他设备需要使用新密码重新登录。</p>
          <button class="primary-button" type="submit" :disabled="!!busy">{{ busy === 'password' ? '修改中…' : '确认修改密码' }}</button>
        </form>
      </section>

      <section class="account-security-section">
        <h2>当前设备</h2>
        <div class="account-session-card"><div><strong>退出当前账号</strong><small>账号中的观看记录和追剧清单会保留，下次登录后可继续使用。</small></div><button class="secondary-button" type="button" :disabled="!!busy" @click="logout">{{ busy === 'logout' ? '退出中…' : '退出登录' }}</button></div>
      </section>
    </template>

    <div v-else class="account-login-state">
      <strong>当前处于访客模式</strong>
      <p>登录后，观看记录和追剧清单会跟随账号保存在后端，并可在 Web 与 App 之间同步。</p>
      <button class="primary-button" type="button" @click="emit('login')">登录账号</button>
    </div>
  </section>
</template>
