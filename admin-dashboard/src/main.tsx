import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AdminRoot } from "../../src/admin/AdminRoot";
import "./admin.css";

class AdminErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[admin-app] Render failed.", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-slate-900">Admin dashboard could not load</h1>
            <p className="mt-2 text-sm text-slate-600">Refresh the page. If the problem continues, contact the dashboard administrator.</p>
            <button onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Reload dashboard
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminErrorBoundary>
      <BrowserRouter>
        <AdminRoot />
      </BrowserRouter>
    </AdminErrorBoundary>
  </React.StrictMode>,
);
