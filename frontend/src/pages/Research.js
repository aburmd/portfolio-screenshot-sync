import React, { useState, useCallback, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell } from "recharts";
import { fetchFundamentals, fetchScreenerResults, runScreener, runMaScanner, fetchBuyCandidates, fetchPullbackBuys, refreshIndexes } from "../services/api";

const card = { border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafafa" };
const btn = { padding: "6px 16px", cursor: "pointer", borderRadius: 4, fontSize: 13 };
const btnPrimary = { ...btn, background: "#1976d2", color: "#fff", border: "none" };

export default function Research() {
  const [tab, setTab] = useState("screener");
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>📊 Research</h2>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button style={{ ...btn, background: tab === "screener" ? "#1976d2" : "#fff", color: tab === "screener" ? "#fff" : "#333", border: tab === "screener" ? "none" : "1px solid #ccc" }} onClick={() => setTab("screener")}>Earnings Screener</button>
        <button style={{ ...btn, background: tab === "candidates" ? "#1976d2" : "#fff", color: tab === "candidates" ? "#fff" : "#333", border: tab === "candidates" ? "none" : "1px solid #ccc" }} onClick={() => setTab("candidates")}>Buy Candidates</button>
        <button style={{ ...btn, background: tab === "pullback" ? "#2e7d32" : "#fff", color: tab === "pullback" ? "#fff" : "#333", border: tab === "pullback" ? "none" : "1px solid #ccc" }} onClick={() => setTab("pullback")}>🎯 Pullback Buy</button>
        <button style={{ ...btn, background: tab === "fundamentals" ? "#1976d2" : "#fff", color: tab === "fundamentals" ? "#fff" : "#333", border: tab === "fundamentals" ? "none" : "1px solid #ccc" }} onClick={() => setTab("fundamentals")}>Fundamentals</button>
      </div>
      {tab === "screener" && <ScreenerSection />}
      {tab === "candidates" && <BuyCandidatesSection />}
      {tab === "pullback" && <PullbackBuySection />}
      {tab === "fundamentals" && <FundamentalsSection />}
    </div>
  );
}

