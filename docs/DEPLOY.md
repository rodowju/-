# 배포 가이드 (프리뷰 → 소프트런치)

이 저장소는 정적 클라이언트(`apps/client`)만 배포한다. 서버(`apps/server`)는 M6 이후.
이 환경에서는 Vercel 계정/토큰이 없어 **실제 배포는 수행하지 않았다.** 아래는 설정 파일 기준 절차이며, 빌드 산출물은 로컬에서 검증했다.

## 1. 사전 준비
- GitHub 저장소 연동이 복구되어야 한다 (현재 이 세션의 푸시는 403).
- Vercel 계정, 프로젝트 가져오기: "Import Git Repository" → 이 저장소 선택.
- Framework Preset: **Other** (설정은 루트 `vercel.json`이 지정).

## 2. 설정 (`vercel.json`에 이미 반영)
| 항목 | 값 |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Build | `pnpm --filter @freeze/client build` |
| Output | `apps/client/dist` |
| 해시된 에셋 | `Cache-Control: public, max-age=31536000, immutable` |
| `sw.js`, `index.html`, manifest | `max-age=0, must-revalidate` (서비스 워커 갱신 보장) |
| 보안 헤더 | `nosniff`, `Referrer-Policy`, `Permissions-Policy` |

**CSP는 아직 없다.** 광고 SDK가 확정되면 해당 도메인을 허용하는 CSP를 추가해야 한다.

## 3. 환경 변수
| 이름 | 용도 | 비고 |
|---|---|---|
| `VITE_ANALYTICS_URL` | 익명 통계 수집 엔드포인트 | 없으면 전송하지 않고 메모리 큐에만 쌓인다 |

수집 엔드포인트는 아직 없다. `POST` JSON(`{v, install, session, app, events[]}`)을 받는 단순 수집기면 되고, 스키마는 `apps/client/src/logic/analytics.ts`가 정의한다.

## 4. 프리뷰 확인 체크리스트
- [ ] 폰(iOS Safari, 안드로이드 Chrome)에서 홀드/릴리즈가 즉각 반응하는가
- [ ] 홈 화면에 추가 → 전체 화면(standalone), 세로 고정
- [ ] 비행기 모드에서 재실행되는가 (서비스 워커 프리캐시)
- [ ] 새 배포 후 재방문 시 자동 갱신되는가
- [ ] 레터박스(상하 여백)를 눌러도 입력이 먹는가

## 5. 로컬 확인
```bash
pnpm install
pnpm --filter @freeze/client build
pnpm --filter @freeze/client preview   # http://localhost:4173
```
