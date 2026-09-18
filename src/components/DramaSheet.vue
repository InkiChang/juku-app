<script setup lang="ts">
import { computed } from 'vue';
import { appStore } from '../stores/app';
import type { Drama } from '../types/api';

const props = defineProps<{ drama: Drama }>();
const emit = defineEmits<{ close: []; play: [drama: Drama] }>();
const title = computed(() => props.drama.title || props.drama.name || '未命名短剧');
const cover = computed(() => {
  const source = props.drama.cover || props.drama.coverUrl || props.drama.poster || props.drama.thumb || '/design-review/assets/poster-5.jpg';
  return appStore.api().resolve(source);
});
const episodes = computed(() => Math.min(Number(props.drama.totalEpisode || props.drama.episodeCount || 20), 60));
function onImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  image.onerror = null;
  image.src = '/design-review/assets/poster-5.jpg';
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')"><section class="sheet detail-sheet"><div class="sheet-handle"></div><div class="sheet-title"><h2>剧集详情</h2><button class="close-button" type="button" aria-label="关闭" @click="emit('close')">×</button></div><div class="detail-hero"><img :src="cover" :alt="title" @error="onImageError"><div><h3>{{ title }}</h3><p>{{ drama.source || '短剧' }} · {{ drama.totalEpisode || drama.episodeCount || '未知' }} 集 · {{ drama.releaseStatus || '连载中' }}</p><p>{{ drama.desc || drama.intro || '暂无剧情简介。' }}</p><div class="chips"><span v-for="tag in (drama.tags || [drama.categoryName || drama.category || '热门'])" :key="tag" class="chip">{{ tag }}</span></div></div></div><div class="section-head detail-episodes-head"><h3>选集</h3><span>从第 1 集开始</span></div><div class="episodes"><button v-for="episode in episodes" :key="episode" type="button" :class="{ active: episode === 1 }" @click="emit('play', drama)">{{ episode }}</button></div><div class="sheet-actions"><button class="secondary-button" type="button" @click="emit('close')">♡ 追剧</button><button class="primary-button" type="button" @click="emit('play', drama)">▶ 继续播放</button></div></section></div>
</template>
