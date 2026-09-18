<script setup lang="ts">
import { ref } from 'vue';
import { appStore } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';

const emit = defineEmits<{ done: [] }>();

const value = ref(appStore.state.apiBaseUrl);
const error = ref('');
const saving = ref(false);

async function save() {
  saving.value = true;
  error.value = '';
  try { await appStore.switchServer(value.value); emit('done'); } catch (cause) { error.value = cause instanceof Error ? cause.message : '服务器连接失败'; }
  finally { saving.value = false; }
}
</script>

<template>
  <section class="screen-view settings-view"><div class="heading-row"><div><span class="eyebrow">CONFIGURATION</span><div class="title-line"><AppIcon name="server" label="服务器" /><h1>服务器</h1></div><p>开发阶段连接本地后端，发布后可切换到域名入口。</p></div><button class="icon-button" type="button" aria-label="返回我的" @click="emit('done')">‹</button></div><form class="form-panel" @submit.prevent="save"><label>后端地址<input v-model="value" type="url" placeholder="http://192.168.3.172:8998" required /></label><p class="muted">手机调试时不能使用 127.0.0.1，请填写电脑或服务器的局域网地址。</p><div class="toggle-row"><span><strong>原始 MP4 / HLS 优先</strong><small>手机优先使用硬件解码</small></span><button class="toggle on" type="button"><i></i></button></div><div class="toggle-row"><span><strong>自动下一集</strong><small>播放结束后继续当前剧集</small></span><button class="toggle on" type="button"><i></i></button></div><p v-if="error" class="error-text">{{ error }}</p><button class="primary-button" :disabled="saving">{{ saving ? '检测中…' : '检测并保存' }}</button></form></section>
</template>
