<script setup lang="ts">
defineProps<{ active: string }>();
const emit = defineEmits<{ navigate: [screen: string] }>();
const items = [
  { id: 'home', icon: '⌂', label: '首页' },
  { id: 'library', icon: '▦', label: '剧库' },
  { id: 'following', icon: '♡', label: '追剧' },
  { id: 'downloads', icon: '⇩', label: '下载' },
  { id: 'mine', icon: '◎', label: '我的' },
];
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <button v-for="item in items" :key="item.id" :class="{ active: active === item.id }" type="button" @click="emit('navigate', item.id)">
      <span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span>
    </button>
  </nav>
</template>
