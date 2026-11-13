import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { redactSensitiveText } from "../_shared/sensitive-text.mjs";

// Super Admin Portal API. Every request must present a valid Supabase access
// token belonging to ADMIN_EMAIL. All data is read/written with service_role
// after that server-side check; the browser never queries admin tables
// directly. Sensitive actions are written to admin_audit_logs.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_EMAIL = "montensms@gmail.com";
const RATE_LIMIT = 120; // requests
const RATE_WINDOW_MS = 60_000;
const APP_RELEASE_BUCKET = "app-release-files";
const APP_RELEASE_MAX_BYTES = 100 * 1024 * 1024;

interface Auth {
  userId: string;
  email: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function authenticate(req: Request, admin: ReturnType<typeof adminClient>): Promise<Auth | null> {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const token = header.replace("Bearer ", "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const email = (data.user.email ?? "").toLowerCase();
  if (email !== ADMIN_EMAIL) return null;
  return { userId: data.user.id, email };
}

async function rateLimit(admin: ReturnType<typeof adminClient>, key: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin.from("rate_limits").select("*", { count: "exact", head: true }).eq("user_id", key).eq("endpoint", "admin-api").gte("created_at", since);
  if (count !== null && count >= RATE_LIMIT) return false;
  await admin.from("rate_limits").insert({ user_id: key, endpoint: "admin-api" });
  return true;
}

async function audit(admin: ReturnType<typeof adminClient>, email: string, action: string, targetType?: string, targetId?: string, details?: unknown) {
  await admin.from("admin_audit_logs").insert({
    admin_email: email,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details: details ?? null,
  });
}

function validId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function appFileType(fileName: string): "apk" | "aab" | null {
  const extension = fileName.toLowerCase().split(".").pop();
  return extension === "apk" || extension === "aab" ? extension : null;
}

function safeAppFileName(fileName: string): string {
  const basename = fileName.split(/[\\/]/).pop() ?? "";
  return basename.normalize("NFKC").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
}

function appText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

async function appManagement(admin: ReturnType<typeof adminClient>): Promise<Response> {
  const [releasesResult, configResult] = await Promise.all([
    admin.from("app_releases").select("*").order("created_at", { ascending: false }),
    admin.from("app_release_config").select("*").eq("id", "default").single(),
  ]);
  if (releasesResult.error) return fail(500, "Could not load app release history.");
  if (configResult.error) return fail(500, "Could not load app configuration.");
  return json({ releases: releasesResult.data ?? [], config: configResult.data });
}

async function createAppUploadUrl(admin: ReturnType<typeof adminClient>, auth: Auth, body: any): Promise<Response> {
  const fileName = appText(body?.fileName, 255);
  const fileSize = Number(body?.fileSize);
  const fileType = fileName ? appFileType(fileName) : null;
  if (!fileName || /[\\/]/.test(fileName) || /[\u0000-\u001f\u007f]/.test(fileName)) return fail(400, "A valid file name is required.");
  if (!fileType) return fail(400, "Only .apk and .aab Android release files are accepted.");
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > APP_RELEASE_MAX_BYTES) return fail(400, "File size must be between 1 byte and 100 MB.");

  const safeName = safeAppFileName(fileName);
  if (!safeName || appFileType(safeName) !== fileType) return fail(400, "The file name is not supported.");
  const path = `incoming/${crypto.randomUUID()}/${safeName}`;
  const { data, error } = await admin.storage.from(APP_RELEASE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[admin-api] app release upload URL failed:", error?.message);
    return fail(500, "Could not prepare secure app file upload.");
  }
  await audit(admin, auth.email, "create_app_release_upload", "app_releases", undefined, { file_name: fileName, file_type: fileType, file_size: fileSize });
  return json({ path: data.path, token: data.token, signedUrl: data.signedUrl });
}

async function validateAppFileSignature(admin: ReturnType<typeof adminClient>, path: string): Promise<boolean> {
  const storage = admin.storage.from(APP_RELEASE_BUCKET);
  const { data, error } = await storage.createSignedUrl(path, 60);
  if (error || !data) return false;
  const response = await fetch(data.signedUrl, { headers: { Range: "bytes=0-3" } });
  if (!response.ok || !response.body) return false;
  const reader = response.body.getReader();
  const firstBytes = new Uint8Array(4);
  let written = 0;
  try {
    while (written < firstBytes.length) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const count = Math.min(value.length, firstBytes.length - written);
      firstBytes.set(value.subarray(0, count), written);
      written += count;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return written === 4 &&
    firstBytes[0] === 0x50 && firstBytes[1] === 0x4b &&
    firstBytes[2] === 0x03 && firstBytes[3] === 0x04;
}

async function completeAppUpload(admin: ReturnType<typeof adminClient>, auth: Auth, body: any): Promise<Response> {
  const path = typeof body?.path === "string" ? body.path : "";
  const fileName = appText(body?.fileName, 255);
  const fileType = fileName ? appFileType(fileName) : null;
  const fileSize = Number(body?.fileSize);
  const safeName = fileName ? safeAppFileName(fileName) : "";
  const pathMatch = /^incoming\/[0-9a-f-]{36}\/([A-Za-z0-9._-]{1,120})$/i.exec(path);
  if (!pathMatch || !fileName || !fileType || pathMatch[1] !== safeName) return fail(400, "Invalid upload reference or file name.");
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > APP_RELEASE_MAX_BYTES) return fail(400, "Invalid uploaded file size.");

  const appName = appText(body?.appName, 100);
  const versionName = appText(body?.versionName, 64);
  const versionCode = appText(body?.versionCode ?? "", 32);
  const packageName = appText(body?.packageName, 255);
  const description = appText(body?.description ?? "", 4000);
  const releaseNotes = appText(body?.releaseNotes ?? "", 8000);
  if (!appName || !versionName || !packageName || versionCode === null || description === null || releaseNotes === null) {
    return fail(400, "App name, version and package name are required; text fields must be within their size limits.");
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) return fail(400, "Enter a valid Android package name.");

  const folder = path.slice(0, path.lastIndexOf("/"));
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const { data: objects, error: listError } = await admin.storage.from(APP_RELEASE_BUCKET).list(folder, { limit: 10, search: leaf });
  if (listError) return fail(500, "Could not verify the uploaded file in private storage.");
  const object = (objects ?? []).find((item: any) => item.name === leaf);
  const storedSize = Number(object?.metadata?.size);
  if (!object || !Number.isSafeInteger(storedSize) || storedSize !== fileSize) return fail(400, "Uploaded file is missing or its size does not match.");
  if (!await validateAppFileSignature(admin, path)) {
    await admin.storage.from(APP_RELEASE_BUCKET).remove([path]);
    return fail(400, "The uploaded file is not a valid Android ZIP archive.");
  }

  const { data, error } = await admin.from("app_releases").insert({
    app_name: appName,
    version_name: versionName,
    version_code: versionCode ?? "",
    package_name: packageName,
    description: description ?? "",
    release_notes: releaseNotes ?? "",
    file_name: fileName,
    file_type: fileType,
    storage_path: path,
    file_size: storedSize,
    status: "draft",
    created_by: auth.email,
  }).select("*").single();
  if (error || !data) {
    await admin.storage.from(APP_RELEASE_BUCKET).remove([path]);
    console.error("[admin-api] app release draft insert failed:", error?.message);
    return fail(500, "Upload validated, but the release draft could not be saved.");
  }
  await audit(admin, auth.email, "create_app_release_draft", "app_releases", data.id, { file_type: fileType, file_size: storedSize, version_name: versionName });
  return json({ release: data });
}

async function saveAppReleaseDraft(admin: ReturnType<typeof adminClient>, auth: Auth, body: any): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!validId(id)) return fail(400, "Invalid release id.");
  const appName = appText(body?.appName, 100);
  const versionName = appText(body?.versionName, 64);
  const versionCode = appText(body?.versionCode ?? "", 32);
  const packageName = appText(body?.packageName, 255);
  const description = appText(body?.description ?? "", 4000);
  const releaseNotes = appText(body?.releaseNotes ?? "", 8000);
  if (!appName || !versionName || !packageName || versionCode === null || description === null || releaseNotes === null) return fail(400, "App name, version and package name are required; text fields must be within their size limits.");
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) return fail(400, "Enter a valid Android package name.");
  const { data, error } = await admin.from("app_releases").update({
    app_name: appName,
    version_name: versionName,
    version_code: versionCode ?? "",
    package_name: packageName,
    description: description ?? "",
    release_notes: releaseNotes ?? "",
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "draft").select("id").maybeSingle();
  if (error) return fail(500, "Could not save this app release draft.");
  if (!data) return fail(404, "Draft not found; published releases cannot be edited.");
  await audit(admin, auth.email, "update_app_release_draft", "app_releases", id);
  return json({ ok: true });
}

