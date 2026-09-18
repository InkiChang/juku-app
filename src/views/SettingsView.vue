<script setup lang="ts">
import { ref } from 'vue';
import { appStore } from '../stores/app';

const value = ref(appStore.state.apiBaseUrl);
const error = ref('');
const saving = ref(false);

async function save() {
  saving.value = true;
  error.value = '';
  try { await appStore.switchServer(value.value); } catch (cause) { error.value = cause instanceof Error ? cause.message : '服务器连接失败'; }
  finally { saving.value = false; }
}
</script>

<template>
  <section class="settings-view"><div class="page-heading"><div><span class="eyebrow">CONFIGURATION</span><h1>服务器</h1><p>开发阶段连接本地后端，发布后可切换到域名入口。</p></div></div><form class="panel form-panel" @submit.prevent="save"><label>后端地址<input v-model="value" type="url" placeholder="http://192.168.3.172:8998" required /></label><p class="muted">手机调试时不能使用 127.0.0.1，请填写电脑或服务器的局域网地址。</p><p v-if="error" class="error-text">{{ error }}</p><button class="primary-button" :disabled="saving">{{ saving ? '检测中…' : '检测并保存' }}</button></form></section>
</template>
