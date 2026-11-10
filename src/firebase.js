function timeout(promise) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('저장 서버 응답 시간 초과'),{code:'timeout'})),15000);})]).finally(()=>clearTimeout(timer));
}
export async function connectFirebase(config) {
  if (!config?.apiKey || !config?.projectId || !config?.appId) throw new Error('Firebase 웹 설정이 아직 없습니다.');
  const version = '13.2.0';
  const [appSdk,authSdk,firestoreSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
  ]);
  const app = appSdk.getApps()[0] || appSdk.initializeApp(config);
  const auth = authSdk.getAuth(app);
  await authSdk.setPersistence(auth,authSdk.browserLocalPersistence);
  const user = (await authSdk.signInAnonymously(auth)).user;
  const db = firestoreSdk.getFirestore(app);
  const folder = firestoreSdk.collection(db,'users',user.uid,'draws');
  return {
    uid:user.uid,
    async save(record) {
      const target = record.roomId ? firestoreSdk.collection(db,'tripRooms',record.roomId,'travelers',record.travelerName,'draws') : folder;
      const ref = firestoreSdk.doc(target,record.id);
      // Stable UUID + existing-document check makes retries idempotent.
      if ((await timeout(firestoreSdk.getDocFromServer(ref))).exists()) return;
      await timeout(firestoreSdk.setDoc(ref,{...record,...(record.roomId?{ownerUid:user.uid}:{}),savedAt:firestoreSdk.serverTimestamp()}));
    },
    async finalize(record) {
      const draws = firestoreSdk.collection(db,'tripRooms',record.roomId,'travelers',record.travelerName,'draws');
      const latest = firestoreSdk.query(draws,firestoreSdk.orderBy('drawnAt','desc'),firestoreSdk.limit(1));
      const existing = await timeout(firestoreSdk.getDocsFromServer(latest));
      if (!existing.empty) return existing.docs[0].data();
      const ref = firestoreSdk.doc(draws,'final');
      return timeout(firestoreSdk.runTransaction(db,async transaction=>{
        const snap=await transaction.get(ref);
        if(snap.exists()) return snap.data();
        transaction.set(ref,{...record,ownerUid:user.uid,savedAt:firestoreSdk.serverTimestamp()});
        return record;
      }));
    },
    async remove(record) {
      const collection=record.roomId ? firestoreSdk.collection(db,'tripRooms',record.roomId,'travelers',record.travelerName,'draws') : folder;
      const refs=record.roomId ? ['final',record.id] : [record.id];
      await timeout(firestoreSdk.runTransaction(db,async tx=>{
        const docs=await Promise.all(refs.map(id=>tx.get(firestoreSdk.doc(collection,id))));
        for(const doc of docs) {
          if(doc.exists() && doc.data().id===record.id && doc.data().travelerName===record.travelerName) tx.delete(doc.ref);
        }
      }));
    },
    watch(room, names, receive, fail) {
      const stops = names.map(name => {
        const records = firestoreSdk.collection(db,'tripRooms',room,'travelers',name,'draws');
        const query = firestoreSdk.query(records,firestoreSdk.orderBy('drawnAt','desc'),firestoreSdk.limit(100));
        return firestoreSdk.onSnapshot(query, {includeMetadataChanges:true}, snapshot => {
          if(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)return;
          receive(name,snapshot.docs.filter(doc=>!doc.metadata.hasPendingWrites).map(doc=>({...doc.data(),syncState:'synced'})));
        },fail);
      });
      return () => stops.forEach(stop => stop());
    },
    async list() {
      const result = await timeout(firestoreSdk.getDocsFromServer(firestoreSdk.query(folder,firestoreSdk.orderBy('drawnAt','desc'),firestoreSdk.limit(100))));
      return result.docs.map(doc=>{ const {savedAt,...record}=doc.data(); return record; });
    },
  };
}
