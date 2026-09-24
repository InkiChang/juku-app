import type { Drama, PlaybackHistoryItem } from '../types/api';
import { sameDrama } from '../stores/app';

function numberFrom(value: unknown): number | undefined {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Return the episode number represented by a history row. */
export function historyEpisodeIndex(item: PlaybackHistoryItem): number | undefined {
  for (const value of [item.episodeIndex, item.index, item.episode, item['episode_number'], item['episodeNumber']]) {
    const parsed = numberFrom(value);
    if (parsed !== undefined && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function hasPlaybackProgress(item: PlaybackHistoryItem): boolean {
  if (item.completed === true) return true;
  for (const value of [item.position, item.progress, item['currentTime'], item['playedSeconds'], item['watchedSeconds']]) {
    const parsed = numberFrom(value);
    if (parsed !== undefined && parsed > 0) return true;
  }
  return false;
}

function sameTitle(left: PlaybackHistoryItem, right: Drama): boolean {
  const leftTitle = String(left.title || left.drama?.title || left.drama?.name || '').trim().toLocaleLowerCase();
  const rightTitle = String(right.title || right.name || '').trim().toLocaleLowerCase();
  return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

/**
 * Build the set of episodes that this user has actually started watching.
 * A row with only a drama-level identity or a zero position is intentionally
 * ignored so opening a player does not mark an episode as watched.
 */
export function watchedEpisodeSet(history: PlaybackHistoryItem[], drama: Drama): Set<number> {
  const watched = new Set<number>();
  for (const item of history) {
    if (!sameDrama(item, drama) && !sameTitle(item, drama)) continue;
    if (!hasPlaybackProgress(item)) continue;
    const episode = historyEpisodeIndex(item);
    if (episode !== undefined) watched.add(episode);
  }
  return watched;
}
