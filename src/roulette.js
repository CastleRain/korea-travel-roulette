export const STATES = Object.freeze({ READY:'ready', PROVINCE:'province', TRANSITION:'transition', DISTRICT:'district', COMPLETE:'complete' });

// Rejection sampling avoids modulo bias; used for animation and displayed result.
export function uniformIndex(length, cryptoSource = globalThis.crypto) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0x100000000) throw new RangeError('후보 수가 올바르지 않습니다.');
  const limit = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do { cryptoSource.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % length;
}

export function validateCatalog(data) {
  if (!data?.version || !Array.isArray(data.provinces) || !data.provinces.length) throw new Error('지역 데이터를 읽을 수 없습니다.');
  const ids = new Set();
  for (const p of data.provinces) {
    if (!p.id || !p.name || !p.path || ids.has(p.id) || !p.destinations?.length) throw new Error('시·도 데이터가 불완전합니다.');
    ids.add(p.id);
    const localIds = new Set();
    for (const d of p.destinations) {
      if (!d.id || !d.name || !d.path || d.provinceId !== p.id || localIds.has(d.id)) throw new Error(`${p.name} 하위 지역 데이터가 불완전합니다.`);
      localIds.add(d.id);
    }
    if (p.singleStage && p.destinations.length !== 1) throw new Error('단일 단계 지역 후보가 올바르지 않습니다.');
  }
  return data;
}

export class Roulette {
  constructor(provinces, { pick = uniformIndex, schedule = (fn,ms)=>globalThis.setTimeout(fn,ms), cancel = id=>globalThis.clearTimeout(id), changed = () => {}, completed = () => {} } = {}) {
    this.provinces = provinces;
    this.pick = pick; this.schedule = schedule; this.cancel = cancel;
    this.changed = changed; this.completed = completed;
    this.timer = null; this.generation = 0;
    this.state = STATES.READY; this.province = null; this.destination = null; this.current = null;
  }
  clear() {
    this.generation++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  reset() {
    this.clear(); this.state = STATES.READY;
    this.province = null; this.destination = null; this.current = null;
    this.changed(this);
  }
  start(ids = this.provinces.map(p=>p.id)) {
    const candidates = this.provinces.filter(p=>ids.includes(p.id));
    if (!candidates.length) throw new Error('추첨할 시·도를 하나 이상 선택해주세요.');
    this.clear(); this.province = null; this.destination = null;
    this.state = STATES.PROVINCE;
    this.spin(candidates);
  }
  spin(candidates) {
    const generation = this.generation;
    const tick = () => {
      if (generation !== this.generation) return;
      this.current = candidates[this.pick(candidates.length)];
      this.changed(this);
      this.timer = this.schedule(tick, 80);
    };
    tick();
  }
  stop() {
    if (this.state === STATES.PROVINCE) {
      const selected = this.current;
      this.clear(); this.province = selected; this.current = selected;
      if (selected.singleStage) { this.destination = selected.destinations[0]; this.finish(); return true; }
      this.state = STATES.TRANSITION; this.changed(this);
      const generation = this.generation;
      this.timer = this.schedule(() => {
        if (this.generation !== generation) return;
        this.timer = null; this.state = STATES.DISTRICT;
        this.spin(this.province.destinations);
      }, 1200);
      return true;
    }
    if (this.state === STATES.DISTRICT) {
      this.destination = this.current; this.clear(); this.finish(); return true;
    }
    return false;
  }
  rerollDistrict() {
    if (this.state !== STATES.COMPLETE || this.province.singleStage) return false;
    this.clear(); this.destination = null; this.state = STATES.DISTRICT;
    this.spin(this.province.destinations); return true;
  }
  finish() {
    this.state = STATES.COMPLETE; this.current = this.destination;
    this.changed(this); this.completed({ province: this.province, destination: this.destination });
  }
}

export function makeRecord(province, destination, dataVersion, { id = crypto.randomUUID(), now = new Date() } = {}) {
  if (destination.provinceId !== province.id || !province.destinations.some(d=>d.id === destination.id)) throw new Error('시·도와 목적지가 일치하지 않습니다.');
  return { id, provinceId:province.id, provinceName:province.name, destinationId:destination.id,
    destinationName:destination.name, fullName:province.singleStage ? province.name : `${province.name} ${destination.name}`,
    singleStage:Boolean(province.singleStage), dataVersion, drawnAt:now.toISOString() };
}
