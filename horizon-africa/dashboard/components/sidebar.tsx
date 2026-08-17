"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, MessageSquare, Radio, Settings, X, Plus, HelpCircle, LogOut, BarChart3, Bell, FileText, Package, HeartPulse } from "lucide-react";
import logo from "@/app/assets/logo.png";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/broadcasts", label: "Broadcasts", icon: Radio },
  { href: "/follow-ups", label: "Follow-Ups", icon: Bell },
  { href: "/templates", label: "Templates", icon: FileText },
    { href: "/products", label: "Products", icon: Package },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/health", label: "System Health", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[260px] transform border-r border-outline-variant/50 bg-white transition-transform duration-200 lg:static lg:translate-x-0 flex flex-col py-6 px-4 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="mb-6 flex items-center justify-between px-4">
          <Image
            src={logo}
            alt="Horizon Africa"
            className="h-20 w-auto object-contain"
            priority
          />
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* New Broadcast CTA */}
        <div className="mb-6">
          <Link
            href="/broadcasts"
            onClick={onClose}
            className="flex w-full items-center justify-start gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            New Broadcast
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-surface-container-highest text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="#"
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-xs font-semibold text-on-surface-variant transition-all hover:bg-surface-container hover:text-on-surface"
          >
            <HelpCircle className="h-5 w-5" />
            Help Center
          </Link>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-xs font-semibold text-on-surface-variant transition-all hover:bg-surface-container hover:text-on-surface"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
          </form>
        </nav>
      </aside>
    </>
  );
}