async function saveAppReleaseConfig(admin: ReturnType<typeof adminClient>, auth: Auth, body: any): Promise<Response> {
  const appName = appText(body?.appName, 100);
  const downloadUrl = appText(body?.downloadUrl ?? "", 2048);
  const updateInfo = appText(body?.updateInfo ?? "", 4000);
  const minimumVersion = appText(body?.minimumVersion ?? "", 64);
  if (!appName || downloadUrl === null || updateInfo === null || minimumVersion === null || typeof body?.forceUpdate !== "boolean") {
    return fail(400, "Invalid app configuration. Check required fields and length limits.");
  }
  if (downloadUrl) {
    try {
      const parsed = new URL(downloadUrl);
      if (parsed.protocol !== "https:") return fail(400, "Download and store links must use HTTPS.");
    } catch {
      return fail(400, "Enter a valid download or store URL.");
    }
  }
  const { error } = await admin.from("app_release_config").update({
    app_name: appName,
    download_url: downloadUrl,
    update_info: updateInfo,
    minimum_version: minimumVersion,
    force_update: body.forceUpdate,
    updated_at: new Date().toISOString(),
  }).eq("id", "default");
  if (error) return fail(500, "Could not save app configuration.");
  await audit(admin, auth.email, "update_app_release_config", "app_release_config", "default");
  return json({ ok: true });
}

async function publishAppRelease(admin: ReturnType<typeof adminClient>, auth: Auth, body: any): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!validId(id)) return fail(400, "Invalid release id.");
  const { data: release, error: readError } = await admin.from("app_releases").select("id,status,version_name,package_name").eq("id", id).maybeSingle();
  if (readError) return fail(500, "Could not verify the selected release.");
  if (!release || release.status !== "draft") return fail(404, "Draft not found or it has already been published.");
  if (!release.version_name || !release.package_name) return fail(400, "Release version and package name are required before publishing.");
  const { data, error } = await admin.rpc("publish_app_release", { p_release_id: id });
  if (error || !data) return fail(400, error?.message ?? "Could not publish this release.");
  await audit(admin, auth.email, "publish_app_release", "app_releases", id, { version_name: release.version_name, package_name: release.package_name });
  return json({ release: data });
}

async function deleteAppReleaseDraft(admin: ReturnType<typeof adminClient>, auth: Auth, id: string): Promise<Response> {
  if (!validId(id)) return fail(400, "Invalid release id.");
  const { data: release, error: readError } = await admin.from("app_releases").select("id,status,storage_path").eq("id", id).maybeSingle();
  if (readError) return fail(500, "Could not load the app release.");
  if (!release) return fail(404, "Release not found.");
  if (release.status !== "draft") return fail(400, "Published release files cannot be deleted here.");
  const { error: storageError } = await admin.storage.from(APP_RELEASE_BUCKET).remove([release.storage_path]);
  if (storageError) return fail(500, "Could not remove the private release file.");
  const { error } = await admin.from("app_releases").delete().eq("id", id).eq("status", "draft");
  if (error) return fail(500, "The file was removed, but the draft record could not be deleted.");
  await audit(admin, auth.email, "delete_app_release_draft", "app_releases", id);
  return json({ ok: true });
}

async function appReleaseDownload(admin: ReturnType<typeof adminClient>, id: string): Promise<Response> {
  if (!validId(id)) return fail(400, "Invalid release id.");
  const { data: release, error } = await admin.from("app_releases").select("storage_path,status,file_type").eq("id", id).maybeSingle();
  if (error) return fail(500, "Could not load the published app file.");
  if (!release || release.status !== "published") return fail(404, "Published app file not found.");
  const { data, error: signError } = await admin.storage.from(APP_RELEASE_BUCKET).createSignedUrl(release.storage_path, 300, { download: true });
  if (signError || !data) return fail(500, "Could not create a secure download link.");
  return json({ signedUrl: data.signedUrl, fileType: release.file_type, expiresInSeconds: 300 });
}

// ---------- endpoint helpers ----------

