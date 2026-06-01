/**
 * lib/polymarket.ts
 *
 * Lógica central del scanner:
 *  1. Trae markets abiertos del Gamma API público de Polymarket (sin auth).
 *  2. Detecta, para cada market, si tiene "Holding Rewards" habilitados (el 4% APY).
 *  3. Calcula datos de apoyo (probabilidad implícita, días a resolución, yield de
 *     bonding hold-to-$1 como referencia) y devuelve una lista ordenable.
 *
 * El programa de Holding Rewards de Polymarket aplica una tasa uniforme (hoy 4.00%
 * anualizada) sobre una lista curada de markets elegibles. El Gamma API expone un
 * flag por market. Como el nombre exacto del campo puede variar entre versiones del
 * API, la detección es robusta: revisa nombres candidatos y además escanea el objeto
 * en profundidad buscando cualquier campo cuyo nombre indique holding reward.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";

/* ----------------------------- Tipos ----------------------------- */

export interface ScanParams {
  /** APY mínimo (%) para incluir un market. Default 4. */
  minApy: number;
  /** Probabilidad implícita mínima del favorito (%) para incluir. Default 0 (sin filtro). */
  minProb: number;
  /** Liquidez mínima en USDC. Default 0. */
  minLiquidity: number;
  /** Cuántas páginas de 500 markets escanear. Más = más cobertura, más lento. Default 6. */
  maxPages: number;
  /** Si true incluye markets aunque no tenga reward detectado (para inspección). Default false. */
  includeNonReward: boolean;
}

export interface RewardEvidence {
  key: string;
  value: unknown;
}

export interface Opportunity {
  id: string;
  question: string;
  slug: string;
  url: string;
  /** APY de holding reward (%). Si solo hay flag booleano se asume la tasa del programa (4%). */
  holdingApy: number | null;
  /** true si la tasa es asumida (flag sin valor numérico explícito). */
  apyAssumed: boolean;
  /** Outcome favorito (mayor precio) y su precio = probabilidad implícita. */
  favoriteOutcome: string;
  favoritePrice: number; // 0..1
  impliedProb: number; // %
  bestAsk: number | null;
  spread: number | null;
  endDate: string | null;
  daysToResolution: number | null;
  /** Yield de bonding (comprar favorito y mantener hasta $1) anualizado compuesto, % — referencia. */
  bondApy: number | null;
  liquidity: number;
  volume24hr: number;
  volume: number;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  /** Campos crudos donde se detectó el reward (para debug/transparencia). */
  evidence: RewardEvidence[];
}

export interface ScanResult {
  scannedAt: string;
  marketsScanned: number;
  found: number;
  params: ScanParams;
  opportunities: Opportunity[];
}

/* ------------------------- Utilidades ------------------------- */

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Parsea arrays que el Gamma API a veces devuelve como string JSON. */
function parseMaybeJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Normaliza una tasa cruda a porcentaje. Acepta fracción (0.04), % (4) o bps (400). */
function normalizeRateToPct(raw: number): number {
  if (raw <= 1) return raw * 100; // fracción -> %
  if (raw <= 100) return raw; // ya en %
  return raw / 100; // asumir basis points
}

const HOLDING_KEY_RE =
  /(holding.*(reward|rate|apr|apy|yield))|((reward|rate|apr|apy|yield).*holding)/i;

/**
 * Detecta holding rewards en un objeto market.
 * Devuelve { eligible, ratePct, assumed, evidence }.
 */
