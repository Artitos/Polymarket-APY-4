"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const HOLDING_RATE = 3.25; // % APY del programa de Holding Rewards (cambia cada tanto)

interface Opportunity {
  id: string;
  question: string;
  slug: string;
  url: string;
  holdingApy: number | null;
  apyAssumed: boolean;
  favoriteOutcome: string;
  favoritePrice: number;
  impliedProb: number;
  bestAsk: number | null;
  spread: number | null;
  endDate: string | null;
  daysToResolution: number | null;
  bondApy: number | null;
  liquidity: number;
  volume24hr: number;
  volume: number;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  evidence: { key: string; value: unknown }[];
}

interface ScanResponse {
  ok: boolean;
  error?: string;
  scannedAt?: string;
  marketsScanned?: number;
  found?: number;
  opportunities?: Opportunity[];
}

interface LiquidityMarket {
  id: string;
  question: string;
  slug: string;
  url: string;
  dailyPool: number;
  maxSpreadCents: number;
  minSize: number;
  bestBid: number | null;
  bestAsk: number | null;
  currentSpreadCents: number | null;
  midpoint: number | null;
  liquidity: number;
  volume24hr: number;
  endDate: string | null;
  daysToResolution: number | null;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
}

interface LiquidityResponse {
  ok: boolean;
  error?: string;
  scannedAt?: string;
  marketsScanned?: number;
  found?: number;
  markets?: LiquidityMarket[];
}