function ScreenerSection() {
  const [market, setMarket] = useState("US");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [dropFilter, setDropFilter] = useState(false);
  const [dropThreshold, setDropThreshold] = useState(6);
  const [peFilter, setPeFilter] = useState(false);
  const [peThreshold, setPeThreshold] = useState(30);
  const [opFilter, setOpFilter] = useState(false);
  const [revFilter, setRevFilter] = useState(false);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResults(await fetchScreenerResults(market));
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [market]);

  useEffect(() => { loadResults(); }, [loadResults]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      await runScreener(market);
      alert("Screener triggered! Results will appear in ~2 minutes. Click 🔄 Reload after.");
    } catch (e) {
      setError(e.message);
    }
    setRunning(false);
  };

  const handleRefreshIndexes = async () => {
    try {
      const r = await refreshIndexes(market);
      alert(`Indexes refreshed: ${JSON.stringify(r.indexes)}`);
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  let filtered = results;
  if (dropFilter) filtered = filtered.filter(r => r.cumulative_drop != null && r.cumulative_drop <= -dropThreshold);
  if (peFilter) filtered = filtered.filter(r => r.forward_pe && r.forward_pe < peThreshold);
  if (opFilter) filtered = filtered.filter(r => r.operating_margins && r.operating_margins > 0);
  if (revFilter) filtered = filtered.filter(r => r.revenue_growth && r.revenue_growth > 0);

  const curSym = market === "IN" ? "₹" : "$";
  const fmtLarge = (v) => {
    if (v == null) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    return v.toLocaleString();
  };

  // Group by earnings date for calendar view
  const byDate = {};
  results.forEach(r => {
    if (!r.report_date) return;
    byDate[r.report_date] = byDate[r.report_date] || [];
    byDate[r.report_date].push(r);
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US (S&P 500 + Nasdaq 100)</option>
            <option value="IN">India (Nifty 500)</option>
          </select>
        </label>
        <button style={btnPrimary} onClick={handleRun} disabled={running}>
          {running ? "Triggering..." : "🔍 Run Screener"}
        </button>
        <button style={{ ...btn, border: "1px solid #ccc" }} onClick={handleRefreshIndexes}>↻ Refresh Indexes</button>
        <button style={{ ...btn, border: "1px solid #ccc" }} onClick={loadResults}>🔄 Reload</button>
      </div>

      {/* Filters */}
      <div style={{ ...card, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: 10 }}>
        <span style={{ fontSize: 12, fontWeight: "bold" }}>Filters:</span>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={dropFilter} onChange={e => setDropFilter(e.target.checked)} />
          Drop ≥ <input type="number" value={dropThreshold} onChange={e => setDropThreshold(parseFloat(e.target.value) || 0)}
            style={{ width: 40, padding: 2, marginLeft: 2 }} disabled={!dropFilter} />%
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={peFilter} onChange={e => setPeFilter(e.target.checked)} />
          Fwd P/E &lt; <input type="number" value={peThreshold} onChange={e => setPeThreshold(parseFloat(e.target.value) || 0)}
            style={{ width: 40, padding: 2, marginLeft: 2 }} disabled={!peFilter} />
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={opFilter} onChange={e => setOpFilter(e.target.checked)} />
          Op Margin +ve
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={revFilter} onChange={e => setRevFilter(e.target.checked)} />
          Rev Growth +ve
        </label>
        <span style={{ fontSize: 11, color: "#999" }}>{filtered.length} of {results.length} stocks</span>
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {/* Results table */}
      {loading ? <p>Loading...</p> : filtered.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f5f5f5" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "left" }}>Sector</th>
            <th style={{ padding: 6, textAlign: "left" }}>Earnings</th>
            <th style={{ padding: 6, textAlign: "right" }}>Pre Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Cur Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Day Drop</th>
            <th style={{ padding: 6, textAlign: "right" }}>Cum Drop</th>
            <th style={{ padding: 6, textAlign: "right" }}>Op Margin</th>
            <th style={{ padding: 6, textAlign: "right" }}>Rev Growth</th>
            <th style={{ padding: 6, textAlign: "right" }}>Fwd P/E</th>
            <th style={{ padding: 6, textAlign: "right" }}>Mkt Cap</th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => {
              const dropColor = r.cumulative_drop < -6 ? "#c62828" : r.cumulative_drop < 0 ? "#e65100" : "#2e7d32";
              return (
                <tr key={r.symbol} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={{ padding: 6, fontWeight: "bold" }}>{r.symbol}</td>
                  <td style={{ padding: 6, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</td>
                  <td style={{ padding: 6, fontSize: 11, color: "#666" }}>{r.sector}</td>
                  <td style={{ padding: 6 }}>{r.report_date}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.pre_earnings_price?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.current_price?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.day_drop < 0 ? "#c62828" : "#2e7d32", fontWeight: "bold" }}>{r.day_drop?.toFixed(1)}%</td>
                  <td style={{ padding: 6, textAlign: "right", color: dropColor, fontWeight: "bold" }}>{r.cumulative_drop?.toFixed(1)}%</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.operating_margins > 0 ? "#2e7d32" : "#c62828" }}>{r.operating_margins != null ? `${r.operating_margins.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.revenue_growth > 0 ? "#2e7d32" : "#c62828" }}>{r.revenue_growth != null ? `${r.revenue_growth.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{r.forward_pe != null ? `${r.forward_pe.toFixed(1)}x` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmtLarge(r.market_cap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : !loading && <p style={{ color: "#999" }}>No results. Click "🔍 Run Screener" to scan (takes ~2 min), then "🔄 Reload".</p>}

      {/* Earnings Calendar summary */}
      {Object.keys(byDate).length > 0 && (
        <div style={{ ...card, marginTop: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>📅 Earnings This Week — {results.length} stocks from {market === "US" ? "S&P 500 + Nasdaq 100" : "Nifty 500"}</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).map(([dt, stocks]) => (
              <div key={dt} style={{ border: "1px solid #e0e0e0", borderRadius: 6, padding: 8, minWidth: 200, flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 12, marginBottom: 4, color: "#1565c0" }}>{dt} ({stocks.length})</div>
                {stocks.sort((a, b) => (a.cumulative_drop || 0) - (b.cumulative_drop || 0)).map(s => (
                  <div key={s.symbol} style={{ fontSize: 11, padding: "1px 0" }}>
                    <span style={{ fontWeight: "bold" }}>{s.symbol}</span>
                    <span style={{ color: s.cumulative_drop < -6 ? "#c62828" : s.cumulative_drop < 0 ? "#e65100" : "#2e7d32", marginLeft: 4, fontWeight: "bold" }}>
                      {s.cumulative_drop?.toFixed(1)}%
                    </span>
                    <span style={{ color: "#666", marginLeft: 4 }}>{s.name?.substring(0, 20)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuyCandidatesSection() {
  const [market, setMarket] = useState("US");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [minScore, setMinScore] = useState(4);
  const [maOnly, setMaOnly] = useState(false);
  const [earnOnly, setEarnOnly] = useState(false);

  const loadResults = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResults(await fetchBuyCandidates(market)); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [market]);

  useEffect(() => { loadResults(); }, [loadResults]);

  const handleRunMA = async () => {
    setScanning(true);
    try { await runMaScanner(market); alert("MA Scanner triggered! Takes ~2-3 min. Click 🔄 Reload after."); } catch (e) { setError(e.message); }
    setScanning(false);
  };

  let filtered = results.filter(r => r.total_score >= minScore);
  if (maOnly) filtered = filtered.filter(r => r.ma_aligned);
  if (earnOnly) filtered = filtered.filter(r => r.report_date);

  const curSym = market === "IN" ? "₹" : "$";
  const fmtLarge = (v) => { if (v == null) return "—"; const abs = Math.abs(v); if (abs >= 1e12) return `${(v/1e12).toFixed(1)}T`; if (abs >= 1e9) return `${(v/1e9).toFixed(1)}B`; if (abs >= 1e6) return `${(v/1e6).toFixed(0)}M`; return v.toLocaleString(); };
  const scoreBar = (score, max, color) => (
    <span>{Array.from({length: max}, (_, i) => <span key={i} style={{ color: i < score ? color : "#ddd" }}>●</span>)}</span>
  );

  return (
    <div>
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US</option><option value="IN">India</option>
          </select>
        </label>
        <button style={btnPrimary} onClick={handleRunMA} disabled={scanning}>{scanning ? "Triggering..." : "📈 Run MA Scanner"}</button>
        <button style={{ ...btn, border: "1px solid #ccc" }} onClick={loadResults}>🔄 Reload</button>
        <label style={{ fontSize: 12 }}>Min Score<br />
          <select value={minScore} onChange={e => setMinScore(parseInt(e.target.value))} style={{ padding: 6 }}>
            {[0,1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}/8</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={maOnly} onChange={e => setMaOnly(e.target.checked)} /> MA Aligned Only
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={earnOnly} onChange={e => setEarnOnly(e.target.checked)} /> With Earnings Only
        </label>
        <span style={{ fontSize: 11, color: "#999" }}>{filtered.length} of {results.length} stocks</span>
      </div>

      {/* Score legend */}
      <div style={{ ...card, padding: 8, fontSize: 11, display: "flex", gap: 16 }}>
        <span><b>Score = Tech + Fund + Earn (0-8)</b></span>
        <span style={{ color: "#1565c0" }}>●●● Tech (0-3): MA aligned, 200MA up, near 52w high</span>
        <span style={{ color: "#2e7d32" }}>●●● Fund (0-3): Op margin +ve, Rev growth +ve, P/E &lt; 30</span>
        <span style={{ color: "#ff9800" }}>●● Earn (0-2): Recent earnings + dip ≥ 6%</span>
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {loading ? <p>Loading...</p> : filtered.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f5f5f5" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "center" }}>Score</th>
            <th style={{ padding: 6, textAlign: "center" }}>Tech</th>
            <th style={{ padding: 6, textAlign: "center" }}>Fund</th>
            <th style={{ padding: 6, textAlign: "center" }}>Earn</th>
            <th style={{ padding: 6, textAlign: "right" }}>Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>50MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>150MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>200MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>From 52wH</th>
            <th style={{ padding: 6, textAlign: "right" }}>Fwd P/E</th>
            <th style={{ padding: 6, textAlign: "right" }}>Drop</th>
            <th style={{ padding: 6, textAlign: "left" }}>Earnings</th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => {
              const bg = r.total_score >= 6 ? "#e8f5e9" : r.total_score >= 4 ? "#fff8e1" : i % 2 ? "#fafafa" : "#fff";
              return (
                <tr key={r.symbol} style={{ background: bg }}>
                  <td style={{ padding: 6, fontWeight: "bold" }}>{r.symbol}</td>
                  <td style={{ padding: 6, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</td>
                  <td style={{ padding: 6, textAlign: "center", fontWeight: "bold", fontSize: 14 }}>{r.total_score}/8</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{scoreBar(r.tech_score, 3, "#1565c0")}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{scoreBar(r.fund_score, 3, "#2e7d32")}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{scoreBar(r.earn_score, 2, "#ff9800")}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.current_price?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.current_price > (r.ma50 || 0) ? "#2e7d32" : "#c62828" }}>{r.ma50 ? curSym + r.ma50.toLocaleString() : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{r.ma150 ? curSym + r.ma150.toLocaleString() : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{r.ma200 ? curSym + r.ma200.toLocaleString() : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right", color: (r.pct_from_high || 0) >= -10 ? "#2e7d32" : "#c62828" }}>{r.pct_from_high != null ? `${r.pct_from_high.toFixed(0)}%` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{r.forward_pe != null ? `${r.forward_pe.toFixed(1)}x` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right", color: (r.cumulative_drop || 0) < -6 ? "#c62828" : "#666" }}>{r.cumulative_drop != null ? `${r.cumulative_drop.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: 6, fontSize: 11 }}>{r.report_date || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : !loading && <p style={{ color: "#999" }}>No candidates found. Run "📈 MA Scanner" first (takes ~3 min), then "🔄 Reload".</p>}
    </div>
  );
}

function PullbackBuySection() {
  const [market, setMarket] = useState("US");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [peFilter, setPeFilter] = useState(false);
  const [peThreshold, setPeThreshold] = useState(30);

  const loadResults = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResults(await fetchPullbackBuys(market)); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [market]);

  useEffect(() => { loadResults(); }, [loadResults]);

  let filtered = results;
  if (peFilter) filtered = filtered.filter(r => r.forward_pe && r.forward_pe < peThreshold);

  const curSym = market === "IN" ? "₹" : "$";
  const fmtLarge = (v) => { if (v == null) return "—"; const abs = Math.abs(v); if (abs >= 1e12) return `${(v/1e12).toFixed(1)}T`; if (abs >= 1e9) return `${(v/1e9).toFixed(1)}B`; if (abs >= 1e6) return `${(v/1e6).toFixed(0)}M`; return v.toLocaleString(); };

  return (
    <div>
      {/* Explanation */}
      <div style={{ ...card, background: "#e8f5e9", border: "1px solid #66bb6a" }}>
        <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 4 }}>🎯 Pullback Buy — Strong Uptrend + 50MA Pullback</div>
        <div style={{ fontSize: 12, color: "#333" }}>
          These stocks are in a confirmed uptrend (price &gt; 150MA &gt; 200MA, 200MA rising) but have pulled back to the 50MA zone (+3% to -8%).
          The 50MA acts as dynamic support — institutional buyers often step in here. This is a high-probability buy setup.
        </div>
      </div>

      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US</option><option value="IN">India</option>
          </select>
        </label>
        <button style={{ ...btn, border: "1px solid #ccc" }} onClick={loadResults}>🔄 Reload</button>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={peFilter} onChange={e => setPeFilter(e.target.checked)} />
          Fwd P/E &lt; <input type="number" value={peThreshold} onChange={e => setPeThreshold(parseFloat(e.target.value) || 0)}
            style={{ width: 40, padding: 2, marginLeft: 2 }} disabled={!peFilter} />
        </label>
        <span style={{ fontSize: 11, color: "#999" }}>{filtered.length} stocks in pullback zone</span>
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {loading ? <p>Loading...</p> : filtered.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#e8f5e9" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "center" }}>Score</th>
            <th style={{ padding: 6, textAlign: "center" }}>Tech</th>
            <th style={{ padding: 6, textAlign: "center" }}>Fund</th>
            <th style={{ padding: 6, textAlign: "center" }}>Earn</th>
            <th style={{ padding: 6, textAlign: "left" }}>Sector</th>
            <th style={{ padding: 6, textAlign: "right" }}>Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>50MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>From 50MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>150MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>200MA</th>
            <th style={{ padding: 6, textAlign: "right" }}>Op Margin</th>
            <th style={{ padding: 6, textAlign: "right" }}>Rev Growth</th>
            <th style={{ padding: 6, textAlign: "right" }}>Fwd P/E</th>
            <th style={{ padding: 6, textAlign: "right" }}>Mkt Cap</th>
            <th style={{ padding: 6, textAlign: "left" }}>Earnings</th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => {
              const fromMA = r.pct_from_50ma || 0;
              const maColor = fromMA <= -3 ? "#c62828" : fromMA <= 0 ? "#e65100" : "#2e7d32";
              return (
                <tr key={r.symbol} style={{ background: r.total_score >= 6 ? "#c8e6c9" : r.total_score >= 4 ? "#f1f8e9" : i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={{ padding: 6, fontWeight: "bold" }}>{r.symbol}</td>
                  <td style={{ padding: 6, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</td>
                  <td style={{ padding: 6, textAlign: "center", fontWeight: "bold", fontSize: 14 }}>{r.total_score}/8</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{[0,1,2].map(j => <span key={j} style={{ color: j < r.tech_score ? "#1565c0" : "#ddd" }}>●</span>)}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{[0,1,2].map(j => <span key={j} style={{ color: j < r.fund_score ? "#2e7d32" : "#ddd" }}>●</span>)}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{[0,1].map(j => <span key={j} style={{ color: j < r.earn_score ? "#ff9800" : "#ddd" }}>●</span>)}</td>
                  <td style={{ padding: 6, fontSize: 11, color: "#666" }}>{r.sector}</td>
                  <td style={{ padding: 6, textAlign: "right", fontWeight: "bold" }}>{curSym}{r.current_price?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.ma50?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right", color: maColor, fontWeight: "bold" }}>{fromMA.toFixed(1)}%</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.ma150?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.ma200?.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.operating_margins > 0 ? "#2e7d32" : "#c62828" }}>{r.operating_margins != null ? `${r.operating_margins.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right", color: r.revenue_growth > 0 ? "#2e7d32" : "#c62828" }}>{r.revenue_growth != null ? `${r.revenue_growth.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{r.forward_pe != null ? `${r.forward_pe.toFixed(1)}x` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmtLarge(r.market_cap)}</td>
                  <td style={{ padding: 6, fontSize: 11 }}>{r.report_date ? `📅 ${r.report_date}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : !loading && <p style={{ color: "#999" }}>No stocks in pullback zone right now. Run MA Scanner from Buy Candidates tab first.</p>}
    </div>
  );
}

function FundamentalsSection() {
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState("US");
  const [period, setPeriod] = useState("annual");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [customPrice, setCustomPrice] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");

  const handleSearch = useCallback(async () => {
    if (!symbol.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const result = await fetchFundamentals(symbol.trim().toUpperCase(), market, period);
      if (result.error) { setError(result.error); } else { setData(result); setCustomPrice(""); setBuyPrice(""); setSellPrice(""); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [symbol, market, period]);

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSearch(); };
  const fmtLarge = (v) => { if (v == null) return "—"; const abs = Math.abs(v); if (abs >= 1e12) return `${(v/1e12).toFixed(1)}T`; if (abs >= 1e9) return `${(v/1e9).toFixed(1)}B`; if (abs >= 1e6) return `${(v/1e6).toFixed(0)}M`; if (abs >= 1e3) return `${(v/1e3).toFixed(0)}K`; return v.toFixed(0); };
  const curSym = data?.currency === "INR" ? "₹" : "$";
  const cp = parseFloat(customPrice) || 0;
  const bp = parseFloat(buyPrice) || 0;
  const sp = parseFloat(sellPrice) || 0;

  const chartData = data?.data?.map(d => {
    const eps = d.eps || 0;
    const annualizedEps = data?.period === "quarterly" ? eps * 4 : eps;
    return {
      year: d.label ? (d.type === "estimate" ? `${d.label}E` : d.label) : (d.type === "estimate" ? `${d.year}E` : `${d.year}`),
      operating_income: d.operating_income, pe: d.pe, eps: d.eps, revenue: d.revenue, type: d.type,
      op_income_display: d.operating_income != null ? d.operating_income / (data.currency === "INR" ? 1e7 : 1e6) : null,
      custom_pe: annualizedEps > 0 && cp > 0 ? parseFloat((cp / annualizedEps).toFixed(2)) : null,
      buy_pe: annualizedEps > 0 && bp > 0 ? parseFloat((bp / annualizedEps).toFixed(2)) : null,
      sell_pe: annualizedEps > 0 && sp > 0 ? parseFloat((sp / annualizedEps).toFixed(2)) : null,
    };
  }) || [];

  const opUnit = data?.currency === "INR" ? "Cr" : "M";
  const opDivisor = data?.currency === "INR" ? 1e7 : 1e6;

  return (
    <div>
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Symbol<br /><input value={symbol} onChange={e => setSymbol(e.target.value)} onKeyDown={handleKeyDown} placeholder="e.g. AAPL, RELIANCE" style={{ padding: 6, width: 160, fontSize: 14 }} /></label>
        <label style={{ fontSize: 12 }}>Market<br /><select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}><option value="US">US</option><option value="IN">India (NSE)</option></select></label>
        <label style={{ fontSize: 12 }}>Period<br /><select value={period} onChange={e => setPeriod(e.target.value)} style={{ padding: 6 }}><option value="annual">Annual</option><option value="quarterly">Quarterly</option></select></label>
        <button style={btnPrimary} onClick={handleSearch} disabled={loading}>{loading ? "Loading..." : "Search"}</button>
        {data?.cached && <span style={{ fontSize: 11, color: "#999" }}>📦 cached</span>}
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {data && !error && (<>
        <div style={{ ...card, background: "#e3f2fd" }}>
          <div style={{ fontSize: 20, fontWeight: "bold" }}>{data.company_name}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>
            {data.display_symbol || data.symbol} · {data.currency} · Price: {curSym}{data.current_price?.toLocaleString()}
            {data.trailing_pe && <span> · Trailing P/E: {data.trailing_pe.toFixed(1)}</span>}
            {data.forward_pe && <span> · Forward P/E: {data.forward_pe.toFixed(1)}</span>}
            {data.operating_margin && <span> · Op Margin: {(data.operating_margin * 100).toFixed(1)}%</span>}
          </div>
        </div>

        {chartData.length > 0 && (
          <div style={card}>
            <h4 style={{ margin: "0 0 12px" }}>Operating Income ({opUnit}) & P/E Ratio</h4>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${curSym}${fmtLarge(v * opDivisor)}`} label={{ value: "Operating Income", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: "P/E Ratio", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  return (<div style={{ background: "#fff", border: "1px solid #ccc", padding: 8, fontSize: 12 }}>
                    <div style={{ fontWeight: "bold" }}>{label} {d?.type === "estimate" ? "(Estimate)" : ""}</div>
                    {d?.operating_income != null && <div>Op Income: {curSym}{fmtLarge(d.operating_income)}</div>}
                    {d?.revenue != null && <div>Revenue: {curSym}{fmtLarge(d.revenue)}</div>}
                    {d?.eps != null && <div>EPS: {curSym}{d.eps.toFixed(2)}</div>}
                    {d?.pe != null && <div>Historical P/E: {d.pe.toFixed(1)}x</div>}
                    {d?.custom_pe != null && <div style={{ color: "#9c27b0" }}>Custom P/E: {d.custom_pe.toFixed(1)}x</div>}
                    {d?.buy_pe != null && <div style={{ color: "#2e7d32" }}>Buy P/E: {d.buy_pe.toFixed(1)}x</div>}
                    {d?.sell_pe != null && <div style={{ color: "#c62828" }}>Sell P/E: {d.sell_pe.toFixed(1)}x</div>}
                  </div>);
                }} />
                <Legend />
                <Bar yAxisId="left" dataKey="op_income_display" name={`Op Income (${opUnit})`} radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (<Cell key={i} fill={d.type === "estimate" ? "#90caf9" : (d.op_income_display >= 0 ? "#2e7d32" : "#c62828")} opacity={d.type === "estimate" ? 0.6 : 1} />))}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="pe" name="Historical P/E" stroke="#ff9800" strokeWidth={2} dot={{ r: 4, fill: "#ff9800" }} connectNulls strokeDasharray={cp > 0 ? "5 3" : undefined} />
                {cp > 0 && <Line yAxisId="right" type="monotone" dataKey="custom_pe" name={`P/E @ ${curSym}${cp}`} stroke="#9c27b0" strokeWidth={2} dot={{ r: 4, fill: "#9c27b0" }} connectNulls />}
                {bp > 0 && <Line yAxisId="right" type="monotone" dataKey="buy_pe" name={`Buy @ ${curSym}${bp}`} stroke="#2e7d32" strokeWidth={2} dot={{ r: 3, fill: "#2e7d32" }} connectNulls strokeDasharray="8 4" />}
                {sp > 0 && <Line yAxisId="right" type="monotone" dataKey="sell_pe" name={`Sell @ ${curSym}${sp}`} stroke="#c62828" strokeWidth={2} dot={{ r: 3, fill: "#c62828" }} connectNulls strokeDasharray="8 4" />}
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12, padding: "8px 0", borderTop: "1px solid #eee" }}>
              <label style={{ fontSize: 12 }}>Custom Price<br /><input type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder={data?.current_price ? `${data.current_price}` : "Price"} style={{ padding: 4, width: 90, border: "2px solid #9c27b0", borderRadius: 4 }} /></label>
              <label style={{ fontSize: 12, color: "#2e7d32" }}>Buy Target<br /><input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="Buy price" style={{ padding: 4, width: 90, border: "2px solid #2e7d32", borderRadius: 4 }} /></label>
              <label style={{ fontSize: 12, color: "#c62828" }}>Sell Target<br /><input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="Sell price" style={{ padding: 4, width: 90, border: "2px solid #c62828", borderRadius: 4 }} /></label>
              <span style={{ fontSize: 11, color: "#666" }}>Current: {curSym}{data?.current_price?.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div style={card}>
          <h4 style={{ margin: "0 0 8px" }}>Financials Detail</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f5f5f5" }}>
              <th style={{ padding: 6, textAlign: "left" }}>Year</th>
              <th style={{ padding: 6, textAlign: "right" }}>Revenue</th>
              <th style={{ padding: 6, textAlign: "right" }}>Op Income</th>
              <th style={{ padding: 6, textAlign: "right" }}>EPS</th>
              <th style={{ padding: 6, textAlign: "right" }}>P/E</th>
              <th style={{ padding: 6, textAlign: "left" }}>Type</th>
            </tr></thead>
            <tbody>
              {data.data.map((d, i) => (
                <tr key={i} style={{ background: d.type === "estimate" ? "#f3f8ff" : "transparent" }}>
                  <td style={{ padding: 6, fontWeight: "bold" }}>{d.label || d.year}{d.type === "estimate" ? "E" : ""}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{d.revenue != null ? `${curSym}${fmtLarge(d.revenue)}` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right", color: d.operating_income != null ? (d.operating_income >= 0 ? "#2e7d32" : "#c62828") : "#999" }}>{d.operating_income != null ? `${curSym}${fmtLarge(d.operating_income)}` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{d.eps != null ? `${curSym}${d.eps.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{d.pe != null ? `${d.pe.toFixed(1)}x` : "—"}</td>
                  <td style={{ padding: 6, fontSize: 11, color: "#666" }}>{d.type === "estimate" ? "📊 Est" : "✅ Actual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