function detectHoldingReward(market: Record<string, unknown>): {
  eligible: boolean;
  ratePct: number | null;
  assumed: boolean;
  evidence: RewardEvidence[];
} {
  const evidence: RewardEvidence[] = [];
  let eligible = false;
  let ratePct: number | null = null;

  // 1) Nombres exactos candidatos (boolean = habilitado).
  const boolKeys = [
    "holdingRewardsEnabled",
    "enableHoldingRewards",
    "hasHoldingRewards",
    "holdingRewardActive",
    "holdingRewardsActive",
    "holdingReward",
  ];
  for (const k of boolKeys) {
    if (market[k] === true || market[k] === "true") {
      eligible = true;
      evidence.push({ key: k, value: market[k] });
    }
  }

  // 2) Nombres exactos candidatos para la tasa (numérico).
  const rateKeys = [
    "holdingRewardRate",
    "holdingRewardsRate",
    "holdingRewardApr",
    "holdingRewardsApr",
    "holdingApr",
    "holdingApy",
    "holdingRate",
    "rewardsApr",
    "rewardApr",
    "rewardApy",
  ];
  for (const k of rateKeys) {
    const v = market[k];
    if (v != null && toNum(v) > 0) {
      eligible = true;
      ratePct = normalizeRateToPct(toNum(v));
      evidence.push({ key: k, value: v });
    }
  }

  // 3) Escaneo profundo: cualquier clave que matchee el patrón de holding reward.
  const walk = (obj: unknown, path: string, depth: number) => {
    if (depth > 4 || obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const full = path ? `${path}.${k}` : k;
      if (HOLDING_KEY_RE.test(k)) {
        if (v === true || v === "true") {
          eligible = true;
          evidence.push({ key: full, value: v });
        } else if (typeof v === "number" || (typeof v === "string" && parseFloat(v) > 0)) {
          const n = toNum(v);
          if (n > 0) {
            eligible = true;
            if (ratePct == null) ratePct = normalizeRateToPct(n);
            evidence.push({ key: full, value: v });
          }
        }
      }
      if (typeof v === "object" && v !== null) walk(v, full, depth + 1);
    }
  };
  walk(market, "", 0);

  let assumed = false;
  if (eligible && ratePct == null) {
    // Hay flag pero sin tasa numérica: asumimos la tasa del programa (4.00%).
    ratePct = 4.0;
    assumed = true;
  }

  return { eligible, ratePct, assumed, evidence };
}

/** Calcula APY de bonding (comprar favorito a precio p y mantener hasta $1), compuesto. */
function bondApy(price: number, days: number | null): number | null {
  if (price <= 0 || price >= 1 || days == null || days < 0.5) return null;
  const apy = Math.pow(1 / price, 365 / days) - 1;
  if (!Number.isFinite(apy)) return null;
  return apy * 100;
}

/* --------------------------- Fetch --------------------------- */

