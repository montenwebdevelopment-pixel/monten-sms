import { useEffect, useState } from "react";
import { Smartphone, Apple, Download } from "lucide-react";
import { detectPlatform, handleAppDownload, type Platform } from "../lib/appDownload";

function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  return platform;
}

// Single shared download button that adapts to the visitor's device:
// Android gets the direct APK, iPhone sees "Coming Soon" until the
// official App Store listing exists, and everyone else gets both options.
export function DownloadAppButton({ className = "" }: { className?: string }) {
  const platform = usePlatform();
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);

  const handleClick = async () => {
    setChecking(true);
    const result = await handleAppDownload();
    setChecking(false);
    if (result.message) {
      setMessage(result.message);
      setTimeout(() => setMessage(""), 5000);
    }
  };

  if (platform === "ios") {
    return (
      <div className={className}>
        <button
          disabled
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-100 text-slate-400 text-sm font-semibold cursor-not-allowed"
        >
          <Apple className="w-4 h-4" /> Download for iPhone &mdash; Coming Soon
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={checking}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-royal-600 text-white text-sm font-semibold hover:bg-royal-700 transition-colors disabled:opacity-60"
      >
        {platform === "android" ? (
          <><Download className="w-4 h-4" /> Download for Android</>
        ) : (
          <><Smartphone className="w-4 h-4" /> Get the Mobile App</>
        )}
      </button>
      {message && <p className="mt-2 text-xs text-slate-500">{message}</p>}
    </div>
  );
}
