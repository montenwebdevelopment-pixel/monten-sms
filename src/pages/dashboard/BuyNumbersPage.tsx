import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, ChevronDown, Loader as Loader2, ShoppingBag, Phone, CircleCheck as CheckCircle, Circle as XCircle, Clock, ArrowRight, ArrowLeft, Copy, Check, X, CircleAlert as AlertCircle, RefreshCw, TrendingUp, Package, Globe, Timer } from "lucide-react";
import { supabase, EDGE_FUNCTION_BASE } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { formatNaira, countryFlag } from "../../lib/format";
import { copyToClipboard, notifyOtpReceived } from "../../lib/native";
import { Button, Card, Input, EmptyState } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";
import type { Country, Service, Offer } from "../../types";

type Step = "country" | "services" | "offers" | "result";

// 5SIM automatically expires and cancels standard virtual numbers after
// 5 minutes. The backend sends us the exact `expiresAt` from 5SIM's response;
// this fallback is only used if that field is missing.
const DEFAULT_RENTAL_MS = 5 * 60 * 1000;

function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const POPULAR_COUNTRIES: { code: string; name: string }[] = [
  { code: "usa", name: "United States" },
  { code: "england", name: "United Kingdom" },
  { code: "canada", name: "Canada" },
  { code: "germany", name: "Germany" },
  { code: "france", name: "France" },
  { code: "netherlands", name: "Netherlands" },
  { code: "russia", name: "Russia" },
  { code: "ukraine", name: "Ukraine" },
  { code: "turkey", name: "Turkey" },
  { code: "indonesia", name: "Indonesia" },
  { code: "india", name: "India" },
  { code: "brazil", name: "Brazil" },
  { code: "mexico", name: "Mexico" },
  { code: "nigeria", name: "Nigeria" },
];

const POPULAR_SERVICES: { code: string; name: string }[] = [
  { code: "whatsapp", name: "WhatsApp" },
  { code: "telegram", name: "Telegram" },
  { code: "google", name: "Google" },
  { code: "gmail", name: "Gmail" },
  { code: "tiktok", name: "TikTok" },
  { code: "facebook", name: "Facebook" },
  { code: "instagram", name: "Instagram" },
  { code: "twitter", name: "X (Twitter)" },
  { code: "discord", name: "Discord" },
  { code: "tinder", name: "Tinder" },
  { code: "uber", name: "Uber" },
  { code: "amazon", name: "Amazon" },
  { code: "binance", name: "Binance" },
  { code: "paypal", name: "PayPal" },
  { code: "microsoft", name: "Microsoft" },
  { code: "wechat", name: "WeChat" },
];