function dayStart(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function weekStart(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function monthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function count(admin: any, table: string, filters: Record<string, string> = {}, since?: string): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function overview(admin: any) {
  const [users, today, week, month, txTotal, txSuccess, txPending, txFailed,
    depTotal, depSuccess, depPending, depFailed, numbers, numbersSuccess,
    emailOrders, emailSuccess, emailWaiting, emailFailed, tickets, openTickets] = await Promise.all([
    count(admin, "profiles"),
    count(admin, "profiles", {}, dayStart()),
    count(admin, "profiles", {}, weekStart()),
    count(admin, "profiles", {}, monthStart()),
    count(admin, "transactions"),
    count(admin, "transactions", { type: "purchase", status: "completed" }),
    count(admin, "transactions", { type: "deposit", status: "pending" }),
    count(admin, "transactions", { status: "failed" }),
    count(admin, "transactions", { type: "deposit" }),
    count(admin, "transactions", { type: "deposit", status: "completed" }),
    count(admin, "transactions", { type: "deposit", status: "pending" }),
    count(admin, "transactions", { type: "deposit", status: "failed" }),
    count(admin, "purchased_numbers"),
    count(admin, "purchased_numbers", { status: "received" }),
    count(admin, "email_otp_orders"),
    count(admin, "email_otp_orders", { status: "received" }),
    count(admin, "email_otp_orders", { status: "waiting" }),
    count(admin, "email_otp_orders", { status: "failed" }),
    count(admin, "support_tickets"),
    count(admin, "support_tickets", { status: "open" }),
  ]);

  // Revenue: actual successful purchases (phone + email) in naira.
  const [revNum, revEmail] = await Promise.all([
    admin.from("purchased_numbers").select("selling_price").eq("status", "received"),
    admin.from("email_otp_orders").select("charge_naira").eq("status", "received"),
  ]);
  const revenue =
    (revNum.data ?? []).reduce((s: number, r: any) => s + Number(r.selling_price ?? 0), 0) +
    (revEmail.data ?? []).reduce((s: number, r: any) => s + Number(r.charge_naira ?? 0), 0);

  const deposits = await admin.from("transactions").select("amount").eq("type", "deposit").eq("status", "completed");
  const depositTotal = (deposits.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  const wallets = await admin.from("profiles").select("wallet_balance");
  const walletTotal = (wallets.data ?? []).reduce((s: number, r: any) => s + Number(r.wallet_balance ?? 0), 0);

  const [{ count: logins }, { count: uniqueLogins }] = await Promise.all([
    count(admin, "login_activity", { event_type: "login" }),
    admin.from("login_activity").select("user_id", { count: "exact", head: true }).eq("event_type", "login").not("user_id", "is", null),
  ]);

  return json({
    users: { total: users, today, week, month },
    logins: { totalEvents: logins ?? 0, uniqueUsers: uniqueLogins ?? 0 },
    numbers: { total: numbers, success: numbersSuccess },
    emailOrders: { total: emailOrders, success: emailSuccess, waiting: emailWaiting, failed: emailFailed },
    payments: { deposits: depTotal, depositsSuccess: depSuccess, depositsPending: depPending, depositsFailed: depFailed,
      purchases: txTotal, purchasesSuccess: txSuccess, pending: txPending, failed: txFailed },
    revenue,
    depositTotal,
    walletTotal,
    tickets: { total: tickets, open: openTickets },
  });
}

async function chart(admin: any, table: string, days: number, extra: Record<string, string> = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let q = admin.from(table).select("created_at").gte("created_at", since);
  for (const [c, v] of Object.entries(extra)) q = q.eq(c, v);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const row of data ?? []) buckets[(row.created_at as string).slice(0, 10)] = (buckets[(row.created_at as string).slice(0, 10)] ?? 0) + 1;
  return json({ series: Object.entries(buckets).map(([date, n]) => ({ date, n })) });
}

function search(q: URLSearchParams, fields: string[]): string | null {
  const term = q.get("search")?.trim();
  if (!term) return null;
  // Only allowlisted characters reach the DB; Supabase client escapes values.
  const safe = term.replace(/[%_,()]/g, "").trim();
  if (!safe) return null;
  return `${fields.map((f) => `${f}.ilike.*${safe}*`).join(",")}`;
}

function pagination(q: URLSearchParams) {
  const page = Math.max(1, parseInt(q.get("page") ?? "1", 10) || 1);
  const size = Math.min(100, Math.max(10, parseInt(q.get("pageSize") ?? "25", 10) || 25));
  return { from: (page - 1) * size, to: page * size - 1, page, size };
}

async function usersEndpoint(admin: any, q: URLSearchParams) {
  const { from, to } = pagination(q);
  const match = search(q, ["full_name", "email"]);
  // profiles has no email column; email lives in auth.users. Use the FK:
  // query auth users via the admin API listUsers for email search, else join
  // through profiles' id FK using an rpc-free approach: fetch auth emails
  // first when searching by email.
  if (match) {
    const term = q.get("search")?.trim().replace(/[%_,()]/g, "") ?? "";
    const page = await admin.auth.listUsers({ page: 1, perPage: 500 });
    const ids = (page.users ?? [])
      .filter((u: any) => (u.email ?? "").toLowerCase().includes(term.toLowerCase()) || (u.user_metadata?.full_name ?? "").toLowerCase().includes(term.toLowerCase()))
      .map((u: any) => u.id);
    if (ids.length === 0) return json({ users: [], total: 0 });
    const { data, error, count } = await admin.from("profiles").select("*", { count: "exact" }).in("id", ids).order("created_at", { ascending: false }).range(from, to);
    if (error) throw new Error(error.message);
    return json({ users: data ?? [], total: count ?? 0 });
  }
  let base = admin.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false });
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  return json({ users: data ?? [], total: count ?? 0 });
}

async function userDetail(admin: any, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const [profile, authUser, txns, numbers, emailOrders, tickets, convos] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).maybeSingle(),
    admin.auth.admin.getUserById(id),
    admin.from("transactions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("purchased_numbers").select("id,service_name,country_name,status,selling_price,cost_price,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("email_otp_orders").select("id,service,email_address,status,charge_naira,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("support_tickets").select("id,case_ref,subject,status,priority,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("support_conversations").select("id,topic,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  const lastLogin = await admin.from("login_activity").select("created_at").eq("user_id", id).eq("event_type", "login").order("created_at", { ascending: false }).limit(1);
  return json({
    profile: profile.data,
    auth: authUser.data?.user ? { id: authUser.data.user.id, email: authUser.data.user.email, created_at: authUser.data.user.created_at, last_sign_in_at: authUser.data.user.last_sign_in_at, providers: authUser.data.user.app_metadata?.providers ?? [] } : null,
    transactions: txns.data ?? [],
    numbers: numbers.data ?? [],
    emailOrders: emailOrders.data ?? [],
    tickets: tickets.data ?? [],
    conversations: convos.data ?? [],
    lastLogin: lastLogin.data?.[0]?.created_at ?? null,
  });
}

async function loginActivity(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const type = q.get("type") ?? "";
  let base = admin.from("login_activity").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (type === "login" || type === "login_failed" || type === "logout") base = base.eq("event_type", type);
  const term = search(q, ["email"]);
  if (term) base = base.or(term);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const [{ count: totalEvents }, { data: uniq }, fails] = await Promise.all([
    count(admin, "login_activity", { event_type: "login" }),
    admin.from("login_activity").select("user_id").eq("event_type", "login").not("user_id", "is", null),
    count(admin, "login_activity", { event_type: "login_failed" }),
  ]);
  const uniqueUsers = new Set((uniq ?? []).map((r: any) => r.user_id)).size;
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: daily } = await admin.from("login_activity").select("created_at").gte("created_at", since30);
  const buckets: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) buckets[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
  for (const r of daily ?? []) buckets[(r.created_at as string).slice(0, 10)] = (buckets[(r.created_at as string).slice(0, 10)] ?? 0) + 1;
  return json({ events: data ?? [], total: count ?? 0, page, size,
    summary: { totalEvents: totalEvents ?? 0, uniqueUsers, failed: fails ?? 0, daily: Object.entries(buckets).map(([date, n]) => ({ date, n })) } });
}

async function otpOrders(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const status = q.get("status") ?? "";
  let base = admin.from("purchased_numbers").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  const term = q.get("search")?.trim().replace(/[%_,()]/g, "");
  if (term) {
    base = base.or(`fivesim_id.ilike.*${term}*,phone_number.ilike.*${term}*,service_name.ilike.*${term}*`);
  }
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  // Attach customer emails.
  const ids = [...new Set(rows.map((r: any) => r.user_id))];
  const emails = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin.from("profiles").select("id").in("id", ids);
    if (profs?.length) {
      const users = await Promise.all(profs.map((p: any) => admin.auth.admin.getUserById(p.id)));
      users.forEach((u: any, i: number) => emails.set(profs[i].id, u.data?.user?.email ?? ""));
    }
  }
  const [total, success, pending, failed, cancelled] = await Promise.all([
    count(admin, "purchased_numbers"),
    count(admin, "purchased_numbers", { status: "received" }),
    count(admin, "purchased_numbers", { status: "waiting" }),
    count(admin, "purchased_numbers", { status: "failed" }),
    count(admin, "purchased_numbers", { status: "cancelled" }),
  ]);
  return json({
    orders: rows.map((r: any) => ({ ...r, customer_email: emails.get(r.user_id) ?? "" })),
    total: count ?? 0, page, size,
    summary: { total, success, pending, failed, cancelled },
  });
}

