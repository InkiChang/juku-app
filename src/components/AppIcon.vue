<script setup lang="ts">
import { computed } from 'vue';
import { icons, type IconName } from '../config/icons';

const props = withDefaults(defineProps<{ name: IconName; label?: string; size?: number }>(), { size: 24 });
const source = computed(() => icons[props.name]);
</script>

<template>
  <span class="asset-icon" :style="{ '--icon-url': `url(${source})`, width: `${size}px`, height: `${size}px` }" :role="label ? 'img' : undefined" :aria-label="label"></span>
</template>
