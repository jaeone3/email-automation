# Retention Email System — 배포 가이드

## 시스템 개요

**"마지막 활동 이후 N일 동안 안 들어온 유저"** 에게 자동으로 리텐션 메일을 보냅니다.

- 발송 시점: D+1, D+3, D+7, D+14 (레슨 완료 시점 기준)
- 리셋: 유저가 다시 레슨하면 시퀀스 처음부터 다시 시작
- 발송 대상: **런칭 이후 가입한 유저만** (기존 유저는 제외)
- 지원 언어: English, Korean, Japanese, Chinese, Spanish, German, French (7개)
- 발송 서비스: **Resend** (자체 도메인 `kokoai.im`)

### 활동 신호
`user_profiles.streak.lastPracticeDate` 기준. 없으면 `created_at`으로 폴백.

### 구성 요소
- `send-retention-email` edge function: 5분마다 실행. 배치 클레임 + 발송 + 로그 기록.
- `unsubscribe` edge function: 수신거부 처리.
- `retention_email_log` 테이블: 감사 + 중복 방지.
- `retention_email_stats` 뷰: 복귀율 측정.

---

## 사전 조건

아래 테이블은 미리 존재해야 합니다:

| 테이블 | 필요 컬럼 |
|--------|-----------|
| `auth.users` | Supabase 기본 |
| `public.user_profiles` | `id`, `display_name`, `timezone`, `streak` (jsonb), `created_at` |
| `public.email_unsubscribes` | `user_id`, `unsubscribe_token`, `unsubscribed`, `unsubscribed_at` |

---

## Step 1: Resend 세팅

### 1-1. 계정 생성 및 도메인 인증
1. https://resend.com 가입 (GitHub 로그인 가능)
2. Dashboard > **Domains** > `Add Domain` → `kokoai.im` 입력
3. Resend가 주는 DNS 레코드 (SPF TXT, DKIM TXT 2개) → 도메인 등록처(Cloudflare/가비아 등)에 추가
4. `Verify` 클릭 → 5~30분 내 ✅

> **기존 Google Workspace (`jake@kokoai.im`)와 충돌 안 함.** MX는 그대로, SPF는 Resend 가이드대로 병합, DKIM은 서브셀렉터로 따로 추가됩니다.

### 1-2. API Key 발급
Dashboard > **API Keys** > `Create API Key` → `re_xxx...` 복사

---

## Step 2: Supabase Secrets 등록

Supabase Dashboard > **Edge Functions** > **Manage secrets** 에서 4개 등록:

| 변수명 | 값 | 설명 |
|--------|-----|------|
| `SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` | Dashboard > Settings > API > Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Dashboard > Settings > API > **service_role** key (anon 아님!) |
| `RESEND_API_KEY` | `re_xxx...` | Step 1-2에서 받은 값 |
| `FROM_EMAIL` | `hello@kokoai.im` | 발송 주소 (기본값: `hello@kokoai.im`) |

---

## Step 3: DB 마이그레이션 실행

Supabase Dashboard > **SQL Editor**에서 `supabase/migrations/20260424000000_retention_additive_only.sql` 전체 복붙 후 실행.

### 생성되는 것
- `retention_config` (런칭 날짜 저장)
- `retention_email_log` (발송 로그)
- `claim_retention_batch(batch_limit)` RPC (배치 클레임)
- `retention_email_stats` 뷰 (복귀율 대시보드)
- `ensure_unsubscribe_token`, `unsubscribe` RPC (idempotent 재생성)
- `pg_cron`, `pg_net` 확장

### 삭제되는 것 (v1 잔재)
- `email_queue` 테이블
- `email_eligible_users` 뷰
- `pick_pending_emails`, `recover_stale_email_locks` 함수
- v1 cron 스케줄 (`enqueue-emails`, `send-email`, `cleanup-old-queue`)

### 런칭 날짜 확인/조정
마이그레이션은 실행된 날짜를 자동으로 `launch_date`로 저장합니다. 바꾸려면:
```sql
UPDATE retention_config SET value = '2026-04-22' WHERE key = 'launch_date';
```

---

## Step 4: service_role key를 DB에 등록

pg_cron이 edge function을 호출할 때 인증에 사용합니다.

SQL Editor에서 (값만 실제 값으로 교체):
```sql
ALTER DATABASE postgres SET app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
```

> **중요**: 실행 후 **SQL Editor 탭을 닫고 새로 열어야** 다음 단계에서 값을 읽을 수 있습니다.

---

## Step 5: Cron 스케줄 등록

`<PROJECT_REF>`만 본인 값으로 교체 후 새 탭에서 실행:

```sql
-- 5분마다 배치 발송
SELECT cron.schedule('send-retention-email', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-retention-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
$$);

-- 매일 UTC 1시 (KST 10시): 90일 지난 로그 정리
SELECT cron.schedule('cleanup-retention-log', '0 1 * * *', $$
  DELETE FROM public.retention_email_log
   WHERE created_at < now() - interval '90 days';
$$);
```

### 등록 확인
```sql
SELECT jobname, schedule FROM cron.job;
```
→ `send-retention-email`, `cleanup-retention-log` 2개 보이면 성공.

---

## Step 6: Edge Functions 배포

```bash
cd /Users/jake/Downloads/email-automation
supabase login                                    # 최초 1회
supabase link --project-ref <PROJECT_REF>         # 최초 1회

supabase functions deploy send-retention-email --project-ref <PROJECT_REF>
supabase functions deploy unsubscribe            --project-ref <PROJECT_REF>
```

