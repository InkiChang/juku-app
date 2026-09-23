import type { Drama, FollowingItem, PlaybackHistoryItem } from '../types/api';

// Keep the grouping rules aligned with the backend Web client's following.js.
export function followingRecords(entries: FollowingItem[], history: PlaybackHistoryItem[], findDrama: (id: string) => Drama | undefined) {
  type Group = { ids: Set<string>; entry?: FollowingItem; progress?: PlaybackHistoryItem };
  const identitySet = (value: FollowingItem | PlaybackHistoryItem): Set<string> => {
    const ids = new Set<string>();
    const source = String(value.source || value.drama?.source || '').trim().toLowerCase().replace(/^www\./, '');
    const add = (candidate: unknown) => {
      const id = String(candidate ?? '').trim();
      if (!id) return;
      ids.add(id);
      const separator = id.indexOf(':');
      const tail = separator >= 0 ? id.slice(separator + 1).trim() : id;
      if (source && tail) ids.add(`${source}:${tail}`);
    };
    add(value.dramaId);
    add(value.sourceId);
    const drama = value.drama;
    if (drama) {
      add(drama.id);
      add(drama.sourceId);
    }
    return ids;
  };
  const groups: Group[] = [];
  const add = (value: FollowingItem | PlaybackHistoryItem, kind: 'entry' | 'progress') => {
    const ids = identitySet(value);
    if (!ids.size) return;
    const matches = groups.filter(group => [...ids].some(id => group.ids.has(id)));
    const group = matches[0] || { ids: new Set<string>() };
    for (const match of matches.slice(1)) {
      for (const id of match.ids) group.ids.add(id);
      if (!group.entry) group.entry = match.entry;
      if (!group.progress) group.progress = match.progress;
      groups.splice(groups.indexOf(match), 1);
    }
    for (const id of ids) group.ids.add(id);
    if (kind === 'entry') group.entry = value as FollowingItem;
    else group.progress = value as PlaybackHistoryItem;
    if (!groups.includes(group)) groups.push(group);
  };
  entries.forEach(item => add(item, 'entry'));
  history.forEach(item => add(item, 'progress'));
  return groups.map(group => {
    const entry = group.entry;
    const progress = group.progress;
    const ids = [...group.ids];
    const known = ids.map(id => findDrama(id)).find(Boolean);
    const id = entry?.dramaId || progress?.dramaId || ids[0];
    const total = Number(known?.totalEpisode || entry?.totalEpisode || progress?.total || 0);
    const completed = Boolean((entry?.completed && !entry.newEpisodes) || (progress?.completed && Number(progress.index) >= Math.max(total, Number(progress.total || 0))));
    const watching = !completed && Boolean(progress || entry?.completed);
    const tab = completed ? '已看' : watching ? '在看' : entry?.saved ? '想看' : '';
    const drama: Drama = known || { id, title: entry?.title || progress?.title, source: entry?.source || progress?.source, totalEpisode: total };
    const item: FollowingItem = { ...entry, dramaId: id, index: progress?.index, totalEpisode: total };
    const percent = progress?.duration ? Math.min(100, Math.max(0, Number(progress.position || 0) / progress.duration * 100)) : 0;
    return { item, drama, tab, percent, time: Date.parse(progress?.watchedAt || entry?.updatedAt || '') || 0 };
  }).sort((a, b) => b.time - a.time);
}
