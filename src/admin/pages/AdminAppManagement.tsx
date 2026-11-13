import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FileArchive,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Smartphone,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "../adminSupabase";
import { adminFetch, PageHeader } from "../adminApi";
import { readAndroidPackageMetadata } from "../appPackageMetadata";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

interface AppRelease {
  id: string;
  app_name: string;
  version_name: string;
  version_code: string;
  package_name: string;
  description: string;
  release_notes: string;
  file_name: string;
  file_type: "apk" | "aab";
  storage_path: string;
  file_size: number;
  status: "draft" | "published";
  created_at: string;
  published_at: string | null;
}

interface AppReleaseConfig {
  app_name: string;
  download_url: string;
  update_info: string;
  minimum_version: string;
  force_update: boolean;
  current_release_id: string | null;
}

interface UploadUrl {
  path: string;
  token: string;
  signedUrl: string;
}

interface DraftForm {
  id: string | null;
  appName: string;
  versionName: string;
  versionCode: string;
  packageName: string;
  description: string;
  releaseNotes: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function zipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
}

function defaultDraft(appName = "MONTEN SMS"): DraftForm {
  return {
    id: null,
    appName,
    versionName: "",
    versionCode: "",
    packageName: "",
    description: "",
    releaseNotes: "",
  };
}

