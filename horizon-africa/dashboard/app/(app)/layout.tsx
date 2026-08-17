import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell user={{ email: user.email ?? null }}>
      {children}
    </DashboardShell>
  );
}
