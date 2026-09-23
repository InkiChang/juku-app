import type { Drama } from '../types/api';

function firstValue(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return String(value.length);
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

export function episodeCount(drama?: Partial<Drama>): string {
  return firstValue(drama?.totalEpisode, drama?.total_episode, drama?.chapterCount, drama?.chapter_count, drama?.episodeCount, drama?.episode_count, drama?.episodes, drama?.total) || '集数未知';
}

export function episodeLabel(drama?: Partial<Drama>): string {
  const count = episodeCount(drama);
  return count === '集数未知' || /集$/.test(count) ? count : `${count}集`;
}

export function categoryName(drama?: Partial<Drama>): string {
  const direct = [drama?.categoryName, drama?.category_name, drama?.typeName, drama?.type_name, drama?.sortName, drama?.sort_name, drama?.category, drama?.categoryNameSnake]
    .map(value => String(value || '').trim()).find(Boolean);
  if (direct) return direct;
  const channel = String(drama?.channelName || drama?.channel_name || '').trim();
  return ['黄果原创', '成人短剧', '成人漫剧', 'AI魔改'].includes(channel) ? channel : '未分类';
}

export function sourceLabel(drama?: Partial<Drama>): string {
  const hints = [drama?.source, drama?.id?.split(':')[0], drama?.channelName, drama?.channel_name, drama?.site, drama?.host];
  for (const hint of hints) {
    const raw = String(hint || '').trim().toLowerCase().replace(/^www\./, '');
    if (['hongguo', '红果', 'hongguoduanju.com', 'redfruit'].includes(raw)) return '红果';
    if (['huangdou', '黄豆', 'tideember.cc', 'xqjurgek.top'].includes(raw)) return '黄豆';
    if (['huangguo', 'huangguoai', 'huangguo-video', 'huangguoai.com', 'huangguo.video', 'cloudfront', 'api', '黄果'].includes(raw)) return '黄果';
  }
  return '未知站源';
}

export function releaseStatusLabel(drama?: Partial<Drama>): string {
  const rawDrama = drama as (Partial<Drama> & Record<string, unknown>) | undefined;
  const status = String(rawDrama?.releaseStatus || rawDrama?.release_status || rawDrama?.updateStatus || rawDrama?.update_status || rawDrama?.status || rawDrama?.state || '').trim().toLowerCase();
  if (['finished', 'complete', 'completed', 'done', 'ended', '完结', '已完结', '大结局', '全集'].includes(status)) return '已完结';
  if (['ongoing', 'serializing', 'updating', 'in_progress', '未完结', '连载', '连载中', '更新中'].includes(status)) return '连载中';

  // Some source records use `unknown` while the remark still carries the
  // authoritative Web status, such as “共 80 集” or “更新至第 12 集”.
  const remark = String(rawDrama?.remark || rawDrama?.remarks || rawDrama?.episodeRemark || rawDrama?.episode_remark || '').trim();
  if (/已完结|完结|大结局|全\s*\d+\s*集|共\s*\d+\s*集|\d+\s*集全|全集/.test(remark)) return '已完结';
  if (/未完结|更新至|连载|更新中|新上架/.test(remark)) return '连载中';

  const total = Number(String(rawDrama?.totalEpisode ?? rawDrama?.total_episode ?? rawDrama?.episodeCount ?? rawDrama?.episode_count ?? '').replace(/[^\d.]/g, ''));
  const latest = Number(String(rawDrama?.latestEpisode ?? rawDrama?.latest_episode ?? rawDrama?.currentEpisode ?? rawDrama?.current_episode ?? rawDrama?.episode ?? '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(total) && total > 0 && Number.isFinite(latest) && latest > 0) return latest >= total ? '已完结' : '连载中';
  return '状态未知';
}

export function dramaMetaLine(drama?: Partial<Drama>): string {
  return `${sourceLabel(drama)} · ${episodeLabel(drama)} · ${releaseStatusLabel(drama)}`;
}

export function rankingMetaLine(drama?: Partial<Drama>): string {
  return `${episodeLabel(drama)} · ${releaseStatusLabel(drama)} · ${categoryName(drama)}`;
}
