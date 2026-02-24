-- ============================================================
-- 이메일 자동발송 시스템 전체 셋업 (통합 마이그레이션)
-- ============================================================

-- ============================================================
-- 1. email_eligible_users 뷰
--    auth.users + user_profiles + email_unsubscribes 조인
--    수신거부 안 한 유저만 노출
-- ============================================================
CREATE OR REPLACE VIEW public.email_eligible_users AS
SELECT
  au.id AS user_id,
  au.email,
  up.display_name,
  au.created_at,
  eu.unsubscribe_token,
  up.timezone
FROM auth.users au
INNER JOIN public.user_profiles up ON up.id = au.id
LEFT JOIN public.email_unsubscribes eu ON eu.user_id = up.id
WHERE eu.unsubscribed IS NULL OR eu.unsubscribed = false;

-- ============================================================
-- 5. ensure_unsubscribe_token() 함수
--    토큰이 없으면 INSERT, 있으면 기존 토큰 반환
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_unsubscribe_token(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_token uuid;
BEGIN
  SELECT unsubscribe_token INTO v_token
  FROM public.email_unsubscribes
  WHERE user_id = p_user_id;

  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  INSERT INTO public.email_unsubscribes (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING unsubscribe_token INTO v_token;

  IF v_token IS NULL THEN
    SELECT unsubscribe_token INTO v_token
    FROM public.email_unsubscribes
    WHERE user_id = p_user_id;
  END IF;

  RETURN v_token;
END;
$$;

-- ============================================================
-- 6. unsubscribe RPC 함수
--    GitHub Pages에서 supabaseClient.rpc('unsubscribe', { token }) 으로 호출
-- ============================================================
CREATE OR REPLACE FUNCTION public.unsubscribe(token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE public.email_unsubscribes
  SET unsubscribed = true,
      unsubscribed_at = now()
  WHERE unsubscribe_token = token::uuid
    AND unsubscribed = false;

  GET DIAGNOSTICS affected = ROW_COUNT;

  RETURN json_build_object('success', affected > 0);
END;
$$;

-- ============================================================
-- 7. email_queue 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_queue (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_email    text NOT NULL,
  recipient_name     text,
  unsubscribe_token  text,
  subject            text NOT NULL,
  language           text,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'auth_failed')),
  error              text,
  attempts           int NOT NULL DEFAULT 0,
  queued_at          timestamptz NOT NULL DEFAULT now(),
  locked_at          timestamptz,
  sent_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON email_queue (status, queued_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue (status);

-- ============================================================
-- 8. pick_pending_emails() — 대기 중인 이메일 원자적 선택+잠금
-- ============================================================
CREATE OR REPLACE FUNCTION pick_pending_emails(batch_limit int DEFAULT 20)
RETURNS SETOF email_queue
LANGUAGE sql
AS $$
  UPDATE email_queue
  SET status = 'sending',
      locked_at = now(),
      attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM email_queue
    WHERE status = 'pending' AND attempts < 3
    ORDER BY queued_at ASC
    LIMIT batch_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ============================================================
-- 9. recover_stale_email_locks() — 크래시된 잠금 복구 (5분 초과 시)
-- ============================================================
CREATE OR REPLACE FUNCTION recover_stale_email_locks()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  recovered int;
BEGIN
  UPDATE email_queue
  SET status = 'pending', locked_at = NULL
  WHERE status = 'sending'
    AND locked_at < now() - interval '5 minutes';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;

-- ============================================================
-- 10. pg_cron + pg_net 확장 활성화
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 11. pg_cron 스케줄 등록
--     <SERVICE_ROLE_KEY>와 <PROJECT_REF>를 실제 값으로 교체 후 실행
-- ============================================================

-- service_role key를 DB 설정에 저장 (pg_cron에서 사용)
-- ALTER DATABASE postgres SET app.settings.service_role_key = '<SERVICE_ROLE_KEY>';

-- 5분마다: 대상 유저를 큐에 삽입
-- SELECT cron.schedule('enqueue-emails', '*/5 * * * *', $$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/enqueue-emails',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
-- $$);

-- enqueue 1분 후부터 5분마다: 큐에서 이메일 발송
-- SELECT cron.schedule('send-email', '1/5 * * * *', $$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-email',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
-- $$);

-- 매일 UTC 1시: 3일 지난 건 전부 정리
-- SELECT cron.schedule('cleanup-old-queue', '0 1 * * *', $$
--   DELETE FROM email_queue
--   WHERE queued_at < now() - interval '3 days';
-- $$);
