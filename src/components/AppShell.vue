<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import type { IconName } from '../config/icons';
defineProps<{ active: string }>();
const emit = defineEmits<{ navigate: [screen: string] }>();
const items = [
  { id: 'home', icon: 'home', label: '首页' },
  { id: 'library', icon: 'library', label: '剧库' },
  { id: 'following', icon: 'following', label: '追剧' },
  { id: 'downloads', icon: 'download', label: '下载' },
  { id: 'mine', icon: 'mine', label: '我的' },
];
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <button v-for="item in items" :key="item.id" :class="{ active: active === item.id }" type="button" @click="emit('navigate', item.id)">
      <AppIcon class="nav-icon" :name="item.icon as IconName" :label="item.label" /><span>{{ item.label }}</span>
    </button>
  </nav>
</template>
