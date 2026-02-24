import nodemailer from "npm:nodemailer@6.9.10";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { COMMON_CONFIG, SEND_CONFIG, getEmailContent, DEFAULT_LANGUAGE } from "../_shared/config.ts";
import { renderTemplate } from "../_shared/template.ts";


interface QueueRow {
  id: number;
  recipient_email: string;
  recipient_name: string | null;
  unsubscribe_token: string | null;
  subject: string;
  language: string | null;
}

Deno.serve(async (_req) => {
  const supabase = getSupabaseClient();
  const gmailAddress = Deno.env.get("GMAIL_ADDRESS");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailAddress || !gmailPassword) {
    return new Response(
      JSON.stringify({ error: "GMAIL 인증 정보 미설정" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // 크래시된 잠금 복구
    await supabase.rpc("recover_stale_email_locks");

    // 대기 중인 이메일 원자적 선택 + 잠금
    const { data: emails, error: pickError } = await supabase.rpc(
      "pick_pending_emails",
      { batch_limit: SEND_CONFIG.BATCH_SIZE },
    );

    if (pickError) {
      console.error("큐 조회 실패:", pickError.message);
      return new Response(JSON.stringify({ error: pickError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, message: "큐 비어있음" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // SMTP transport 생성 (포트 465, implicit TLS)
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailAddress, pass: gmailPassword },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    // SMTP 연결 확인
    try {
      await transporter.verify();
    } catch (authErr) {
      console.error("SMTP 인증 실패:", authErr);
      // 모든 선택된 이메일을 auth_failed로 처리
      const ids = (emails as QueueRow[]).map((e) => e.id);
      await supabase
        .from("email_queue")
        .update({ status: "auth_failed", error: String(authErr) })
        .in("id", ids);

      return new Response(
        JSON.stringify({ error: "SMTP 인증 실패", auth_error: true }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    let failed = 0;
    const processedIds = new Set<number>();

    for (const row of emails as QueueRow[]) {
      try {
        // 언어별 콘텐츠 가져오기
        const content = getEmailContent(row.language || DEFAULT_LANGUAGE);

        // 수신거부 URL 생성
        const unsubscribeUrl =
          `${COMMON_CONFIG.unsubscribe_base_url}?token=${row.unsubscribe_token || ""}`;

        // 본문 줄바꿈을 HTML <br>로 변환
        const bodyHtml = content.body.replace(/\n/g, "<br>");

        // 수신거부 안내문의 {{brand_name}} 치환
        const unsubscribeNotice = content.unsubscribe_notice.replaceAll("{{brand_name}}", COMMON_CONFIG.brand_name);

        // HTML 렌더링
        const html = renderTemplate({
          brand_name: COMMON_CONFIG.brand_name,
          greeting: content.greeting,
          body: bodyHtml,
          cta_text: content.cta_text,
          cta_url: COMMON_CONFIG.cta_url,
          streak_count: COMMON_CONFIG.streak_count,
          unsubscribe_url: unsubscribeUrl,
          unsubscribe_notice: unsubscribeNotice,
          unsubscribe_text: content.unsubscribe_text,
          social_instagram: COMMON_CONFIG.social_instagram,
          social_twitter: COMMON_CONFIG.social_twitter,
          social_facebook: COMMON_CONFIG.social_facebook,
          social_tiktok: COMMON_CONFIG.social_tiktok,
        });

        // 이메일 발송
        await transporter.sendMail({
          from: gmailAddress,
          to: row.recipient_email,
          subject: row.subject,
          html,
          headers: {
            "List-Unsubscribe":
              `<${unsubscribeUrl}>, <mailto:${gmailAddress}?subject=unsubscribe>`,
          },
        });

        // 성공 처리
        await supabase
          .from("email_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);

        processedIds.add(row.id);
        sent++;
        console.log(`발송 성공: ${row.recipient_email}`);

        // Gmail 속도 제한 방지: 발송 간 1초 딜레이
        await new Promise((r) => setTimeout(r, 1000));
      } catch (sendErr: unknown) {
        const errObj = sendErr as { code?: string; responseCode?: number };

        // 인증 에러 → 전체 중단
        if (
          errObj.code === "EAUTH" ||
          errObj.responseCode === 535
        ) {
          console.error("인증 실패, 전체 중단:", sendErr);
          // 남은 미처리 이메일들만 auth_failed 처리 (이미 sent/failed된 건 제외)
          const remainingIds = (emails as QueueRow[])
            .filter((e) => e.id !== row.id && !processedIds.has(e.id))
            .map((e) => e.id);

          if (remainingIds.length > 0) {
            await supabase
              .from("email_queue")
              .update({ status: "auth_failed", error: String(sendErr) })
              .in("id", remainingIds);
          }

          await supabase
            .from("email_queue")
            .update({ status: "auth_failed", error: String(sendErr) })
            .eq("id", row.id);

          transporter.close();
          return new Response(
            JSON.stringify({ sent, failed, auth_error: true }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        // Gmail 속도 제한 (421/550) → 남은 이메일 pending으로 되돌리고 중단
        if (
          errObj.responseCode === 421 ||
          errObj.responseCode === 550
        ) {
          console.error("Gmail 속도 제한 감지, 중단:", sendErr);
          const remainingIds = (emails as QueueRow[])
            .filter((e) => e.id !== row.id && !processedIds.has(e.id))
            .map((e) => e.id);

          if (remainingIds.length > 0) {
            await supabase
              .from("email_queue")
              .update({ status: "pending", locked_at: null })
              .in("id", remainingIds);
          }

          await supabase
            .from("email_queue")
            .update({ status: "failed", error: String(sendErr) })
            .eq("id", row.id);

          transporter.close();
          return new Response(
            JSON.stringify({ sent, failed: failed + 1, rate_limited: true }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

        // 개별 실패 → 계속 진행
        console.error(`발송 실패: ${row.recipient_email} -`, sendErr);
        await supabase
          .from("email_queue")
          .update({ status: "failed", error: String(sendErr) })
          .eq("id", row.id);

        processedIds.add(row.id);
        failed++;
      }
    }

    transporter.close();
    console.log(`발송 완료 - 성공: ${sent}, 실패: ${failed}`);
    return new Response(
      JSON.stringify({ sent, failed, total: (emails as QueueRow[]).length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("예상치 못한 오류:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
