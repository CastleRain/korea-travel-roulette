# 기존 Firebase 프로젝트 연결하기

이 앱은 **GitHub Pages(웹 화면) + Firebase Authentication(익명 사용자) + Cloud Firestore(추첨 기록)**로 동작합니다. Firebase Hosting이나 서버 배포는 필요하지 않습니다.

2026-11-10: 사용자 지정 `dalchun-35ecb`에 웹 앱 **어디든 여행 룰렛**을 등록했다. 서울 `asia-northeast3`의 Standard `(default)` DB, Spark 무료 요금제를 사용한다. 사용자 승인 후 익명 인증과 `firestore.rules`를 게시했다. 로컬 화면에서 기존 선택 기록 7개의 저장과 미선택 후보 1개의 미전송을 확인했으며, 해당 후보를 명시적으로 선택해 기록한 뒤 총 8개가 Firebase 저장 완료로 표시됐다. 콘솔의 draws 문서 및 서버 savedAt도 확인했다. 배포 검증 상세는 [연결 기록](FIREBASE_CONNECTION_STATUS.md)에 남긴다.

## 1. 기존 프로젝트에 웹 앱 등록

1. [Firebase 콘솔](https://console.firebase.google.com/)에 로그인하고 사용할 기존 프로젝트를 선택합니다.
2. **프로젝트 설정 → 일반 → 내 앱**으로 이동합니다.
3. 웹 앱이 없다면 **앱 추가 → 웹 아이콘(</>)**을 누릅니다. 앱 닉네임은 `어디든`처럼 구분하기 쉬운 이름으로 정합니다. Firebase Hosting은 설정하지 않아도 됩니다.
4. 웹 앱이 이미 있으면 해당 앱의 **SDK 설정 및 구성 → 구성(Config)**을 엽니다.
5. 다음 형태의 공개 `firebaseConfig`를 확인합니다. 앱에 SDK 코드가 이미 있으므로 콘솔의 npm 설치 코드나 `initializeApp` 전체를 다시 붙이지 않습니다.

```js
const firebaseConfig = {
  apiKey: "YOUR_PUBLIC_WEB_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_WEB_APP_ID"
};
```

예시는 형식 설명용입니다. 실제 콘솔 값을 그대로 사용하고 `storageBucket` 등의 형식을 임의로 바꾸지 마세요. 이 앱에 필요한 핵심 필드는 `apiKey`, `projectId`, `appId`입니다. `measurementId`와 Analytics는 필요하지 않습니다.

## 2. 익명 로그인 켜기

**Authentication → 로그인 방법(Sign-in method) → 새 제공업체 추가 → 익명(Anonymous)**에서 사용 설정을 켜고 저장합니다. 콘솔 버전에 따라 Authentication은 Security 또는 Build 그룹 아래에 표시될 수 있습니다.

이 앱은 로그인 버튼 없이 익명 사용자 ID로 본인 기록을 구분합니다. 같은 브라우저에서는 로그인 상태를 유지합니다. 다른 기기나 브라우저에서 같은 기록을 조회하는 기능은 별도 Google/이메일 로그인 및 계정 연결 구현이 필요합니다.

Authentication의 **설정 → 승인된 도메인(Authorized domains)**도 확인하고 배포 도메인 `castlerain.github.io`를 등록해두면 이후 외부 로그인 도입 시에도 사용할 수 있습니다. 경로(`/korea-travel-roulette/`)는 넣지 않습니다. 익명 로그인만 사용할 때는 모든 프로젝트에서 도메인 추가가 필수인 것은 아닙니다. 웹 API 키에 HTTP 리퍼러 제한이 별도로 있다면 `https://castlerain.github.io/*` 출처를 허용해야 합니다.

## 3. Cloud Firestore 준비

1. **Firestore Database**로 이동합니다. Realtime Database가 아닙니다.
2. DB가 없으면 **데이터베이스 만들기**에서 **Standard edition**, 데이터베이스 ID **`(default)`**를 사용합니다.
3. 새 DB는 **프로덕션 모드**로 시작하고 적절한 위치를 선택합니다. 이미 DB가 있으면 새 DB를 만들거나 위치를 바꿀 필요가 없습니다.
4. 이 앱은 기본 `(default)` 데이터베이스를 사용합니다. 기존 프로젝트에 이름이 있는 DB만 있다면 기본 DB를 준비하거나 앱 코드에 사용할 DB ID를 명시하도록 수정해야 합니다.

목적지 문서는 첫 추첨 저장 시 자동 생성되므로 콘솔에서 users 컬렉션을 미리 만들 필요는 없습니다.

## 4. 보안 규칙 적용

프로젝트의 `firestore.rules` 파일을 열고, Firebase 콘솔의 **Firestore Database → Rules(규칙)**에 적용한 뒤 **Publish(게시)**합니다.

**전용 DB이고 다른 앱 규칙이 없다면** 이 파일 전체를 사용할 수 있습니다.

**기존 앱과 같은 프로젝트라면** 기존 규칙 전체를 이 파일로 덮어쓰지 마세요. 기존 `match /databases/{database}/documents` 안에 아래 경로에 대한 블록을 병합하고, 기존 앱의 경로는 보존해야 합니다.

```text
match /users/{uid}/draws/{drawId} { ... }
```

이 경로를 다른 앱도 사용 중인지 먼저 확인합니다. 기존 규칙에 `allow read, write: if true` 같은 광범위 허용이 있으면 더 제한적인 새 규칙을 추가해도 광범위 허용이 우선 적용될 수 있으므로 해당 경로의 허용 조건을 함께 정리해야 합니다.

제공한 규칙은 본인 경로에만 새 추첨 기록을 생성하고, 최근 100개 이내의 본인 기록만 조회하도록 제한합니다. 다른 사용자 접근과 기존 기록 수정·삭제는 막습니다. 실제 적용 전 로컬 Firestore 에뮬레이터에서 5개 저장·보안 검사를 통과한 규칙입니다.

현재 `firestore.rules`가 연결 대상 DB의 기존 규칙과 병합되지 않았다면 `firebase deploy`로 전체 규칙을 덮어쓰지 마세요.

## 5. 웹 설정 넣고 GitHub에 반영

로컬 `public/firebase-config.js`에서 `null`을 공개 설정 객체로 바꿉니다. **`export const`를 유지**해야 합니다.

```js
export const firebaseConfig = {
  apiKey: "콘솔의 공개 웹 API 키",
  authDomain: "콘솔의 authDomain",
  projectId: "콘솔의 projectId",
  appId: "콘솔의 appId"
};
```

콘솔 객체의 다른 공개 필드를 함께 넣어도 됩니다. 서비스 계정 JSON, private_key, 관리자 키나 GitHub 토큰은 이 파일에 넣지 않습니다. Firebase 웹 설정은 브라우저에 배포되는 공개 식별 설정이며 데이터 접근 제한은 Authentication과 Firestore Rules가 담당합니다.

직접 반영할 경우 프로젝트 폴더에서 실행합니다.

```powershell
git add public/firebase-config.js
git commit -m "Connect Firebase web configuration"
git push
```

main push 후 GitHub Actions가 웹 앱을 빌드하고 Pages에 배포합니다. Firebase DB나 보안 규칙은 이 Actions에서 자동으로 생성·배포하지 않으므로 2~4단계는 별도로 완료해야 합니다.

웹 설정과 프로젝트 ID를 전달해 주시면 코드 반영·배포 단계는 이어서 처리할 수 있습니다. 서비스 계정 인증 파일은 필요하지 않습니다.

## 6. 실제 저장 확인

1. [배포 사이트](https://castlerain.github.io/korea-travel-roulette/)를 새로고침합니다.
2. 기록 영역에 **클라우드 연결됨**이 표시되는지 확인합니다.
3. 이름을 입력하고 여행지 하나를 추첨한 뒤 **이 결과 기록하기**를 누릅니다. 여러 결과를 체크해 **선택한 결과 기록하기**를 눌러도 됩니다. 해당 기록에 **Firebase 저장 완료**가 표시되는지 확인합니다.
4. Firebase 콘솔에서 **Firestore Database → 데이터**를 열어 아래 문서를 확인합니다.

```text
users
  └─ 익명 사용자 UID
       └─ draws
            └─ 추첨 UUID
                 travelerName / fullName / drawnAt / savedAt / provinceId / destinationId / ...
```

5. 문서의 `fullName`이 사이트 결과와 같고 `savedAt`이 서버 시각으로 들어왔는지 확인합니다.
6. 사이트를 새로고침한 뒤에도 기록이 유지되는지 확인합니다. 브라우저 기록만으로는 클라우드 저장을 증명할 수 없으므로 **콘솔의 문서 생성까지 확인**합니다.

미연결 상태에서 사용자가 **선택해 기록한** 항목은 연결 후 자동으로 재전송됩니다. 선택하지 않은 최근 추첨 결과는 이 브라우저의 임시 목록에만 보관하고 전송하지 않습니다. 클라우드 저장이 실패하면 완료로 표시하지 않고 대기 상태를 유지합니다.

이름 필드(`travelerName`)를 허용하는 최신 `firestore.rules`를 적용해야 합니다. 이름은 표시용이며 사용자 구분 키는 익명 UID입니다. 같은 이름을 입력해도 다른 기기의 기록이 공유되지 않으며, 같은 브라우저에서 이름만 바꾸면 기존 기록은 계속 보입니다.

## 문제가 생기면

| 증상 | 확인할 항목 |
| --- | --- |
| 계속 클라우드 미연결 | `firebase-config.js`가 여전히 null인지, GitHub Actions가 끝났는지, 페이지를 새로고침했는지 |
| `auth/operation-not-allowed` | 익명 로그인 제공업체가 켜져 있는지 |
| `auth/invalid-api-key` | 웹 앱 Config 값을 정확히 복사했는지 |
| `permission-denied` | Firestore 규칙을 게시했는지, 익명 인증과 UID 경로가 맞는지, `(default)` DB에 적용했는지 |
| 요청 출처 차단 | Google Cloud API 키의 HTTP 리퍼러·API 제한에 현재 배포 출처가 허용됐는지 |
| 연결되지만 기록이 저장 대기 | 네트워크·규칙·Firebase 콘솔 사용량 상태 확인 후 사이트의 다시 저장 버튼으로 재시도 |

## 공식 문서

- [웹 앱 등록과 설정 객체](https://firebase.google.com/docs/web/setup)
- [익명 인증](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Firestore 시작하기](https://firebase.google.com/docs/firestore/quickstart)
- [Firestore 규칙 작성·게시와 기존 규칙 덮어쓰기 주의](https://firebase.google.com/docs/firestore/security/get-started)

2026-11-10 공식 문서를 확인해 작성했습니다. 콘솔 메뉴의 묶음이나 번역은 화면 버전에 따라 달라질 수 있습니다.
