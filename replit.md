# 너스케줄 (NurSchedule)

한국 병원 병동의 간호사 교대근무 스케줄을 관리하는 웹 플랫폼입니다. 병동 설정, 간호사 관리, 근무 규칙, 인력 요구 설정, 개인 요청, 자동 스케줄 생성, 시각적 그리드 편집, 검증 및 내보내기 기능을 제공합니다.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API 서버 실행 (포트 8080, /api 경로)
- `pnpm --filter @workspace/nurse-scheduler run dev` — 프론트엔드 실행 (포트 24675, / 경로)
- `pnpm run typecheck` — 전체 타입 체크
- `pnpm run build` — 전체 빌드
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI spec에서 hooks/Zod schemas 재생성
- `pnpm --filter @workspace/db run push` — DB 스키마 마이그레이션 (개발용)
- Required env: `DATABASE_URL` — PostgreSQL 연결 문자열, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter router, shadcn/ui, Tailwind CSS v4, Pretendard 폰트
- API: Express 5, OpenAPI-first
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — Generated React Query hooks
- `lib/api-zod/src/generated/` — Generated Zod schemas
- `lib/db/src/schema/` — Drizzle ORM schema (wards, nurses, rules, staffing, schedules)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/services/` — Business logic (generator.ts, validator.ts)
- `artifacts/nurse-scheduler/src/pages/` — React pages
- `artifacts/nurse-scheduler/src/components/layout/AppLayout.tsx` — Sidebar layout

## Architecture decisions

- OpenAPI-first: all API contracts defined in `openapi.yaml`, hooks and Zod schemas auto-generated
- Staffing requirements use path param `/{wardId}/staffing/{yearMonth}` (not query) to avoid Orval codegen collision
- Schedule grid uses click-to-cycle (D→E→N→휴→blank) for fast manual editing
- Auto-generate runs server-side in `services/generator.ts` using a round-robin greedy algorithm with constraint checking
- Validation runs server-side in `services/validator.ts` and stores results in DB for persistence

## Product

- **대시보드**: 병동/간호사/스케줄/충돌 통계 및 병동 바로가기
- **병동 관리**: 병동 CRUD, 근무 시간 설정
- **간호사 관리**: 간호사 CRUD, 경력/야간고정/임신 상태, 허용 근무 유형
- **근무 규칙**: 연속 근무 제한, 야간 제한, 공정성, 프리셉터 매칭
- **인력 요구**: 날짜별 D/E/N 필요 인원 설정 (일괄 적용 지원)
- **개인 요청**: 간호사별 고정휴무/희망휴무/금지근무/연차 등록
- **스케줄 그리드**: 자동 생성, 셀 클릭으로 수동 편집, 검증 패널
- **내보내기**: 스케줄 미리보기 및 인쇄

## User preferences

- Korean UI 레이블 전체 사용
- shadcn/ui 컴포넌트 기반 디자인
- Pretendard 폰트

## Gotchas

- Seed script: `NODE_ENV=development npx tsx artifacts/api-server/src/seed.ts` (idempotent check included)
- API server must be running before frontend can load data
- Schedule grid nurse rows only appear after at least one schedule entry exists (auto-generate creates entries)
- `preceptorId` in nurses uses self-referential FK — update after all nurses are created

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- OpenAPI spec changes require `pnpm --filter @workspace/api-spec run codegen` to regenerate hooks
