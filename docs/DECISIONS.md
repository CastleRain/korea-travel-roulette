# 구현 결정 · 2026-11-10

사용자 확정: 별도 폴더 구현, GitHub 웹 배포 후 테스트, 예외 지역 포함, 기록 저장 기능. DB는 Firebase 사용을 제안·선택했으며 기존 프로젝트의 웹 설정을 전달받기로 했다. GitHub 내 직접 저장 가능 여부 질문에는 인증·쓰기 서버가 필요한 방식이라는 설명을 제공했다. GitHub 저장으로 변경하라는 지시는 받지 않았다.

구현 기본값(사용자 확정 수치와 구별):

- buildless HTML/CSS/ES modules. Python tkinter 기획을 GitHub Pages에서 실행할 웹 앱으로 전환.
- 범용 AI Company OS와 분리한 `projects/korea-travel-roulette`.
- 공개 GitHub 저장소 `CastleRain/korea-travel-roulette`, GitHub Actions Pages 배포. 다른 프로젝트 파일·기존 첨부 PDF는 업로드하지 않음.
- Firebase 익명 인증 + Firestore, 사용자별 기록. 여러 기기 공유는 포함하지 않음.
- 세종 단일 단계 완료. 제주 행정시 포함. 일반구는 시 단위 병합. 섬 지역 포함.
- 데이터 기준일 2026-10-01, 16 시·도 / 230 최종 후보, 원천·가공·라이선스 명시.
- 선택 시·도 균등 → 내부 목적지 균등. 연속 중복 허용. 중단 당시 표시 후보가 결과.
- 80ms 후보 갱신, 첫 확정 후 1.2초 전환. 키 repeat 무시, 키를 뗀 뒤 다음 정지.
- Firestore 서버 응답 이후만 저장 완료. 미연결·실패는 IndexedDB 보관 및 재전송.
- 모바일은 추첨 카드 먼저 표시. 정적 실제 경계 SVG, 시·도/최종 목적지 강조 및 확대.

Firebase 프로젝트 설정·실제 클라우드 쓰기와 규칙 배포는 설정 수령 후 확인해야 한다. 에뮬레이터 통과를 실제 클라우드 완료로 대체하지 않는다.
