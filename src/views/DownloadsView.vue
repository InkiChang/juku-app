<script setup lang="ts">
const tasks = [
  { title: '180万照妖镜', status: '下载中', detail: '第 19–24 集 · 最高画质 · 手机本地任务', progress: 68 },
  { title: '误入豪门的她', status: '已完成', detail: '64 集 · 合并文件可播放', progress: 100 },
];
</script>

<template>
  <section class="screen-view">
    <div class="heading-row"><div><span class="eyebrow">OFFLINE TASKS</span><h1>下载</h1><p>任务在手机端执行，完成后可离线观看。</p></div><button class="icon-button" type="button" aria-label="刷新下载任务">↻</button></div>
    <div class="download-summary"><div><strong>2</strong><span>进行中</span></div><div><strong>34</strong><span>已完成分集</span></div><div><strong>1.8G</strong><span>累计写入</span></div></div>
    <div class="filter-row"><button class="active" type="button">全部任务</button><button type="button">进行中</button><button type="button">已完成</button></div>
    <div class="task-list"><article v-for="task in tasks" :key="task.title" class="task-card"><div class="task-head"><strong>{{ task.title }}</strong><span>{{ task.status }}</span></div><small>{{ task.detail }}</small><div class="progress"><i :style="{ width: `${task.progress}%` }"></i></div></article></div>
    <p class="form-note">下载使用手机存储空间；服务端只负责提供原始 MP4/HLS 地址，不承担重解码。</p>
  </section>
</template>
