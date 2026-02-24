import { getSupabaseClient } from "../_shared/supabase-client.ts";

const UNSUBSCRIBE_PAGE =
  "https://jaeone3.github.io/email-unsubscribe/unsubscribe.html";

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return Response.redirect(UNSUBSCRIBE_PAGE, 302);
  }

  try {
    const supabase = getSupabaseClient();

    const { data, error: selectError } = await supabase
      .from("email_unsubscribes")
      .select("id, unsubscribed")
      .eq("unsubscribe_token", token)
      .single();

    if (selectError || !data) {
      return Response.redirect(UNSUBSCRIBE_PAGE, 302);
    }

    // 이미 수신거부된 경우도 같은 페이지로
    if (!data.unsubscribed) {
      const { error: updateError } = await supabase
        .from("email_unsubscribes")
        .update({
          unsubscribed: true,
          unsubscribed_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      if (updateError) {
        console.error("unsubscribe update failed:", updateError.message);
      }
    }

    return Response.redirect(UNSUBSCRIBE_PAGE, 302);
  } catch (err) {
    console.error("unexpected error:", err);
    return Response.redirect(UNSUBSCRIBE_PAGE, 302);
  }
});
