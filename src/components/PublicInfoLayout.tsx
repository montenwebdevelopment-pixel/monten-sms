import { Link } from "react-router-dom";
import { Logo } from "./ui";

export function PublicInfoLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="MONTEN SMS home" className="rounded-lg focus:outline-none focus:ring-2 focus:ring-royal-500">
            <Logo size="sm" />
          </Link>
          <Link to="/" className="text-sm font-semibold text-royal-600 hover:text-royal-700">
            Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-royal-600">MONTEN SMS</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{description}</p>
        </div>
        <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          {children}
        </article>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <nav aria-label="Policy links" className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-3 px-4 py-5 text-sm sm:px-6">
          <Link to="/privacy-policy" className="font-medium text-royal-600 hover:text-royal-700">Privacy Policy</Link>
          <Link to="/delete-account" className="font-medium text-royal-600 hover:text-royal-700">Account Deletion</Link>
          <a href="mailto:support@montensms.com" className="font-medium text-royal-600 hover:text-royal-700">Contact Support</a>
        </nav>
      </footer>
    </div>
  );
}

export function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-bold text-navy-900">{title}</h2>
      <div className="space-y-3 text-sm leading-7 text-slate-600">{children}</div>
    </section>
  );
}
