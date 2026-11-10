# 실제 구현·검증 기록 · 2026-11-10

색상·서체 보완과 Firebase 연결 안내의 후속 기록은 [UI 보완 검증](UI_REFINEMENT.md)을 참고한다. 아래는 최초 구현·배포 당시의 기록이다.

## 결과와 현재 한계

별도 프로젝트 구현 및 GitHub Pages 공개 배포를 완료했다.

- 사이트: https://castlerain.github.io/korea-travel-roulette/
- 저장소: https://github.com/CastleRain/korea-travel-roulette
- 검증한 앱 소스 commit: `c4e99ea8c1eab0729df2c6649f2a60d2746039c0`
- 최초 배포 Actions: https://github.com/CastleRain/korea-travel-roulette/actions/runs/42811650099
- Actions의 build/test/deploy 모두 success, 공개 주소에서 실제 추첨 및 새로고침 후 기록 조회 확인.
- **실제 Firebase 연결·클라우드 저장은 설정 수령 대기이며 미완료**. `firebase-config.js`는 null. 미연결을 화면에 표시하며 브라우저 임시 보관과 Firebase 저장 완료를 구별한다.

## 변경 파일

- `public/index.html`, `style.css`, `favicon.svg`: 실제 지도와 추첨 UI, 모바일 배치, 안내·범위 선택·기록 목록.
- `public/data/regions.json`, `LICENSE-DATA`: 출처 고정된 2026-10-01 경계와 시 단위 후보 목록.
- `src/roulette.js`: 상태 머신, 실제 표시 후보 확정, 타이머 취소, 예외 지역.
- `src/app.js`: Enter/클릭, 지도 갱신·확대, 결과 복사·지도 검색, 기록 UI.
- `src/storage.js`: IndexedDB 대기 기록, 재시도와 클라우드 응답 구분.
- `src/firebase.js`, `firebase-config.js`: Firebase 익명 인증·Firestore 저장/조회, 연결 전 상태.
- `firestore.rules`, `firebase.json`: 사용자별 검증 규칙과 로컬 에뮬레이터 설정.
- `scripts/`, `tests/`, `.github/workflows/pages.yml`, `README.md`, `docs/`: 실행·변환·검사·배포·인수 문서.

기존 AI Company OS 코드·회사 데이터와 원본 첨부 PDF는 변경·배포하지 않았다. 새 Git 저장소에는 이 프로젝트의 소스와 공개 행정경계 데이터만 업로드했다.

## 직접 실행한 검사

| 확인 | 실제 결과 |
| --- | --- |
| `npm.cmd test` | 19/19 통과, 실패·취소·생략 0 |
| `npm.cmd run build` | 성공, 16개 시·도 / 230개 최종 후보 검증 |
| `firebase emulators:exec --only firestore --project demo-travel-roulette "node --test tests/firestore.integration.mjs"` | 5/5 통과, 실제 로컬 문서 저장·조회 및 사용자 접근 제한 |
| `git diff --cached --check` | 오류 없음 |
| Firebase 공식 CDN 13.2.0 앱 SDK URL | HTTP 200 |
| GitHub Actions 검사·빌드·Pages 배포 | 실제 실행 success |

에뮬레이터는 demo 프로젝트만 사용했다. 미인증 쓰기, 타인 경로 쓰기·읽기, 추가 필드, 과도한 필드 크기, 기존 기록 덮어쓰기, 제한 없는 조회를 거부하는 것을 확인했다. 본인 문서 생성·조회와 최근 100개 제한 조회는 허용했다. 이 결과는 실제 Firebase 프로젝트 검증을 대신하지 않는다.

## 실제 브라우저 확인

Windows에서 in-app browser로 로컬 및 배포 사이트를 직접 조작했다.

- 시·도 시작 → Enter 확정 → 하위 지역 자동 회전 → 두 번째 Enter 완료.
- 로컬 일반 사례: 경상남도 거제시를 확정하고 지도 제목·결과·기록 일치를 확인.
- 새로고침 후 IndexedDB의 기존 기록 조회.
- 모든 지역 해제 후 적용 차단과 안내 표시.
- 세종만 선택하여 단일 단계 확정, 하위 재추첨 버튼 미표시와 단일 단계 기록 확인.
- 제주만 선택하여 제주시/서귀포시 2개 후보와 제주시 최종 확정 확인.
- Enter 1.8초 길게 누르기: 첫 단계 확정 후 하위 단계가 계속 회전하며, 새 Enter 입력으로만 최종 확정됨을 확인.
- 결과 복사 버튼 성공 안내를 확인했으나 자동화 도구의 클립보드 읽기는 빈 값이어서 복사된 실제 텍스트의 도구 간 대조는 미검증.
- 실제 JSON 다운로드 파일을 읽어 기록 3개·pending 3개를 확인. 저장 성공으로 위장하지 않음.
- 390×844 모바일 화면: 추첨 카드 우선 배치와 버튼 확인, DOM 폭 375 / viewport 390으로 가로 넘침 없음.
- 공개 사이트에서 충청북도 보은군 최종 확정 → 기록 생성 → 새로고침 후 같은 기록 유지 확인.
- 공개 주소의 앱 console error 0개. 최종 전체 화면을 로컬 `verification/deployed-desktop.png`에 저장.

초기 브라우저 확인에서 타이머 함수를 인스턴스 메서드로 호출할 때 `Illegal invocation`이 발생했다. 전역 타이머를 감싼 호출로 수정한 뒤 단위 검사·빌드를 재실행하고 실제 추첨을 다시 확인했다. 지도 확대 시 도형이 지도 영역 밖으로 나오는 문제는 SVG overflow 제한과 확대에 따른 라벨 크기 조정으로 보완했다. 최초부터 무오류였던 결과로 표시하지 않는다.

## 미실행 항목·다음 단계

1. Firebase 프로젝트 ID·웹 설정 수령.
2. 기존 프로젝트의 Authentication/Firestore 상태 및 기존 보안 규칙 확인. 다른 앱 규칙을 덮어쓰지 않고 필요한 경로만 병합.
3. 익명 인증과 배포 출처 허용 설정, 공개 웹 설정 연결.
4. 실제 사이트 추첨 → Firestore 문서 생성 → 새로고침 조회 및 실패·재시도 검증.

웹 UI 테스트는 지금 가능하다. Firebase 실저장 완료 판정은 위 단계 이후에만 가능하다. 여러 기기에서 같은 기록을 공유하는 정식 계정 로그인은 이번 구현 범위에 포함하지 않았다.
