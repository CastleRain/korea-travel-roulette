const PROFILE_KEY = 'eodideun.traveler-name.v1';

export function normalizeTravelerName(value) {
  if (typeof value !== 'string') throw new Error('이름이나 별명을 입력해주세요.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('이름이나 별명을 입력해주세요.');
  if (name.length > 20) throw new Error('이름은 20자 이내로 입력해주세요.');
  return name;
}

// A nickname is display metadata, never an authentication key or document path.
export class TravelerProfile {
  constructor(storage) { this.storage = storage; this.name = ''; this.persistent = true; }
  load() {
    try {
      const raw = (this.storage ?? globalThis.localStorage).getItem(PROFILE_KEY);
      this.name = raw ? normalizeTravelerName(raw) : '';
    } catch { this.name = ''; this.persistent = false; }
    return this.name;
  }
  set(value) {
    this.name = normalizeTravelerName(value);
    try { (this.storage ?? globalThis.localStorage).setItem(PROFILE_KEY, this.name); this.persistent = true; }
    catch { this.persistent = false; }
    return this.name;
  }
}
