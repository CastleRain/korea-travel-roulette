import { uniformIndex } from './roulette.js';

export function drawOptions(provinces, pick = uniformIndex) {
  const pools = provinces.map(province => ({province, remaining: [...province.destinations]}));
  const options = [];
  while (pools.length && options.length < 3) {
    const index = pick(pools.length);
    const {province, remaining} = pools[index];
    const [destination] = remaining.splice(pick(remaining.length), 1);
    options.push({province, destination});
    if (!remaining.length) pools.splice(index, 1);
  }
  return options;
}

export function currentRoom() {
  const url = new URL(location.href);
  let room = url.searchParams.get('room');
  if (!/^[a-f0-9]{32}$/.test(room || '')) {
    try { room = localStorage.getItem('travel-active-room'); } catch {}
    if (!/^[a-f0-9]{32}$/.test(room || '')) room = crypto.randomUUID().replaceAll('-', '');
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);
  }
  try { localStorage.setItem('travel-active-room', room); } catch {}
  return room;
}

export function historyFor(records, shared, name, room) {
  const entries = new Map();
  for (const record of [...records, ...shared]) {
    if (record.travelerName === name && (!record.roomId || record.roomId === room)) entries.set(record.id, record);
  }
  return [...entries.values()].sort((a,b) => b.drawnAt.localeCompare(a.drawnAt));
}
