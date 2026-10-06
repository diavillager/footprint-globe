# Vercel 정적 웹 배포

상태: 2026-10-06 `diavillager/footprint-globe` 프로젝트 생성·Git 연결·Preview 배포를 완료했다. 첫 배포의 환경 분류가 요청과 달라 일시 중지했으나, 사용자가 지도 키 없는 첫 배포의 제공을 허용하고 프로젝트 재개와 Preview 검증 지속을 승인했다. Chrome 파일 접근 권한 변경 없이 현재 검증 범위까지 진행하도록 사용자가 확정했으므로 원격 파일 등록 검증은 미수행으로 남긴다. 이후 사용자가 Production 재배포와 localhost·Preview 키 설정 정리를 승인했고 아래 최신 결과를 반영했다. 사용자는 최종 검토에 문제가 없으면 PR #12를 병합하도록 승인했다.

## 다른 워크트리로 인계

준비 대화는 명세·설정 검토와 `bfd4cdb` 커밋까지 진행했다. 사용자가 기존 워크트리의 브랜치를 해제한 뒤 배포 대화에서 `codex/vercel-deploy`를 이어 사용한다. 로컬 `.env.local`은 Git에 포함되지 않으므로 새 워크트리에 자동 복사되지 않는다. 키 값을 채팅에 요청하지 말고 안전한 로컬 설정 또는 Vercel 환경변수 입력으로 준비한다.

## 목적과 기준

[PRD](../docs/PRD.md), [화면 명세](2026-10-06-004-globe-ui.md), [지도 명세](2026-10-06-005-detailed-map.md)를 기준으로 현재 MapTiler 화면을 HTTPS 웹 서비스로 배포한다. 기준 커밋은 PR #11이 병합된 `main`의 `a3d928c`이며 작업 브랜치는 `codex/vercel-deploy`다.

사용자 지정 방문은 사진 등록과 함께 추후 확장한다. 두 기능은 이번 배포와 현재 MVP의 완료 조건에서 제외한다. 기존 방문·사진 자료형은 유지하며 반복 지정·사진 형식·개수·보존 정책은 확장 개발 시 결정한다.

## 범위와 입출력

- 입력: Git으로 관리되는 앱 소스·잠금 파일·빌드 설정과 Vercel 빌드 환경의 공개 지도 키.
- 출력: `dist/` 정적 파일, 배포 URL, 배포 커밋과 검증 결과.
- 현재 지원: rawSignals 위치 관측, 64 MiB·100,000개 신호 한도, 실선 연결, 관측 말풍선, UTC/KST, 목록·분포 창.
- 초기 한반도 뷰와 파일 등록 시 줌을 유지한 첫 관측 이동을 보존한다.
- 서버 함수·DB·로그인·사용자 기록 저장·분석 SDK·사진·수동 방문 지정은 추가하지 않는다.
- 실제 JSON·원본 기반 샘플·로컬 환경 파일·로컬 검증 서버는 배포하지 않는다. 우선 Git 연동으로 추적 파일에서 빌드하며 로컬 폴더 전체 업로드는 하지 않는다.

## 빌드와 호스팅

| 항목 | 설정 |
| --- | --- |
| Framework | Vite |
| Root Directory | 저장소 루트 |
| Node.js | 24.x |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Production branch | `main` |
| Preview branch | `codex/vercel-deploy` |

Node.js 24.x는 Vercel 프로젝트 설정에서 명시적으로 선택한다. 현재 `package.json`의 `>=22.12.0`은 최소 요구 버전이며 24.x 고정 설정이 아니다.

`vercel.json`에 빌드·출력·HTTP 헤더를 기록한다. 현재 URL 라우터가 없는 단일 루트 화면이므로 모든 요청을 index.html로 바꾸는 rewrite는 추가하지 않는다. 없는 자원은 404로 처리한다. 기존 production CSP를 HTTP 헤더에도 적용하고 iframe 삽입을 차단한다. Referer는 origin 수준으로 제한하여 MapTiler origin 검증과 양립시킨다. 해시 자원 캐싱은 플랫폼 기본 동작을 사용한다.

## 지도 키·외부 요청·비용

