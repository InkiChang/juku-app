<script setup lang="ts">
import { ref } from 'vue';
import { appStore } from '../stores/app';

const emit = defineEmits<{ done: [] }>();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    await appStore.login(username.value, password.value);
    emit('done');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="screen-view login-view">
    <div class="heading-row"><div><span class="eyebrow">JUKU APP</span><h1>继续观看</h1><p>登录后，Web 和 App 共用观看记录与追剧清单。</p></div><button class="icon-button" type="button" aria-label="返回" @click="emit('done')">‹</button></div>
    <form class="form-panel" @submit.prevent="submit">
      <label>用户名<input v-model="username" autocomplete="username" required /></label>
      <label>密码<input v-model="password" type="password" autocomplete="current-password" required /></label>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="primary-button" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
    </form>
  </section>
</template>
