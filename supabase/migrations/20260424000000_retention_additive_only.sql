-- ============================================================
-- Retention Email System v2 — ADDITIVE ONLY (안전 버전)
-- ------------------------------------------------------------
-- 이 스크립트는 DROP 문이 없어서 기존 DB를 건드리지 않습니다.
-- v1 (email_queue 등) 그대로 유지. 새 시스템만 옆에 생성.
-- 나중에 v1 안 쓰는 것 확인되면 별도로 정리.
-- ------------------------------------------------------------
-- 실행: 트랜잭션 안에서 돌려서 에러 나면 자동 롤백.
-- ============================================================

BEGIN;


-- 1. retention_config
CREATE TABLE IF NOT EXISTS public.retention_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.retention_config (key, value)
VALUES ('launch_date', CURRENT_DATE::text),
       ('daily_cap', '100')
ON CONFLICT (key) DO NOTHING;


-- 2. retention_email_log (중복 발송 방지용 audit)
CREATE TABLE IF NOT EXISTS public.retention_email_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  day         int NOT NULL CHECK (day IN (1, 3, 7, 14)),
  language    text,
  status      text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  resend_id   text,
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retention_log_user_day
  ON public.retention_email_log (user_id, day, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_log_status
  ON public.retention_email_log (status, created_at);


-- 3. ensure_unsubscribe_token (CREATE OR REPLACE 안전. v1과 동일 로직)
CREATE OR REPLACE FUNCTION public.ensure_unsubscribe_token(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_token uuid;
BEGIN
  SELECT unsubscribe_token INTO v_token FROM public.email_unsubscribes WHERE user_id = p_user_id;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;
  INSERT INTO public.email_unsubscribes (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING unsubscribe_token INTO v_token;
  IF v_token IS NULL THEN
    SELECT unsubscribe_token INTO v_token FROM public.email_unsubscribes WHERE user_id = p_user_id;
  END IF;
  RETURN v_token;
END; $$;


-- 4. unsubscribe RPC (CREATE OR REPLACE 안전. v1과 동일 로직)
CREATE OR REPLACE FUNCTION public.unsubscribe(token text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE affected int;
BEGIN
  UPDATE public.email_unsubscribes
     SET unsubscribed = true, unsubscribed_at = now()
   WHERE unsubscribe_token = token::uuid AND unsubscribed = false;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN json_build_object('success', affected > 0);
END; $$;


-- 5. is_tier_1_timezone — Tier-1 영어권 체크
CREATE OR REPLACE FUNCTION public.is_tier_1_timezone(tz text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT tz IN (
    'America/Anchorage','America/Boise','America/Chicago','America/Denver',
    'America/Detroit','America/Indiana/Indianapolis','America/Juneau',
    'America/Los_Angeles','America/Menominee','America/New_York',
    'America/Phoenix','America/Adak','America/Nome','America/Sitka',
    'America/Yakutat','America/Metlakatla','Pacific/Honolulu',
    'US/Central','US/Eastern','US/Pacific',
    'America/Edmonton','America/Halifax','America/Regina','America/St_Johns',
    'America/Toronto','America/Vancouver','America/Winnipeg',
    'America/Blanc-Sablon','America/Cambridge_Bay','America/Dawson',
    'America/Dawson_Creek','America/Fort_Nelson','America/Glace_Bay',
    'America/Goose_Bay','America/Inuvik','America/Iqaluit','America/Moncton',
    'America/Nipigon','America/Pangnirtung','America/Rainy_River',
    'America/Rankin_Inlet','America/Resolute','America/Thunder_Bay',
    'America/Whitehorse','America/Yellowknife',
    'Europe/London','Europe/Belfast','Europe/Dublin','Eire',
    'Australia/Adelaide','Australia/Brisbane','Australia/Broken_Hill',
    'Australia/Currie','Australia/Darwin','Australia/Eucla','Australia/Hobart',
    'Australia/Lindeman','Australia/Lord_Howe','Australia/Melbourne',
    'Australia/Perth','Australia/Sydney',
    'Pacific/Auckland','Pacific/Chatham'
  );
$$;


-- 6. claim_retention_batch — 핵심 RPC (edge function이 호출)
CREATE OR REPLACE FUNCTION public.claim_retention_batch(batch_limit int DEFAULT 20)
RETURNS TABLE (
  log_id bigint, user_id uuid, email text, display_name text,
  timezone text, day int, unsubscribe_token uuid
)
LANGUAGE plpgsql AS $$
DECLARE
  launch_dt date; daily_cap_val int;
  sent_today int; remaining_today int; effective_limit int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('retention_email_claim')) THEN
    RETURN;
  END IF;

  UPDATE public.retention_email_log
     SET status='failed', error=COALESCE(error,'stale lock recovered')
   WHERE status='sending' AND created_at < now() - interval '10 minutes';

  SELECT value::date INTO launch_dt FROM public.retention_config WHERE key='launch_date';
  IF launch_dt IS NULL THEN launch_dt := CURRENT_DATE; END IF;

  SELECT value::int INTO daily_cap_val FROM public.retention_config WHERE key='daily_cap';
  IF daily_cap_val IS NULL THEN daily_cap_val := 100; END IF;

  SELECT COUNT(*) INTO sent_today
    FROM public.retention_email_log
   WHERE created_at >= CURRENT_DATE::timestamptz
     AND status IN ('sent','sending');

  remaining_today := daily_cap_val - sent_today;
  IF remaining_today <= 0 THEN RETURN; END IF;
  effective_limit := LEAST(batch_limit, remaining_today);

  RETURN QUERY
  WITH eligible AS (
    SELECT up.id AS uid, au.email AS u_email, up.display_name AS u_name,
           up.timezone AS u_tz, eu.unsubscribe_token AS u_tok,
           COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) AS last_act,
           CASE WHEN public.is_tier_1_timezone(up.timezone) THEN 1 ELSE 2 END AS priority,
           CASE
             WHEN COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) <= CURRENT_DATE - 14
               AND NOT EXISTS (SELECT 1 FROM public.retention_email_log r
                 WHERE r.user_id=up.id AND r.day=14
                   AND r.created_at::date > COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date))
             THEN 14
             WHEN COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) <= CURRENT_DATE - 7
               AND NOT EXISTS (SELECT 1 FROM public.retention_email_log r
                 WHERE r.user_id=up.id AND r.day=7
                   AND r.created_at::date > COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date))
             THEN 7
             WHEN COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) <= CURRENT_DATE - 3
               AND NOT EXISTS (SELECT 1 FROM public.retention_email_log r
                 WHERE r.user_id=up.id AND r.day=3
                   AND r.created_at::date > COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date))
             THEN 3
             WHEN COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date) <= CURRENT_DATE - 1
               AND NOT EXISTS (SELECT 1 FROM public.retention_email_log r
                 WHERE r.user_id=up.id AND r.day=1
                   AND r.created_at::date > COALESCE((up.streak->>'lastPracticeDate')::date, up.created_at::date))
             THEN 1
           END AS send_day
    FROM public.user_profiles up
    JOIN auth.users au ON au.id = up.id
    LEFT JOIN public.email_unsubscribes eu ON eu.user_id = up.id
    WHERE (eu.unsubscribed IS NULL OR eu.unsubscribed = false)
      AND au.email IS NOT NULL
      AND up.created_at >= launch_dt
  ),
  to_send AS (
    SELECT * FROM eligible WHERE send_day IS NOT NULL
    ORDER BY priority ASC, last_act ASC, uid ASC
    LIMIT effective_limit
  ),
  claimed AS (
    INSERT INTO public.retention_email_log (user_id, day, status)
    SELECT uid, send_day, 'sending' FROM to_send
    RETURNING id AS rl_id, user_id AS rl_uid, day AS rl_day
  )
  SELECT c.rl_id, c.rl_uid, t.u_email, t.u_name, t.u_tz, c.rl_day, t.u_tok
  FROM claimed c JOIN to_send t ON t.uid = c.rl_uid;
