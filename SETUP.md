# 이메일 자동발송 시스템 — 배포 가이드

## 시스템 개요

가입 후 24~48시간 된 유저에게 리텐션 이메일을 자동 발송하는 시스템입니다.

- **enqueue-emails**: 발송 대상 유저를 찾아서 큐에 삽입 (5분마다)
- **send-email**: 큐에서 이메일을 꺼내서 Gmail SMTP로 발송 (5분마다, enqueue 1분 후)
- **unsubscribe**: 수신거부 처리
- **cleanup**: 3일 지난 큐 데이터 자동 삭제 (매일 1회)

유저의 timezone 기반으로 72개 언어 중 적절한 언어로 이메일이 발송됩니다.

---

## 사전 조건

아래 테이블이 이미 존재해야 합니다:

| 테이블 | 비고 |
|--------|------|
| `auth.users` | Supabase 기본 제공 |
| `public.user_profiles` | `timezone` 컬럼 포함 필수 |
| `public.email_unsubscribes` | 수신거부 관리용 |

---

## Step 1: Gmail 앱 비밀번호 생성

발송에 사용할 Gmail 계정에서 앱 비밀번호를 만들어야 합니다.

1. Google 계정 > 보안 > **2단계 인증 활성화** (이미 되어있으면 건너뜀)
2. Google 계정 > 보안 > 2단계 인증 > **앱 비밀번호** 메뉴 진입
3. 앱 이름 입력 (예: "Email System") > **만들기**
4. 16자리 비밀번호가 생성됨 → 이 값을 메모 (한 번만 보여줌)

> **주의**: 2단계 인증이 꺼져있으면 "앱 비밀번호" 메뉴 자체가 안 보입니다. 반드시 2FA를 먼저 켜세요.

---

## Step 2: Supabase 환경변수 설정

Supabase Dashboard > **Edge Functions** > **Secrets** 에서 아래 4개를 등록합니다.

| 변수명 | 값 | 어디서 찾나 |
|--------|-----|------------|
| `SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` | Dashboard > Settings > API > Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (긴 문자열) | Dashboard > Settings > API > service_role key (secret) |
| `GMAIL_ADDRESS` | 발송용 Gmail 주소 | Step 1에서 사용한 Gmail |
| `GMAIL_APP_PASSWORD` | 16자리 앱 비밀번호 | Step 1에서 생성한 값 |

> **주의**: `SUPABASE_SERVICE_ROLE_KEY`는 `anon` key가 아니라 **service_role** key입니다. 헷갈리지 마세요.

---

## Step 3: 코드에서 값 변경

### 3-1. config.ts (`supabase/functions/_shared/config.ts`)

`COMMON_CONFIG` 부분을 본인 서비스에 맞게 수정합니다:

```ts
export const COMMON_CONFIG = {
  brand_name: "Koko AI",           // ← 브랜드명 변경
  cta_url: "https://kokoai.com/app", // ← 앱 URL 변경
  streak_count: 0,
  unsubscribe_base_url: "https://jaeone3.github.io/email-unsubscribe/unsubscribe.html",
  social_instagram: "#",            // ← SNS 링크 변경 (없으면 그대로)
  social_twitter: "#",
  social_facebook: "#",
  social_tiktok: "#",
};
```

그리고 아래 72개 언어별 이메일 콘텐츠에서 `Koko`를 본인 브랜드명으로 **전체 치환** (Ctrl+H) 합니다.

### 3-2. unsubscribe/index.ts

수신거부 페이지 URL을 바꾸려면 4라인 수정:
```ts
const UNSUBSCRIBE_PAGE = "https://jaeone3.github.io/email-unsubscribe/unsubscribe.html";
```
> 바꿀 필요 없으면 그대로 두면 됩니다. 공용 페이지라 어떤 프로젝트에서든 동작합니다.

---

## Step 4: SQL 실행 (데이터베이스 설정)

Supabase Dashboard > **SQL Editor** 에서 실행합니다.

`supabase/migrations/20260224100000_full_setup.sql` 파일을 열고, **주석이 아닌 부분** (1~149라인)을 복사해서 실행합니다.

이 SQL이 생성하는 것들:
- `email_eligible_users` 뷰 — 발송 대상 유저 조회용
- `ensure_unsubscribe_token()` 함수 — 수신거부 토큰 자동 생성
- `unsubscribe()` RPC 함수 — 수신거부 처리
- `email_queue` 테이블 — 발송 큐
- `pick_pending_emails()` 함수 — 큐에서 배치 선택 + 잠금
- `recover_stale_email_locks()` 함수 — 크래시 복구
- `pg_cron`, `pg_net` 확장 활성화

> 기존 `user_profiles`, `email_unsubscribes` 테이블에는 영향 없습니다.

---

## Step 5: pg_cron 스케줄 등록

SQL Editor에서 아래 순서대로 실행합니다.

### 5-1. service_role key를 DB에 저장

`<SERVICE_ROLE_KEY>`를 Step 2에서 사용한 실제 값으로 교체 후 실행:

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
```

### 5-2. SQL Editor 탭을 닫고 새 탭 열기

> **중요**: ALTER DATABASE는 현재 세션에 바로 적용되지 않습니다. 반드시 새 탭을 열어야 다음 단계에서 값을 읽을 수 있습니다.

### 5-3. 스케줄 등록

`<PROJECT_REF>`를 본인 Supabase 프로젝트 레퍼런스로 교체 후 실행:

```sql
-- 5분마다: 발송 대상 유저를 큐에 삽입
SELECT cron.schedule('enqueue-emails', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/enqueue-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
$$);

-- enqueue 1분 후부터 5분마다: 큐에서 이메일 발송
SELECT cron.schedule('send-email', '1/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
$$);