const fmtUSD = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(1)}K`
    : `$${n.toFixed(0)}`;

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
};

const fmtDays = (d: number | null) => (d == null ? "—" : d < 0 ? "fin." : `${d}d`);

const fmtReward = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

export default function Page() {
  const [tab, setTab] = useState<"holding" | "liquidity">("holding");

  /* ======================= HOLDING REWARDS ======================= */
  const [minApy, setMinApy] = useState(String(HOLDING_RATE));
  const [minProb, setMinProb] = useState("0");
  const [minLiq, setMinLiq] = useState("0");
  const [maxPages, setMaxPages] = useState("6");
  const [includeNonReward, setIncludeNonReward] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      minApy,
      minProb,
      minLiquidity: minLiq,
      maxPages,
      includeNonReward: String(includeNonReward),
    });
    try {
      const res = await fetch(`/api/scan?${params.toString()}`, { cache: "no-store" });
      const json: ScanResponse = await res.json();
      if (!json.ok) throw new Error(json.error || "Error desconocido");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [minApy, minProb, minLiq, maxPages, includeNonReward]);

  useEffect(() => {
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh) timer.current = setInterval(runScan, 90_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [autoRefresh, runScan]);

  const rows = data?.opportunities ?? [];

  // Calculadora de holding rewards
  const [deposit, setDeposit] = useState("1000");
  const [calcApy, setCalcApy] = useState(String(HOLDING_RATE));
  const [calcDays, setCalcDays] = useState("30");
  const [calcMarket, setCalcMarket] = useState<string | null>(null);
  const [calcPrice, setCalcPrice] = useState<number | null>(null);
  const calcRef = useRef<HTMLDivElement | null>(null);

  const loadIntoCalc = (r: Opportunity) => {
    if (r.holdingApy != null) setCalcApy(r.holdingApy.toFixed(2));
    if (r.daysToResolution != null && r.daysToResolution > 0) setCalcDays(String(Math.ceil(r.daysToResolution)));
    setCalcMarket(r.question);
    setCalcPrice(r.favoritePrice > 0 && r.favoritePrice < 1 ? r.favoritePrice : null);
    calcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const D = Math.max(0, Number(deposit) || 0);
  const A = Math.max(0, Number(calcApy) || 0);
  const days = Math.max(0, Number(calcDays) || 0);
  const dailyReward = (D * (A / 100)) / 365;
  const totalReward = D * (A / 100) * (days / 365);
  const monthlyReward = dailyReward * 30;
  const returnPct = D > 0 ? (totalReward / D) * 100 : 0;
  const finalValue = D + totalReward;
  const resolutionGain = calcPrice != null ? D * ((1 - calcPrice) / calcPrice) : null;

  /* ======================= LIQUIDITY REWARDS ======================= */
  const [liqMinPool, setLiqMinPool] = useState("10");
  const [liqMaxPages, setLiqMaxPages] = useState("6");
  const [liqData, setLiqData] = useState<LiquidityResponse | null>(null);
  const [liqLoading, setLiqLoading] = useState(false);
  const [liqError, setLiqError] = useState<string | null>(null);
  const [liqAuto, setLiqAuto] = useState(false);
  const liqTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runLiqScan = useCallback(async () => {
    setLiqLoading(true);
    setLiqError(null);
    const params = new URLSearchParams({ mode: "liquidity", minPool: liqMinPool, maxPages: liqMaxPages });
    try {
      const res = await fetch(`/api/scan?${params.toString()}`, { cache: "no-store" });
      const json: LiquidityResponse = await res.json();
      if (!json.ok) throw new Error(json.error || "Error desconocido");
      setLiqData(json);
    } catch (e) {
      setLiqError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiqLoading(false);
    }
  }, [liqMinPool, liqMaxPages]);

  useEffect(() => {
    runLiqScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (liqTimer.current) clearInterval(liqTimer.current);
    if (liqAuto) liqTimer.current = setInterval(runLiqScan, 60_000);
    return () => {
      if (liqTimer.current) clearInterval(liqTimer.current);
    };
  }, [liqAuto, runLiqScan]);

  const liqRows = liqData?.markets ?? [];

  // Calculadora de liquidity rewards
  const [lcPool, setLcPool] = useState("100");
  const [lcCapital, setLcCapital] = useState("1000");
  const [lcSpread, setLcSpread] = useState("1");
  const [lcMaxSpread, setLcMaxSpread] = useState("3");
  const [lcCompeting, setLcCompeting] = useState("5000");
  const [lcDays, setLcDays] = useState("7");
  const [lcMarket, setLcMarket] = useState<string | null>(null);
  const liqCalcRef = useRef<HTMLDivElement | null>(null);

  const loadIntoLiqCalc = (m: LiquidityMarket) => {
    if (m.dailyPool > 0) setLcPool(String(Math.round(m.dailyPool)));
    if (m.maxSpreadCents > 0) setLcMaxSpread(String(m.maxSpreadCents));
    if (m.daysToResolution != null && m.daysToResolution > 0) setLcDays(String(Math.ceil(m.daysToResolution)));
    setLcMarket(m.question);
    liqCalcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const lcV = Math.max(0.0001, Number(lcMaxSpread) || 0);
  const lcS = Math.max(0, Number(lcSpread) || 0);
  const scoreFactor = lcS <= lcV ? Math.pow((lcV - lcS) / lcV, 2) : 0;
  const lcCap = Math.max(0, Number(lcCapital) || 0);
  const lcComp = Math.max(0, Number(lcCompeting) || 0);
  const lcPoolN = Math.max(0, Number(lcPool) || 0);
  const lcDaysN = Math.max(0, Number(lcDays) || 0);
  const yourScore = lcCap * scoreFactor;
  const poolShare = yourScore + lcComp > 0 ? yourScore / (yourScore + lcComp) : 0;
  const liqDaily = lcPoolN * poolShare;
  const liqPeriod = liqDaily * lcDaysN;
  const liqMonthly = liqDaily * 30;
  const liqApr = lcCap > 0 ? ((liqDaily * 365) / lcCap) * 100 : 0;

  /* ============================ RENDER ============================ */
  return (
    <div className="page" data-tab={tab}>
      <div className="wrap">
        <div className="topbar">
          <div className="brandmark">
            <div className="glyph">P</div>
            <div className="name">
              PM<b>·</b>SCAN <span className="ver">v2</span>
            </div>
          </div>
          <div className="tabs" role="tablist">
            <button
              className={"tab" + (tab === "holding" ? " active" : "")}
              data-k="holding"
              onClick={() => setTab("holding")}
            >
              <span className="tdot" /> Holding · {HOLDING_RATE}% APY
            </button>
            <button
              className={"tab" + (tab === "liquidity" ? " active" : "")}
              data-k="liquidity"
              onClick={() => setTab("liquidity")}
            >
              <span className="tdot" /> Liquidity Rewards
            </button>
          </div>
        </div>

        {tab === "holding" ? (
          <>
            <div className="hero">
              <div className="badge">
                <span className="pip" /> {HOLDING_RATE}% APY · pagado diariamente
              </div>
              <h1>
                Markets con <span className="accent">Holding Rewards</span> activos
              </h1>
              <p>
                Polymarket paga {HOLDING_RATE}% anualizado sobre el valor de tu posición en una lista
                curada de markets elegibles. El scanner los detecta y los lista por APY.
              </p>
            </div>

            <div className="card">
              <div className="controls">
                <div className="field">
                  <label>APY mínimo (%)</label>
                  <input type="number" value={minApy} min={0} step={0.25} onChange={(e) => setMinApy(e.target.value)} />
                  <span className="hint">tasa del programa: {HOLDING_RATE}%</span>
                </div>
                <div className="field">
                  <label>Prob. mín. favorito (%)</label>
                  <input type="number" value={minProb} min={0} max={100} onChange={(e) => setMinProb(e.target.value)} />
                  <span className="hint">0 = sin filtro</span>
                </div>
                <div className="field">
                  <label>Liquidez mín. (USDC)</label>
                  <input type="number" value={minLiq} min={0} step={500} onChange={(e) => setMinLiq(e.target.value)} />
                </div>
                <div className="field">
                  <label>Páginas a escanear</label>
                  <select value={maxPages} onChange={(e) => setMaxPages(e.target.value)}>
                    <option value="3">3 · ~1500 markets</option>
                    <option value="6">6 · ~3000 markets</option>
                    <option value="10">10 · ~5000 markets</option>
                    <option value="20">20 · ~10000 markets</option>
                  </select>
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn" onClick={runScan} disabled={loading}>
                    {loading ? "Escaneando…" : "Escanear"}
                  </button>
                </div>
              </div>
            </div>

            <div className="statline">
              <span>
                Estado:{" "}
                {loading ? (
                  <b>
                    <span className="spinner" />
                    escaneando
                  </b>
                ) : error ? (
                  <b className="err">error</b>
                ) : (
                  <b className="ok">listo</b>
                )}
              </span>
              <span>Markets: <b>{data?.marketsScanned ?? "—"}</b></span>
              <span>Con reward: <b className="ok">{data?.found ?? "—"}</b></span>
              <span>Último scan: <b>{data?.scannedAt ? new Date(data.scannedAt).toLocaleTimeString("es-AR") : "—"}</b></span>
              <label className="toggle">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> auto-refresh 90s
              </label>
              <label className="toggle">
                <input type="checkbox" checked={includeNonReward} onChange={(e) => setIncludeNonReward(e.target.checked)} /> debug
              </label>
            </div>

            <div className="card table-card">
              {error ? (
                <div className="state"><div className="big">⚠ Falló el escaneo</div><div>{error}</div></div>
              ) : loading && rows.length === 0 ? (
                <div className="state"><div className="big"><span className="spinner" />Consultando el Gamma API…</div></div>
              ) : rows.length === 0 ? (
                <div className="state"><div className="big">Sin resultados</div><div>Subí las páginas, bajá la liquidez mínima, o activá debug.</div></div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Favorito</th>
                      <th className="num">Holding APY</th>
                      <th className="num hide-sm">Bond APY*</th>
                      <th className="num hide-sm">Días</th>
                      <th className="num hide-sm">Fin</th>
                      <th className="num">Liquidez</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id} style={{ animationDelay: `${Math.min(i * 16, 320)}ms` }}>
                        <td className="q">
                          <a href={r.url} target="_blank" rel="noreferrer">{r.question}</a>
                          <div className="slug">
                            {r.slug || "—"}
                            {!r.acceptingOrders && <span className="pill" style={{ marginLeft: 8 }}>no acepta órdenes</span>}
                          </div>
                        </td>
                        <td><span>{r.favoriteOutcome}</span> <span className="dim">{r.impliedProb.toFixed(1)}%</span></td>
                        <td className="num"><span className={"bignum" + (r.apyAssumed ? " assumed" : "")}>{r.holdingApy != null ? `${r.holdingApy.toFixed(2)}%` : "—"}</span></td>
                        <td className="num hide-sm" style={{ color: "var(--cyan)" }}>{r.bondApy != null ? `${r.bondApy.toFixed(1)}%` : "—"}</td>
                        <td className="num hide-sm dim">{fmtDays(r.daysToResolution)}</td>
                        <td className="num hide-sm dim">{fmtDate(r.endDate)}</td>
                        <td className="num">{fmtUSD(r.liquidity)}</td>
                        <td className="num">
                          <button className="btn-mini" onClick={() => loadIntoCalc(r)}>calc</button>
                          <a className="ext" href={r.url} target="_blank" rel="noreferrer">↗</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card calc" ref={calcRef}>
              <div className="calc-head">
                <h2>Calculadora de <span className="accent">rewards</span></h2>
                <p>¿Cuánto rinde tu depósito farmeando el holding reward? Tocá <span className="kbd">calc</span> en un market para cargar su APY y días, o ajustá a mano.</p>
              </div>
              {calcMarket && (
                <div className="calc-loaded">
                  Cargado desde: <b>{calcMarket}</b>
                  {calcPrice != null && <span className="dim"> · favorito a {(calcPrice * 100).toFixed(1)}¢</span>}
                </div>
              )}
              <div className="calc-inputs">
                <div className="field"><label>Depósito (USDC)</label><input type="number" value={deposit} min={0} step={100} onChange={(e) => setDeposit(e.target.value)} /></div>
                <div className="field"><label>APY del reward (%)</label><input type="number" value={calcApy} min={0} step={0.25} onChange={(e) => setCalcApy(e.target.value)} /></div>
                <div className="field"><label>Días a mantener</label><input type="number" value={calcDays} min={0} step={1} onChange={(e) => setCalcDays(e.target.value)} /><span className="hint">{calcMarket ? "= días hasta el cierre" : "editá según tu plan"}</span></div>
              </div>
              <div className="stats">
                <div className="stat"><div className="lbl">Reward por día</div><div className="val">{fmtReward(dailyReward)}</div><div className="sub">USDC / día</div></div>
                <div className="stat"><div className="lbl">Reward por mes</div><div className="val">{fmtReward(monthlyReward)}</div><div className="sub">~30 días</div></div>
                <div className="stat lead"><div className="lbl">Total en {days || 0} días</div><div className="val">{fmtReward(totalReward)}</div><div className="sub">+{returnPct.toFixed(2)}% sobre tu depósito</div></div>
                <div className="stat"><div className="lbl">Valor final</div><div className="val">{fmtReward(finalValue)}</div><div className="sub">depósito + rewards</div></div>
              </div>
              {resolutionGain != null && (
                <div className="note" style={{ borderLeftColor: "var(--cyan)" }}>
                  <b style={{ color: "var(--cyan)" }}>Extra por resolución (no garantizado):</b> si con esos {fmtReward(D)} comprás el favorito a {(calcPrice! * 100).toFixed(1)}¢ y resuelve a tu favor, al llegar a $1 ganás otros <span className="cyan">{fmtReward(resolutionGain)}</span> aparte de los rewards. Si resuelve en contra, perdés el depósito.
                </div>
              )}
            </div>

            <div className="note">
              <b>Leé esto.</b> El holding reward ({HOLDING_RATE}% anualizado) es una <b>tasa variable</b> y la lista de elegibles la define Polymarket. El <code>≈</code> indica que el market está marcado como elegible pero el API no devolvió tasa numérica, así que se asume {HOLDING_RATE}%. <b>Bond APY*</b> es solo de referencia y <b>no es libre de riesgo</b>. Esto no es asesoramiento financiero.
            </div>
          </>
        ) : (
          <>
            <div className="hero">
              <div className="badge"><span className="pip" /> pool diario · repartido entre LPs</div>
              <h1>
                Markets con <span className="accent">Liquidity Rewards</span>
              </h1>
              <p>
                Otro programa, otra lógica: Polymarket reparte un pool diario entre quienes ponen
                órdenes límite cerca del midpoint. Lo que ganás depende de tu spread y de la competencia.
              </p>
            </div>

            <div className="card">
              <div className="controls">
                <div className="field">
                  <label>Pool diario mín. (USDC)</label>
                  <input type="number" value={liqMinPool} min={0} step={10} onChange={(e) => setLiqMinPool(e.target.value)} />
                  <span className="hint">descarta pools chicos</span>
                </div>
                <div className="field">
                  <label>Páginas a escanear</label>
                  <select value={liqMaxPages} onChange={(e) => setLiqMaxPages(e.target.value)}>
                    <option value="3">3 · ~1500 markets</option>
                    <option value="6">6 · ~3000 markets</option>
                    <option value="10">10 · ~5000 markets</option>
                    <option value="20">20 · ~10000 markets</option>
                  </select>
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn" onClick={runLiqScan} disabled={liqLoading}>
                    {liqLoading ? "Escaneando…" : "Escanear pools"}
                  </button>
                </div>
              </div>
            </div>

            <div className="statline">
              <span>
                Estado:{" "}
                {liqLoading ? (<b><span className="spinner" />escaneando</b>) : liqError ? (<b className="err">error</b>) : (<b className="ok">listo</b>)}
              </span>
              <span>Markets: <b>{liqData?.marketsScanned ?? "—"}</b></span>
              <span>Con pool: <b className="ok">{liqData?.found ?? "—"}</b></span>
              <span>Último scan: <b>{liqData?.scannedAt ? new Date(liqData.scannedAt).toLocaleTimeString("es-AR") : "—"}</b></span>
              <label className="toggle">
                <input type="checkbox" checked={liqAuto} onChange={(e) => setLiqAuto(e.target.checked)} /> auto-refresh 60s
              </label>
            </div>

            <div className="card table-card">
              {liqError ? (
                <div className="state"><div className="big">⚠ Falló el escaneo</div><div>{liqError}</div></div>
              ) : liqLoading && liqRows.length === 0 ? (
                <div className="state"><div className="big"><span className="spinner" />Buscando pools de liquidez…</div></div>
              ) : liqRows.length === 0 ? (
                <div className="state"><div className="big">Sin resultados</div><div>Bajá el pool mínimo a 0 o subí las páginas.</div></div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th className="num">Pool/día</th>
                      <th className="num hide-sm">Max spread</th>
                      <th className="num hide-sm">Min shares</th>
                      <th className="num hide-sm">Spread actual</th>
                      <th className="num">Liquidez</th>
                      <th className="num hide-sm">Días</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {liqRows.map((m, i) => (
                      <tr key={m.id} style={{ animationDelay: `${Math.min(i * 16, 320)}ms` }}>
                        <td className="q">
                          <a href={m.url} target="_blank" rel="noreferrer">{m.question}</a>
                          <div className="slug">
                            {m.slug || "—"}
                            {!m.acceptingOrders && <span className="pill" style={{ marginLeft: 8 }}>no acepta órdenes</span>}
                          </div>
                        </td>
                        <td className="num"><span className="bignum">{fmtUSD(m.dailyPool)}</span></td>
                        <td className="num hide-sm dim">{m.maxSpreadCents > 0 ? `±${m.maxSpreadCents}¢` : "—"}</td>
                        <td className="num hide-sm dim">{m.minSize > 0 ? m.minSize : "—"}</td>
                        <td className="num hide-sm dim">{m.currentSpreadCents != null ? `${m.currentSpreadCents}¢` : "—"}</td>
                        <td className="num">{fmtUSD(m.liquidity)}</td>
                        <td className="num hide-sm dim">{fmtDays(m.daysToResolution)}</td>
                        <td className="num">
                          <button className="btn-mini" onClick={() => loadIntoLiqCalc(m)}>calc</button>
                          <a className="ext" href={m.url} target="_blank" rel="noreferrer">↗</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card calc" ref={liqCalcRef}>
              <div className="calc-head">
                <h2>Calculadora de <span className="accent">liquidity rewards</span></h2>
                <p>Estimación con la fórmula real: tu score = <span className="kbd">((maxSpread − tuSpread) / maxSpread)² × capital</span>, y tu pago = <span className="kbd">pool × (tu score / score total)</span>. Tocá <span className="kbd">calc</span> en un market para cargar su pool y max spread.</p>
              </div>
              {lcMarket && <div className="calc-loaded">Cargado desde: <b>{lcMarket}</b></div>}
              <div className="calc-inputs">
                <div className="field"><label>Pool diario (USDC)</label><input type="number" value={lcPool} min={0} step={10} onChange={(e) => setLcPool(e.target.value)} /></div>
                <div className="field"><label>Tu capital (USDC)</label><input type="number" value={lcCapital} min={0} step={100} onChange={(e) => setLcCapital(e.target.value)} /></div>
                <div className="field"><label>Tu spread del mid (¢)</label><input type="number" value={lcSpread} min={0} step={0.5} onChange={(e) => setLcSpread(e.target.value)} /><span className="hint">más cerca = más score</span></div>
                <div className="field"><label>Max spread (¢)</label><input type="number" value={lcMaxSpread} min={0.5} step={0.5} onChange={(e) => setLcMaxSpread(e.target.value)} /></div>
                <div className="field"><label>Competencia (USDC)</label><input type="number" value={lcCompeting} min={0} step={500} onChange={(e) => setLcCompeting(e.target.value)} /><span className="hint">liquidez de otros LPs</span></div>
                <div className="field"><label>Días a operar</label><input type="number" value={lcDays} min={0} step={1} onChange={(e) => setLcDays(e.target.value)} /></div>
              </div>
              <div className="stats">
                <div className="stat"><div className="lbl">Eficiencia del spread</div><div className="val" style={{ color: "var(--accent)" }}>{(scoreFactor * 100).toFixed(1)}%</div><div className="sub">qué tan bien puntúa</div></div>
                <div className="stat"><div className="lbl">Tu parte del pool</div><div className="val" style={{ color: "var(--accent)" }}>{(poolShare * 100).toFixed(2)}%</div><div className="sub">vs el resto de LPs</div></div>
                <div className="stat lead"><div className="lbl">Ganancia por día</div><div className="val">{fmtReward(liqDaily)}</div><div className="sub">USDC / día estimado</div></div>
                <div className="stat"><div className="lbl">En {lcDaysN || 0} días</div><div className="val">{fmtReward(liqPeriod)}</div><div className="sub">≈ {fmtReward(liqMonthly)}/mes · {liqApr.toFixed(0)}% APR</div></div>
              </div>
              <div className="note">
                <b>Es una estimación, no una promesa.</b> Las rewards reales dependen de la competencia minuto a minuto (el campo "Competencia" es tu mejor adivinanza) y del muestreo aleatorio de Polymarket. Poner órdenes te deja con <b>posición real</b>: si el precio se mueve en contra, la pérdida puede comerse las rewards. Empezá con poco capital en markets de poca competencia para calibrar.
              </div>
            </div>
          </>
        )}

        <div className="foot">PM·SCAN · datos del Gamma API público de Polymarket · no es asesoramiento financiero</div>
      </div>
    </div>
  );
}
