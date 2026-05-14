# Ward Shift Planner

3교대 간호사 근무표를 설정 기반으로 자동 생성하고, 검증과 수동 편집까지 지원하는 웹 플랫폼입니다.

## Local demo

```powershell
.\run-local-demo.bat
```

- web: `http://127.0.0.1:24675`
- api: `http://127.0.0.1:8080/api/healthz`

## Deploy on Render

이 저장소는 현재 `render.yaml`이 포함되어 있어서 Render에 바로 연결해 배포할 수 있습니다.

### Current deployment mode

- `DATABASE_URL`이 없으면 demo mode로 실행됩니다.
- demo mode에서는 현실적인 샘플 병동/간호사 데이터로 서비스가 열립니다.
- 즉, 지금 단계에서는 DB 없이도 무료 임시배포가 가능합니다.

### Render steps

1. GitHub에 이 저장소를 푸시합니다.
2. Render에서 `New +` → `Blueprint`를 선택합니다.
3. 이 저장소를 연결합니다.
4. `render.yaml`을 읽어서 웹 서비스를 생성합니다.
5. 배포가 끝나면 `/api/healthz`와 메인 화면을 확인합니다.

### Build / start commands

- build:
  `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/nurse-scheduler run build && pnpm --filter @workspace/api-server run build`
- start:
  `pnpm --filter @workspace/api-server run start`

## Production direction

현재는 빠른 검토와 테스트를 위한 구조입니다.

- 프론트엔드 빌드 결과를 API 서버가 함께 서빙합니다.
- `DATABASE_URL`을 연결하면 실제 DB 모드로 전환됩니다.
- 이후에는 인증, 운영 데이터, 백업 정책을 붙여 상시 운영 구조로 확장할 수 있습니다.
