import { NextRequest, NextResponse } from "next/server";
import { sendFollowUps } from "@/lib/follow-ups";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const appSecret = process.env.APP_SECRET;

  if (!cronSecret && !appSecret) {
    return NextResponse.json(
      { error: "Neither CRON_SECRET nor APP_SECRET is configured" },
      { status: 500 }
    );
  }

  const isAuth =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (appSecret && authHeader === `Bearer ${appSecret}`);

  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendFollowUps();

  return NextResponse.json(result);
}
