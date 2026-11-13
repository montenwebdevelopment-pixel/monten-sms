import { useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, XCircle, ShieldCheck, FileArchive } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Spinner } from "../../components/ui";

const MAX_BYTES = 100_000_000;
const EDGE_FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function ApkUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || (session.user.email ?? "").toLowerCase() !== "montensms@gmail.com") {
        setMessage("You are not signed in as the site owner.");
        setStatus("error");
      }
      setChecking(false);
    });
  }, []);

  const pickFile = () => fileInputRef.current?.click();

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setStatus("idle");
    setMessage("");
    if (!chosen) return setFile(null);
    if (!chosen.name.toLowerCase().endsWith(".apk")) {
      setFile(null);
      setStatus("error");
      setMessage("Please choose an .apk file.");
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setStatus("error");
      setMessage("File is larger than the 100 MB storage limit.");
      return;
    }
    setFile(chosen);
  };

  const startUpload = async () => {
    if (!file) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStatus("error");
      setMessage("Your session has expired. Please sign in again.");
      return;
    }

    setStatus("uploading");
    setProgress(0);
    setMessage("");

    // XMLHttpRequest is used instead of fetch so real upload progress is available.
    const xhr = new XMLHttpRequest();
    const promise = new Promise<void>((resolve) => {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        if (xhr.status === 200) {
          setStatus("success");
          setMessage(`${file.name} uploaded successfully (${(file.size / 1_000_000).toFixed(1)} MB). The download link is now live.`);
        } else {
          let serverError = "Upload failed. Please try again.";
          try {
            const body = JSON.parse(xhr.responseText);
            if (typeof body?.error === "string") serverError = body.error;
          } catch { /* non-JSON response body */ }
          setStatus("error");
          setMessage(serverError);
        }
        resolve();
      });
      xhr.addEventListener("error", () => {
        setStatus("error");
        setMessage("We couldn't reach the server. Check your connection and try again.");
        resolve();
      });
    });

    xhr.open("POST", `${EDGE_FUNCTION_BASE}/apk-upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Content-Type", "application/vnd.android.package-archive");
    xhr.send(file);
    await promise;
  };

  const busy = status === "uploading";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6 text-navy-800">
          <ShieldCheck className="w-5 h-5 text-royal-600" />
          <h1 className="text-xl font-bold">Owner APK Upload</h1>
        </div>

        {checking ? (
          <Card className="p-8 flex justify-center">
            <Spinner className="w-8 h-8 text-royal-600" />
          </Card>
        ) : status === "error" && message.includes("not signed in") ? (
          <Card className="p-8 text-center">
            <XCircle className="w-10 h-10 text-error-500 mx-auto mb-3" />
            <p className="text-sm text-slate-600">{message}</p>
            <p className="text-xs text-slate-400 mt-2">Sign in to the website with the owner account, then revisit this page.</p>
          </Card>
        ) : (
          <Card className="p-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={onFileChosen}
              className="hidden"
            />

            <button
              onClick={pickFile}
              disabled={busy}
              className="w-full border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center gap-3 hover:border-royal-400 hover:bg-royal-50/50 transition-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileArchive className="w-10 h-10 text-slate-400" />
              <span className="text-sm font-medium text-navy-800">
                {file ? file.name : "Choose monten-sms.apk"}
              </span>
              <span className="text-xs text-slate-400">
                {file ? `${(file.size / 1_000_000).toFixed(1)} MB` : "from your Downloads folder"}
              </span>
            </button>

            {status === "uploading" && (
              <div className="mt-5">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Uploading…</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-royal-600 rounded-full transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {status === "success" && (
              <div className="mt-5 flex items-start gap-2 p-3 rounded-lg bg-success-50 border border-success-200">
                <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0 mt-0.5" />
                <p className="text-sm text-success-700">{message}</p>
              </div>
            )}
            {status === "error" && !message.includes("not signed in") && (
              <div className="mt-5 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200">
                <XCircle className="w-5 h-5 text-error-600 shrink-0 mt-0.5" />
                <p className="text-sm text-error-700">{message}</p>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Button onClick={startUpload} disabled={!file || busy} loading={busy} className="flex-1">
                <Upload className="w-4 h-4" />
                {file && status === "success" ? "Replace APK" : "Upload"}
              </Button>
              <Button variant="outline" onClick={pickFile} disabled={busy}>
                Change file
              </Button>
            </div>

            <p className="mt-4 text-xs text-slate-400 text-center">
              Saved to the app-downloads bucket as monten-sms.apk. Owner account only; enforced server-side.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
