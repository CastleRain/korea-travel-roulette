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
  const app = appSdk.initializeApp(config);
  const auth = authSdk.getAuth(app);
  await authSdk.setPersistence(auth,authSdk.browserLocalPersistence);
  const user = (await authSdk.signInAnonymously(auth)).user;
  const db = firestoreSdk.getFirestore(app);
  const folder = firestoreSdk.collection(db,'users',user.uid,'draws');
  return {
    async save(record) {
      const ref = firestoreSdk.doc(folder,record.id);
      // Stable UUID + existing-document check makes retries idempotent.
      if ((await timeout(firestoreSdk.getDocFromServer(ref))).exists()) return;
      await timeout(firestoreSdk.setDoc(ref,{...record,savedAt:firestoreSdk.serverTimestamp()}));
    },
    async list() {
      const result = await timeout(firestoreSdk.getDocsFromServer(firestoreSdk.query(folder,firestoreSdk.orderBy('drawnAt','desc'),firestoreSdk.limit(100))));
      return result.docs.map(doc=>{ const {savedAt,...record}=doc.data(); return record; });
    },
  };
}
