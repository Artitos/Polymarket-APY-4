"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

// Formato de montos chicos (rewards): 2 decimales si ≥1, si no 4.
const fmtReward = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

export default function Page() {
  const [minApy, setMinApy] = useState("4");
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

  // Escaneo inicial al cargar.
  useEffect(() => {
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh: vuelve a escanear cada 90s para captar markets nuevos.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh) {
      timer.current = setInterval(runScan, 90_000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [autoRefresh, runScan]);

  const rows = data?.opportunities ?? [];

  // ---- Calculadora de rewards ----
  const [deposit, setDeposit] = useState("1000");
  const [calcApy, setCalcApy] = useState("4");
  const [calcDays, setCalcDays] = useState("30");
  const [calcMarket, setCalcMarket] = useState<string | null>(null);
  const [calcPrice, setCalcPrice] = useState<number | null>(null);
  const calcRef = useRef<HTMLDivElement | null>(null);

  // Carga los datos de un market del scanner en la calculadora.
  const loadIntoCalc = (r: Opportunity) => {
    if (r.holdingApy != null) setCalcApy(r.holdingApy.toFixed(2));
    if (r.daysToResolution != null && r.daysToResolution > 0) {
      setCalcDays(String(Math.ceil(r.daysToResolution)));
    }
    setCalcMarket(r.question);
    setCalcPrice(r.favoritePrice > 0 && r.favoritePrice < 1 ? r.favoritePrice : null);
    calcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Cálculos. El holding reward se paga diariamente sobre el valor de la
  // posición (interés simple: no se reinvierte en la posición).
  const D = Math.max(0, Number(deposit) || 0);
  const A = Math.max(0, Number(calcApy) || 0);
  const days = Math.max(0, Number(calcDays) || 0);
  const dailyReward = (D * (A / 100)) / 365;
  const totalReward = D * (A / 100) * (days / 365);
  const monthlyReward = dailyReward * 30;
  const returnPct = D > 0 ? (totalReward / D) * 100 : 0;
  const finalValue = D + totalReward;
  // Ganancia extra por resolución si comprás el favorito a calcPrice y resuelve a tu favor.
  const resolutionGain = calcPrice != null ? D * ((1 - calcPrice) / calcPrice) : null;

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="dot" />
          <div>
            <h1>
              PM<span className="accent">·</span>SCAN
            </h1>
            <div className="sub">Polymarket · Holding Rewards Scanner</div>
          </div>
        </div>
        <p className="tagline">
          Detecta markets con <b>Holding Rewards</b> activos — el ~4% APY que paga
          Polymarket por mantener posiciones elegibles.
        </p>
      </header>

      <section className="controls">
        <div className="field">
          <label>APY mínimo (%)</label>
          <input
            type="number"
            value={minApy}
            min={0}
            step={0.5}
            onChange={(e) => setMinApy(e.target.value)}
          />
          <span className="hint">tasa del programa: 4.00%</span>
        </div>
        <div className="field">
          <label>Prob. mín. favorito (%)</label>
          <input
            type="number"
            value={minProb}
            min={0}
            max={100}
            onChange={(e) => setMinProb(e.target.value)}
          />
          <span className="hint">0 = sin filtro</span>
        </div>
        <div className="field">
          <label>Liquidez mín. (USDC)</label>
          <input
            type="number"
            value={minLiq}
            min={0}
            step={500}
            onChange={(e) => setMinLiq(e.target.value)}
          />
          <span className="hint">descarta books finos</span>
        </div>
        <div className="field">
          <label>Páginas a escanear</label>
          <select value={maxPages} onChange={(e) => setMaxPages(e.target.value)}>
            <option value="3">3 · ~1500 markets</option>
            <option value="6">6 · ~3000 markets</option>
            <option value="10">10 · ~5000 markets</option>
            <option value="20">20 · ~10000 markets</option>
          </select>
          <span className="hint">más cobertura = más lento</span>
        </div>
        <div className="actions">
          <button className="btn" onClick={runScan} disabled={loading}>
            {loading ? "ESCANEANDO…" : "▸ ESCANEAR"}
          </button>
        </div>
      </section>

      <div className="statusbar">
        <span>
          ESTADO:{" "}
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
        <span>
          MARKETS ESCANEADOS: <b>{data?.marketsScanned ?? "—"}</b>
        </span>
        <span>
          CON REWARD: <b className="ok">{data?.found ?? "—"}</b>
        </span>
        <span>
          ÚLTIMO SCAN:{" "}
          <b>
            {data?.scannedAt
              ? new Date(data.scannedAt).toLocaleTimeString("es-AR")
              : "—"}
          </b>
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          auto-refresh (90s)
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeNonReward}
            onChange={(e) => setIncludeNonReward(e.target.checked)}
          />
          modo debug (incluir sin reward)
        </label>
      </div>

      <div className="tablewrap">
        {error ? (
          <div className="state">
            <div className="big">⚠ Falló el escaneo</div>
            <div>{error}</div>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="state">
            <div className="big">
              <span className="spinner" />
              Consultando el Gamma API…
            </div>
            <div>Trayendo y filtrando markets de Polymarket.</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="state">
            <div className="big">Sin resultados</div>
            <div>
              No se detectaron markets con Holding Rewards en el rango escaneado.
              Probá subir las páginas, bajar la liquidez mínima, o activar modo debug.
            </div>
          </div>
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
                <th className="num hide-sm">Vol 24h</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}>
                  <td className="q">
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.question}
                    </a>
                    <div className="slug">
                      {r.slug || "—"}
                      {!r.acceptingOrders && (
                        <span className="pill" style={{ marginLeft: 8 }}>
                          no acepta órdenes
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="prob">{r.favoriteOutcome}</span>{" "}
                    <span className="dim">{r.impliedProb.toFixed(1)}%</span>
                  </td>
                  <td className="num">
                    <span className={"apy" + (r.apyAssumed ? " assumed" : "")}>
                      {r.holdingApy != null ? `${r.holdingApy.toFixed(2)}%` : "—"}
                    </span>
                  </td>
                  <td className="num hide-sm">
                    <span className="bond">
                      {r.bondApy != null ? `${r.bondApy.toFixed(1)}%` : "—"}
                    </span>
                  </td>
                  <td className="num hide-sm dim">{fmtDays(r.daysToResolution)}</td>
                  <td className="num hide-sm dim">{fmtDate(r.endDate)}</td>
                  <td className="num">{fmtUSD(r.liquidity)}</td>
                  <td className="num hide-sm dim">{fmtUSD(r.volume24hr)}</td>
                  <td className="num">
                    <button
                      className="btn-mini"
                      title="Calcular rewards con este market"
                      onClick={() => loadIntoCalc(r)}
                    >
                      calc
                    </button>
                    <a className="ext" href={r.url} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="calc" ref={calcRef}>
        <div className="calc-head">
          <h2>
            Calculadora de <span className="accent">rewards</span>
          </h2>
          <p>
            ¿Cuánto rinde tu depósito farmeando el holding reward? Tocá{" "}
            <span className="kbd">calc</span> en cualquier market de arriba para cargar
            su APY y sus días restantes, o ajustá los valores a mano.
          </p>
        </div>

        {calcMarket && (
          <div className="calc-loaded">
            Cargado desde: <b>{calcMarket}</b>
            {calcPrice != null && (
              <span className="dim">
                {" "}
                · favorito a {(calcPrice * 100).toFixed(1)}¢
              </span>
            )}
          </div>
        )}

        <div className="calc-inputs">
          <div className="field">
            <label>Depósito (USDC)</label>
            <input
              type="number"
              value={deposit}
              min={0}
              step={100}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
          <div className="field">
            <label>APY del reward (%)</label>
            <input
              type="number"
              value={calcApy}
              min={0}
              step={0.5}
              onChange={(e) => setCalcApy(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Días a mantener</label>
            <input
              type="number"
              value={calcDays}
              min={0}
              step={1}
              onChange={(e) => setCalcDays(e.target.value)}
            />
            <span className="hint">
              {calcMarket ? "= días hasta que cierra el market" : "editá según tu plan"}
            </span>
          </div>
        </div>

        <div className="calc-grid">
          <div className="stat">
            <div className="stat-label">Reward por día</div>
            <div className="stat-value">{fmtReward(dailyReward)}</div>
            <div className="stat-sub">USDC / día</div>
          </div>
          <div className="stat">
            <div className="stat-label">Reward por mes</div>
            <div className="stat-value">{fmtReward(monthlyReward)}</div>
            <div className="stat-sub">~30 días</div>
          </div>
          <div className="stat highlight">
            <div className="stat-label">Reward total en {days || 0} días</div>
            <div className="stat-value">{fmtReward(totalReward)}</div>
            <div className="stat-sub">+{returnPct.toFixed(2)}% sobre tu depósito</div>
          </div>
          <div className="stat">
            <div className="stat-label">Valor final</div>
            <div className="stat-value">{fmtReward(finalValue)}</div>
            <div className="stat-sub">depósito + rewards</div>
          </div>
        </div>

        {resolutionGain != null && (
          <div className="calc-extra">
            <b>Extra por resolución (no garantizado):</b> si con esos {fmtReward(D)} comprás
            el outcome favorito a {(calcPrice! * 100).toFixed(1)}¢ y el market resuelve a tu
            favor, al llegar a $1 ganás otros{" "}
            <span className="cyan">{fmtReward(resolutionGain)}</span> aparte de los rewards.
            Si resuelve en contra, perdés el depósito — por eso no se suma al total de arriba.
          </div>
        )}
      </section>

      <div className="disclaimer">
        <b>Leé esto.</b> El <b>Holding Reward</b> (hoy 4.00% anualizado) lo paga
        Polymarket sobre el valor de tu posición; es una <b>tasa variable</b> y la
        lista de markets elegibles la define Polymarket a su criterio. El símbolo{" "}
        <code>≈</code> indica que el market está marcado como elegible pero el API no
        devolvió una tasa numérica, así que se asume la tasa del programa (4%).{" "}
        <b>Bond APY*</b> es solo de referencia: es el rendimiento implícito de comprar
        el outcome favorito y mantenerlo hasta $1 — <b>no es libre de riesgo</b>, el
        outcome puede resolverse en contra y perdés todo. Esto no es asesoramiento
        financiero. Verificá siempre la elegibilidad y la tasa actual en la página del
        market antes de operar.
      </div>
    </div>
  );
}