- `VITE_MAPTILER_API_KEY`를 필요한 Preview/Production 환경에 설정한다. 값은 저장소·문서·명령 출력에 기록하지 않는다. 키는 브라우저 번들에 포함되는 공개 키이며 수정 후 재배포한다.
- MapTiler 허용 origin에 실제 운영 도메인과 사용할 Preview 도메인을 등록한다. 전체 `*.vercel.app`나 출처 불명 허용으로 우회하지 않는다.
- Vercel은 앱 파일을 전달하며 일반 접속 메타데이터를 처리할 수 있다. 선택 JSON의 본문·파일명·관측 시각은 서버로 전송하지 않는다. 지도 조회 영역·확대 수준·IP는 승인된 MapTiler 요청에서 전달될 수 있다.
- 현재 렌더러는 MapTiler SDK 세션이 아닌 요청 수 기준이다. 공개 배포 전 계정 요금제·용도 적합성·남은 한도를 확인한다. 유료 플랜 전환이나 자동 초과 과금은 이번 요청으로 승인된 것으로 보지 않는다.
- 향후 저장 기능은 별도 정책과 명세로 진행하며 이번 배포에 백엔드 키를 추가하지 않는다.

## 배포 절차

1. 계정·팀·프로젝트와 접근 권한을 확인한다. 미확정 배포 대상을 추측하지 않는다.
2. GitHub 저장소를 연결하고 위 빌드 설정·공개 지도 키를 적용한다.
3. Preview를 만들고 정확한 도메인을 MapTiler 허용 목록에 등록한다.
4. 아래 로컬·원격 검증을 완료하고 배포 변경 PR을 생성·검토한다.
5. 해당 PR의 병합 승인을 받은 후 main에 병합하고 Production 배포를 확인한다. 배포 요청을 후속 PR 병합 승인으로 확대하지 않는다.
6. 실제 URL·배포 커밋·지도 동작·남은 제한을 보고한다. 브랜치 정리는 새 작업의 승인 범위를 확인한다.

## 검증과 예외 처리

- 로컬: `npm run check` 및 합성 지도 응답을 사용하는 `node tests/app-smoke.cjs`.
- 원격: HTTPS 루트 성공, JS/CSS/두 worker 정상 로딩, 응답 CSP·보안 헤더, 없는 자원 404와 비공개 경로 미노출.
- Edge에서 완전 합성 JSON으로 등록·첫 관측 이동·줌 유지·말풍선·UTC/KST·모달·지우기·새로고침 후 기록 미복원을 확인한다. 작은 화면에서 페이지 스크롤이 없는지 확인한다.
- 브라우저 요청을 검사하여 JSON/관측 메타데이터 업로드와 예상 밖 분석 요청이 없는지 확인한다. 캡처는 합성 자료만 사용하고 키가 들어 있는 요청 URL·오류 원문은 출력하지 않는다.
- 지도 키 누락·403·429·네트워크 오류 시 고정 안내와 목록 기능을 확인한다. 실패를 키 제한 해제로 해결하지 않는다.
- 빌드 실패 시 로그에서 민감한 값 없이 원인을 확인한다. 운영 장애 시 마지막 정상 배포로 복구하고 잘못된 배포를 계속 승격하지 않는다. 첫 배포에 복구할 이전 버전이 없다면 배포를 중지하고 수정한다.

## 완료 기준과 남은 결정