export function AdminAppManagement() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [config, setConfig] = useState<AppReleaseConfig>({
    app_name: "MONTEN SMS",
    download_url: "",
    update_info: "",
    minimum_version: "",
    force_update: false,
    current_release_id: null,
  });
  const [configForm, setConfigForm] = useState(config);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [busyReleaseId, setBusyReleaseId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminFetch<{ releases: AppRelease[]; config: AppReleaseConfig }>("app-management");
      setReleases(result.releases);
      setConfig(result.config);
      setConfigForm(result.config);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not load app releases." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const chooseFile = () => fileInput.current?.click();

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    setNotice(null);
    setValidationMessage("");
    setFile(null);
    if (!selected) return;

    const extension = selected.name.toLowerCase().split(".").pop();
    if (extension !== "apk" && extension !== "aab") {
      setNotice({ type: "error", text: "Choose an Android .apk or .aab release file." });
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_FILE_BYTES) {
      setNotice({ type: "error", text: "The file must be larger than 0 bytes and no larger than 100 MB." });
      return;
    }

    const header = new Uint8Array(await selected.slice(0, 4).arrayBuffer());
    if (!zipHeader(header)) {
      setNotice({ type: "error", text: "The selected file does not have a valid Android ZIP archive signature." });
      return;
    }

    setFile(selected);
    setValidationMessage(`ZIP signature verified · ${extension.toUpperCase()} · ${formatBytes(selected.size)}`);
    setForm((current) => current ?? defaultDraft(config.app_name || "MONTEN SMS"));
    try {
      setValidationMessage(`Reading ${extension.toUpperCase()} manifest…`);
      const metadata = await readAndroidPackageMetadata(selected);
      setForm((current) => current ? {
        ...current,
        packageName: metadata.packageName ?? current.packageName,
        versionName: metadata.versionName ?? current.versionName,
        versionCode: metadata.versionCode ?? current.versionCode,
      } : current);
      setValidationMessage(metadata.packageName || metadata.versionName
        ? `Archive verified · ${metadata.packageName ?? "Package name not detected"} · ${metadata.versionName ? `version ${metadata.versionName}` : "version not detected"}`
        : "Archive verified. Version/package metadata was not detected; enter it below.");
    } catch {
      setValidationMessage("Archive signature verified. Manifest metadata could not be read; enter version and package name below.");
    }
  };

  const beginNewRelease = () => {
    setForm(defaultDraft(config.app_name || "MONTEN SMS"));
    setFile(null);
    setValidationMessage("");
    setNotice(null);
  };

  const beginEdit = (release: AppRelease) => {
    setForm({
      id: release.id,
      appName: release.app_name,
      versionName: release.version_name,
      versionCode: release.version_code,
      packageName: release.package_name,
      description: release.description,
      releaseNotes: release.release_notes,
    });
    setFile(null);
    setValidationMessage(`${release.file_name} · ${formatBytes(Number(release.file_size))}`);
    setNotice(null);
  };

  const updateForm = (key: keyof DraftForm, value: string) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  const uploadWithProgress = async (signed: UploadUrl, selected: File, accessToken: string): Promise<void> => {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", signed.signedUrl);
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
      xhr.setRequestHeader("Content-Type", selected.name.toLowerCase().endsWith(".apk")
        ? "application/vnd.android.package-archive"
        : "application/octet-stream");
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(undefined);
          return;
        }
        let message = `Storage upload failed (${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (typeof body.message === "string") message = body.message;
          else if (typeof body.error === "string") message = body.error;
        } catch { /* use the HTTP status when the storage response is not JSON */ }
        reject(new Error(message));
      });
      xhr.addEventListener("error", () => reject(new Error("Upload connection failed. Check your connection and retry.")));
      xhr.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));
      xhr.send(selected);
    });
  };

  const saveDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.appName.trim() || !form.versionName.trim() || !form.packageName.trim()) {
      setNotice({ type: "error", text: "App name, version and Android package name are required." });
      return;
    }
    if (!form.id && !file) {
      setNotice({ type: "error", text: "Choose an .apk or .aab file before saving this release draft." });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setNotice(null);
    try {
      if (form.id) {
        await adminFetch("app-management/releases", {
          json: {
            id: form.id,
            appName: form.appName,
            versionName: form.versionName,
            versionCode: form.versionCode,
            packageName: form.packageName,
            description: form.description,
            releaseNotes: form.releaseNotes,
          },
        });
        setNotice({ type: "success", text: "Draft changes saved. This release has not been published." });
      } else {
        const selected = file!;
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) throw new Error("Your admin session has expired. Sign in again.");
        const signed = await adminFetch<UploadUrl>("app-management/upload-url", {
          json: { fileName: selected.name, fileSize: selected.size },
        });
        await uploadWithProgress(signed, selected, sessionData.session.access_token);
        const created = await adminFetch<{ release: AppRelease }>("app-management/complete-upload", {
          json: {
            path: signed.path,
            fileName: selected.name,
            fileSize: selected.size,
            appName: form.appName,
            versionName: form.versionName,
            versionCode: form.versionCode,
            packageName: form.packageName,
            description: form.description,
            releaseNotes: form.releaseNotes,
          },
        });
        setUploadProgress(100);
        setNotice({ type: "success", text: "Upload validated and saved as a draft. It is not published." });
        setForm({
          id: created.release.id,
          appName: created.release.app_name,
          versionName: created.release.version_name,
          versionCode: created.release.version_code,
          packageName: created.release.package_name,
          description: created.release.description,
          releaseNotes: created.release.release_notes,
        });
        setFile(null);
        setValidationMessage(`${created.release.file_name} · ${formatBytes(Number(created.release.file_size))}`);
      }
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not save this app release." });
    } finally {
      setUploading(false);
    }
  };

  const saveConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingConfig(true);
    setNotice(null);
    try {
      await adminFetch("app-management/config", {
        json: {
          appName: configForm.app_name,
          downloadUrl: configForm.download_url,
          updateInfo: configForm.update_info,
          minimumVersion: configForm.minimum_version,
          forceUpdate: configForm.force_update,
        },
      });
      setConfig(configForm);
      setNotice({ type: "success", text: "App configuration saved." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not save app configuration." });
    } finally {
      setSavingConfig(false);
    }
  };

  const publish = async () => {
    if (!publishingId) return;
    const releaseId = publishingId;
    setBusyReleaseId(releaseId);
    try {
      await adminFetch("app-management/publish", { json: { id: releaseId } });
      setNotice({ type: "success", text: "Release published in the admin app catalog. No Google Play submission was made." });
      if (form?.id === releaseId) setForm(null);
      setPublishingId(null);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not publish this release." });
    } finally {
      setBusyReleaseId(null);
    }
  };

  const deleteDraft = async (release: AppRelease) => {
    if (!window.confirm(`Delete the ${release.version_name} draft and its uploaded file? This cannot be undone.`)) return;
    setBusyReleaseId(release.id);
    try {
      await adminFetch(`app-management/releases/${release.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Draft and its private file were deleted." });
      if (form?.id === release.id) setForm(null);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not delete the draft." });
    } finally {
      setBusyReleaseId(null);
    }
  };

  const downloadRelease = async (release: AppRelease) => {
    setBusyReleaseId(release.id);
    try {
      const result = await adminFetch<{ signedUrl: string }>(`app-management/download/${release.id}`);
      window.location.assign(result.signedUrl);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not retrieve this published file." });
    } finally {
      setBusyReleaseId(null);
    }
  };

  const currentRelease = releases.find((release) => release.id === config.current_release_id);

  return (
    <div>
      <PageHeader
        title="App Management"
        subtitle="Upload, validate, configure and publish Android app releases."
        actions={
          <>
            <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={beginNewRelease} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Upload className="h-4 w-4" /> Upload New App
            </button>
          </>
        }
      />

      {notice && (
        <div className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {notice.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-auto" aria-label="Dismiss message"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Info className="mt-0.5 h-5 w-5 shrink-0" />
        <p><strong>AAB and APK are different:</strong> an .aab is for Google Play distribution and cannot be installed directly. An .apk can be installed directly. Publishing here only updates this admin release catalog; it does not upload to or publish on Google Play.</p>
      </div>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-blue-600" />
          <h2 className="font-bold text-slate-900">Published app</h2>
        </div>
        {currentRelease ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label="Current version" value={`${currentRelease.app_name} ${currentRelease.version_name}`} />
            <Summary label="Package" value={currentRelease.package_name || "Not specified"} />
            <Summary label="Published file" value={`${currentRelease.file_name} · ${currentRelease.file_type.toUpperCase()}`} />
            <Summary label="Published" value={dateLabel(currentRelease.published_at)} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">No app version has been published in this dashboard yet.</p>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="mb-1 font-bold text-slate-900">App configuration</h2>
        <p className="mb-4 text-sm text-slate-500">Manage the app link and update guidance. These settings are stored for the admin catalog and do not change the customer app automatically.</p>
        <form onSubmit={saveConfig} className="grid gap-4 lg:grid-cols-2">
          <Field label="App name">
            <input required maxLength={100} value={configForm.app_name} onChange={(e) => setConfigForm({ ...configForm, app_name: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Download / store link">
            <input type="url" maxLength={2048} placeholder="https://play.google.com/store/apps/…" value={configForm.download_url} onChange={(e) => setConfigForm({ ...configForm, download_url: e.target.value })} className={inputClass} />
            <span className="mt-1 block font-normal text-slate-400">HTTPS links only. This link is configuration and is not published to customers automatically.</span>
          </Field>
          <Field label="Update information">
            <textarea maxLength={4000} rows={3} value={configForm.update_info} onChange={(e) => setConfigForm({ ...configForm, update_info: e.target.value })} className={inputClass} />
          </Field>
          <div className="space-y-4">
            <Field label="Minimum supported version (optional)">
              <input maxLength={64} value={configForm.minimum_version} onChange={(e) => setConfigForm({ ...configForm, minimum_version: e.target.value })} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={configForm.force_update} onChange={(e) => setConfigForm({ ...configForm, force_update: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              Mark update as required
            </label>
          </div>
          <div className="lg:col-span-2">
            <button type="submit" disabled={savingConfig} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {savingConfig ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save configuration
            </button>
          </div>
        </form>
      </section>

      {form && (
        <section className="mb-6 rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">{form.id ? "Edit release draft" : "Upload a new app version"}</h2>
              <p className="text-sm text-slate-500">The release will remain a draft until you explicitly publish it.</p>
            </div>
            <button onClick={() => { setForm(null); setFile(null); }} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close editor"><X className="h-5 w-5" /></button>
          </div>

          <form onSubmit={saveDraft} className="space-y-4">
            {!form.id && (
              <>
                <input ref={fileInput} type="file" accept=".apk,.aab,application/vnd.android.package-archive,application/octet-stream" className="hidden" onChange={(e) => void onFileSelected(e)} />
                <button type="button" onClick={chooseFile} disabled={uploading} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-blue-400 hover:bg-blue-50/40 disabled:opacity-50">
                  <FileArchive className="h-8 w-8 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-800">{file?.name ?? "Choose Android release file (.apk or .aab)"}</span>
                  <span className="text-xs text-slate-500">{file ? `${formatBytes(file.size)} · ${file.type || "file type not supplied by browser"}` : "Maximum file size: 100 MB"}</span>
                </button>
                {validationMessage && <p className="text-xs text-emerald-700">{validationMessage}</p>}
              </>
            )}

            {form.id && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <Archive className="mr-2 inline h-4 w-4" /> Draft file: {validationMessage}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="App name">
                <input required maxLength={100} value={form.appName} onChange={(e) => updateForm("appName", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Version name">
                <input required maxLength={64} value={form.versionName} onChange={(e) => updateForm("versionName", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Version code (if available)">
                <input maxLength={32} value={form.versionCode} onChange={(e) => updateForm("versionCode", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Android package name">
                <input required maxLength={255} placeholder="com.example.app" value={form.packageName} onChange={(e) => updateForm("packageName", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Description">
                <textarea maxLength={4000} rows={3} value={form.description} onChange={(e) => updateForm("description", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Release notes">
                <textarea maxLength={8000} rows={3} value={form.releaseNotes} onChange={(e) => updateForm("releaseNotes", e.target.value)} className={inputClass} />
              </Field>
            </div>

            {uploading && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{form.id ? "Saving draft…" : "Uploading securely…"}</span><span>{uploadProgress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={uploading || loading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {form.id ? "Save Draft Changes" : "Upload & Save as Draft"}
              </button>
              {form.id && (
                <button type="button" onClick={() => setPublishingId(form.id)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  <Send className="h-4 w-4" /> Publish
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">App versions</h2>
            <p className="text-sm text-slate-500">Drafts and published releases; files are stored privately.</p>
          </div>
          {loading && <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />}
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading app versions…</p>
        ) : releases.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No app files uploaded yet. Use “Upload New App” to create a draft release.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-3 font-semibold">Version</th>
                  <th className="px-3 py-3 font-semibold">Release file</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => {
                  const isCurrent = release.id === config.current_release_id;
                  const busy = busyReleaseId === release.id;
                  return (
                    <tr key={release.id} className="border-b border-slate-50 align-top last:border-0">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{release.app_name} {release.version_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{release.package_name || "Package not specified"}</div>
                        {isCurrent && <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Current</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-[260px] truncate text-slate-800" title={release.file_name}>{release.file_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{release.file_type.toUpperCase()} · {formatBytes(Number(release.file_size))}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${release.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{release.status}</span>
                        {release.status === "published" && <div className="mt-1 text-xs text-slate-500">Catalog only; not Google Play</div>}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{dateLabel(release.published_at ?? release.created_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {release.status === "draft" ? (
                            <>
                              <button onClick={() => beginEdit(release)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                              <button onClick={() => setPublishingId(release.id)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"><Send className="h-3.5 w-3.5" /> Publish</button>
                              <button onClick={() => void deleteDraft(release)} disabled={busy} className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label="Delete draft"><Trash2 className="h-3.5 w-3.5" /></button>
                            </>
                          ) : (
                            <button onClick={() => void downloadRelease(release)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Retrieve file
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {publishingId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="publish-title">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 id="publish-title" className="text-lg font-bold text-slate-900">Confirm release publication</h2>
            <p className="mt-2 text-sm text-slate-600">This marks the selected draft as the current published version in this admin catalog. It does <strong>not</strong> submit the file to Google Play. An AAB is not a directly installable APK.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPublishingId(null)} disabled={busyReleaseId === publishingId} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button onClick={() => void publish()} disabled={busyReleaseId === publishingId} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busyReleaseId === publishingId && <LoaderCircle className="h-4 w-4 animate-spin" />} Confirm Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<span className="mt-1 block">{children}</span></label>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p></div>;
}
