
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("WEBHOOK_SECRET");

  if (!expected || req.headers.get("x-webhook-secret") !== expected)
    return json({ error: "Unauthorized" }, 401);

  const appId = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!appId || !apiKey || !supabaseUrl || !serviceKey)
    return json({ error: "Missing server configuration" }, 500);

  try {
    const event = await req.json();
    const incoming = event?.record;

    if (event?.type !== "INSERT" || !incoming?.id)
      return json({ skipped: true });

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: friendRequest, error: friendError } =
      await supabase
        .from("friend_requests")
        .select("id,sender_id,recipient_id,status")
        .eq("id", incoming.id)
        .maybeSingle();

    if (friendError) throw friendError;

    if (!friendRequest || friendRequest.status !== "pending")
      return json({ skipped: true });

    const { data: sender, error: senderError } =
      await supabase
        .from("profiles")
        .select("username")
        .eq("id", friendRequest.sender_id)
        .maybeSingle();

    if (senderError) throw senderError;

    const notification = {
      app_id: appId,
      include_aliases: {
        external_id: [friendRequest.recipient_id]
      },
      target_channel: "push",
      headings: {
        fr: "🤝 Nouvelle demande d'ami !",
        en: "New friend request!"
      },
      contents: {
        fr: `${sender?.username ?? "Un joueur"} souhaite devenir ton ami sur WikiVerse !`,
        en: "You have a new friend request on WikiVerse!"
      },
      url: "https://yoxxxxprog.github.io/WikiVerse/",
      idempotency_key: friendRequest.id
    };

    const response = await fetch(
      "https://api.onesignal.com/notifications",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${apiKey}`
        },
        body: JSON.stringify(notification)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error(
        "OneSignal rejected notification",
        response.status,
        result
      );

      return json({
        error: "OneSignal rejected notification",
        status: response.status
      }, 502);
    }

    return json({
      sent: true,
      notification_id: result.id ?? null
    });

  } catch (error) {
    console.error("Notification processing failed", error);

    return json({
      error: "Notification processing failed"
    }, 500);
  }
});
