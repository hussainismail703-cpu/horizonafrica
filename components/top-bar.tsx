"use client";

import { Menu, Bell, HelpCircle, Flame, UserPlus, AlertTriangle, Clock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface TopBarProps {
  user: { email: string | null } | null;
  onMenuClick: () => void;
}

interface AppNotification {
  id: string;
  type: "hot_lead" | "new_lead" | "escalation" | "follow_up_due";
  title: string;
  description: string;
  leadId: number;
  phone?: string;
  timestamp: string;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Overview",
  "/leads": "Leads",
  "/conversations": "Conversations",
  "/broadcasts": "Broadcasts",
  "/reports": "Reports",
  "/products": "Products",
    "/settings": "Settings",
  "/health": "System Health",
};

const typeIcons: Record<AppNotification["type"], typeof Flame> = {
  hot_lead: Flame,
  new_lead: UserPlus,
  escalation: AlertTriangle,
  follow_up_due: Clock,
};

const typeColours: Record<AppNotification["type"], string> = {
  hot_lead: "text-error",
  new_lead: "text-secondary",
  escalation: "text-error",
  follow_up_due: "text-on-surface-variant",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function TopBar({ user, onMenuClick }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = pageTitles[pathname] ?? "Overview";

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifCount, setNotifCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setNotifications(body.notifications ?? []);
      setNotifCount(body.count ?? 0);
    } catch {
      // notification fetch is best-effort
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function openNotification(n: AppNotification) {
    setNotifOpen(false);
    router.push(`/leads?search=${encodeURIComponent(n.phone ?? String(n.leadId))}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface px-8">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="text-on-surface-variant hover:text-on-surface lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h2 className="hidden text-xl font-semibold text-on-surface md:block">{title}</h2>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setNotifOpen((o) => !o);
              if (!notifOpen) loadNotifications();
            }}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-low hover:text-secondary"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {notifCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
                {notifCount > 9 ? "9+" : notifCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div
              data-notifications
              role="menu"
              className="absolute right-0 top-11 z-30 w-80 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface shadow-lg"
            >
              <div className="border-b border-outline-variant/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Notifications
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-on-surface-variant">
                    No notifications
                  </p>
                ) : (
                  notifications.map((n) => {
                    const Icon = typeIcons[n.type] ?? Bell;
                    return (
                      <button
                        key={n.id}
                        role="menuitem"
                        onClick={() => openNotification(n)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low"
                      >
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${typeColours[n.type]}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-on-surface">
                            {n.title}
                          </span>
                          <span className="block truncate text-xs text-on-surface-variant">
                            {n.description}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-on-surface-variant/70">
                          {timeAgo(n.timestamp)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-low hover:text-secondary">
          <HelpCircle className="h-5 w-5" />
        </button>
        <div className="mx-2 h-6 w-px bg-outline-variant/50" />
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="text-xs font-semibold text-on-surface transition-colors hover:text-secondary"
          >
            Sign Out
          </button>
        </form>
        <div className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-xs font-bold text-secondary">
          {user?.email?.charAt(0).toUpperCase() ?? "U"}
        </div>
      </div>
    </header>
  );
}