-- 매일 UTC 1시 (KST 10시): 3일 지난 큐 데이터 삭제
SELECT cron.schedule('cleanup-old-queue', '0 1 * * *', $$
  DELETE FROM email_queue
  WHERE queued_at < now() - interval '3 days';
$$);
```

### 5-4. 등록 확인

```sql
SELECT * FROM cron.job;
```
3개 스케줄이 보이면 성공입니다.

---

## Step 6: Edge Functions 배포

터미널에서 Supabase CLI로 배포합니다.

```bash
# Supabase 로그인 (처음 한 번만)
supabase login

# 3개 함수 배포
supabase functions deploy enqueue-emails --project-ref <PROJECT_REF>
supabase functions deploy send-email --project-ref <PROJECT_REF>
supabase functions deploy unsubscribe --project-ref <PROJECT_REF>
```

> Supabase CLI가 없으면 먼저 설치: `npm install -g supabase`

---

## Step 7: 수동 테스트

배포 후 pg_cron을 기다리지 않고 수동으로 테스트할 수 있습니다.

### 7-1. enqueue 테스트
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/enqueue-emails \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

응답 예시:
```json
{"enqueued": 3, "skipped": 0, "errors": []}
```

### 7-2. send 테스트
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/send-email \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

응답 예시:
```json
{"sent": 3, "failed": 0, "total": 3}
```

### 7-3. 큐 상태 확인

SQL Editor에서:
```sql
SELECT id, recipient_email, status, language, queued_at, sent_at
FROM email_queue
ORDER BY id DESC
LIMIT 20;
```

---

## 문제 해결

### "GMAIL 인증 정보 미설정" 에러
→ Step 2의 환경변수 (`GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`)가 등록되었는지 확인

### "SMTP 인증 실패" 에러
→ Gmail 앱 비밀번호가 맞는지 확인. 일반 비밀번호가 아니라 **앱 비밀번호** (16자리)여야 함

### "유저 조회 실패" 에러
→ `email_eligible_users` 뷰가 생성되었는지 확인. SQL Editor에서:
```sql
SELECT * FROM email_eligible_users LIMIT 5;
```

### enqueue는 성공했는데 send에서 0건
→ 큐에 `pending` 상태 이메일이 있는지 확인:
```sql
SELECT * FROM email_queue WHERE status = 'pending';
```

### pg_cron이 안 도는 것 같을 때
→ 실행 이력 확인:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### auth_failed로 멈춘 이메일 복구
→ Gmail 비밀번호 문제 해결 후:
```sql
UPDATE email_queue SET status = 'pending', error = NULL WHERE status = 'auth_failed';
```

---

## 커스터마이징

### 이메일 제목 / 본문 / 버튼 텍스트 변경

`supabase/functions/_shared/config.ts`의 `EMAIL_CONTENT`에서 언어별로 수정합니다.

```ts
"English": {
  subject: "...",           // 이메일 제목 ({name}은 유저 이름으로 치환됨)
  body: "...",              // 본문 텍스트
  cta_text: "...",          // CTA 버튼 텍스트 (예: "Start now")
  greeting: "...",          // 메인 인사말 (예: "Learn Korean today!")
  unsubscribe_notice: "...", // 하단 수신거부 안내문 ({{brand_name}}은 브랜드명으로 치환됨)
  unsubscribe_text: "...",  // 수신거부 링크 텍스트
},
```

모든 언어에 동일하게 적용하려면 72개 언어 블록을 전부 수정해야 합니다.
필요한 언어만 남기고 나머지를 삭제해도 됩니다. 매핑에 없는 timezone은 자동으로 English로 발송됩니다.

### 이메일 HTML 디자인 변경

`supabase/functions/_shared/template.ts`에서 HTML 템플릿을 수정합니다.

- 레이아웃, 색상, 폰트 등은 inline style로 되어있음 (이메일은 외부 CSS 불가)
- `{{변수명}}` 형태는 자동 치환되므로 유지해야 함
- 주요 변수: `{{brand_name}}`, `{{greeting}}`, `{{body}}`, `{{cta_text}}`, `{{cta_url}}`, `{{unsubscribe_url}}`

### 로고 이미지 변경

현재 로고는 Supabase Storage에 호스팅되어 있습니다.
자체 로고로 바꾸려면:

1. Supabase Dashboard > Storage > 버킷 생성 (`email-assets`, public으로 설정)
2. 로고 이미지 업로드
3. `template.ts` 51라인의 이미지 URL을 새 URL로 교체:
```
https://<PROJECT_REF>.supabase.co/storage/v1/object/public/email-assets/로고파일명.png
```

SNS 아이콘도 같은 방식으로 교체 가능합니다 (126, 129, 132, 135라인).

### 코드 수정 후 반영

코드를 수정한 후에는 Edge Functions를 다시 배포해야 합니다:
```bash
supabase functions deploy enqueue-emails --project-ref <PROJECT_REF>
supabase functions deploy send-email --project-ref <PROJECT_REF>
supabase functions deploy unsubscribe --project-ref <PROJECT_REF>
```

> SQL이나 pg_cron은 다시 실행할 필요 없습니다. 코드 변경만 재배포하면 됩니다.

---

## 참고

- **Gmail 일일 한도**: 500통/일 (Google 공식)
- **배치 크기**: 20통/호출 (config.ts의 `SEND_CONFIG.BATCH_SIZE`로 조절 가능)
- **발송 간 딜레이**: 1초 (Gmail 속도 제한 방지)
- **큐 데이터 보존**: 3일 후 자동 삭제
- **크래시 복구**: 5분 이상 `sending` 상태면 자동으로 `pending`으로 복원
