import { normalizeTravelerName } from './profile.js';

// Candidates stay local; only explicitly saved records enter the cloud outbox.
export class LocalRecords {
  async open() {
    this.db = await new Promise((resolve,reject)=>{
      const request = indexedDB.open('travel-roulette-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', {keyPath:'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('다른 탭을 닫은 뒤 다시 시도해주세요.'));
    });
    this.db.onversionchange = () => this.db.close();
  }
  async transaction(mode, operation) {
    if (!this.db) throw new Error('브라우저 저장소를 사용할 수 없습니다.');
    return new Promise((resolve,reject)=>{
      const tx = this.db.transaction('records',mode);
      const request = operation(tx.objectStore('records'));
      tx.oncomplete = ()=>resolve(request.result);
      tx.onerror = ()=>reject(tx.error);
      tx.onabort = ()=>reject(tx.error || new Error('로컬 저장이 취소되었습니다.'));
    });
  }
  put(record) { return this.transaction('readwrite',store=>store.put(record)); }
  async all() { return (await this.transaction('readonly',store=>store.getAll())).sort((a,b)=>b.drawnAt.localeCompare(a.drawnAt)); }
}

export class RecordService {
  constructor(local, { notify = () => {} } = {}) { this.local=local; this.remote=null; this.notify=notify; this.inflight = new Set(); this.memory = new Map(); this.saves = new Map(); }
  async all() {
    let stored = [];
    try { stored = await this.local.all(); } catch {}
    return [...new Map([...stored,...this.memory.values()].map(r=>[r.id,r])).values()].sort((a,b)=>b.drawnAt.localeCompare(a.drawnAt));
  }
  async list() { return (await this.all()).filter(record=>record.syncState !== 'candidate'); }
  async candidates() { return (await this.all()).filter(record=>record.syncState === 'candidate'); }
  async stage(record) {
    const travelerName = normalizeTravelerName(record.travelerName);
    if ((await this.all()).some(r=>r.id===record.id)) return;
    await this.retain({...record,travelerName,syncState:'candidate'});
    await this.notify();
  }
  async retain(record) {
    this.memory.set(record.id,record);
    try { await this.local.put(record); return true; }
    catch { this.localFailed=true;this.notify('브라우저 임시 저장 실패: 이 화면을 닫기 전에 JSON을 내려받아주세요.'); return false; }
  }
  save(record) {
    if (this.saves.has(record.id)) return this.saves.get(record.id);
    const operation = this.promote(record).finally(()=>this.saves.delete(record.id));
    this.saves.set(record.id,operation);
    return operation;
  }
  async promote(record) {
    const existing = (await this.all()).find(r=>r.id === record.id);
    if (existing && existing.syncState !== 'candidate') return false;
    const pending = {...(existing ?? record), syncState:'pending'};
    await this.retain(pending); await this.notify();
    if (this.remote) await this.syncOne(pending);
    return true;
  }
  async saveSelected(ids) {
    const wanted = new Set(ids);
    const chosen = (await this.candidates()).filter(record=>wanted.has(record.id));
    let count = 0;
    for (const record of chosen) if (await this.save(record)) count++;
    return count;
  }
  async syncOne(record) {
    if (!this.remote || record.syncState==='synced' || record.syncState==='candidate' || this.inflight.has(record.id)) return;
    this.inflight.add(record.id);
    // Capture destination; a reconnect never writes records to two accounts.
    const remote = this.remote;
    try {
      const {syncState, syncError, ...payload} = record;
      await remote.save(payload);
      await this.retain({...payload, syncState:'synced'});
    } catch(error) {
      await this.retain({...record,syncState:'pending',syncError:error.code || 'network'});
      this.notify('Firebase 저장을 완료하지 못했습니다. 기록은 대기 상태이며 다시 저장할 수 있습니다.');
    } finally { this.inflight.delete(record.id); await this.notify(); }
  }
  async connect(remote) {
    this.remote=remote;
    // Cloud results are merged without erasing unsent local records.
    for (const record of await remote.list()) await this.retain({...record,syncState:'synced'});
    await this.sync();
  }
  async sync() { for (const record of await this.list()) await this.syncOne(record); await this.notify(); }
}
