"use client";

import { Menu, Bell, HelpCircle } from "lucide-react";
import { usePathname } from "next/navigation";

interface TopBarProps {
  user: { email: string | null } | null;
  onMenuClick: () => void;
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

export function TopBar({ user, onMenuClick }: TopBarProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Overview";
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
        <button className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-low hover:text-secondary">
          <Bell className="h-5 w-5" />
        </button>
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
