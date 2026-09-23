<script setup lang="ts">
import { computed } from 'vue';
import { icons, type IconName } from '../config/icons';

const props = withDefaults(defineProps<{ name: IconName; label?: string; size?: number }>(), { size: 24 });
const source = computed(() => icons[props.name]);
const markup = computed(() => source.value.replace(/#333/g, 'currentColor'));
</script>

<template>
  <span class="asset-icon" :style="{ width: `${size}px`, height: `${size}px` }" :role="label ? 'img' : undefined" :aria-label="label" v-html="markup"></span>
</template>
