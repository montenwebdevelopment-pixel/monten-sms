import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OWNER_USER_ID = "6c8f806f-117f-49b7-ae2d-88021b8e44ce"; // montensms@gmail.com
const OWNER_EMAIL = "montensms@gmail.com";
const BUCKET = "app-downloads";
const APK_PATH = "monten-sms.apk";
const MIN_BYTES = 1_000_000;
const MAX_BYTES = 100_000_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Unauthorized" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !userData.user) return json(401, { error: "Invalid session" });

  const isOwner =
    userData.user.id === OWNER_USER_ID &&
    (userData.user.email ?? "").toLowerCase() === OWNER_EMAIL;
  if (!isOwner) return json(403, { error: "Not authorized" });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) {
    return json(400, {
      error: `File must be between 1 MB and 100 MB. Received ${(bytes.length / 1_000_000).toFixed(1)} MB.`,
    });
  }

  // APKs are ZIP archives; verify the ZIP local-file-header magic bytes.
  const isZip =
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
  if (!isZip) return json(400, { error: "This file is not a valid Android APK." });

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(APK_PATH, bytes, {
    contentType: "application/vnd.android.package-archive",
    upsert: true,
  });
  if (uploadError) return json(500, { error: `Storage upload failed: ${uploadError.message}` });

  return json(200, { ok: true, size: bytes.length });
});
