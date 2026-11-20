# 배포 가이드 (프리뷰 → 소프트런치)

배포 대상은 둘이다. 정적 클라이언트(`apps/client`, Vercel)와 게임 서버(`apps/server`, 상시 실행 컨테이너).
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
| `VITE_SERVER_URL` | 게임 서버 주소 (예: `https://game.example.com`) | 없으면 온라인 대전·고스트를 숨긴다. WebSocket 은 같은 주소의 `/ws` |

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

## 6. 게임 서버 (`apps/server`)
단일 번들 파일(`dist/server.mjs`, 의존성 포함)이라 Node 22 만 있으면 실행된다. `node_modules` 없이 실행되는 것을 확인했다.

```bash
pnpm --filter @freeze/server build
PORT=8787 ALLOWED_ORIGINS=https://your-client.example node apps/server/dist/server.mjs
```

컨테이너(리포지토리 루트에서 빌드):
```bash
docker build -f apps/server/Dockerfile -t freeze-server .
```

| 환경 변수 | 기본 | 설명 |
|---|---|---|
| `PORT` | 8787 | HTTP + WebSocket(`/ws`) |
| `ALLOWED_ORIGINS` | (없음 = 모두 허용) | 쉼표 구분. **운영에서는 반드시 클라이언트 도메인만** 허용 |
| `GHOST_FILE` | (없음 = 메모리) | 고스트 JSON 저장 경로. 운영에서는 DB 로 교체 권장 |
| `QUEUE_WAIT_MS` | 8000 | 매치 대기 시간 |
| `COUNTDOWN_MS` | 3000 | 매치 시작 카운트다운 |

엔드포인트: `GET /healthz`, `GET|POST /api/ghosts`, `GET /api/leaderboard?stage=N`, `WS /ws`.

운영 주의(미검증 항목 포함):
- **룸 상태는 프로세스 메모리**에 있다. 인스턴스를 여러 대 두려면 같은 룸의 연결을 같은 인스턴스로 보내는 라우팅이 필요하다. 처음에는 지역별 단일 인스턴스를 권장한다.
- 지연이 공정성에 직결되므로 유저와 가까운 지역에 배치한다(한국 유저 대상이면 서울/도쿄 리전).
- Docker 빌드는 이 환경에서 실행해 보지 못했다(도커 없음).
