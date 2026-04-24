// 프리뷰 전용 — 실제 리텐션 템플릿을 day/language 바꿔가며 테스트
// body 옵션:
//   to       : 수신자 (기본 jake@kokoai.im)
//   day      : 1 | 3 | 7 | 14 | "all" (기본 "all" → 4통 모두 발송)
//   language : English | Korean | Japanese | Chinese | Spanish | German | French (기본 Korean)
//   name     : 이름 placeholder (기본 Jake)
//
// 예: {"to":"jake@kokoai.im","language":"Korean"}            → 4통 모두
//     {"to":"jake@kokoai.im","day":3,"language":"English"}   → D+3 한 통

import {
  BUSINESS_INFO,
  COMMON_CONFIG,
  getEmailContent,
  SUPPORTED_LANGUAGES,
  type RetentionDay,
  type SupportedLanguage,
} from "../_shared/config.ts";
import { renderTemplate } from "../_shared/template.ts";

const VALID_DAYS: readonly number[] = [1, 3, 7, 14];
const NAME_CLEANUP = /\{name\}[,،、님さん!¡\s]*/u;

Deno.serve(async (req) => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") ?? "hello@kokoai.im";

  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY 미설정" }, 500);
  }

  // 기본값
  let to = "jake@kokoai.im";
  let daysToSend: RetentionDay[] = [1, 3, 7, 14]; // 기본 전체
  let language: SupportedLanguage = "Korean";
  let userName: string | null = "Jake";

  try {
    const body = await req.json();
    if (typeof body?.to === "string") to = body.to;
    if (body?.day === "all") {
      daysToSend = [1, 3, 7, 14];
    } else if (VALID_DAYS.includes(body?.day)) {
      daysToSend = [body.day as RetentionDay];
    }
    if (
      typeof body?.language === "string" &&
      (SUPPORTED_LANGUAGES as readonly string[]).includes(body.language)
    ) {
      language = body.language as SupportedLanguage;
    }
    if (typeof body?.name === "string") userName = body.name;
    if (body?.name === null || body?.name === "") userName = null;
  } catch (_) {
    // body 없어도 기본값으로 진행
  }

  const results: Array<Record<string, unknown>> = [];

  for (const day of daysToSend) {
    const content = getEmailContent(language, day);

    const subject = userName
      ? content.subject.replace("{name}", userName)
      : content.subject.replace(NAME_CLEANUP, "").trim();

    const bodyHtml = content.body.replaceAll("\n", "<br>");
    const unsubscribeNotice = content.unsubscribe_notice.replaceAll(
      "{{brand_name}}",
      COMMON_CONFIG.brand_name,
    );

    const fakeToken = "preview-token-not-real";
    const unsubscribeUrl =
      `${COMMON_CONFIG.unsubscribe_base_url}?token=${fakeToken}`;
    const ctaUrl = (() => {
      const u = new URL(COMMON_CONFIG.cta_url);
      u.searchParams.set("utm_source", "retention_email");
      u.searchParams.set("utm_medium", "email");
      u.searchParams.set("utm_campaign", `d${day}`);
      u.searchParams.set("utm_content", language.toLowerCase());
      u.searchParams.set("preview", "1");
      return u.toString();
    })();

    const html = renderTemplate({
      brand_name: COMMON_CONFIG.brand_name,
      greeting: content.greeting,
      body: bodyHtml,
      cta_text: content.cta_text,
      cta_url: ctaUrl,
      hero_image_url: content.hero_image_url,
      streak_count: 0,
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

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${COMMON_CONFIG.brand_name} <${fromEmail}>`,
        to: [to],
        reply_to: COMMON_CONFIG.reply_to_email,
        subject: `[PREVIEW D+${day} ${language}] ${subject}`,
        html,
      }),
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    results.push({ day, ok: res.ok, status: res.status, resend: data });

    // Resend 속도 제한 회피: 발송 간 짧은 딜레이
    await new Promise((r) => setTimeout(r, 300));
  }

  const allOk = results.every((r) => r.ok);

  return json(
    {
      ok: allOk,
      preview: { language, name: userName, days: daysToSend },
      results,
      sent_to: to,
      from: fromEmail,
    },
    allOk ? 200 : 207, // 207 Multi-Status if partial failure
  );
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
