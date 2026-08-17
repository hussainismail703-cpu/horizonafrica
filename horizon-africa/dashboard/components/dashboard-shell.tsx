"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";

export function DashboardShell({ user, children }: { user: { email: string | null } | null; children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col lg:pl-0 overflow-hidden">
        <TopBar user={user} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
