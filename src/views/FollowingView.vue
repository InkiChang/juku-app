<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { appStore } from '../stores/app';
import { followingRecords } from '../utils/following';
import type { Drama } from '../types/api';

const emit = defineEmits<{ openDrama: [drama: Drama]; playDrama: [drama: Drama] }>();
const state = appStore.state;
const active = ref('在看');
const tabs = ['在看', '想看', '已看'];
const titleOf = (drama?: Drama) => drama?.title || drama?.name || '未命名短剧';
const coverOf = (drama?: Drama) => {
  const source = drama?.cover || drama?.coverUrl || drama?.cover_url || drama?.image || drama?.imageUrl || drama?.image_url || drama?.img || drama?.pic || drama?.picture || drama?.poster || drama?.thumb || drama?.thumbnail;
  return source ? appStore.api().resolve(source) : '';
};
const failedCovers = ref<Record<string, string>>({});
const followingItems = computed(() => followingRecords(state.following, state.history, id => state.followingDramas[id] || state.dramas.find(drama => drama.id === id)));
const listItems = computed(() => followingItems.value.filter(item => item.tab === active.value));
const counts = computed(() => ({
  '在看': followingItems.value.filter(item => item.tab === '在看').length,
  '想看': followingItems.value.filter(item => item.tab === '想看').length,
  '已看': followingItems.value.filter(item => item.tab === '已看').length,
}));
function handlePullRefresh() { void appStore.loadHome(); }
onMounted(() => {
  void appStore.loadHome();
  window.addEventListener('juku:pull-refresh', handlePullRefresh);
});
onBeforeUnmount(() => {
  window.removeEventListener('juku:pull-refresh', handlePullRefresh);
});
async function onImageError(drama: Drama) {
  const failed = coverOf(drama);
  failedCovers.value[drama.id] = failed;
  const raw = drama.cover || drama.coverUrl || drama.cover_url || drama.image || drama.imageUrl || drama.image_url || drama.img || drama.pic || drama.picture || drama.poster || drama.thumb || drama.thumbnail || '';
  const repaired = await appStore.repairDramaCover(drama.id, raw);
  if (repaired && appStore.api().resolve(repaired) !== failed) {
    drama.cover = repaired;
  }
}
</script>

<template>
  <section class="screen-view">
    <div class="heading-row"><div><span class="eyebrow">YOUR LIST</span><h1>追剧</h1><p>在看的故事和想看的新剧都在这里。</p></div></div>
    <div class="segmented-tabs"><button v-for="tab in tabs" :key="tab" :class="{ active: active === tab }" type="button" @click="active = tab">{{ tab }} {{ counts[tab as keyof typeof counts] }}</button></div>
    <div v-if="listItems.length" class="follow-list">
      <article v-for="({ item, drama, percent }) in listItems" :key="drama.id" class="follow-item">
        <button class="following-cover" type="button" :aria-label="`播放 ${titleOf(drama)}`" @click="emit('playDrama', drama)">
          <img v-if="coverOf(drama) && failedCovers[drama.id] !== coverOf(drama)" :key="coverOf(drama)" :src="coverOf(drama)" :alt="titleOf(drama)" @error="onImageError(drama)">
          <span v-else>暂无封面</span>
        </button>
        <div><strong role="button" tabindex="0" @click="emit('openDrama', drama)" @keydown.enter="emit('openDrama', drama)">{{ titleOf(drama) }}</strong><small>{{ active === '在看' ? (item.index ? `看到第 ${item.index} 集` : '有新集，接着看') : active === '想看' ? '等待观看' : '已完成观看' }}<br>{{ item.newEpisodes ? `更新了 ${item.newEpisodes} 集` : '' }}</small><div v-if="active === '在看' && percent > 0" class="progress"><i :style="{ width: `${percent}%` }"></i></div></div>
        <button class="chevron" type="button" aria-label="继续播放" @click.stop="emit('playDrama', drama)">›</button>
      </article>
    </div>
    <div v-else class="empty-state"><strong>还没有追剧</strong><span>在剧库中加入喜欢的短剧后，会同步显示在这里。</span></div>
  </section>
</template>

<style scoped>
.following-cover { width: 65px; height: 86px; padding: 0; border: 0; border-radius: 5px; overflow: hidden; display: grid; place-items: center; background: var(--surface); color: var(--muted); font-size: 11px; }
.following-cover img { display: block; }
</style>
