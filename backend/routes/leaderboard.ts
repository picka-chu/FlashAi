import type { Hono } from "hono";
import crypto from "crypto";

type LeaderboardEntry = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  credits: number;
};

function maskName(name: string, fallback = "Anonymous"): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return fallback;
  if (trimmed.length <= 2) return `${trimmed[0]}*`;
  return `${trimmed.slice(0, 2)}${"*".repeat(Math.max(1, trimmed.length - 2))}`;
}

export function registerLeaderboardRoutes(app: Hono, supabase: any) {
  app.get("/api/leaderboard", async (c) => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id,name,credits,photo_url")
        .order("credits", { ascending: false })
        .limit(10);

      if (error) throw error;

      const safeRows: LeaderboardEntry[] = (data || []).map((row: any, index: number) => ({
        // Never expose internal user UUIDs on a public endpoint.
        id: crypto.createHash("sha256").update(String(row.id)).digest("hex").slice(0, 16) || String(index),
        displayName: maskName(row.name),
        avatarUrl: row.photo_url ? String(row.photo_url) : null,
        credits: Number(row.credits || 0),
      }));

      return c.json(safeRows);
    } catch (error) {
      console.error("Leaderboard API error:", error);
      return c.json([], 500);
    }
  });
}
