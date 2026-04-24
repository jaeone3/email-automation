// 유저가 이메일의 "수신거부" 링크를 누르면 여기로 옴.
//   URL: https://<REF>.supabase.co/functions/v1/unsubscribe?token=<token>
// 이 함수가:
//   1. email_unsubscribes 테이블에서 토큰으로 row 찾기
//   2. unsubscribed=true 로 update
//   3. 브랜드 HTML 확인 페이지 반환
// GitHub Pages 등 외부 의존성 없음.

import { getSupabaseClient } from "../_shared/supabase-client.ts";

const BRAND_NAME = "Koko AI";
const BRAND_LOGO =
  "https://evljahialeytwjpnjywm.supabase.co/storage/v1/object/public/email-assets/appicon.png";
const APP_URL = "https://kokoai.im/";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return html(pageError("잘못된 링크입니다. 토큰이 없습니다."), 400);
  }

  try {
    const supabase = getSupabaseClient();

    const { data, error: selectError } = await supabase
      .from("email_unsubscribes")
      .select("id, unsubscribed")
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (selectError) {
      console.error("select error:", selectError.message);
      return html(pageError("처리 중 오류가 발생했습니다."), 500);
    }

    if (!data) {
      return html(pageError("유효하지 않은 토큰입니다."), 404);
    }

    // 이미 수신거부된 상태면 skip
    if (!data.unsubscribed) {
      const { error: updateError } = await supabase
        .from("email_unsubscribes")
        .update({
          unsubscribed: true,
          unsubscribed_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      if (updateError) {
        console.error("update error:", updateError.message);
        return html(pageError("처리 중 오류가 발생했습니다."), 500);
      }
    }

    return html(pageSuccess(), 200);
  } catch (err) {
    console.error("unexpected error:", err);
    return html(pageError("처리 중 오류가 발생했습니다."), 500);
  }
});

// ------------------------------------------------------------
// HTML 페이지 렌더
// ------------------------------------------------------------

function pageSuccess(): string {
  return pageShell(`
    <div style="text-align:center;">
      <img src="${BRAND_LOGO}" alt="${BRAND_NAME}" width="80"
           style="display:block; margin:0 auto 20px auto; border-radius:16px;">
      <h1 style="font-size:22px; font-weight:800; color:#3c3c3c; margin:0 0 12px 0;">
        수신거부가 완료되었어요 👋
      </h1>
      <p style="font-size:15px; color:#8f8f8f; line-height:1.6; margin:0 0 24px 0;">
        앞으로 ${BRAND_NAME}에서 마케팅 이메일을 보내지 않을게요.<br>
        언제든 다시 돌아오면 Koko가 반겨줄게요.
      </p>
      <a href="${APP_URL}" style="display:inline-block; padding:12px 28px;
         background:#58CC02; color:#fff; font-weight:700; font-size:15px;
         text-decoration:none; border-radius:12px;">
        ${BRAND_NAME} 열기
      </a>
    </div>
  `);
}

function pageError(message: string): string {
  return pageShell(`
    <div style="text-align:center;">
      <img src="${BRAND_LOGO}" alt="${BRAND_NAME}" width="80"
           style="display:block; margin:0 auto 20px auto; border-radius:16px;">
      <h1 style="font-size:20px; font-weight:800; color:#3c3c3c; margin:0 0 12px 0;">
        오류가 발생했어요
      </h1>
      <p style="font-size:15px; color:#8f8f8f; line-height:1.6; margin:0 0 24px 0;">
        ${escapeHtml(message)}
      </p>
      <p style="font-size:13px; color:#afafaf;">
        계속 문제가 생기면 <a href="mailto:hello@kokoai.im" style="color:#58CC02; text-decoration:none;">hello@kokoai.im</a> 으로 알려주세요.
      </p>
    </div>
  `);
}

function pageShell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${BRAND_NAME}</title>
<style>
  body { margin:0; padding:0; background:#f7f7f7;
         font-family:-apple-system,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR','Helvetica Neue',sans-serif; }
  .card { max-width:420px; margin:80px auto; padding:40px 32px;
          background:#fff; border-radius:20px;
          box-shadow:0 4px 16px rgba(0,0,0,0.05); }
  @media (max-width: 480px) {
    .card { margin:24px 16px; padding:32px 20px; }
  }
</style>
</head>
<body>
<div class="card">
${inner}
</div>
</body>
</html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
