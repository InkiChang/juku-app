<script setup lang="ts">
import { ref } from 'vue';
import { appStore } from '../stores/app';

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
  <section class="screen-view settings-view">
    <header class="detail-page-head">
      <button class="icon-button" type="button" aria-label="返回我的" @click="emit('done')">‹</button>
      <div><span class="eyebrow">CONFIGURATION</span><h1>服务器与播放</h1><p>后端连接与本机播放设置</p></div>
    </header>
    <form class="form-panel" @submit.prevent="save">
      <label>后端地址<input v-model="value" type="url" placeholder="http://your-lan-host:8998" required /></label>
      <p class="muted">可填写本地后端或正式域名。浏览器开发预览已为正式服务器启用同源转发；安装到手机后使用原生网络连接，并保留后端账号 Cookie。</p>
      <div class="toggle-row"><span><strong>原始 MP4 / HLS 优先</strong><small>手机优先使用硬件解码</small></span><button class="toggle on" type="button" aria-label="原始媒体优先已开启" aria-pressed="true"><i></i></button></div>
      <div class="toggle-row"><span><strong>自动下一集</strong><small>播放结束后继续当前剧集</small></span><button class="toggle on" type="button" aria-label="自动下一集已开启" aria-pressed="true"><i></i></button></div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="primary-button" :disabled="saving">{{ saving ? '检测中…' : '检测并保存' }}</button>
    </form>
  </section>
</template>
