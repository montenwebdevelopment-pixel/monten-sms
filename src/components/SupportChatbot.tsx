import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle, X, Send, Headphones, ChevronRight, Sparkles, Ticket, AlertCircle,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase, EDGE_FUNCTION_BASE } from "../lib/supabase";
import { quickReplyTopics, getFaqById } from "../lib/supportFaqs";

// Messages only ever carry PLAIN TEXT. Anything richer (ticket card, links,
// buttons) is described by `kind` and built from trusted code at render time,
// so nothing read back out of storage can control what gets rendered.
type MessageKind = "text" | "contact-human" | "fallback" | "ticket_created" | "auth_required";

const MESSAGE_KINDS: MessageKind[] = ["text", "contact-human", "fallback", "ticket_created", "auth_required"];

interface TicketInfo {
  case_ref: string;
  subject: string;
  status: string;
  priority: string;
}

interface ChatMessage {
  id: string;
  role: "bot" | "user";
  text: string;
  kind: MessageKind;
  timestamp: number;
  ticket?: TicketInfo;
}

const STORAGE_KEY = "monten_support_chat";
const MAX_SAVED = 40;
const MAX_TEXT_LENGTH = 1000;

function isValidSavedMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.length > 0 &&
    m.id.length <= 64 &&
    (m.role === "bot" || m.role === "user") &&
    typeof m.text === "string" &&
    m.text.length <= MAX_TEXT_LENGTH * 2 &&
    typeof m.kind === "string" &&
    MESSAGE_KINDS.includes(m.kind as MessageKind) &&
    typeof m.timestamp === "number" &&
    Number.isFinite(m.timestamp)
  );
}

function loadSavedMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSavedMessage).slice(-MAX_SAVED).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      kind: m.kind,
      timestamp: m.timestamp,
      ticket: typeof (m as any).ticket === "object" && (m as any).ticket ? (m as any).ticket : undefined,
    }));
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_SAVED).map((m) => ({
      id: m.id,
      role: m.role,
      text: typeof m.text === "string" ? m.text.slice(0, MAX_TEXT_LENGTH * 2) : "",
      kind: m.kind,
      timestamp: m.timestamp,
      ticket: m.ticket,
    }));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore quota errors
  }
}

const greetingId = "greeting";
const supportHandle = "@montensmssupport";
const supportUrl = "https://t.me/montensmssupport";
const supportEmail = "support@montensms.com";
const supportEmailUrl = "mailto:support@montensms.com";

function makeGreeting(name?: string, signedIn?: boolean): ChatMessage {
  const firstName = name?.split(" ")[0]?.trim();
  const intro = signedIn
    ? `${firstName ? `Hi ${firstName}! ` : "Hi! "}I'm the MONTEN SMS support assistant. I can check your balance, pull up your transaction history, summarize your spending, review your number orders, check notifications, and help with OTP or payment issues. What can I help with today?`
    : "Hi! I'm the MONTEN SMS support assistant. Sign in so I can look into your account details — meanwhile I can help with general questions about pricing, how MONTEN SMS works, and more.";
  return { id: greetingId, role: "bot", text: intro, kind: "text", timestamp: Date.now() };
}

const FALLBACK_TEXT =
  "I want to make sure I help you with the right thing. Could you tell me a bit more about what's going on? I can look into deposits, wallet balance, number orders, OTP issues, payments, or escalate to our human team.";

interface AgentResponse {
  reply: string;
  kind?: MessageKind;
  ticket?: TicketInfo;
  actions_taken?: string[];
}