export function BuyNumbersPage() {
  const { profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>("country");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [countries, setCountries] = useState<Country[]>([]);
  const [countrySearch, setCountrySearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [countriesError, setCountriesError] = useState("");
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [countryRetryCount, setCountryRetryCount] = useState(0);

  const [services, setServices] = useState<Service[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);

  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [smsStatus, setSmsStatus] = useState<"waiting" | "received" | "canceled" | "failed">("waiting");

  const [smsCode, setSmsCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [manualChecking, setManualChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const authHeadersRef = useRef<{ Authorization: string; "Content-Type": string; apikey: string } | null>(null);

  useEffect(() => { fetchCountries(); }, []);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Live countdown timer — runs while waiting and after OTP received
  useEffect(() => {
    if ((smsStatus !== "waiting" && smsStatus !== "received") || !expiresAt) return;
    const tick = () => {
      const diff = expiresAt - Date.now();
      setRemainingMs(diff > 0 ? diff : 0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, smsStatus]);

  const getAuthHeaders = async () => {
    const { data: session } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };
  };

  const fetchCountries = async (attempt = 1) => {
    setCountriesLoading(true);
    setCountriesError("");
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/countries`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); setCountryRetryCount(attempt + 1); return fetchCountries(attempt + 1); }
        // Upstream detail stays in the console: it names our supplier and its
        // failure structure, neither of which belongs on a customer screen.
        console.error("[buy-numbers] countries request failed", resp.status, data?.error);
        setCountriesError("We couldn't load the available countries right now. Please try again in a moment."); setCountries([]); setCountryRetryCount(0); return;
      }
      const list = data.countries || [];
      if (list.length === 0) { setCountriesError("No countries are available right now. Please try again in a moment."); setCountries([]); return; }
      setCountries(list); setCountryRetryCount(0);
    } catch (err: any) {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); setCountryRetryCount(attempt + 1); return fetchCountries(attempt + 1); }
      console.error("[buy-numbers] countries request failed", err);
      setCountriesError("We couldn't load the available countries right now. Please check your connection and try again."); setCountries([]); setCountryRetryCount(0);
    } finally { setCountriesLoading(false); }
  };

  const fetchServices = async (country: Country) => {
    setServicesLoading(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/services/${country.code}`, { headers });
      if (!resp.ok) throw new Error(`services request failed with status ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error("services response carried an error");
      setServices(data.services || []);
    } catch (err: any) {
      console.error("[buy-numbers] services request failed", err);
      setError("We couldn't load the services for that country. Please try again in a moment.");
    }
    finally { setServicesLoading(false); }
  };

  const fetchOffers = async (country: Country, service: Service) => {
    setOffersLoading(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/offers/${country.code}/${service.code}`, { headers });
      if (!resp.ok) throw new Error("Failed to fetch offers");
      const data = await resp.json();
      setOffers(data.offers || []);
    } catch (err: any) {
      console.error("[buy-numbers] offers request failed", err);
      setError("We couldn't load prices for that service. Please try again in a moment.");
    }
    finally { setOffersLoading(false); }
  };

  const selectCountry = (country: Country) => {
    setSelectedCountry(country);
    setCountrySearch("");
    setStep("services");
    fetchServices(country);
  };

  const selectService = (service: Service) => {
    setSelectedService(service);
    setServiceSearch("");
    setStep("offers");
    if (selectedCountry) fetchOffers(selectedCountry, service);
  };

  const playOtpSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number, gainVal: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(gainVal, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration);
      };

      // Two ascending tones — a gentle "ding-ding" notification
      playTone(880, 0, 0.25, 0.15);
      playTone(1320, 0.12, 0.3, 0.12);

      setTimeout(() => ctx.close(), 800);
    } catch {
      // Audio context may be blocked — silently ignore
    }
  }, []);

  const checkSms = useCallback(async (fivesimId: string) => {
    if (!authHeadersRef.current) return;
    const smsResp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/sms/${fivesimId}`, { headers: authHeadersRef.current });
    const smsData = await smsResp.json().catch(() => ({}));
    setLastChecked(Date.now());
    if (smsData.status === "received" && typeof smsData.smsCode === "string" && smsData.smsCode.trim().length > 0) {
      setSmsStatus("received"); setSmsCode(smsData.smsCode.trim());
      void copyToClipboard(smsData.smsCode.trim());
      notifyOtpReceived();
      playOtpSound();
      if (pollRef.current) clearInterval(pollRef.current);
    } else if (smsData.status === "canceled" || smsData.status === "failed") {
      setSmsStatus(smsData.status);
      if (pollRef.current) clearInterval(pollRef.current);
      if (typeof smsData.expiresAt === "number") setExpiresAt(smsData.expiresAt);
      refreshProfile();
    } else if (typeof smsData.expiresAt === "number") {
      setExpiresAt(smsData.expiresAt);
    }
  }, [playOtpSound, refreshProfile]);

  const handleManualCheck = async () => {
    if (!purchaseResult?.id || manualChecking || smsStatus !== "waiting") return;
    setManualChecking(true);
    try { await checkSms(purchaseResult.id); }
    catch (err) { console.error("[buy-numbers] manual check failed", err); }
    finally { setManualChecking(false); }
  };

  const handleBuy = async (offer: Offer) => {
    if (!selectedCountry || !selectedService) return;
    if ((profile?.wallet_balance ?? 0) < offer.price) { setError("Insufficient wallet balance. Please fund your wallet first."); return; }
    setLoading(true); setError("");
    try {
      const headers = await getAuthHeaders();
      authHeadersRef.current = headers;
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/purchase`, {
        method: "POST", headers,
        body: JSON.stringify({ country: selectedCountry.code, service: selectedService.code, operator: offer.operator }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        // The proxy already returns customer-safe refusals for the cases the
        // customer can act on; everything else becomes a fixed sentence.
        console.error("[buy-numbers] purchase rejected", resp.status, data?.error);
        const reason = resp.status === 400 && typeof data?.error === "string" && data.error.includes("Insufficient")
          ? "Insufficient wallet balance. Please fund your wallet first."
          : resp.status === 429
            ? "Too many purchase attempts. Please wait a minute and try again."
            : "We couldn't complete this purchase. Your wallet has not been charged. Please try again in a moment.";
        setError(reason);
        return;
      }
      setPurchaseResult(data);
      setSmsStatus("waiting");
      setSmsCode(null);
      setLastChecked(Date.now());
      setExpiresAt(toEpochMs(data.expiresAt) ?? (Date.now() + DEFAULT_RENTAL_MS));
      setStep("result");
      refreshProfile();
      pollRef.current = window.setInterval(() => { checkSms(data.id); }, 5000);
    } catch (err: any) {
      console.error("[buy-numbers] purchase failed", err);
      setError("We couldn't complete this purchase. Please try again in a moment.");
    }
    finally { setLoading(false); }
  };

  const handleCancel = async () => {
    if (!purchaseResult?.id) return;
    const headers = await getAuthHeaders();
    try {
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/cancel/${purchaseResult.id}`, { method: "POST", headers });
      if (!resp.ok) {
        // The server refuses to cancel a number whose code already arrived. Never
        // show the number as canceled (and refunded) unless the server agreed.
        console.error("[buy-numbers] cancel rejected", resp.status);
        setError(
          resp.status === 409
            ? "This number can no longer be canceled. If its code already arrived, it has been used."
            : "We couldn't cancel this number. Please try again in a moment."
        );
        return;
      }
      setSmsStatus("canceled");
      if (pollRef.current) clearInterval(pollRef.current);
      refreshProfile();
    } catch (err: any) {
      console.error("[buy-numbers] cancel failed", err);
      setError("We couldn't cancel this number. Please try again in a moment.");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
  };
  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep("country"); setSelectedCountry(null); setSelectedService(null);
    setServices([]); setOffers([]); setPurchaseResult(null);
    setSmsStatus("waiting"); setSmsCode(null);
    setExpiresAt(null); setRemainingMs(0); setLastChecked(null); setError(""); setCodeCopied(false);
  };

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const popularCountryCodes = new Set(POPULAR_COUNTRIES.map(c => c.code));
  const filteredCountries = countries.filter(c => c.name.toLowerCase().includes(countrySearch.toLowerCase()));
  const popularFilteredCountries = filteredCountries.filter(c => popularCountryCodes.has(c.code));
  const otherFilteredCountries = filteredCountries.filter(c => !popularCountryCodes.has(c.code));
  const popularCountryOrder = (code: string) => {
    const idx = POPULAR_COUNTRIES.findIndex(c => c.code === code);
    return idx === -1 ? 999 : idx;
  };
  popularFilteredCountries.sort((a, b) => popularCountryOrder(a.code) - popularCountryOrder(b.code));

  const popularServiceCodes = new Set(POPULAR_SERVICES.map(s => s.code));
  const filteredServices = services.filter(s => s.name.toLowerCase().includes(serviceSearch.toLowerCase()) || s.code.toLowerCase().includes(serviceSearch.toLowerCase()));
  const popularFilteredServices = filteredServices.filter(s => popularServiceCodes.has(s.code));
  const otherFilteredServices = filteredServices.filter(s => !popularServiceCodes.has(s.code));
  const popularServiceOrder = (code: string) => {
    const idx = POPULAR_SERVICES.findIndex(s => s.code === code);
    return idx === -1 ? 999 : idx;
  };
  popularFilteredServices.sort((a, b) => popularServiceOrder(a.code) - popularServiceOrder(b.code));

  const bestPrice = offers.length > 0 ? Math.min(...offers.map(o => o.price)) : 0;

  const steps = [
    { id: "country", label: "Country" },
    { id: "services", label: "Service" },
    { id: "offers", label: "Operators" },
    { id: "result", label: "Result" },
  ];
  const stepOrder = steps.map(s => s.id);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Buy Numbers" subtitle="Purchase temporary phone numbers for OTP verification" />
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        {steps.map((s, i) => {
          const isActive = stepOrder.indexOf(step) >= i;
          return (
            <div key={s.id} className="flex items-center gap-2 flex-shrink-0">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${isActive ? "bg-royal-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${isActive ? "bg-white/20" : "bg-slate-200"}`}>{i + 1}</span>{s.label}
              </div>
              {i < 3 && <ChevronDown className="w-3 h-3 text-slate-300 -rotate-90" />}
            </div>
          );
        })}
      </div>
      {error && <div className="mb-4 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">{error}</div>}

      {step === "country" && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-2"><MapPin className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900">Select a Country</h2></div>
          <p className="text-sm text-slate-500 mb-6">Choose which country you want a phone number from</p>
          {countriesLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3"><Loader2 className="w-6 h-6 text-royal-600 animate-spin" /><p className="text-sm text-slate-500">{countryRetryCount > 0 ? `Retrying... (attempt ${countryRetryCount}/3)` : "Loading available countries..."}</p></div>
          ) : countriesError ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-error-50 border border-error-200 rounded-lg"><AlertCircle className="w-4 h-4 text-error-600 mt-0.5 shrink-0" /><div><p className="text-sm font-medium text-error-700">Failed to load countries</p><p className="text-xs text-error-600 mt-1">{countriesError}</p></div></div>
              <button onClick={() => fetchCountries()} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-royal-700 bg-royal-50 rounded-lg hover:bg-royal-100 transition-colors"><RefreshCw className="w-4 h-4" /> Retry</button>
            </div>
          ) : (
            <div className="relative">
              <Input value={countrySearch} onChange={setCountrySearch} placeholder="Search 190+ countries..." icon={<Search className="w-4 h-4" />} />
              <div className="mt-3 max-h-96 overflow-y-auto space-y-1">
                {filteredCountries.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No countries match your search</p> : (<>
                  {popularFilteredCountries.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                        <TrendingUp className="w-3.5 h-3.5 text-royal-500" />
                        <span className="text-xs font-bold text-royal-600 uppercase tracking-wide">Most Popular Countries</span>
                      </div>
                      {popularFilteredCountries.map(country => (
                        <button key={country.code} onClick={() => selectCountry(country)} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-royal-50 transition-base text-left">
                          <span className="text-sm font-medium text-navy-900 flex items-center gap-2">
                            <span className="text-base">{countryFlag(country.code)}</span>
                            {country.name}
                          </span>
                          <span className="text-xs text-slate-400 uppercase">{country.code}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {otherFilteredCountries.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                        <Globe className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">All Countries</span>
                      </div>
                      {otherFilteredCountries.map(country => (
                        <button key={country.code} onClick={() => selectCountry(country)} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-base text-left">
                          <span className="text-sm font-medium text-navy-900 flex items-center gap-2">
                            <span className="text-base">{countryFlag(country.code)}</span>
                            {country.name}
                          </span>
                          <span className="text-xs text-slate-400 uppercase">{country.code}</span>
                        </button>
                      ))}
                    </>
                  )}
                </>)}
              </div>
            </div>
          )}
        </Card>
      )}

      {step === "services" && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Search className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900">Select a Service</h2></div>
            <button onClick={() => setStep("country")} className="text-sm text-slate-500 hover:text-navy-900 inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Change country</button>
          </div>
          <p className="text-sm text-slate-500 mb-4">Country: <span className="font-semibold text-navy-900 inline-flex items-center gap-1.5"><span className="text-base">{selectedCountry ? countryFlag(selectedCountry.code) : ""}</span>{selectedCountry?.name}</span></p>
          {servicesLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3"><Loader2 className="w-6 h-6 text-royal-600 animate-spin" /><p className="text-sm text-slate-500">Loading services for {selectedCountry?.name}...</p></div>
          ) : services.length === 0 ? (
            <EmptyState icon={<Search className="w-7 h-7" />} title="No services available" message="No services found for this country. Try another country." />
          ) : (
            <div className="relative">
              <Input value={serviceSearch} onChange={setServiceSearch} placeholder="Search services..." icon={<Search className="w-4 h-4" />} />
              <div className="mt-3 max-h-96 overflow-y-auto space-y-1">
                {filteredServices.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No services match your search</p> : (<>
                  {popularFilteredServices.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                        <TrendingUp className="w-3.5 h-3.5 text-royal-500" />
                        <span className="text-xs font-bold text-royal-600 uppercase tracking-wide">Most Popular Services</span>
                      </div>
                      {popularFilteredServices.map(service => {
                        const popular = POPULAR_SERVICES.find(s => s.code === service.code);
                        return (
                          <button key={service.code} onClick={() => selectService(service)} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-royal-50 transition-base text-left">
                            <span className="text-sm font-medium text-navy-900">{popular?.name || service.name}</span>
                            <ArrowRight className="w-4 h-4 text-slate-300" />
                          </button>
                        );
                      })}
                    </>
                  )}
                  {otherFilteredServices.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                        <Package className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">All Services</span>
                      </div>
                      {otherFilteredServices.map(service => (
                        <button key={service.code} onClick={() => selectService(service)} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-base text-left">
                          <span className="text-sm font-medium text-navy-900 capitalize">{service.name}</span>
                          <ArrowRight className="w-4 h-4 text-slate-300" />
                        </button>
                      ))}
                    </>
                  )}
                </>)}
              </div>
            </div>
          )}
        </Card>
      )}

      {step === "offers" && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900">Available Operators</h2></div>
            <button onClick={() => setStep("services")} className="text-sm text-slate-500 hover:text-navy-900 inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Change service</button>
          </div>
          <div className="flex items-center gap-2 mb-6">
            <span className="text-sm text-slate-500 inline-flex items-center gap-1.5"><span className="text-base">{selectedCountry ? countryFlag(selectedCountry.code) : ""}</span>{selectedCountry?.name}</span>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500 capitalize">{selectedService?.name}</span>
          </div>
          {offersLoading ? <div className="flex flex-col items-center justify-center py-12 gap-3"><Loader2 className="w-6 h-6 text-royal-600 animate-spin" /><p className="text-sm text-slate-500">Fetching live prices...</p></div> :
           offers.length === 0 ? <EmptyState icon={<ShoppingBag className="w-7 h-7" />} title="No numbers in stock" message="No numbers available for this service and country. Try a different service or country." /> : (
            <div className="space-y-3">
              {offers.map((offer, i) => {
                const isBest = offer.price === bestPrice && offers.length > 1;
                const stockLevel = offer.stock > 100 ? "high" : offer.stock > 20 ? "medium" : "low";
                return (
                  <div key={i} className={`relative flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border transition-all duration-200 ${isBest ? "border-success-400 bg-success-50/30" : "border-slate-200 hover:border-royal-300 hover:shadow-sm"}`}>
                    {isBest && <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-success-500 text-white text-xs font-bold rounded-full flex items-center gap-1"><TrendingUp className="w-3 h-3" /> BEST PRICE</div>}
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${offer.operator === "any" ? "bg-gradient-to-br from-royal-500 to-royal-700" : "bg-gradient-to-br from-slate-100 to-slate-200"}`}><Phone className={`w-5 h-5 ${offer.operator === "any" ? "text-white" : "text-slate-600"}`} /></div>
                      <div>
                        <p className="font-bold text-navy-900 capitalize">{offer.operator === "any" ? "Any Operator" : offer.operator}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span className={`w-2 h-2 rounded-full ${stockLevel === "high" ? "bg-success-500" : stockLevel === "medium" ? "bg-warning-500" : "bg-error-500"}`} />
                            <span className={`font-medium ${stockLevel === "high" ? "text-success-600" : stockLevel === "medium" ? "text-warning-600" : "text-error-600"}`}>{offer.stock.toLocaleString()} in stock</span>
                          </span>
                          {offer.rate > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <TrendingUp className="w-3 h-3" /> {offer.rate}% success
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-auto">
                      <div className="text-right">
                        <p className="text-lg font-bold text-navy-900">{formatNaira(offer.price)}</p>
                        <p className="text-xs text-slate-400">per number</p>
                      </div>
                      <Button onClick={() => handleBuy(offer)} loading={loading} disabled={loading || (profile?.wallet_balance ?? 0) < offer.price} className="min-w-[96px] min-h-[44px]">Buy</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {offers.length > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <Package className="w-3.5 h-3.5" /> Prices are all-inclusive. Stock updates in real-time.
            </div>
          )}
        </Card>
      )}

      {step === "result" && purchaseResult && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2"><Phone className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900">Active Number</h2></div>
            <button onClick={handleReset} className="text-sm text-royal-600 hover:text-royal-700 font-medium inline-flex items-center gap-1">Buy another <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>

          {/* Phone number card — always visible */}
          <div className="bg-gradient-to-br from-navy-900 to-royal-800 rounded-xl p-5 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-royal-200 text-xs font-medium mb-1">Phone Number</p>
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-bold text-white tracking-wide">{purchaseResult.phone}</p>
                  <button onClick={() => handleCopy(purchaseResult.phone)} className="text-white/60 hover:text-white transition-colors">{copied ? <Check className="w-4 h-4 text-success-400" /> : <Copy className="w-4 h-4" />}</button>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-royal-200">
                  <span>Service: <span className="text-white font-medium capitalize">{selectedService?.name}</span></span>
                  <span>Operator: <span className="text-white font-medium capitalize">{purchaseResult.operator}</span></span>
                </div>
              </div>
              {/* Status badge in the number card */}
              <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${smsStatus === "received" ? "bg-success-500/20 text-success-300" : smsStatus === "canceled" ? "bg-warning-500/20 text-warning-300" : smsStatus === "failed" ? "bg-error-500/20 text-error-300" : "bg-royal-500/20 text-royal-200"}`}>
                {smsStatus === "received" && <CheckCircle className="w-3.5 h-3.5" />}
                {smsStatus === "waiting" && <Clock className="w-3.5 h-3.5" />}
                {smsStatus === "canceled" && <XCircle className="w-3.5 h-3.5" />}
                {smsStatus === "failed" && <XCircle className="w-3.5 h-3.5" />}
                {smsStatus === "received" ? "OTP Received" : smsStatus === "waiting" ? "Waiting" : smsStatus === "canceled" ? "Canceled" : "Timed Out"}
              </div>
            </div>
          </div>

          {/* Countdown timer — visible while waiting and after received (showing time remaining) */}
          {expiresAt && remainingMs > 0 && (smsStatus === "waiting" || smsStatus === "received") && (
            <div className={`flex items-center justify-between mb-4 rounded-xl border p-4 transition-colors ${remainingMs < 60000 ? "border-error-300 bg-error-50" : remainingMs < 180000 ? "border-warning-300 bg-warning-50" : "border-royal-200 bg-royal-50"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${remainingMs < 60000 ? "bg-error-100" : remainingMs < 180000 ? "bg-warning-100" : "bg-royal-100"}`}>
                  <Timer className={`w-5 h-5 ${remainingMs < 60000 ? "text-error-600" : remainingMs < 180000 ? "text-warning-600" : "text-royal-600"}`} />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">{smsStatus === "received" ? "Number still active for" : "Number expires in"}</p>
                  <p className={`text-xl font-bold tabular-nums ${remainingMs < 60000 ? "text-error-700" : remainingMs < 180000 ? "text-warning-700" : "text-royal-700"}`}>{formatCountdown(remainingMs)}</p>
                </div>
              </div>
              {lastChecked && (
                <p className="text-xs text-slate-400">Last checked: {new Date(lastChecked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
              )}
            </div>
          )}

          {/* Waiting state */}
          {smsStatus === "waiting" && (
            <div className="flex flex-col items-center py-6 mb-2">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-royal-100 flex items-center justify-center">
                  <Clock className="w-8 h-8 text-royal-600" />
                </div>
                <div className="absolute inset-0 animate-ping">
                  <div className="w-16 h-16 rounded-full bg-royal-100/60" />
                </div>
              </div>
              <p className="mt-4 font-semibold text-navy-900 text-lg">Waiting for OTP...</p>
              <p className="text-sm text-slate-500 mt-1">Your SMS will appear here automatically</p>
              <div className="mt-2 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-royal-600 animate-spin" />
                <span className="text-xs text-slate-400">Auto-checking every 5 seconds</span>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={handleManualCheck}
                  disabled={manualChecking}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-royal-600 hover:bg-royal-700 text-white font-semibold text-sm transition-all hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {manualChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {manualChecking ? "Checking..." : "Check SMS Now"}
                </button>
                <Button variant="outline" onClick={handleCancel}>
                  <X className="w-4 h-4" /> Cancel Number
                </Button>
              </div>
            </div>
          )}

          {/* OTP Received — only shown when a valid non-empty code was returned */}
          {smsStatus === "received" && smsCode && smsCode.trim().length > 0 && (
            <div className="space-y-4 mb-2">
              {/* Success indicator */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-success-50 border border-success-200">
                <div className="w-10 h-10 rounded-full bg-success-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="w-5 h-5 text-success-600" />
                </div>
                <div>
                  <p className="font-bold text-success-800">OTP Received!</p>
                  <p className="text-sm text-success-600">Your verification code is ready below</p>
                </div>
              </div>

              {/* OTP code — large, prominent, copyable */}
              {smsCode && (
                <div className="bg-success-50 border-2 border-dashed border-success-300 rounded-xl px-6 py-5 text-center">
                  <p className="text-xs font-medium text-success-600 mb-2 uppercase tracking-wide">Your Verification Code</p>
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <p className="text-4xl font-bold text-success-700 tracking-[0.3em]">{smsCode}</p>
                    <button
                      onClick={() => handleCopyCode(smsCode)}
                      className="p-2 rounded-lg bg-success-100 hover:bg-success-200 text-success-700 transition-colors"
                      title="Copy code"
                    >
                      {codeCopied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                    {expiresAt && remainingMs > 0 && (
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold tabular-nums ${remainingMs < 60000 ? "bg-error-100 text-error-700" : remainingMs < 180000 ? "bg-warning-100 text-warning-700" : "bg-success-100 text-success-700"}`}>
                        <Timer className={`w-4 h-4 ${remainingMs < 60000 ? "animate-pulse" : ""}`} />
                        {formatCountdown(remainingMs)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleCopyCode(smsCode)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-success-600 hover:bg-success-700 text-white text-sm font-medium transition-colors"
                  >
                    {codeCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {codeCopied ? "Copied!" : "Copy Code"}
                  </button>
                </div>
              )}

              {/* Action buttons — stay visible after OTP arrives */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleManualCheck}
                  disabled={manualChecking}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-navy-900 text-sm font-medium transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${manualChecking ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-royal-600 hover:bg-royal-700 text-white text-sm font-medium transition-colors"
                >
                  <ArrowRight className="w-4 h-4" />
                  Buy Another Number
                </button>
              </div>
            </div>
          )}

          {/* Canceled state */}
          {smsStatus === "canceled" && (
            <div className="flex flex-col items-center py-8 mb-2">
              <div className="w-16 h-16 rounded-full bg-warning-100 flex items-center justify-center mb-4"><XCircle className="w-8 h-8 text-warning-600" /></div>
              <p className="font-bold text-navy-900">Number Canceled</p>
              <p className="text-sm text-slate-500 mt-1">This number has been canceled and your wallet has been refunded</p>
              <Button className="mt-4" onClick={handleReset}>Buy Another Number</Button>
            </div>
          )}

          {/* Timed out state */}
          {smsStatus === "failed" && (
            <div className="flex flex-col items-center py-8 mb-2">
              <div className="w-16 h-16 rounded-full bg-error-100 flex items-center justify-center mb-4"><XCircle className="w-8 h-8 text-error-600" /></div>
              <p className="font-bold text-navy-900">Timed Out</p>
              <p className="text-sm text-slate-500 mt-1 text-center">No SMS was received in time. Your wallet has been refunded automatically.</p>
              <Button className="mt-4" onClick={handleReset}>Try Again</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