- [x] 대상 계정 확인: https://vercel.com/diavillager, 새 프로젝트 생성 승인
- [x] 실제 프로젝트 생성·연결: [Vercel 프로젝트](https://vercel.com/diavillager/footprint-globe), GitHub `diavillager/footprint-globe`, Vite, Node.js 24.x, Production 추적 `main`
- [x] 운영 도메인 `footprint-globe.vercel.app` 연결 및 MapTiler 허용 origin 추가
- [ ] MapTiler 운영 사용량·잔여 한도 확인
- [x] 로컬 `npm run check`: 타입 검사·116개 테스트·빌드 통과(설정 초안 작성 후 수행, 큰 지도 번들 경고 유지)
- [x] 배포 워크트리에서 Node.js 24.19.0으로 `npm run check` 및 Edge `node tests/app-smoke.cjs` 통과(합성 응답, 개발·빌드 화면)
- [x] Preview Ready와 실제 지도·한반도 초기 뷰·CSP 메타·이용 안내·390×844 화면의 모달과 페이지 스크롤 없음 확인(Chrome)
- 원격 합성 JSON 등록·관측 선택·시간대·초기화·기록 미복원 검증은 Chrome 확장 파일 접근 권한으로 차단됐다. 사용자가 권한 변경 없이 현재 범위에서 진행하도록 결정했다. 로컬 Edge 합성 smoke 통과와 구별한다.
- [x] 사용자 승인에 따른 Production 재배포와 지도 로딩 확인
- [ ] PR 검토·승인된 병합
- [ ] 운영 URL에서 합성 전체 흐름·개인정보 처리 검증

사용자 실제 기록은 에이전트가 읽지 않는다. 실제 입력 호환성은 사용자가 배포 화면에서 직접 확인하며 합성 검증과 구별한다. 유료 예산·커스텀 도메인·추가 브라우저 지원은 임의로 확정하지 않는다.

## 최신 운영 상태

- 사용자 요청으로 기존 Production 소스 `bfd4cdb`를 최신 환경변수로 캐시 없이 재배포했다. [Production 배포](https://vercel.com/diavillager/footprint-globe/7Cx2S4TYEn87ddJT8hS8oYN5YjTj)는 Ready다. 해당 소스와 현재 브랜치의 차이는 README·이 명세뿐이다.
- [운영 주소](https://footprint-globe.vercel.app/)에서 HTTPS 200·X-Frame-Options DENY·실제 지도·한반도 초기 화면을 확인했다. 실제 사용자 파일은 읽지 않았고 원격 파일 등록 검증은 기존 제한대로 미수행이다.
- 기존 키의 MapTiler 허용 origin은 `footprint-globe.vercel.app`만 남겼다. `localhost`, `127.0.0.1`, Preview 브랜치 주소는 제거했으며 저장 성공을 확인했다. 공급자는 반영에 최대 5분을 안내한다.
- Vercel `VITE_MAPTILER_API_KEY` 적용 환경도 Production만 남겼다. 기존 Preview 빌드의 키 문자열은 소급 제거되지 않지만 origin 제한으로 지도 사용을 차단한다. Preview 배포 이력·Git 연동·로컬 파일은 삭제하지 않았다.
- 아래 진행 기록은 과거 단계의 이력이다. 현재 Production에는 지도 키가 반영돼 있다. PR 병합은 하지 않았다.

## 원격 진행 기록

- 프로젝트를 빈 상태로 생성한 뒤 `footprint-globe`로 이름을 변경하고 기존 GitHub 연결을 사용했다. 서버 함수·분석 SDK·저장소 기능은 추가하지 않았다.
- `bfd4cdb`를 `Create Preview Deployment`로 요청했으나 [첫 배포](https://vercel.com/diavillager/footprint-globe/2emh3ebiFF3WcLNXSTdYiMAdbR7X)의 결과 환경은 Production이었다. 원인을 확정하지 않았으며 발견 즉시 프로젝트의 Production 제공을 일시 중지했다. PR 병합은 수행하지 않았다. 배포에는 지도 키가 없다.
- Vercel의 일시 중지 안내는 Preview 배포·설정·데이터에 영향이 없다고 표시하지만, 실제 `85d51f3` Git 푸시로 생성된 [Preview](https://vercel.com/diavillager/footprint-globe/3ufCZhv5MHJFd5LqeBzJWs1413j1)는 프로젝트가 중지되어 빌드할 수 없다는 사유로 Blocked 처리됐다. 이후 사용자가 지도 키 없는 첫 배포 제공을 허용하며 재개를 승인했고, 프로젝트 재개를 완료했다. 이 승인은 PR 병합·정식 운영 배포 승인으로 확대하지 않는다.
- MapTiler 계정은 Free 플랜이다. 대시보드의 현재 청구 기간에는 0 requests/0 sessions와 데이터 없음이 표시됐으므로 이를 정확한 잔여 한도로 단정하지 않는다. 사용자가 기존 `footprint-globe-dev` 키의 Preview 재사용을 승인했다. localhost 허용을 유지하며 `footprint-globe-git-codex-vercel-deploy-diavillager.vercel.app`만 추가했다. 전체 Vercel 와일드카드·출처 불명 허용은 사용하지 않았다.
- Vercel Preview의 `VITE_MAPTILER_API_KEY`는 공개 브라우저 키에 맞는 Config 형식으로 저장 완료했다. 이후 사용자 요청으로 같은 키의 적용 환경을 Production과 Preview로 저장했다. Vercel 저장 성공과 새 배포가 필요하다는 안내를 확인했다. 당시에는 재배포 전이었으며 현재는 위 최신 운영 상태대로 반영됐다. 이후 사용자 승인으로 운영 origin `footprint-globe.vercel.app`도 기존 키 허용 목록에 추가했다. MapTiler는 origin 변경 반영에 최대 5분이 걸릴 수 있다고 안내한다.
- 사용자는 Preview에서 문제가 없었다고 확인했다. 세부 테스트 항목은 보고되지 않았으므로 에이전트의 원격 합성 전체 흐름 검증과 구별한다.
- 사용자 승인으로 `footprint-globe.vercel.app`을 Production 환경에 연결했다. Vercel의 Valid Configuration과 HTTPS 200을 확인했다. 기존 `project-z82gt.vercel.app`은 유지했다. 도메인 연결 당시에는 지도 키 없는 기존 배포를 제공했다. 이후 승인된 재배포로 지도 키를 반영했다.
- 배포 워크트리의 기본 npm 실행기는 Node.js 18을 사용해 optional native binding 설치가 누락됐다. Node.js 24로 npm CLI를 직접 실행해 `npm ci`를 다시 수행한 후 모든 검사가 통과했다. 잠금 파일은 변경하지 않았다.

## 확인한 배포와 검증 한계

- [Preview 브랜치 URL](https://footprint-globe-git-codex-vercel-deploy-diavillager.vercel.app/)은 브랜치의 최신 배포를 가리킨다. 실제 지도 검증 대상은 `37464ea`의 [Ready 배포](https://vercel.com/diavillager/footprint-globe/FztZRE78g91oxAdC2VV5cFmvso64)다. 이후 문서만 변경한 커밋은 같은 앱·빌드 설정을 사용한다.
- 브라우저 공개 지도 키는 현재 Production 전용이다. Preview에서 먼저 검증했으며 이후 Production에서도 실제 지도 로딩을 확인했다. MapTiler의 정확한 브랜치 도메인 허용으로 실제 지도 로딩이 성공했다. 유료 플랜·초과 과금은 활성화하지 않았다. [공식 Free 용도 안내](https://www.maptiler.com/cloud/pricing/)는 테스트·개인·비상업 용도를 포함한다. 계정 대시보드에서 정확한 잔여 요청 한도는 확인하지 못했다.
- Preview에는 기존 Vercel 인증 보호를 유지했다. 로그인된 Chrome에서 화면 검증을 수행했으며 비로그인 HTTP 요청은 Vercel SSO로 302 이동했다. 이 응답을 앱의 HTTP 200이나 보안 헤더 검증으로 계산하지 않았다.
- 사용자가 제공을 허용한 지도 키 없는 첫 배포의 기본 도메인 `project-z82gt.vercel.app`에서 HTTPS 200, CSP의 `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`을 실제 응답으로 확인했다. 이 도메인은 정식 운영 URL로 확정하지 않았다.
- Preview에서 Vercel 도구막대의 추가 script 태그가 관측되어 프로젝트의 Pre-Production Toolbar를 Off로 저장했다. 기존 로드 화면에는 script 태그가 남아 있어 설정 변경을 삽입 제거·네트워크 무전송 검증 완료와 혼동하지 않는다. Analytics·Speed Insights는 활성화하지 않았다.
- 운영 루트 200과 `/.env.local`, `/config`, `/private/`, `/missing-deploy-check.txt`의 404를 확인했다. 이 네 경로 확인을 모든 비공개 경로 검사로 확대하지 않는다. 두 worker·모든 자원 HTTP 상태, 요청 단위 JSON/메타데이터 업로드 부재, 지도 403/429/네트워크 실패는 원격 검증에서 미확인이다. 원격 전체 흐름과 실제 사용자 JSON 호환성을 완료했다고 주장하지 않는다.
- 운영 재배포와 지도 로딩 확인 이후에도 승인된 PR 병합 실행, 정확한 사용량·잔여 한도 확인, 운영 URL의 합성 전체 흐름 검증은 남아 있다. 방문 지정과 사진은 이 완료 조건에 포함하지 않는다.

## 공식 근거

- [Vite 배포](https://vercel.com/docs/frameworks/frontend/vite): 프레임워크 자동 감지와 정적 배포.
- [vercel.json](https://vercel.com/docs/project-configuration/vercel-json): 빌드·출력·헤더 설정.
- [환경변수](https://vercel.com/docs/environment-variables): 환경별 빌드 설정.
- [Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions): 24.x 지정.

2026-10-06 공식 문서를 확인했다. 실제 계정 설정·배포 성공과 검증 한계는 위 기록을 따른다.