async function callSupportAgent(message: string, history: { role: "user" | "assistant"; text: string }[]): Promise<AgentResponse | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) return null;

    const res = await fetch(`${EDGE_FUNCTION_BASE}/support-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message, history }),
    });

    if (res.status === 401) return null;

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { reply: body?.error ?? "I had trouble looking that up. Please try again in a moment.", kind: "fallback" };
    }
    return {
      reply: typeof body.reply === "string" ? body.reply : "I'm not sure how to help with that yet. Could you rephrase?",
      kind: (body.kind as MessageKind) ?? "text",
      ticket: body.ticket,
      actions_taken: body.actions_taken,
    };
  } catch {
    return { reply: "I couldn't reach the server just now. Please check your connection and try again.", kind: "fallback" };
  }
}

export function SupportChatbot() {
  const { profile, session } = useAuth();
  const signedIn = Boolean(session?.user);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const saved = loadSavedMessages();
    if (saved.length > 0) {
      setMessages(saved);
      setShowQuickReplies(false);
    } else {
      setMessages([makeGreeting(profile?.full_name, signedIn)]);
    }
  }, [profile?.full_name, signedIn]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    if (!open && messages.length > 0) {
      setUnread(true);
    }
  }, [messages.length, open]);

  useEffect(() => {
    if (messages.length > 0) saveMessages(messages);
  }, [messages]);

  const addMessage = (msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const conversationHistory = useCallback(
    (): { role: "user" | "assistant"; text: string }[] =>
      messages.slice(-12).map((m) => ({ role: m.role === "bot" ? "assistant" : "user", text: m.text })),
    [messages]
  );

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed.slice(0, MAX_TEXT_LENGTH),
      kind: "text",
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setInput("");
    setShowQuickReplies(false);
    setTyping(true);

    if (!signedIn) {
      // Not signed in: answer from the static FAQ knowledge base only, and
      // remind the user to sign in for account-specific help.
      setTimeout(() => {
        setTyping(false);
        const faq = getFaqById("general-faq");
        addMessage({
          id: `b-${Date.now()}`,
          role: "bot",
          text: faq?.answer ?? FALLBACK_TEXT,
          kind: "fallback",
          timestamp: Date.now(),
        });
        setShowQuickReplies(true);
        scrollToBottom();
      }, 500);
      return;
    }

    const result = await callSupportAgent(trimmed, conversationHistory());
    setTyping(false);

    if (!result) {
      addMessage({
        id: `b-${Date.now()}`,
        role: "bot",
        text: "Please sign in so I can look into your account details. For general questions about how MONTEN SMS works, I can still help right now.",
        kind: "auth_required",
        timestamp: Date.now(),
      });
      setShowQuickReplies(true);
      scrollToBottom();
      return;
    }

    addMessage({
      id: `b-${Date.now()}`,
      role: "bot",
      text: result.reply.slice(0, MAX_TEXT_LENGTH * 2),
      kind: result.kind ?? "text",
      timestamp: Date.now(),
      ticket: result.ticket,
    });
    if (result.kind === "fallback") setShowQuickReplies(true);
    scrollToBottom();
  };

  const handleQuickReply = (id: string) => {
    if (id === "contact-human") {
      addMessage({
        id: `u-${Date.now()}`,
        role: "user",
        text: "Contact human support",
        kind: "text",
        timestamp: Date.now(),
      });
      setShowQuickReplies(false);
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        addMessage({
          id: `b-${Date.now()}`,
          role: "bot",
          text: `You can reach our human support team on Telegram at ${supportHandle} or by email at ${supportEmail}. They typically respond within a few minutes.`,
          kind: "contact-human",
          timestamp: Date.now(),
        });
        scrollToBottom();
      }, 500);
      return;
    }

    const entry = getFaqById(id);
    if (!entry) return;

    addMessage({
      id: `u-${Date.now()}`,
      role: "user",
      text: entry.question,
      kind: "text",
      timestamp: Date.now(),
    });
    setShowQuickReplies(false);

    // Quick replies go through the agent when signed in, so they get
    // account-aware answers (e.g. "Balance" pulls the real balance).
    if (signedIn) {
      setTyping(true);
      callSupportAgent(entry.question, conversationHistory()).then((result) => {
        setTyping(false);
        if (!result) {
          addMessage({
            id: `b-${Date.now()}`,
            role: "bot",
            text: "Please sign in so I can look into your account details.",
            kind: "auth_required",
            timestamp: Date.now(),
          });
          setShowQuickReplies(true);
        } else {
          addMessage({
            id: `b-${Date.now()}`,
            role: "bot",
            text: result.reply.slice(0, MAX_TEXT_LENGTH * 2),
            kind: result.kind ?? "text",
            timestamp: Date.now(),
            ticket: result.ticket,
          });
          if (result.kind === "fallback") setShowQuickReplies(true);
        }
        scrollToBottom();
      });
      return;
    }

    // Not signed in: answer directly from the FAQ entry.
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      addMessage({
        id: `b-${Date.now()}`,
        role: "bot",
        text: entry.answer,
        kind: "text",
        timestamp: Date.now(),
      });
      scrollToBottom();
    }, 400 + Math.random() * 200);
  };

  const handleOpen = () => {
    setOpen(true);
    setUnread(false);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const clearChat = () => {
    setMessages([makeGreeting(profile?.full_name, signedIn)]);
    setShowQuickReplies(true);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const renderBody = (msg: ChatMessage) => {
    if (msg.kind === "contact-human") {
      return (
        <span>
          You can reach our human support team on Telegram at{" "}
          <a
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-royal-600 hover:text-royal-700 underline underline-offset-2"
          >
            {supportHandle}
          </a>{" "}
          or by email at{" "}
          <a
            href={supportEmailUrl}
            className="font-semibold text-royal-600 hover:text-royal-700 underline underline-offset-2"
          >
            {supportEmail}
          </a>
          . They typically respond within a few minutes.
        </span>
      );
    }
    if (msg.kind === "fallback") {
      return (
        <span>
          {msg.text}{" "}
          <button
            onClick={() => handleQuickReply("contact-human")}
            className="font-semibold text-royal-600 hover:text-royal-700 underline underline-offset-2"
          >
            Contact human support
          </button>
          .
        </span>
      );
    }
    if (msg.kind === "auth_required") {
      return (
        <span className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-warning-600" />
          <span>{msg.text}</span>
        </span>
      );
    }
    if (msg.kind === "ticket_created" && msg.ticket) {
      const t = msg.ticket;
      return (
        <span>
          {msg.text}
          <span className="mt-2 flex items-start gap-2 rounded-lg bg-royal-50 border border-royal-200 p-2.5 text-xs">
            <Ticket className="w-4 h-4 mt-0.5 flex-shrink-0 text-royal-600" />
            <span>
              <span className="font-semibold text-navy-900">Case {t.case_ref}</span>
              <br />
              Status: <span className="font-medium text-navy-900">{t.status}</span> · Priority:{" "}
              <span className="font-medium text-navy-900">{t.priority}</span>
            </span>
          </span>
        </span>
      );
    }
    return msg.text;
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={handleOpen}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-royal-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-royal-700 hover:shadow-xl group"
          aria-label="Open MONTEN Support chat"
          title="Open MONTEN Support chat"
        >
          <div className="relative">
            <MessageCircle className="w-6 h-6" />
            {unread && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-error-500 rounded-full border-2 border-royal-600" />
            )}
          </div>
          <span className="absolute inset-0 rounded-full bg-royal-600 animate-ping opacity-10 pointer-events-none" />
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] sm:w-96 max-w-[400px] h-[min(600px,calc(100vh-3rem))] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-navy-900 to-royal-800 text-white flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-royal-200" />
              </div>
              <div>
                <p className="font-bold text-sm leading-tight">MONTEN Support</p>
                <p className="text-xs text-royal-200 leading-tight flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-success-400 rounded-full" /> {signedIn ? "AI Assistant online" : "Sign in for account help"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-base"
                aria-label="Clear chat"
                title="Clear chat"
              >
                <X className="w-4 h-4 opacity-60" />
              </button>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-base"
                aria-label="Close chat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                    msg.role === "user"
                      ? "bg-royal-600 text-white rounded-br-md"
                      : msg.kind === "auth_required"
                      ? "bg-warning-50 text-navy-900 border border-warning-200 rounded-bl-md"
                      : "bg-white text-navy-900 border border-slate-200 rounded-bl-md"
                  }`}
                >
                  {renderBody(msg)}
                  <span
                    className={`block text-[10px] mt-1 ${msg.role === "user" ? "text-royal-200" : "text-slate-400"}`}
                  >
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            ))}

            {typing && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            {/* Quick reply buttons */}
            {showQuickReplies && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-slate-400 font-medium px-1">Quick replies:</p>
                <div className="flex flex-wrap gap-2">
                  {quickReplyTopics.slice(0, 8).map((id) => {
                    const entry = getFaqById(id);
                    if (!entry) return null;
                    return (
                      <button
                        key={id}
                        onClick={() => handleQuickReply(id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-royal-200 text-royal-700 text-xs font-medium hover:bg-royal-50 hover:border-royal-300 transition-base"
                      >
                        {entry.question}
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => handleQuickReply("contact-human")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-navy-900 text-white text-xs font-medium hover:bg-navy-800 transition-base"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  Contact Human Support
                </button>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-3 bg-white border-t border-slate-200 flex-shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder="Type your question..."
              maxLength={MAX_TEXT_LENGTH}
              className="flex-1 px-4 py-2.5 rounded-full border border-slate-300 bg-slate-50 text-navy-900 placeholder-slate-400 text-sm input-focus transition-base"
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || typing}
              className="w-10 h-10 rounded-full bg-royal-600 hover:bg-royal-700 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-base flex-shrink-0"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
