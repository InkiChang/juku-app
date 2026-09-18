<script setup lang="ts">
defineProps<{ title: string }>();
const emit = defineEmits<{ settings: []; login: [] }>();
</script>

<template>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">▶</span><strong>剧库</strong><span class="version">v0.0.1</span></div>
    <div class="top-actions">
      <button class="icon-button" title="服务器设置" @click="emit('settings')">⚙</button>
      <button class="account-button" @click="emit('login')">{{ title }}</button>
    </div>
  </header>
</template>
