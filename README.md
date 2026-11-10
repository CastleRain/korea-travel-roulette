# 어디든 · 대한민국 여행 룰렛

지도와 연결된 2단계 여행지 추첨 웹 앱. 별도 프로젝트로 구성했으며 상위 AI Company OS의 실행·데이터를 사용하지 않습니다.

- 시작 → Enter로 시·도 확정 → 1.2초 뒤 시·군·구 추첨 → Enter로 완료
- 첫 방문 이름/별명 입력과 기기 내 기억, 상단에서 이름 변경
- 추첨 결과는 로컬 임시 목록에 모으고 단건 또는 체크한 여러 결과만 내 기록에 저장
- 터치/클릭 지원, 재시작, 같은 시·도에서 다시 뽑기, 추첨 범위 선택
- 실제 행정경계 SVG 지도, 결과 강조, 확대/축소, 지도 검색, 결과 복사
- Firebase 익명 인증 + Firestore 사용자별 추첨 기록 저장
- 연결 전/실패 시 IndexedDB 대기 기록, 수동 재시도, JSON 전체 내보내기
- Firestore 응답을 받기 전에는 클라우드 저장 완료로 표시하지 않음
- 키 연타·타이머 중복·이전 추첨 콜백 방지, 반응형 화면, 키보드/스크린리더 안내

## 실행

Node.js 22 이상. 정적 HTML/ES modules에 Bootstrap 5.3.8과 Bootstrap Icons 1.13.1을 적용합니다. 라이브러리 CSS·아이콘 폰트는 빌드에 포함해 같은 출처에서 제공합니다. Firebase SDK는 설정이 있을 때 공식 CDN에서 가져옵니다.

```powershell
cd C:\Users\c\Desktop\AI_company\projects\korea-travel-roulette
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

http://127.0.0.1:5178/ 에서 실행합니다. 파일을 수정하면 다시 빌드한 뒤 브라우저를 새로고침합니다. HTML 파일을 직접 더블클릭하지 마세요.

## 데이터와 예외 지역

`public/data/regions.json`에 경계와 후보가 함께 들어 있습니다. 인터넷 지도 API 키 없이 지역을 표시합니다.

- **기준일 2026-10-01**: 시·도 16개, 최종 후보 230개(세종 포함). 2026년 전남·광주 통합 및 인천 개편이 반영된 데이터입니다.
- 기본 확률은 선택한 시·도 균등 → 그 안의 목적지 균등입니다. 전국 목적지의 확률은 동일하지 않습니다. 중복 추첨을 허용합니다.
- 세종: 시·도 확정과 동시에 최종 확정. 존재하지 않는 하위 시·군·구를 만들지 않습니다.
- 제주: 제주시와 서귀포시.
- 일반구: 같은 시로 합쳐 한 번만 후보에 넣습니다. 합친 여행지 ID는 원천의 공식 행정코드와 구분합니다.
- 섬: 강화·옹진·울릉 등 포함. 원본 경계의 떨어진 폴리곤도 SVG에 포함합니다.
- 단일 단계(정상 예외)와 데이터 누락(실행 차단 오류)을 구별합니다.

출처: 통계청 SGIS / [vuski·VW LAB admdongkor](https://github.com/vuski/admdongkor), commit `d5d5a821c8de6cc337d47eeca604d7af76271c9b`. 데이터는 **CC BY 4.0 + 공공누리 제1유형 출처표시**이며 [원문 라이선스](public/data/LICENSE-DATA)를 포함했습니다. 시 단위 병합, 위경도 SVG 변환을 수행했습니다. 원본 SHA-256은 데이터 파일에 기록돼 있습니다. 경계 데이터는 공적 행정처리·측량용이 아닙니다.

변환 재실행은 선택 사항입니다. `pyarrow`, `shapely`가 필요합니다.

```powershell
python -m pip install --target .tools/python pyarrow shapely
python scripts/prepare_data.py
```

## Firebase 연결

콘솔에서 따라 하는 [단계별 연결 안내](docs/FIREBASE_SETUP.md)를 먼저 참고하세요. 웹 앱 등록 → 익명 인증 → 기본 Firestore DB → 보안 규칙 → 공개 웹 설정 반영 → 실제 문서 확인 순서입니다.

현재 `public/firebase-config.js`는 사용자 지정 `dalchun-35ecb` 웹 앱에 연결되어 있습니다. 서울 Standard `(default)` DB, 익명 인증, 본인 기록만 읽기·생성하는 규칙을 적용했습니다. 연결 진행 및 실제 검증은 [연결 기록](docs/FIREBASE_CONNECTION_STATUS.md)을 참고하세요. 아래는 다른 프로젝트로 변경할 때의 절차입니다.

1. 기존 Firebase 프로젝트에서 웹 앱을 등록하고 공개 `firebaseConfig`를 `public/firebase-config.js`에 넣습니다.
2. Authentication → Sign-in method에서 **익명(Anonymous)** 로그인을 켭니다.
3. Firestore Database를 생성합니다. 기존 DB가 있으면 그대로 사용합니다. 위치는 프로젝트 운영자가 선택합니다.
4. `firestore.rules`의 사용자별 제한을 배포합니다. 기존 DB에 다른 앱의 규칙이 있으면 이 파일로 전체 덮어쓰지 말고 `/users/{uid}/draws/{drawId}` 블록만 기존 규칙에 합칩니다. 기존 상위 규칙이 모든 접근을 허용한다면 먼저 제한을 검토해야 합니다.
5. Authentication → Settings → Authorized domains에 `castlerain.github.io`를 등록합니다. Firebase 공개 API 키에 웹사이트 제한이 있으면 해당 출처도 허용합니다.
6. `npm run build` 후 GitHub에 push합니다. 페이지에서 추첨 → `Firebase 저장 완료` 확인 → 새로고침 → 동일 기록 조회로 실사용을 검증합니다.

서비스 계정 JSON, 관리자 비밀 키, GitHub 토큰은 프런트엔드나 저장소에 넣지 않습니다. Firebase 웹 설정은 공개용 식별 설정이며 데이터 접근은 인증과 Rules로 제한합니다. SDK는 공식 CDN `https://www.gstatic.com/firebasejs/13.2.0/`을 사용합니다.