async function fetchMarketsPage(offset: number, limit: number): Promise<Record<string, unknown>[]> {
  const nowIso = new Date().toISOString();
  const params = new URLSearchParams({
    closed: "false",
    active: "true",
    limit: String(limit),
    offset: String(offset),
    order: "volume24hr",
    ascending: "false",
    end_date_min: nowIso,
  });
  const url = `${GAMMA_BASE}/markets?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (e) {
    // Reintento sin order (por si el param order no es válido en esta versión del API).
    const fb = new URLSearchParams({
      closed: "false",
      active: "true",
      limit: String(limit),
      offset: String(offset),
    });
    res = await fetch(`${GAMMA_BASE}/markets?${fb.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  }

  if (!res.ok) {
    // Fallback sin order si el server rechazó el query.
    const fb = new URLSearchParams({
      closed: "false",
      active: "true",
      limit: String(limit),
      offset: String(offset),
    });
    const res2 = await fetch(`${GAMMA_BASE}/markets?${fb.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res2.ok) throw new Error(`Gamma API ${res.status}/${res2.status}`);
    res = res2;
  }

  const data = await res.json();
  // El endpoint puede devolver un array directo o { data: [...] }.
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  return [];
}

/* ------------------------- Scan principal ------------------------- */

export async function scan(params: ScanParams): Promise<ScanResult> {
  const limit = 500;
  const all: Record<string, unknown>[] = [];

  for (let page = 0; page < params.maxPages; page++) {
    const batch = await fetchMarketsPage(page * limit, limit);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < limit) break;
  }

  const now = Date.now();
  const opportunities: Opportunity[] = [];

  for (const m of all) {
    const detection = detectHoldingReward(m);
    if (!detection.eligible && !params.includeNonReward) continue;

    const outcomes = parseMaybeJsonArray(m["outcomes"]);
    const prices = parseMaybeJsonArray(m["outcomePrices"]).map((p) => parseFloat(p));

    // Favorito = outcome con mayor precio.
    let favIdx = 0;
    let favPrice = 0;
    prices.forEach((p, i) => {
      if (Number.isFinite(p) && p > favPrice) {
        favPrice = p;
        favIdx = i;
      }
    });
    const favoriteOutcome = outcomes[favIdx] ?? (favIdx === 0 ? "Yes" : "No");

    const endRaw = (m["endDate"] ?? m["endDateIso"] ?? m["end_date"]) as string | undefined;
    let endDate: string | null = endRaw ?? null;
    let days: number | null = null;
    if (endRaw) {
      const t = new Date(endRaw).getTime();
      if (Number.isFinite(t)) days = (t - now) / (1000 * 60 * 60 * 24);
    }

    const liquidity = toNum(m["liquidityNum"] ?? m["liquidity"]);
    const volume24hr = toNum(m["volume24hr"] ?? m["volume24hrClob"] ?? 0);
    const volume = toNum(m["volumeNum"] ?? m["volume"]);
    const bestAsk = m["bestAsk"] != null ? toNum(m["bestAsk"]) : null;
    const spread = m["spread"] != null ? toNum(m["spread"]) : null;
    const acceptingOrders = m["acceptingOrders"] === true || m["acceptingOrders"] === "true";
    const enableOrderBook = m["enableOrderBook"] === true || m["enableOrderBook"] === "true";

    const impliedProb = favPrice * 100;
    const apy = detection.ratePct;

    // Filtros
    if (apy != null && apy < params.minApy && !params.includeNonReward) continue;
    if (impliedProb < params.minProb) continue;
    if (liquidity < params.minLiquidity) continue;

    // URL: preferir slug del evento contenedor.
    let slug = String(m["slug"] ?? "");
    const events = m["events"];
    if (Array.isArray(events) && events.length > 0 && (events[0] as any)?.slug) {
      slug = String((events[0] as any).slug);
    }
    const url = slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com";

    opportunities.push({
      id: String(m["id"] ?? m["conditionId"] ?? slug),
      question: String(m["question"] ?? m["title"] ?? "(sin título)"),
      slug,
      url,
      holdingApy: apy,
      apyAssumed: detection.assumed,
      favoriteOutcome,
      favoritePrice: favPrice,
      impliedProb,
      bestAsk,
      spread,
      endDate,
      daysToResolution: days != null ? Math.round(days * 10) / 10 : null,
      bondApy: bondApy(favPrice, days),
      liquidity,
      volume24hr,
      volume,
      acceptingOrders,
      enableOrderBook,
      evidence: detection.evidence,
    });
  }

  // Orden: APY de holding desc, luego liquidez desc.
  opportunities.sort((a, b) => {
    const av = a.holdingApy ?? -1;
    const bv = b.holdingApy ?? -1;
    if (bv !== av) return bv - av;
    return b.liquidity - a.liquidity;
  });

  return {
    scannedAt: new Date().toISOString(),
    marketsScanned: all.length,
    found: opportunities.length,
    params,
    opportunities,
  };
}

/* ====================================================================== */
/*  LIQUIDITY REWARDS (programa de órdenes límite / market making)        */
/*  Distinto al holding reward: hay un pool diario por market que se       */
/*  reparte entre quienes ponen órdenes cerca del midpoint.                */
/* ====================================================================== */

export interface LiquidityMarket {
  id: string;
  question: string;
  slug: string;
  url: string;
  /** Pool de rewards que reparte el market por día (USDC). */
  dailyPool: number;
  /** Max spread elegible (en centavos). Órdenes dentro de esta distancia del mid puntúan. */
  maxSpreadCents: number;
  /** Tamaño mínimo de orden para calificar (shares). */
  minSize: number;
  bestBid: number | null;
  bestAsk: number | null;
  /** Spread actual del book en centavos. */
  currentSpreadCents: number | null;
  midpoint: number | null;
  liquidity: number;
  volume24hr: number;
  endDate: string | null;
  daysToResolution: number | null;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
}

export interface LiquidityScanResult {
  scannedAt: string;
  marketsScanned: number;
  found: number;
  markets: LiquidityMarket[];
}

function extractLiquidity(m: Record<string, unknown>): {
  eligible: boolean;
  dailyPool: number;
  maxSpreadCents: number;
  minSize: number;
} {
  let dailyPool = 0;
  const cr = m["clobRewards"];
  if (Array.isArray(cr)) {
    for (const r of cr as Record<string, unknown>[]) {
      dailyPool += toNum(
        r["rewardsDailyRate"] ??
          r["dailyRate"] ??
          r["rewards_daily_rate"] ??
          r["rewardsAmount"] ??
          0
      );
    }
  }
  if (dailyPool === 0) {
    dailyPool = toNum(m["rewardsDailyRate"] ?? m["dailyRewardsRate"] ?? 0);
  }

  let maxSpreadCents = toNum(m["rewardsMaxSpread"] ?? m["reward_max_spread"] ?? 0);
  if (maxSpreadCents > 0 && maxSpreadCents <= 1) maxSpreadCents *= 100; // de price-units a centavos

  const minSize = toNum(m["rewardsMinSize"] ?? m["reward_min_size"] ?? 0);

  const eligible =
    dailyPool > 0 || maxSpreadCents > 0 || (Array.isArray(cr) && cr.length > 0);

  return { eligible, dailyPool, maxSpreadCents, minSize };
}

export async function scanLiquidity(maxPages: number, minPool: number): Promise<LiquidityScanResult> {
  const limit = 500;
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchMarketsPage(page * limit, limit);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < limit) break;
  }

  const now = Date.now();
  const markets: LiquidityMarket[] = [];

  for (const m of all) {
    const liq = extractLiquidity(m);
    if (!liq.eligible) continue;
    if (liq.dailyPool < minPool) continue;

    const prices = parseMaybeJsonArray(m["outcomePrices"]).map((p) => parseFloat(p));
    let favPrice = 0;
    prices.forEach((p) => {
      if (Number.isFinite(p) && p > favPrice) favPrice = p;
    });

    const bid = m["bestBid"] != null ? toNum(m["bestBid"]) : null;
    const ask = m["bestAsk"] != null ? toNum(m["bestAsk"]) : null;
    let midpoint: number | null = null;
    let currentSpreadCents: number | null = null;
    if (bid != null && ask != null && bid > 0 && ask > 0) {
      midpoint = (bid + ask) / 2;
      currentSpreadCents = Math.round((ask - bid) * 1000) / 10; // a centavos, 1 decimal
    } else if (favPrice > 0) {
      midpoint = favPrice;
    }

    const endRaw = (m["endDate"] ?? m["endDateIso"] ?? m["end_date"]) as string | undefined;
    let endDate: string | null = endRaw ?? null;
    let days: number | null = null;
    if (endRaw) {
      const t = new Date(endRaw).getTime();
      if (Number.isFinite(t)) days = Math.round(((t - now) / (1000 * 60 * 60 * 24)) * 10) / 10;
    }

    let slug = String(m["slug"] ?? "");
    const events = m["events"];
    if (Array.isArray(events) && events.length > 0 && (events[0] as any)?.slug) {
      slug = String((events[0] as any).slug);
    }

    markets.push({
      id: String(m["id"] ?? m["conditionId"] ?? slug),
      question: String(m["question"] ?? m["title"] ?? "(sin título)"),
      slug,
      url: slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com",
      dailyPool: liq.dailyPool,
      maxSpreadCents: liq.maxSpreadCents,
      minSize: liq.minSize,
      bestBid: bid,
      bestAsk: ask,
      currentSpreadCents,
      midpoint,
      liquidity: toNum(m["liquidityNum"] ?? m["liquidity"]),
      volume24hr: toNum(m["volume24hr"] ?? 0),
      endDate,
      daysToResolution: days,
      acceptingOrders: m["acceptingOrders"] === true || m["acceptingOrders"] === "true",
      enableOrderBook: m["enableOrderBook"] === true || m["enableOrderBook"] === "true",
    });
  }

  markets.sort((a, b) => b.dailyPool - a.dailyPool);

  return {
    scannedAt: new Date().toISOString(),
    marketsScanned: all.length,
    found: markets.length,
    markets,
  };
}
