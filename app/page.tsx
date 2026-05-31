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
