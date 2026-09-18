<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import type { Drama } from '../types/api';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const state = appStore.state;
const active = ref('在看');
const tabs = ['在看', '想看', '已看'];
const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.poster || drama?.thumb;
  return source ? appStore.api().resolve(source) : '/design-review/assets/poster-5.jpg';
};
const fallback = computed(() => state.dramas.slice(0, 3));
const items = computed(() => state.following.map(item => item.drama).filter(Boolean) as Drama[]);
onMounted(() => appStore.loadHome());
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}
</script>

<template>
  <section class="screen-view">
    <div class="heading-row"><div><span class="eyebrow">YOUR LIST</span><h1>追剧</h1><p>在看的故事和想看的新剧都在这里。</p></div><button class="icon-button" type="button" aria-label="同步追剧" @click="appStore.loadHome()">↻</button></div>
    <div class="segmented-tabs"><button v-for="tab in tabs" :key="tab" :class="{ active: active === tab }" type="button" @click="active = tab">{{ tab }} {{ tab === '在看' ? 3 : tab === '想看' ? 8 : 12 }}</button></div>
    <div v-if="(items.length ? items : fallback).length" class="follow-list"><article v-for="(drama, index) in (items.length ? items : fallback)" :key="drama.id" class="follow-item" @click="emit('openDrama', drama)"><img :src="coverOf(drama)" :alt="titleOf(drama)" @error="onImageError"><div><strong>{{ titleOf(drama) }}</strong><small>{{ active === '在看' ? `看到第 ${18 + index * 12} 集` : active === '想看' ? '等待观看' : '已完成观看' }}<br>{{ index === 0 ? '更新了 4 集' : '昨天更新' }}</small><div class="progress"><i :style="{ width: `${58 - index * 14}%` }"></i></div></div><button class="chevron" type="button" aria-label="继续播放" @click.stop="emit('playDrama', drama)">›</button></article></div>
    <div v-else class="empty-state"><strong>还没有追剧</strong><span>在剧库中加入喜欢的短剧后，会同步显示在这里。</span></div>
  </section>
</template>
