"use client";

import { useState, useMemo } from "react";
import { Conversation, LeadScore } from "@/lib/types";
import { extractMessageText } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { ScoreBadge } from "@/components/score-badge";
import { Search, X, MessageSquare, Bot, Send } from "lucide-react";

interface ConversationViewProps {
  conversations: Conversation[];
  // Live lead scores keyed by phone — conversation rows only snapshot the
  // score at message time, so callers can pass current values to overlay.
  leadScores?: Record<string, LeadScore>;
}

const scoreOptions: (LeadScore | "ALL")[] = ["ALL", "HOT", "WARM", "COLD"];

export function ConversationView({ conversations, leadScores }: ConversationViewProps) {
  const [search, setSearch] = useState("");
  const [scoreFilter, setScoreFilter] = useState<LeadScore | "ALL">("ALL");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const scoreOf = (c: Conversation): LeadScore =>
    leadScores?.[c.phone_number] ?? c.lead_score;

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const matchesSearch =
        !search ||
        c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.phone_number.includes(search);
      const matchesScore = scoreFilter === "ALL" || scoreOf(c) === scoreFilter;
      return matchesSearch && matchesScore;
    });
  }, [conversations, leadScores, search, scoreFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    filtered.forEach((c) => {
      const key = c.phone_number;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aLast = a[1][0];
      const bLast = b[1][0];
      return new Date(bLast.created_at).getTime() - new Date(aLast.created_at).getTime();
    });
  }, [filtered]);

  const selectedMessages = selectedPhone
    ? conversations.filter((c) => c.phone_number === selectedPhone).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];

  return (
    <div className="flex h-[calc(100vh-180px)] gap-4">
      {/* Conversation List Pane */}
      <div className="flex w-full flex-col rounded-xl border border-surface-variant bg-surface-container-lowest lg:w-[340px] lg:shrink-0">
        <div className="border-b border-outline-variant/30 p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/50" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-low py-2.5 pl-10 pr-4 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
            />
          </div>
          <div className="flex gap-2">
            {scoreOptions.map((s) => (
              <button
                key={s}
                onClick={() => setScoreFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  scoreFilter === s
                    ? "bg-secondary text-on-secondary"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {s === "ALL" ? "All" : s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {grouped.length > 0 ? (
            grouped.map(([phone, msgs]) => {
              const last = msgs[0];
              const isSelected = selectedPhone === phone;
              return (
                <button
                  key={phone}
                  onClick={() => setSelectedPhone(phone)}
                  className={`w-full rounded-lg p-3 text-left transition ${
                    isSelected ? "bg-surface-container-high" : "hover:bg-surface-container-low"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {last.contact_name ?? phone}
                    </p>
                    <ScoreBadge score={scoreOf(last)} />
                  </div>
                  <p className="mt-1 truncate text-xs text-on-surface-variant">
                    {extractMessageText(last.incoming_message) ?? extractMessageText(last.ai_response) ?? last.ai_response ?? "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-on-surface-variant/60">
                    {msgs.length} messages · {formatDate(last.created_at)}
                  </p>
                </button>
              );
            })
          ) : (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              No conversations found.
            </p>
          )}
        </div>
      </div>

      {/* Chat Window Pane */}
      <div className="hidden flex-1 flex-col rounded-xl border border-surface-variant bg-surface-container-lowest lg:flex">
        {selectedPhone ? (
          <div className="flex h-full flex-col">
            {/* Chat Header */}
            <div className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-sm font-bold text-secondary">
                  {(selectedMessages[0]?.contact_name ?? selectedPhone).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-on-surface">
                    {selectedMessages[0]?.contact_name ?? selectedPhone}
                  </p>
                  <p className="text-xs text-on-surface-variant">{selectedPhone}</p>
                </div>
              </div>
              <button onClick={() => setSelectedPhone(null)} className="text-on-surface-variant hover:text-on-surface">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {selectedMessages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  {msg.incoming_message && (
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
                        <MessageSquare className="h-4 w-4 text-on-surface-variant" />
                      </div>
                      <div className="rounded-lg rounded-tl-sm bg-surface-container-low px-4 py-2.5 max-w-[70%]">
                        <p className="text-sm text-on-surface">{extractMessageText(msg.incoming_message)}</p>
                        <p className="mt-1 text-[11px] text-on-surface-variant/60">
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  )}
                  {msg.ai_response && (
                    <div className="flex items-start gap-2 justify-end">
                      <div className="rounded-lg rounded-tr-sm bg-secondary px-4 py-2.5 max-w-[70%]">
                        <p className="text-sm text-on-secondary">{extractMessageText(msg.ai_response) ?? msg.ai_response}</p>
                        <p className="mt-1 text-[11px] text-on-secondary/70">
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary-container/20">
                        <Bot className="h-4 w-4 text-secondary" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Input Area (decorative - matches stitch design) */}
            <div className="border-t border-outline-variant/30 p-4">
              <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2.5">
                <input
                  type="text"
                  placeholder="Type a message... (read-only)"
                  disabled
                  className="flex-1 bg-transparent text-sm text-on-surface-variant placeholder:text-on-surface-variant/50 focus:outline-none"
                />
                <button
                  disabled
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-on-secondary disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-on-surface-variant/50">
                AI responses are automated via n8n workflow
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-12 w-12 text-on-surface-variant/30" />
              <p className="text-sm text-on-surface-variant">
                Select a conversation to view message history
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