> Supabase CLI 설치: `brew install supabase/tap/supabase`

---

## Step 7: 테스트

### 7-1. 수동 발송
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/send-retention-email \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

응답 예시:
```json
{ "sent": 0, "failed": 0, "skipped": 0, "message": "대상 없음" }
```

> 런칭 직후엔 D+1 대상 유저가 없어서 당연히 0입니다. 24시간 뒤부터 신규 가입자 중 연습 안 한 유저가 잡힙니다.

### 7-2. 로그 확인
```sql
-- 최근 발송 현황
SELECT id, user_id, day, language, status, sent_at, error
FROM retention_email_log
ORDER BY created_at DESC
LIMIT 20;

-- 발송 대상 후보 미리보기 (디버그용)
SELECT up.id, au.email, up.timezone,
       COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) AS last_act,
       current_date - COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) AS days_inactive
FROM user_profiles up
JOIN auth.users au ON au.id = up.id
WHERE up.created_at >= (SELECT value::date FROM retention_config WHERE key = 'launch_date')
ORDER BY days_inactive DESC
LIMIT 20;
```

### 7-3. 복귀율 확인 (며칠 지난 뒤)
```sql
SELECT * FROM retention_email_stats;
```
결과:
| day | language | total_sent | returned_within_1d | returned_within_3d | returned_within_7d | return_rate_pct |
|-----|----------|------------|---------------------|---------------------|---------------------|-----------------|
| 1   | English  | 120        | 15                  | 28                  | 35                  | 29.17           |
| 3   | Korean   | 48         | ...                 | ...                 | ...                 | ...             |

→ **"D+1 영어 메일 29.17% 복귀율"** 같은 수치로 효과 판단.

---

## 문제 해결

### Resend에서 401 Unauthorized
→ `RESEND_API_KEY`가 맞는지 확인. `re_`로 시작하는 값이어야 함.

### Resend에서 422 validation error
→ `FROM_EMAIL`이 Resend에서 인증된 도메인 주소인지 확인. 도메인 verification이 완료돼야 함.

### 발송 대상이 0인데 유저가 많아 보임
- **의도된 동작**: `launch_date` 이전 가입자는 제외됩니다.
- 확인:
```sql
SELECT COUNT(*) FROM user_profiles 
WHERE created_at >= (SELECT value::date FROM retention_config WHERE key = 'launch_date');
```

### 미지원 언어 유저가 skipped로 쌓임
- **의도된 동작**: timezone이 7개 지원 언어로 매핑 안 되면 `status='failed', error='unsupported_language: ...'`로 기록.
- 독일/프랑스는 지원되지만 브라질/러시아 등은 제외됨. 언어 추가하려면 `_shared/config.ts`의 `SUPPORTED_LANGUAGES`에 추가 + 해당 언어 템플릿 28개 중 4개(day_1/3/7/14) 작성.

### auth_failed로 멈춘 이메일 복구
- 새 시스템엔 없는 상태. `status`는 `sending`, `sent`, `failed` 3가지.
- `sending`이 10분 이상 멈춰있으면 다음 cron에서 자동으로 `failed` 처리됨.

### pg_cron이 안 도는 것 같을 때
```sql
SELECT * FROM cron.job_run_details
WHERE jobname IN ('send-retention-email','cleanup-retention-log')
ORDER BY start_time DESC LIMIT 20;
```

---

## 커스터마이징

### 이메일 콘텐츠 수정
`supabase/functions/_shared/config.ts`의 `EMAIL_CONTENT[언어][day_N]`에서 수정. 7개 언어 × 4개 day = 28 블록.

### 런칭 날짜 변경
```sql
UPDATE retention_config SET value = '<YYYY-MM-DD>' WHERE key = 'launch_date';
```

### 지원 언어 추가/제거
1. `_shared/config.ts`의 `SUPPORTED_LANGUAGES`에 이름 추가
2. 같은 파일의 `EMAIL_CONTENT`에 해당 언어 블록 추가 (day_1, day_3, day_7, day_14 4개 필수)
3. `_shared/timezone-mapping.ts`에서 해당 언어로 매핑되는 timezone 확인 (이미 287개 매핑 완료)
4. 재배포: `supabase functions deploy send-retention-email`

### 발송 주기 변경
```sql
SELECT cron.unschedule('send-retention-email');
SELECT cron.schedule('send-retention-email', '<NEW_CRON>', $$ ... $$);
```

### 배치 크기 변경
`_shared/config.ts`의 `SEND_CONFIG.BATCH_SIZE` (기본 20).

### 코드 수정 후 반영
```bash
supabase functions deploy send-retention-email --project-ref <PROJECT_REF>
```
SQL/cron은 재실행 불필요.

---

## 참고

- **Resend 무료 티어**: 3,000통/월, 100통/일. 초과 시 Pro $20/월 (50k통).
- **배치 크기**: 20통/호출. 5분마다 돌아서 최대 **5,760통/일** 가능.
- **로그 보존**: 90일 후 자동 삭제.
- **Stale 회복**: 10분 이상 `sending` 상태면 자동으로 `failed` 처리.
- **복귀 트래킹**: CTA URL에 `utm_campaign=d1/d3/d7/d14` 자동 포함 → Amplitude/GA 등에서 소스별 구분 가능.
