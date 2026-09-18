<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import AppIcon from '../components/AppIcon.vue';
import type { Drama, FollowingItem } from '../types/api';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const state = appStore.state;
const active = ref('在看');
const tabs = ['在看', '想看', '已看'];
const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.poster || drama?.thumb;
  return source ? appStore.api().resolve(source) : '/design-review/assets/poster-5.jpg';
};
function itemDrama(item: (typeof state.following)[number]): Drama | undefined {
  if (item.drama) return item.drama;
  const known = appStore.findDrama(item.dramaId);
  if (known) return known;
  if (!item.dramaId && !item.title) return undefined;
  return { id: item.dramaId || `following-${item.title}`, title: item.title, category: item.category, totalEpisode: item.totalEpisode };
}
const followingItems = computed(() => state.following.map(item => ({ item, drama: itemDrama(item) })).filter(entry => entry.drama));
const items = computed(() => followingItems.value.filter(({ item }) => {
  if (active.value === '已看') return item.completed === true;
  if (active.value === '想看') return item.saved === true && item.completed !== true && !state.history.some(history => history.dramaId === item.dramaId);
  return item.saved !== false && item.completed !== true;
}));
const listItems = computed<Array<{ item: FollowingItem; drama: Drama }>>(() => items.value as Array<{ item: FollowingItem; drama: Drama }>);
const counts = computed(() => ({
  '在看': followingItems.value.filter(({ item }) => item.saved !== false && item.completed !== true).length,
  '想看': followingItems.value.filter(({ item }) => item.saved === true && item.completed !== true && !state.history.some(history => history.dramaId === item.dramaId)).length,
  '已看': followingItems.value.filter(({ item }) => item.completed === true).length,
}));
onMounted(() => appStore.loadHome());
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}
</script>

<template>
  <section class="screen-view">
    <div class="heading-row"><div><span class="eyebrow">YOUR LIST</span><h1>追剧</h1><p>在看的故事和想看的新剧都在这里。</p></div><button class="icon-button" type="button" aria-label="同步追剧" @click="appStore.loadHome()"><AppIcon name="refresh" label="同步追剧" /></button></div>
    <div class="segmented-tabs"><button v-for="tab in tabs" :key="tab" :class="{ active: active === tab }" type="button" @click="active = tab">{{ tab }} {{ counts[tab as keyof typeof counts] }}</button></div>
    <div v-if="listItems.length" class="follow-list"><article v-for="({ item, drama }) in listItems" :key="drama.id" class="follow-item" @click="emit('openDrama', drama)"><img :src="coverOf(drama)" :alt="titleOf(drama)" @error="onImageError"><div><strong>{{ titleOf(drama) }}</strong><small>{{ active === '在看' ? `看到第 ${item.index || item.watchedEpisode || 1} 集` : active === '想看' ? '等待观看' : '已完成观看' }}<br>{{ item.newEpisodes ? `更新了 ${item.newEpisodes} 集` : '已同步' }}</small><div class="progress"><i :style="{ width: `${Math.min(92, Math.max(8, Number(item.index || item.watchedEpisode || 1) / Math.max(1, Number(item.totalEpisode || drama.totalEpisode || 12)) * 100))}%` }"></i></div></div><button class="chevron" type="button" aria-label="继续播放" @click.stop="emit('playDrama', drama)">›</button></article></div>
    <div v-else class="empty-state"><strong>还没有追剧</strong><span>在剧库中加入喜欢的短剧后，会同步显示在这里。</span></div>
  </section>
</template>