async function emailOrders(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const status = q.get("status") ?? "";
  let base = admin.from("email_otp_orders").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  const term = q.get("search")?.trim().replace(/[%_,()]/g, "");
  if (term) base = base.or(`email_address.ilike.*${term}*,service.ilike.*${term}*`);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r: any) => r.user_id))];
  const emails = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin.from("profiles").select("id").in("id", ids);
    if (profs?.length) {
      const users = await Promise.all(profs.map((p: any) => admin.auth.admin.getUserById(p.id)));
      users.forEach((u: any, i: number) => emails.set(profs[i].id, u.data?.user?.email ?? ""));
    }
  }
  const [total, success, pending, failed, cancelled] = await Promise.all([
    count(admin, "email_otp_orders"),
    count(admin, "email_otp_orders", { status: "received" }),
    count(admin, "email_otp_orders", { status: "waiting" }),
    count(admin, "email_otp_orders", { status: "failed" }),
    count(admin, "email_otp_orders", { status: "cancelled" }),
  ]);
  return json({
    orders: rows.map((r: any) => ({ ...r, customer_email: emails.get(r.user_id) ?? "" })),
    total: count ?? 0, page, size,
    summary: { total, success, pending, failed, cancelled },
  });
}

async function wallet(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const status = q.get("status") ?? "";
  const type = q.get("type") ?? "";
  let base = admin.from("transactions").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  if (type && type !== "all") base = base.eq("type", type);
  const term = q.get("search")?.trim().replace(/[%_,()]/g, "");
  if (term) base = base.or(`reference.ilike.*${term}*,description.ilike.*${term}*`);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r: any) => r.user_id))];
  const emails = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin.from("profiles").select("id").in("id", ids);
    if (profs?.length) {
      const users = await Promise.all(profs.map((p: any) => admin.auth.admin.getUserById(p.id)));
      users.forEach((u: any, i: number) => emails.set(profs[i].id, u.data?.user?.email ?? ""));
    }
  }
  const [deposits, depSuccess, depPending, depFailed] = await Promise.all([
    count(admin, "transactions", { type: "deposit" }),
    count(admin, "transactions", { type: "deposit", status: "completed" }),
    count(admin, "transactions", { type: "deposit", status: "pending" }),
    count(admin, "transactions", { type: "deposit", status: "failed" }),
  ]);
  const depSum = await admin.from("transactions").select("amount").eq("type", "deposit").eq("status", "completed");
  const walletSum = await admin.from("profiles").select("wallet_balance");
  return json({
    transactions: rows.map((r: any) => ({ ...r, customer_email: emails.get(r.user_id) ?? "" })),
    total: count ?? 0, page, size,
    summary: {
      deposits: deposits ?? 0, depSuccess: depSuccess ?? 0, depPending: depPending ?? 0, depFailed: depFailed ?? 0,
      depositTotal: (depSum.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
      walletTotal: (walletSum.data ?? []).reduce((s: number, r: any) => s + Number(r.wallet_balance ?? 0), 0),
    },
  });
}

async function topCustomers(admin: any, q: URLSearchParams) {
  const period = q.get("period") ?? "all";
  let since: string | undefined;
  if (period === "today") since = dayStart();
  else if (period === "week") since = weekStart();
  else if (period === "month") since = monthStart();

  // Only successful, paid phone-number purchases count.
  let qy = admin.from("purchased_numbers").select("user_id, selling_price, created_at").eq("status", "received");
  if (since) qy = qy.gte("created_at", since);
  const { data, error } = await qy;
  if (error) throw new Error(error.message);

  const byUser = new Map<string, { count: number; spent: number; last: string }>();
  for (const r of data ?? []) {
    const cur = byUser.get(r.user_id) ?? { count: 0, spent: 0, last: "" };
    cur.count += 1;
    cur.spent += Number(r.selling_price ?? 0);
    if (!cur.last || r.created_at > cur.last) cur.last = r.created_at;
    byUser.set(r.user_id, cur);
  }
  const ranked = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count);
  const limit = q.get("limit") === "0" ? ranked.length : Math.min(ranked.length, parseInt(q.get("limit") ?? "10", 10) || 10);
  const slice = ranked.slice(0, limit);
  const ids = slice.map(([id]) => id);
  const profiles = ids.length ? await admin.from("profiles").select("id,full_name,wallet_balance,email_verified,created_at").in("id", ids) : { data: [] };
  const emails = new Map<string, any>();
  await Promise.all((profiles.data ?? []).map(async (p: any) => {
    const u = await admin.auth.admin.getUserById(p.id);
    emails.set(p.id, u.data?.user?.email ?? "");
  }));
  return json({
    customers: slice.map(([id, v], i) => {
      const p = (profiles.data ?? []).find((x: any) => x.id === id);
      return { rank: i + 1, id, name: p?.full_name ?? "", email: emails.get(id) ?? "", wallet: p?.wallet_balance ?? 0, email_verified: p?.email_verified ?? false, created_at: p?.created_at ?? null, ...v };
    }),
  });
}