END; $$;


-- 7. retention_email_stats view (복귀율 측정)
CREATE OR REPLACE VIEW public.retention_email_stats AS
SELECT l.day, l.language,
  COUNT(*) AS total_sent,
  COUNT(*) FILTER (WHERE (up.streak->>'lastPracticeDate')::date > l.sent_at::date
                     AND (up.streak->>'lastPracticeDate')::date <= l.sent_at::date + 1) AS returned_within_1d,
  COUNT(*) FILTER (WHERE (up.streak->>'lastPracticeDate')::date > l.sent_at::date
                     AND (up.streak->>'lastPracticeDate')::date <= l.sent_at::date + 3) AS returned_within_3d,
  COUNT(*) FILTER (WHERE (up.streak->>'lastPracticeDate')::date > l.sent_at::date
                     AND (up.streak->>'lastPracticeDate')::date <= l.sent_at::date + 7) AS returned_within_7d,
  COUNT(*) FILTER (WHERE (up.streak->>'lastPracticeDate')::date > l.sent_at::date) AS returned_ever,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (up.streak->>'lastPracticeDate')::date > l.sent_at::date)
    / NULLIF(COUNT(*), 0), 2) AS return_rate_pct
FROM public.retention_email_log l
JOIN public.user_profiles up ON up.id = l.user_id
WHERE l.status='sent' AND l.sent_at IS NOT NULL
GROUP BY l.day, l.language
ORDER BY l.day, l.language;


-- 8. 확장 (이미 있으면 skip)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ============================================================
-- 여기까지 에러 없이 왔으면 COMMIT. 중간에 에러 났으면 ROLLBACK.
-- ============================================================
COMMIT;

-- 확인 쿼리 (COMMIT 후 실행)
-- SELECT * FROM retention_config;
-- SELECT count(*) FROM retention_email_log;
-- SELECT routine_name FROM information_schema.routines
--  WHERE routine_name IN ('claim_retention_batch','is_tier_1_timezone');
