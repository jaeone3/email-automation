import { getSupabaseClient } from "../_shared/supabase-client.ts";
import {
  BUSINESS_INFO,
  COMMON_CONFIG,
  SEND_CONFIG,
  getEmailContent,
  type RetentionDay,
} from "../_shared/config.ts";
import { renderTemplate } from "../_shared/template.ts";
import { getSupportedLanguageFromTimezone } from "../_shared/timezone-mapping.ts";

interface ClaimedRow {
  log_id: number;
  user_id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
  day: RetentionDay;
  unsubscribe_token: string | null;
}

const RESEND_URL = "https://api.resend.com/emails";
// {name}, 가 붙어있을 때 이름 없는 유저용으로 앞부분만 깔끔히 제거
const NAME_CLEANUP = /\{name\}[,،、님さん!¡\s]*/u;

Deno.serve(async (_req) => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") || "hello@kokoai.im";

  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY 미설정" }, 500);
  }

  const supabase = getSupabaseClient();

  // 1. 배치 클레임 (stale 회복 + eligible 선택 + 'sending' INSERT 원자적으로)
  const { data: claimed, error: claimErr } = await supabase.rpc(
    "claim_retention_batch",
    { batch_limit: SEND_CONFIG.BATCH_SIZE },
  );

  if (claimErr) {
    console.error("claim 실패:", claimErr.message);
    return json({ error: claimErr.message }, 500);
  }

  const rows = (claimed ?? []) as ClaimedRow[];
  if (rows.length === 0) {
    return json({ sent: 0, failed: 0, skipped: 0, message: "대상 없음" });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    // 지원 언어 필터 (미지원 timezone → 발송 안 함, 로그만 failed 처리)
    const language = getSupportedLanguageFromTimezone(row.timezone);

    if (!language) {
      await markLog(supabase, row.log_id, {
        status: "failed",
        error: `unsupported_language: tz=${row.timezone ?? "null"}`,
        language: "UNSUPPORTED",
      });
      skipped++;
      continue;
    }

    const content = getEmailContent(language, row.day);

    // unsubscribe token이 없으면 지금 생성
    let unsubscribeToken = row.unsubscribe_token;
    if (!unsubscribeToken) {
      const { data: newToken } = await supabase.rpc(
        "ensure_unsubscribe_token",
        { p_user_id: row.user_id },
      );
      unsubscribeToken = (newToken as string | null) ?? "";
    }

    const unsubscribeUrl =
      `${COMMON_CONFIG.unsubscribe_base_url}?token=${unsubscribeToken}`;

    // UTM 파라미터로 day별 복귀 트래킹
    const ctaUrl = appendUtm(COMMON_CONFIG.cta_url, {
      utm_source: "retention_email",
      utm_medium: "email",
      utm_campaign: `d${row.day}`,
      utm_content: language.toLowerCase(),
    });

    const subject = row.display_name
      ? content.subject.replace("{name}", row.display_name)
      : content.subject.replace(NAME_CLEANUP, "").trim();

    const bodyHtml = content.body.replaceAll("\n", "<br>");

    const unsubscribeNotice = content.unsubscribe_notice.replaceAll(
      "{{brand_name}}",
      COMMON_CONFIG.brand_name,
    );

    const html = renderTemplate({
      brand_name: COMMON_CONFIG.brand_name,
      greeting: content.greeting,
      body: bodyHtml,
      cta_text: content.cta_text,
      cta_url: ctaUrl,
      hero_image_url: content.hero_image_url,
      streak_count: COMMON_CONFIG.streak_count,
      unsubscribe_url: unsubscribeUrl,
      unsubscribe_notice: unsubscribeNotice,
      unsubscribe_text: content.unsubscribe_text,
      social_instagram: COMMON_CONFIG.social_instagram,
      social_tiktok: COMMON_CONFIG.social_tiktok,
      social_youtube: COMMON_CONFIG.social_youtube,
      support_email: COMMON_CONFIG.support_email,
      business_company: BUSINESS_INFO.company,
      business_ceo: BUSINESS_INFO.ceo,
      business_number: BUSINESS_INFO.business_number,
      business_address: BUSINESS_INFO.address,
      social_proof: COMMON_CONFIG.social_proof,
    });

    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${COMMON_CONFIG.brand_name} <${fromEmail}>`,
          to: [row.email],
          reply_to: COMMON_CONFIG.reply_to_email,
          subject,
          html,
          headers: {
            "List-Unsubscribe":
              `<${unsubscribeUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "campaign", value: `retention_d${row.day}` },
            { name: "language", value: language.toLowerCase() },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Resend 실패 ${res.status}: ${errText}`);
        await markLog(supabase, row.log_id, {
          status: "failed",
          error: `resend_${res.status}: ${errText.slice(0, 400)}`,
          language,
        });
        failed++;
        continue;
      }

      const data = await res.json().catch(() => ({} as { id?: string }));
      await markLog(supabase, row.log_id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        language,
        resend_id: data?.id ?? null,
      });
      sent++;
      console.log(`발송 성공 d${row.day} ${language} → ${row.email}`);
    } catch (err) {
      console.error(`발송 예외: ${row.email}`, err);
      await markLog(supabase, row.log_id, {
        status: "failed",
        error: `exception: ${String(err).slice(0, 400)}`,
        language,
      });
      failed++;
    }
  }

  return json({ sent, failed, skipped, total: rows.length });
});

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

interface LogUpdate {
  status: "sent" | "failed";
  error?: string;
  language?: string;
  sent_at?: string;
  resend_id?: string | null;
}

async function markLog(
  supabase: ReturnType<typeof getSupabaseClient>,
  log_id: number,
  patch: LogUpdate,
) {
  const { error } = await supabase
    .from("retention_email_log")
    .update(patch)
    .eq("id", log_id);
  if (error) console.error(`log ${log_id} 업데이트 실패:`, error.message);
}

function appendUtm(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