async function tickets(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const status = q.get("status") ?? "";
  let base = admin.from("support_tickets").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  const term = q.get("search")?.trim().replace(/[%_,()]/g, "");
  if (term) base = base.or(`subject.ilike.*${term}*,case_ref.ilike.*${term}*,summary.ilike.*${term}*`);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r: any) => r.user_id))];
  const emails = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin.from("profiles").select("id").in("id", ids);
    if (profs?.length) {
      const users = await Promise.all(profs.map((p: any) => admin.auth.admin.getUserById(p.id)));
      users.forEach((u: any, i: number) => emails.set(profs[i].id, u.data?.user?.email ?? ""));
    }
  }
  const [total, open, pending, resolved] = await Promise.all([
    count(admin, "support_tickets"),
    count(admin, "support_tickets", { status: "open" }),
    count(admin, "support_tickets", { status: "pending" }),
    count(admin, "support_tickets", { status: "resolved" }),
  ]);
  return json({
    tickets: rows.map((r: any) => ({ ...r, customer_email: emails.get(r.user_id) ?? "" })),
    total: count ?? 0, page, size,
    summary: { total: total ?? 0, open: open ?? 0, pending: pending ?? 0, resolved: resolved ?? 0 },
  });
}

async function ticketDetail(admin: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { data: t } = await admin.from("support_tickets").select("*").eq("id", id).maybeSingle();
  if (!t) return fail(404, "ticket not found");
  const { data: msgs } = await admin.from("support_messages").select("*").eq("user_id", t.user_id).order("created_at", { ascending: true }).limit(200);
  const u = await admin.auth.admin.getUserById(t.user_id);
  return json({ ticket: t, messages: (msgs ?? []).map((m: any) => ({ ...m, content: redactSensitiveText(String(m.content ?? "")) })), customer_email: u.data?.user?.email ?? "" });
}

async function updateTicket(admin: any, id: string, body: any, auth: Auth): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const allowed = ["status", "priority"];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (typeof body[k] === "string") patch[k] = body[k];
  if (patch.status && !["open", "pending", "resolved", "closed"].includes(patch.status as string)) return fail(400, "invalid status");
  if (patch.priority && !["low", "medium", "high"].includes(patch.priority as string)) return fail(400, "invalid priority");
  const { error } = await admin.from("support_tickets").update(patch).eq("id", id);
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "update_ticket", "support_tickets", id, patch);
  return json({ ok: true });
}

