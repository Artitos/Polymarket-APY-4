import { NextRequest, NextResponse } from "next/server";
import { scan, scanLiquidity, type ScanParams } from "@/lib/polymarket";

// Se ejecuta en el server (no en el browser): evita problemas de CORS con el Gamma API.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // segundos (límite del plan Hobby de Vercel)

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") === "liquidity" ? "liquidity" : "holding";

  try {
    if (mode === "liquidity") {
      const maxPages = clamp(num(sp.get("maxPages"), 6), 1, 20);
      const minPool = Math.max(0, num(sp.get("minPool"), 0));
      const result = await scanLiquidity(maxPages, minPool);
      return NextResponse.json(
        { ok: true, mode, ...result },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const params: ScanParams = {
      minApy: clamp(num(sp.get("minApy"), 4), 0, 1000),
      minProb: clamp(num(sp.get("minProb"), 0), 0, 100),
      minLiquidity: Math.max(0, num(sp.get("minLiquidity"), 0)),
      maxPages: clamp(num(sp.get("maxPages"), 6), 1, 20),
      includeNonReward: sp.get("includeNonReward") === "true",
    };
    const result = await scan(params);
    return NextResponse.json(
      { ok: true, mode, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function num(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