### 저장 구조와 범위

```text
users/{anonymousUid}/draws/{drawUuid}
  id / provinceId / provinceName / destinationId / destinationName
  fullName / singleStage / dataVersion / drawnAt / travelerName / savedAt(server timestamp)
```

사용자는 본인 기록만 읽고 새로 만들 수 있습니다. 수정·삭제와 다른 사용자 접근은 막습니다. 조회는 최근 100개로 제한하고 현재 화면에는 최근 20개를 표시합니다. 이 브라우저에서 생성한 기록은 IndexedDB에 남아 전체 JSON 내보내기가 가능합니다. UUID로 중복 전송을 방지합니다.

추첨만 한 결과는 `candidate` 상태로 이 기기에만 보관하며 Firebase 연결·재시도 시에도 전송하지 않습니다. 사용자가 선택해 기록하기를 누른 결과만 저장 대기열에 들어갑니다. 이름은 표시용 메타데이터이며 기록 소유권은 익명 UID로 구분합니다. 같은 브라우저에서 이름만 바꾸면 기존 기록은 계속 보이고, 이름 변경은 이전 기록에 소급되지 않습니다. 예전 이름 없는 기록도 보존합니다. JSON 내보내기는 저장한 `records`와 미선택 임시 결과 `candidates`를 구분해 포함합니다.

익명 사용자는 브라우저별로 구분됩니다. 여러 기기 공유는 아직 지원하지 않으며, 브라우저 데이터 삭제 시 기존 익명 기록에 접근하지 못할 수 있습니다. 다른 기기 공유가 필요하면 Google/이메일 로그인과 계정 연결 기능을 추가해야 합니다. 공개 사이트 트래픽에 따른 Firebase 사용량은 Firebase 콘솔에서 확인하세요.

## 검증

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:firestore
```

단위 검사 28개: 전 지역 완주, 예외·소속·범위, 표시 결과 확정, 연타·재시작·오래된 타이머, 저장 실패·재시도·서버 응답 구분, 이름 검증·기억, 명시적 선택 전 전송 금지, 선택 결과만 저장, 이름 변경·기존 기록 보존.

Firestore 에뮬레이터 검사 7개: 실제 문서 쓰기·읽기, 미인증·타인 접근 차단, 필드 검증, 수정 차단, 제한된 본인 조회, 이름 포함 저장·유효성 검사. 실제 Firebase 프로젝트 검증과 구별합니다. Java 및 Firebase CLI가 필요합니다. 로컬 demo 프로젝트로만 실행되며 `firebase.test.json`의 별도 포트를 사용합니다.

## GitHub Pages

`.github/workflows/pages.yml`이 main push 때 검사 → 정적 빌드 → Pages 배포를 수행합니다. 저장소 Settings → Pages → Source를 GitHub Actions로 설정합니다. 저장소 하위 경로에서도 작동하도록 모든 앱 경로가 상대경로입니다. Pages는 앱/DB 서버를 실행하지 않으며 DB 저장은 Firebase가 담당합니다.

## 폴더

| 경로 | 내용 |
| --- | --- |
| public/ | HTML, CSS, Firebase 웹 설정, 출처 포함 지역 데이터 |
| src/roulette.js | 추첨·상태 전이·확률·지역 검증 |
| src/app.js | 화면·지도·키보드·기록·설정 |
| src/storage.js | 로컬 대기 기록과 클라우드 동기화 |
| src/firebase.js | 익명 인증과 Firestore 연결 |
| firestore.rules | 사용자별 보안 규칙 |
| scripts/ | 빌드, 로컬 서버, 데이터 변환 |
| tests/ | 추첨·저장·Firestore 보안 검사 |
| docs/ | 결정사항과 실제 검증 기록 |

개발용 도구·캐시·로컬 검증 기록은 Git에 업로드하지 않습니다.

## UI 라이브러리와 글꼴

기존 중복 CSS와 `public/theme.css`를 폐기했습니다. 특정 색상을 의무화하는 외부 서비스 설정은 없습니다. 새 `public/style.css`의 의미별 변수(`accent`, `ink`, `surface`, `border`)로 표현을 관리하며 색상·브랜드는 변경할 수 있습니다. 이전 색상 선택은 현재 지침이 아닙니다.

Bootstrap의 그리드·버튼·폼·배지·목록과 Bootstrap Icons를 사용합니다. 지도는 밝은 회색, 추첨 패널은 짙은 회색, 주 행동은 파란색을 사용하는 새 구성이며 이는 이번 구현 선택입니다. 라이브러리 버전과 자산은 package-lock.json에 고정하고 빌드가 `dist/vendor/`에 복사합니다. GitHub Actions에서도 `npm ci` 후 검사·빌드를 수행합니다. 재배포 라이선스를 함께 포함합니다.

Pretendard v1.3.9 Variable WOFF2를 직접 호스팅하여 실제 한글 글꼴이 로드되도록 했습니다. 출처는 [orioncactus/pretendard](https://github.com/orioncactus/pretendard/tree/v1.3.9), SIL Open Font License 1.1이며 `public/fonts/OFL.txt`를 포함합니다. 글꼴 SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.