async function replyTicket(admin: any, auth: Auth, body: any): Promise<Response> {
  const ticketId = typeof body?.ticket_id === "string" ? body.ticket_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return fail(400, "invalid ticket id");
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return fail(400, "message required");
  const { data: t } = await admin.from("support_tickets").select("user_id").eq("id", ticketId).maybeSingle();
  if (!t) return fail(404, "ticket not found");
  const { data: convo } = await admin.from("support_conversations").select("id").eq("user_id", t.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let convoId = convo?.id;
  if (!convoId) {
    const { data: created } = await admin.from("support_conversations").insert({ user_id: t.user_id, topic: "Support" }).select("id").single();
    convoId = created?.id;
  }
  const { error } = await admin.from("support_messages").insert({ conversation_id: convoId, user_id: t.user_id, role: "assistant", content: redactSensitiveText(message).slice(0, 4000), meta: { kind: "admin_reply" } });
  if (error) return fail(500, error.message);
  await admin.from("support_tickets").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", ticketId);
  await audit(admin, auth.email, "reply_ticket", "support_tickets", ticketId, { length: message.length });
  return json({ ok: true });
}

async function aiMonitoring(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const [{ data: convos, count: convoCount }, { data: msgs, count: msgCount }, { data: recent }] = await Promise.all([
    admin.from("support_conversations").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to),
    count(admin, "support_messages"),
    admin.from("support_messages").select("id,conversation_id,user_id,role,content,meta,created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const userIds = [...new Set((convos ?? []).map((c: any) => c.user_id))];
  const emails = new Map<string, string>();
  await Promise.all(userIds.map(async (uid) => {
    const u = await admin.auth.admin.getUserById(uid);
    emails.set(uid, u.data?.user?.email ?? "");
  }));
  const escalated = (recent ?? []).filter((m: any) => m.meta?.escalated).length;
  const aiReplies = (recent ?? []).filter((m: any) => m.role === "assistant" && m.meta?.kind !== "admin_reply");
  return json({
    summary: { conversations: convoCount ?? 0, messages: msgCount ?? 0, customersHelped: userIds.length, escalated, recent: recent?.length ?? 0 },
    conversations: (convos ?? []).map((c: any) => ({ ...c, customer_email: emails.get(c.user_id) ?? "" })),
    recentMessages: (recent ?? []).map((m: any) => ({ ...m, content: redactSensitiveText(String(m.content ?? "")) })),
  });
}

async function conversationDetail(admin: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { data: convo } = await admin.from("support_conversations").select("*").eq("id", id).maybeSingle();
  if (!convo) return fail(404, "conversation not found");
  const { data: msgs } = await admin.from("support_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true });
  const u = await admin.auth.admin.getUserById(convo.user_id);
  return json({ conversation: convo, messages: (msgs ?? []).map((m: any) => ({ ...m, content: redactSensitiveText(String(m.content ?? "")) })), customer_email: u.data?.user?.email ?? "" });
}

// ---------- emails ----------

function sanitizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

async function campaigns(admin: any, q: URLSearchParams) {
  const { from, to } = pagination(q);
  const status = q.get("status") ?? "";
  let base = admin.from("email_campaigns").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  return json({ campaigns: data ?? [], total: count ?? 0 });
}

async function campaignDetail(admin: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { data: c } = await admin.from("email_campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) return fail(404, "campaign not found");
  const { data: msgs, count } = await admin.from("email_messages").select("*", { count: "exact" }).eq("campaign_id", id).order("created_at", { ascending: true });
  return json({ campaign: c, messages: msgs ?? [], total: count ?? 0 });
}

async function eligibleUsers(admin: any): Promise<{ email: string; name: string }[]> {
  const { data: profs } = await admin.from("profiles").select("id,full_name,email_verified");
  const out: { email: string; name: string }[] = [];
  for (const p of profs ?? []) {
    const u = await admin.auth.admin.getUserById(p.id);
    const email = sanitizeEmail(u.data?.user?.email);
    if (email && p.email_verified) out.push({ email, name: p.full_name ?? "" });
  }
  return out;
}

async function saveCampaign(admin: any, auth: Auth, body: any): Promise<Response> {
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const html = typeof body?.html === "string" ? body.html.slice(0, 200_000) : "";
  const textBody = typeof body?.text === "string" ? body.text.slice(0, 100_000) : "";
  const recipients = Array.isArray(body?.recipients) ? body.recipients.map(sanitizeEmail).filter(Boolean) : [];
  const isTest = body?.isTest === true;
  const campaignId = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const status = body?.status === "scheduled" && typeof body?.scheduledFor === "string" ? "scheduled" : "draft";
  const scheduledFor = status === "scheduled" && !Number.isNaN(Date.parse(body.scheduledFor)) ? new Date(body.scheduledFor).toISOString() : null;
  const row = {
    created_by: auth.email, subject, html, text_body: textBody,
    recipients: recipients as unknown as string[],
    recipient_count: recipients.length,
    status, scheduled_for: scheduledFor, is_test: isTest,
    updated_at: new Date().toISOString(),
  };
  if (campaignId) {
    const { data, error } = await admin.from("email_campaigns").update(row).eq("id", campaignId).in("status", ["draft", "scheduled"]).select().single();
    if (error) return fail(400, "Only drafts or scheduled campaigns can be edited.");
    return json({ campaign: data });
  }
  const { data, error } = await admin.from("email_campaigns").insert(row).select().single();
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "save_campaign", "email_campaigns", data.id, { subject, recipients: recipients.length, status });
  return json({ campaign: data });
}

async function deleteCampaign(admin: any, auth: Auth, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { data: c } = await admin.from("email_campaigns").select("status").eq("id", id).maybeSingle();
  if (!c) return fail(404, "campaign not found");
  if (c.status === "sending") return fail(400, "Cannot delete a campaign that is currently sending.");
  const { error } = await admin.from("email_campaigns").delete().eq("id", id);
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "delete_campaign", "email_campaigns", id, { prior_status: c.status });
  return json({ ok: true });
}

async function eligible(admin: any) {
  const users = await eligibleUsers(admin);
  return json({ users, total: users.length });
}

function wrapHtml(subject: string, html: string, campaignId: string): string {
  const safeSubject = subject.replace(/</g, "&lt;");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<div style="background:#1e3a8a;padding:20px 28px;color:#fff;font-size:18px;font-weight:bold;">MONTEN SMS</div>
<div style="padding:28px;color:#1e293b;font-size:15px;line-height:1.6;">${html}</div>
<div style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
MONTEN SMS &middot; montensms.com<br/>
<a href="https://montensms.com/unsubscribe?c=${campaignId}" style="color:#2563eb;">Unsubscribe</a>
</div>
</div></body></html>`;
}

async function sendTestEmail(admin: any, auth: Auth, body: any): Promise<Response> {
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const html = typeof body?.html === "string" ? body.html.slice(0, 200_000) : "";
  if (!subject || !html) return fail(400, "subject and html required");
  const { data: cfg } = await admin.from("app_settings").select("value").eq("key", "email_sender").maybeSingle();
  const from = cfg?.value?.from ?? "MONTEN SMS <onboarding@resend.dev>";
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) return fail(503, "Email provider is not configured.");
  const campaignId = "test";
  const wrapped = wrapHtml(subject, html, campaignId);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [auth.email], subject: `[TEST] ${subject}`, html: wrapped }),
  });
  const bodyJson = await resp.json().catch(() => ({}));
  if (!resp.ok) return fail(502, `Email provider rejected the test send: ${bodyJson?.message ?? resp.status}`);
  await audit(admin, auth.email, "send_test_email", "email_campaigns", null, { subject, provider_id: bodyJson?.id ?? null });
  return json({ ok: true, providerId: bodyJson?.id ?? null });
}

async function queueCampaign(admin: any, auth: Auth, body: any): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid campaign id");
  const { data: c } = await admin.from("email_campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) return fail(404, "campaign not found");
  if (c.status !== "draft" && c.status !== "scheduled") return fail(400, "Only drafts or scheduled campaigns can be sent.");
  if (c.is_test) return fail(400, "Test campaigns cannot be queued. Duplicate the campaign without test mode first.");
  const recipients = Array.isArray(c.recipients) ? c.recipients.filter((e: unknown) => typeof e === "string") : [];
  if (recipients.length === 0) return fail(400, "Campaign has no recipients.");
  const { data: sup } = await admin.from("email_suppressions").select("email");
  const suppressed = new Set((sup ?? []).map((s: any) => s.email));
  const eligibleEmails = recipients.filter((e: string) => !suppressed.has(e));
  const { error: updErr } = await admin.from("email_campaigns").update({
    status: "queued", updated_at: new Date().toISOString(),
    stats: { queued: eligibleEmails.length, suppressed: recipients.length - eligibleEmails.length },
  }).eq("id", id);
  if (updErr) return fail(500, updErr.message);
  await admin.from("email_messages").delete().eq("campaign_id", id);
  if (eligibleEmails.length > 0) {
    const { error: insErr } = await admin.from("email_messages").insert(
      eligibleEmails.map((email: string) => ({ campaign_id: id, to_email: email, subject: c.subject, status: "queued" })),
    );
    if (insErr) return fail(500, insErr.message);
  }
  await audit(admin, auth.email, "queue_campaign", "email_campaigns", id, { recipients: eligibleEmails.length, suppressed: recipients.length - eligibleEmails.length });
  return json({ ok: true, queued: eligibleEmails.length, suppressed: recipients.length - eligibleEmails.length });
}

async function cancelCampaign(admin: any, auth: Auth, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { data: c } = await admin.from("email_campaigns").select("status").eq("id", id).maybeSingle();
  if (!c) return fail(404, "campaign not found");
  if (c.status !== "queued" && c.status !== "scheduled") return fail(400, "Only queued or scheduled campaigns can be cancelled.");
  await admin.from("email_messages").update({ status: "cancelled" }).eq("campaign_id", id).eq("status", "queued");
  const { error } = await admin.from("email_campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "cancel_campaign", "email_campaigns", id);
  return json({ ok: true });
}

async function sentEmails(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const status = q.get("status") ?? "";
  let base = admin.from("email_messages").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status && status !== "all") base = base.eq("status", status);
  const term = q.get("search")?.trim().replace(/[%_,()]/g, "");
  if (term) base = base.or(`to_email.ilike.*${term}*,subject.ilike.*${term}*`);
  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const campIds = [...new Set(rows.map((r: any) => r.campaign_id))];
  const { data: camps } = campIds.length ? await admin.from("email_campaigns").select("id,subject,is_test,created_by").in("id", campIds) : { data: [] };
  const [total, sent, failed, queued, cancelled] = await Promise.all([
    count(admin, "email_messages"),
    count(admin, "email_messages", { status: "sent" }),
    count(admin, "email_messages", { status: "failed" }),
    count(admin, "email_messages", { status: "queued" }),
    count(admin, "email_messages", { status: "cancelled" }),
  ]);
  return json({
    messages: rows.map((r: any) => ({ ...r, campaign: camps?.find((c: any) => c.id === r.campaign_id) ?? null })),
    total: count ?? 0, page, size,
    summary: { total: total ?? 0, sent: sent ?? 0, failed: failed ?? 0, queued: queued ?? 0, cancelled: cancelled ?? 0 },
  });
}

async function deleteEmailMessage(admin: any, auth: Auth, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid id");
  const { error } = await admin.from("email_messages").delete().eq("id", id);
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "delete_email_record", "email_messages", id);
  return json({ ok: true });
}

async function clearSentEmails(admin: any, auth: Auth): Promise<Response> {
  const { error } = await admin.from("email_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("email_campaigns").update({ stats: {}, updated_at: new Date().toISOString() }).neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "clear_email_history", "email_messages");
  return json({ ok: true });
}

// ---------- audit + settings ----------

async function auditLogs(admin: any, q: URLSearchParams) {
  const { from, to, page, size } = pagination(q);
  const { data, error, count } = await admin.from("admin_audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);
  return json({ logs: data ?? [], total: count ?? 0, page, size });
}

async function settings(admin: any) {
  const { data } = await admin.from("app_settings").select("key,value");
  const map: Record<string, unknown> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return json({ settings: map });
}

async function saveSetting(admin: any, auth: Auth, body: any): Promise<Response> {
  const key = typeof body?.key === "string" ? body.key.replace(/[^a-z_]/g, "") : "";
  const allowed = ["email_sender", "notifications", "website_config"];
  if (!allowed.includes(key)) return fail(400, "unknown setting");
  const { error } = await admin.from("app_settings").upsert({ key, value: body?.value ?? {}, updated_at: new Date().toISOString() });
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "save_setting", "app_settings", key);
  return json({ ok: true });
}

// ---------- performance ----------

async function performance(admin: any): Promise<Response> {
  const checks = await Promise.allSettled([
    (async () => {
      const t = Date.now();
      const { error } = await admin.from("profiles").select("id").limit(1);
      return { name: "Database", ok: !error, ms: Date.now() - t, detail: error ? error.message : "reachable" };
    })(),
    (async () => {
      const t = Date.now();
      const key = Deno.env.get("FIVESIM_API_KEY") ?? "";
      const r = await fetch("https://5sim.net/v1/guest/products?value=all", { headers: key ? { Authorization: `Bearer ${key}`, Accept: "application/json" } : { Accept: "application/json" } });
      return { name: "OTP provider (5SIM)", ok: r.ok, ms: Date.now() - t, detail: r.ok ? "reachable" : `HTTP ${r.status}` };
    })(),
    (async () => {
      const t = Date.now();
      const key = Deno.env.get("MAILOTP_API_KEY") ?? "";
      const r = await fetch("https://api.mailotp.org/v1/domains", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      return { name: "Email OTP provider (MailOtp)", ok: r.ok, ms: Date.now() - t, detail: r.ok ? "reachable" : `HTTP ${r.status}` };
    })(),
    (async () => {
      const t = Date.now();
      const key = Deno.env.get("RESEND_API_KEY") ?? "";
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      return { name: "Email provider (Resend)", ok: r.ok, ms: Date.now() - t, detail: r.ok ? "reachable" : `HTTP ${r.status}` };
    })(),
    (async () => {
      const t = Date.now();
      const r = await fetch("https://montensms.com", { method: "HEAD" });
      return { name: "Website (montensms.com)", ok: r.ok, ms: Date.now() - t, detail: r.ok ? "reachable" : `HTTP ${r.status}` };
    })(),
    (async () => {
      const t = Date.now();
      const key = Deno.env.get("GEMINI_API_KEY") ?? "";
      if (!key) return { name: "AI service (Gemini)", ok: false, ms: 0, detail: "not configured" };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${"gemini-3.8-flash"}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
      });
      return { name: "AI service (Gemini)", ok: r.ok || r.status === 429, ms: Date.now() - t, detail: r.ok ? "reachable" : r.status === 429 ? "quota exceeded" : `HTTP ${r.status}` };
    })(),
  ]);
  const results = checks.map((c) => (c.status === "fulfilled" ? c.value : { name: "check", ok: false, ms: 0, detail: String(c.reason).slice(0, 200) }));
  return json({ checks: results, checkedAt: new Date().toISOString() });
}

// ---------- developer API management ----------

async function developers(admin: any, q: URLSearchParams): Promise<Response> {
  const search = (q.get("search") ?? "").trim().toLowerCase();

  const { data: keys, error } = await admin.from("developer_api_keys").select("id,user_id,name,key_prefix,environment,active,created_at,last_used_at,revoked_at");
  if (error) return fail(500, error.message);
  const { data: usageRows } = await admin.from("developer_api_usage").select("user_id,status_code,response_ms");
  const { data: txnRows } = await admin.from("developer_api_transactions").select("user_id,amount,status");
  const { data: hookRows } = await admin.from("developer_webhooks").select("id,user_id,active");

  const byUser = new Map<string, { keys: number; activeKeys: number; liveKeys: number; requests: number; failed: number; spent: number; webhooks: number; lastUsed: string | null }>();
  for (const k of keys ?? []) {
    const e = byUser.get(k.user_id) ?? { keys: 0, activeKeys: 0, liveKeys: 0, requests: 0, failed: 0, spent: 0, webhooks: 0, lastUsed: null as string | null };
    e.keys++;
    if (k.active) e.activeKeys++;
    if (k.environment === "production") e.liveKeys++;
    if (k.last_used_at && (!e.lastUsed || k.last_used_at > e.lastUsed)) e.lastUsed = k.last_used_at;
    byUser.set(k.user_id, e);
  }
  for (const u of usageRows ?? []) {
    const e = byUser.get(u.user_id);
    if (e) { e.requests++; if ((u.status_code ?? 0) >= 400) e.failed++; }
  }
  for (const t of txnRows ?? []) {
    const e = byUser.get(t.user_id);
    if (e && t.status === "completed") e.spent += Number(t.amount ?? 0);
  }
  for (const w of hookRows ?? []) {
    const e = byUser.get(w.user_id);
    if (e && w.active) e.webhooks++;
  }

  const rows = [...byUser.entries()];
  const ids = rows.map(([uid]) => uid);
  const [{ data: profs }, users] = await Promise.all([
    ids.length ? admin.from("profiles").select("id,full_name,wallet_balance").in("id", ids) : Promise.resolve({ data: [] }),
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
  ]);
  const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
  const emailMap = new Map(ids.map((id, i) => [id, users[i]?.data?.user?.email ?? ""]));

  const developers = rows
    .map(([uid, agg]) => {
      const p = profMap.get(uid);
      return { user_id: uid, email: emailMap.get(uid) || "unknown", full_name: p?.full_name ?? "", wallet_balance: Number(p?.wallet_balance ?? 0), ...agg };
    })
    .filter((d) => !search || d.email.toLowerCase().includes(search) || d.full_name.toLowerCase().includes(search))
    .sort((a, b) => b.requests - a.requests);
  return json({ developers });
}

async function developerDetail(admin: any, userId: string): Promise<Response> {
  const [{ data: prof }, keys, usage, txns, hooks, authUser] = await Promise.all([
    admin.from("profiles").select("full_name,wallet_balance").eq("id", userId).maybeSingle(),
    admin.from("developer_api_keys").select("id,name,key_prefix,environment,active,created_at,last_used_at,revoked_at").eq("user_id", userId),
    admin.from("developer_api_usage").select("endpoint,method,status_code,response_ms,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    admin.from("developer_api_transactions").select("order_ref,order_id,kind,service,country,amount,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    admin.from("developer_webhooks").select("id,url,active,created_at").eq("user_id", userId),
    admin.auth.admin.getUserById(userId),
  ]);
  const hookIds = (hooks.data ?? []).map((h: any) => h.id);
  const { data: dels } = hookIds.length
    ? await admin.from("developer_webhook_deliveries").select("id,webhook_id,event,status,attempts,response_status,last_error,created_at").in("webhook_id", hookIds).order("created_at", { ascending: false }).limit(30)
    : { data: [] };
  return json({
    profile: prof ? { ...prof, email: authUser.data?.user?.email ?? "" } : null,
    keys: keys.data ?? [],
    usage: usage.data ?? [],
    transactions: txns.data ?? [],
    webhooks: hooks.data ?? [],
    deliveries: dels ?? [],
  });
}

async function developerConfig(admin: any): Promise<Response> {
  const { data } = await admin.from("developer_api_config").select("*").eq("id", 1).maybeSingle();
  return json({ config: data ?? { phone_rate_limit_per_min: 30, email_rate_limit_per_min: 20, phone_margin_naira: 500, email_price_naira: 238, enabled: true } });
}

async function saveDeveloperConfig(admin: any, auth: { email: string }, body: any): Promise<Response> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (!["phone_rate_limit_per_min", "email_rate_limit_per_min", "phone_margin_naira", "email_price_naira", "enabled"].includes(k)) continue;
    if (k === "enabled") patch.enabled = v === true;
    else {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return fail(400, `${k} must be a non-negative number`);
      patch[k] = n;
    }
  }
  if (Object.keys(patch).length === 0) return fail(400, "nothing to update");
  const { error } = await admin.from("developer_api_config").update(patch).eq("id", 1);
  if (error) return fail(500, error.message);
  await audit(admin, auth.email, "update_developer_config", "developer_api_config", "1", patch);
  return json({ ok: true });
}

async function developerKeyAction(admin: any, auth: { email: string }, keyId: string, body: any): Promise<Response> {
  const patch: Record<string, unknown> = {};
  if (typeof body?.active === "boolean") { patch.active = body.active; patch.revoked_at = body.active ? null : new Date().toISOString(); }
  if (Object.keys(patch).length === 0) return fail(400, "nothing to update");
  const { data, error } = await admin.from("developer_api_keys").update(patch).eq("id", keyId).select("id,user_id").single();
  if (error) return fail(404, "Key not found.");
  await audit(admin, auth.email, body.active ? "activate_api_key" : "revoke_api_key", "developer_api_keys", keyId, { user_id: data.user_id });
  return json({ ok: true });
}

// ---------- routing ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/admin-api\/?/, "");
    const admin = adminClient();

    const auth = await authenticate(req, admin);
    if (!auth) return fail(403, "Admin access denied.");

    if (!(await rateLimit(admin, auth.userId))) return fail(429, "Too many requests. Slow down.");

    const method = req.method;
    const seg = path.split("/").filter(Boolean);

    if (method === "GET") {
      if (seg[0] === "app-management") {
        if (seg[1] === "download" && seg[2]) return await appReleaseDownload(admin, seg[2]);
        if (seg.length === 1) return await appManagement(admin);
        return fail(404, "unknown app management endpoint");
      }
      if (seg[0] === "overview") return await overview(admin);
      if (seg[0] === "chart") return await chart(admin, seg[1] ?? "profiles", Math.min(90, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10) || 30)), seg[1] === "purchased_numbers" && url.searchParams.get("successful") === "1" ? { status: "received" } : {});
      if (seg[0] === "users") return seg[1] ? await userDetail(admin, seg[1]) : await usersEndpoint(admin, url.searchParams);
      if (seg[0] === "login-activity") return await loginActivity(admin, url.searchParams);
      if (seg[0] === "otp-orders") return await otpOrders(admin, url.searchParams);
      if (seg[0] === "email-orders") return await emailOrders(admin, url.searchParams);
      if (seg[0] === "wallet") return await wallet(admin, url.searchParams);
      if (seg[0] === "top-customers") return await topCustomers(admin, url.searchParams);
      if (seg[0] === "tickets") return seg[1] ? await ticketDetail(admin, seg[1]) : await tickets(admin, url.searchParams);
      if (seg[0] === "ai-monitoring") return await aiMonitoring(admin, url.searchParams);
      if (seg[0] === "conversations") return seg[1] ? await conversationDetail(admin, seg[1]) : fail(400, "id required");
      if (seg[0] === "campaigns") return seg[1] ? await campaignDetail(admin, seg[1]) : await campaigns(admin, url.searchParams);
      if (seg[0] === "eligible-users") return await eligible(admin);
      if (seg[0] === "sent-emails") return await sentEmails(admin, url.searchParams);
      if (seg[0] === "audit-logs") return await auditLogs(admin, url.searchParams);
      if (seg[0] === "settings") return await settings(admin);
      if (seg[0] === "performance") return await performance(admin);
      if (seg[0] === "developers") return seg[1] ? await developerDetail(admin, seg[1]) : await developers(admin, url.searchParams);
      if (seg[0] === "developer-config") return await developerConfig(admin);
      return fail(404, "unknown endpoint");
    }

    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (seg[0] === "app-management" && seg[1] === "upload-url") return await createAppUploadUrl(admin, auth, body);
      if (seg[0] === "app-management" && seg[1] === "complete-upload") return await completeAppUpload(admin, auth, body);
      if (seg[0] === "app-management" && seg[1] === "releases") return await saveAppReleaseDraft(admin, auth, body);
      if (seg[0] === "app-management" && seg[1] === "config") return await saveAppReleaseConfig(admin, auth, body);
      if (seg[0] === "app-management" && seg[1] === "publish") return await publishAppRelease(admin, auth, body);
      if (seg[0] === "campaigns" && seg[1] === "test-send") return await sendTestEmail(admin, auth, body);
      if (seg[0] === "campaigns" && seg[1] === "queue") return await queueCampaign(admin, auth, body);
      if (seg[0] === "campaigns" && seg[1] === "cancel") return await cancelCampaign(admin, auth, body);
      if (seg[0] === "campaigns") return await saveCampaign(admin, auth, body);
      if (seg[0] === "tickets" && seg[1] === "reply") return await replyTicket(admin, auth, body);
      if (seg[0] === "tickets" && seg[1]) return await updateTicket(admin, seg[1], body, auth);
      if (seg[0] === "settings") return await saveSetting(admin, auth, body);
      if (seg[0] === "developer-config") return await saveDeveloperConfig(admin, auth, body);
      if (seg[0] === "developer-keys" && seg[1]) return await developerKeyAction(admin, auth, seg[1], body);
      return fail(404, "unknown endpoint");
    }

    if (method === "DELETE") {
      if (seg[0] === "app-management" && seg[1] === "releases" && seg[2]) return await deleteAppReleaseDraft(admin, auth, seg[2]);
      if (seg[0] === "campaigns" && seg[1]) return await deleteCampaign(admin, auth, seg[1]);
      if (seg[0] === "sent-emails" && seg[1] === "clear") return await clearSentEmails(admin, auth);
      if (seg[0] === "sent-emails" && seg[1]) return await deleteEmailMessage(admin, auth, seg[1]);
      return fail(404, "unknown endpoint");
    }

    return fail(405, "method not allowed");
  } catch (err) {
    console.error("[admin-api]", err instanceof Error ? err.message : err);
    return fail(500, "Internal error. Check function logs.");
  }
});
