import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { getEmailContent } from "../_shared/config.ts";
import { getLanguageFromTimezone } from "../_shared/timezone-mapping.ts";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

Deno.serve(async (_req) => {
  try {
    const supabase = getSupabaseClient();

    // 24~48시간 전 범위 계산
    const now = new Date();
    const time48hAgo = new Date(
      now.getTime() - 48 * 60 * 60 * 1000,
    ).toISOString();
    const time24hAgo = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();

    // 가입 후 24~48시간 사이 유저 조회 (뷰: auth.users + user_profiles + email_unsubscribes)
    const { data: users, error: usersError } = await supabase
      .from("email_eligible_users")
      .select("user_id, email, display_name, unsubscribe_token, created_at, timezone")
      .gte("created_at", time48hAgo)
      .lt("created_at", time24hAgo);

    if (usersError) {
      console.error("유저 조회 실패:", usersError.message);
      return new Response(JSON.stringify({ error: usersError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!users || users.length === 0) {
      console.log("발송 대상 유저 없음");
      return new Response(
        JSON.stringify({ enqueued: 0, message: "발송 대상 유저 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 이메일 검증 + 중복 제거
    const seenEmails = new Set<string>();
    const validUsers: typeof users = [];

    for (const user of users) {
      if (!EMAIL_REGEX.test(user.email)) {
        console.warn(`유효하지 않은 이메일 건너뜀: ${user.email}`);
        continue;
      }
      if (seenEmails.has(user.email)) {
        console.warn(`중복 이메일 건너뜀: ${user.email}`);
        continue;
      }
      seenEmails.add(user.email);
      validUsers.push(user);
    }

    if (validUsers.length === 0) {
      return new Response(
        JSON.stringify({ enqueued: 0, message: "유효한 수신자 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 이미 큐에 있는 이메일 중복 체크
    const { data: existingQueue } = await supabase
      .from("email_queue")
      .select("recipient_email");

    const alreadyQueued = new Set(
      (existingQueue || []).map(
        (row: { recipient_email: string }) => row.recipient_email,
      ),
    );

    // 큐에 삽입할 데이터 준비
    const toEnqueue = [];
    const errors: string[] = [];

    for (const user of validUsers) {
      if (alreadyQueued.has(user.email)) {
        console.log(`이미 큐에 있음, 건너뜀: ${user.email}`);
        continue;
      }

      // unsubscribe_token 없으면 email_unsubscribes에 생성
      let token = user.unsubscribe_token;
      if (!token) {
        const { data: newToken, error: tokenError } = await supabase
          .rpc("ensure_unsubscribe_token", { p_user_id: user.user_id });

        if (tokenError) {
          console.warn(
            `${user.email} 토큰 생성 실패: ${tokenError.message}`,
          );
          errors.push(`${user.email}: 토큰 생성 실패`);
        } else {
          token = newToken;
        }
      }

      // timezone 기반 언어 결정
      const language = getLanguageFromTimezone(user.timezone);

      // 해당 언어 subject 개인화
      const subjectTemplate = getEmailContent(language).subject;
      let subject: string;
      if (user.display_name) {
        subject = subjectTemplate.replace("{name}", user.display_name);
      } else {
        subject = subjectTemplate.replace(/\{name\}[,،、님さん፣၊ ]*\s*/u, "").trim();
      }

      toEnqueue.push({
        recipient_email: user.email,
        recipient_name: user.display_name || null,
        unsubscribe_token: token,
        subject,
        language,
      });
    }

    if (toEnqueue.length === 0) {
      return new Response(
        JSON.stringify({ enqueued: 0, message: "모두 이미 큐에 존재" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 일괄 삽입
    const { error: insertError } = await supabase
      .from("email_queue")
      .insert(toEnqueue);

    if (insertError) {
      console.error("큐 삽입 실패:", insertError.message);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`${toEnqueue.length}명 큐에 삽입 완료`);
    return new Response(
      JSON.stringify({
        enqueued: toEnqueue.length,
        skipped: validUsers.length - toEnqueue.length,
        errors,
      }),
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
