import React, { useState, useCallback, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell } from "recharts";
import { fetchFundamentals, fetchScreenerResults, runScreener, refreshIndexes } from "../services/api";

const card = { border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafafa" };
const btn = { padding: "6px 16px", cursor: "pointer", borderRadius: 4, fontSize: 13 };
const btnPrimary = { ...btn, background: "#1976d2", color: "#fff", border: "none" };

export default function Research() {
  const [tab, setTab] = useState("screener");
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>📊 Research</h2>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button style={{ ...btn, background: tab === "screener" ? "#1976d2" : "#fff", color: tab === "screener" ? "#fff" : "#333", border: tab === "screener" ? "none" : "1px solid #ccc" }} onClick={() => setTab("screener")}>Earnings Dip Screener</button>
        <button style={{ ...btn, background: tab === "fundamentals" ? "#1976d2" : "#fff", color: tab === "fundamentals" ? "#fff" : "#333", border: tab === "fundamentals" ? "none" : "1px solid #ccc" }} onClick={() => setTab("fundamentals")}>Fundamentals</button>
      </div>
      {tab === "screener" && <ScreenerSection />}
      {tab === "fundamentals" && <FundamentalsSection />}
    </div>
  );
}

function ScreenerSection() {
  const [market, setMarket] = useState("US");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [peFilter, setPeFilter] = useState(false);
  const [error, setError] = useState(null);

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
      const r = await runScreener(market);
      alert(`Scanned ${r.scanned} stocks, ${r.qualifying} qualifying`);
      loadResults();
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

  const filtered = peFilter ? results.filter(r => r.forward_pe && r.forward_pe < 30) : results;
  const curSym = market === "IN" ? "₹" : "$";

  const fmtLarge = (v) => {
    if (v == null) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    return v.toLocaleString();
  };

  return (
    <div>
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US (S&P 500 + Nasdaq 100)</option>
            <option value="IN">India (Nifty 500)</option>
          </select>
        </label>
        <button style={btnPrimary} onClick={handleRun} disabled={running}>
          {running ? "Scanning..." : "🔍 Run Screener"}
        </button>
        <button style={{ ...btn, border: "1px solid #ccc" }} onClick={handleRefreshIndexes}>↻ Refresh Indexes</button>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={peFilter} onChange={e => setPeFilter(e.target.checked)} />
          Forward P/E &lt; 30
        </label>
        <span style={{ fontSize: 11, color: "#999" }}>{filtered.length} stocks</span>
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {loading ? <p>Loading...</p> : filtered.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f5f5f5" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "left" }}>Earnings</th>
            <th style={{ padding: 6, textAlign: "right" }}>Pre Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Cur Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Day Drop</th>
            <th style={{ padding: 6, textAlign: "right" }}>Cum Drop</th>
            <th style={{ padding: 6, textAlign: "right" }}>Op Inc (CY)</th>
            <th style={{ padding: 6, textAlign: "right" }}>Op Inc (NY)</th>
            <th style={{ padding: 6, textAlign: "right" }}>Rev Growth</th>
            <th style={{ padding: 6, textAlign: "right" }}>Fwd P/E</th>
            <th style={{ padding: 6, textAlign: "right" }}>Mkt Cap</th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.symbol} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                <td style={{ padding: 6, fontWeight: "bold" }}>{r.symbol}</td>
                <td style={{ padding: 6, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</td>
                <td style={{ padding: 6 }}>{r.report_date}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.pre_earnings_price?.toLocaleString()}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{curSym}{r.current_price?.toLocaleString()}</td>
                <td style={{ padding: 6, textAlign: "right", color: "#c62828", fontWeight: "bold" }}>{r.day_drop?.toFixed(1)}%</td>
                <td style={{ padding: 6, textAlign: "right", color: "#c62828", fontWeight: "bold" }}>{r.cumulative_drop?.toFixed(1)}%</td>
                <td style={{ padding: 6, textAlign: "right" }}>{r.op_income_cy != null ? `${curSym}${fmtLarge(r.op_income_cy)}` : "—"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{r.op_income_ny != null ? `${curSym}${fmtLarge(r.op_income_ny)}` : "—"}</td>
                <td style={{ padding: 6, textAlign: "right", color: r.revenue_growth > 0 ? "#2e7d32" : "#c62828" }}>{r.revenue_growth != null ? `${r.revenue_growth.toFixed(1)}%` : "—"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{r.forward_pe != null ? `${r.forward_pe.toFixed(1)}x` : "—"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmtLarge(r.market_cap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !loading && <p style={{ color: "#999" }}>No qualifying stocks found. Run the screener or wait for the daily scan.</p>}
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
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await fetchFundamentals(symbol.trim().toUpperCase(), market, period);
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
        setCustomPrice("");
        setBuyPrice("");
        setSellPrice("");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [symbol, market, period]);

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSearch(); };

  const fmtLarge = (v) => {
    if (v == null) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };

  const curSym = data?.currency === "INR" ? "₹" : "$";

  const cp = parseFloat(customPrice) || 0;
  const bp = parseFloat(buyPrice) || 0;
  const sp = parseFloat(sellPrice) || 0;

  const chartData = data?.data?.map(d => {
    const eps = d.eps || 0;
    const annualizedEps = data?.period === "quarterly" ? eps * 4 : eps;
    return {
      year: d.label ? (d.type === "estimate" ? `${d.label}E` : d.label) : (d.type === "estimate" ? `${d.year}E` : `${d.year}`),
      operating_income: d.operating_income,
      pe: d.pe,
      eps: d.eps,
      revenue: d.revenue,
      type: d.type,
      op_income_display: d.operating_income != null ? d.operating_income / (data.currency === "INR" ? 1e7 : 1e6) : null,
      custom_pe: annualizedEps > 0 && cp > 0 ? parseFloat((cp / annualizedEps).toFixed(2)) : null,
      buy_pe: annualizedEps > 0 && bp > 0 ? parseFloat((bp / annualizedEps).toFixed(2)) : null,
      sell_pe: annualizedEps > 0 && sp > 0 ? parseFloat((sp / annualizedEps).toFixed(2)) : null,
    };
  }) || [];

  const opUnit = data?.currency === "INR" ? "Cr" : "M";
  const opDivisor = data?.currency === "INR" ? 1e7 : 1e6;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>📊 Research</h2>

      <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Symbol<br />
          <input value={symbol} onChange={e => setSymbol(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="e.g. AAPL, RELIANCE" style={{ padding: 6, width: 160, fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US</option>
            <option value="IN">India (NSE)</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Period<br />
          <select value={period} onChange={e => setPeriod(e.target.value)} style={{ padding: 6 }}>
            <option value="annual">Annual</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
        <button style={btnPrimary} onClick={handleSearch} disabled={loading}>
          {loading ? "Loading..." : "Search"}
        </button>
        {data?.cached && <span style={{ fontSize: 11, color: "#999" }}>📦 cached</span>}
      </div>

      {error && <div style={{ ...card, background: "#fce4ec", color: "#c62828" }}>❌ {error}</div>}

      {data && !error && (
        <>
          {/* Company header */}
          <div style={{ ...card, background: "#e3f2fd" }}>
            <div style={{ fontSize: 20, fontWeight: "bold" }}>{data.company_name}</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>
              {data.display_symbol || data.symbol} · {data.currency} · Price: {curSym}{data.current_price?.toLocaleString()}
              {data.trailing_pe && <span> · Trailing P/E: {data.trailing_pe.toFixed(1)}</span>}
              {data.forward_pe && <span> · Forward P/E: {data.forward_pe.toFixed(1)}</span>}
              {data.operating_margin && <span> · Op Margin: {(data.operating_margin * 100).toFixed(1)}%</span>}
            </div>
          </div>

          {/* Combined chart: Operating Income bars + P/E line */}
          {chartData.length > 0 && (
            <div style={card}>
              <h4 style={{ margin: "0 0 12px" }}>Operating Income ({opUnit}) & P/E Ratio</h4>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${curSym}${fmtLarge(v * opDivisor)}`}
                    label={{ value: `Operating Income`, angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }}
                    label={{ value: "P/E Ratio", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div style={{ background: "#fff", border: "1px solid #ccc", padding: 8, fontSize: 12 }}>
                        <div style={{ fontWeight: "bold" }}>{label} {d?.type === "estimate" ? "(Estimate)" : ""}</div>
                        {d?.operating_income != null && <div>Op Income: {curSym}{fmtLarge(d.operating_income)}</div>}
                        {d?.revenue != null && <div>Revenue: {curSym}{fmtLarge(d.revenue)}</div>}
                        {d?.eps != null && <div>EPS: {curSym}{d.eps.toFixed(2)}</div>}
                        {d?.pe != null && <div>Historical P/E: {d.pe.toFixed(1)}x</div>}
                        {d?.custom_pe != null && <div style={{ color: "#9c27b0" }}>Custom P/E: {d.custom_pe.toFixed(1)}x</div>}
                        {d?.buy_pe != null && <div style={{ color: "#2e7d32" }}>Buy P/E: {d.buy_pe.toFixed(1)}x</div>}
                        {d?.sell_pe != null && <div style={{ color: "#c62828" }}>Sell P/E: {d.sell_pe.toFixed(1)}x</div>}
                      </div>
                    );
                  }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="op_income_display" name={`Op Income (${opUnit})`} radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.type === "estimate" ? "#90caf9" : (d.op_income_display >= 0 ? "#2e7d32" : "#c62828")} opacity={d.type === "estimate" ? 0.6 : 1} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="pe" name="Historical P/E" stroke="#ff9800" strokeWidth={2}
                    dot={{ r: 4, fill: "#ff9800" }} connectNulls strokeDasharray={cp > 0 ? "5 3" : undefined} />
                  {cp > 0 && <Line yAxisId="right" type="monotone" dataKey="custom_pe" name={`P/E @ ${curSym}${cp}`} stroke="#9c27b0" strokeWidth={2}
                    dot={{ r: 4, fill: "#9c27b0" }} connectNulls />}
                  {bp > 0 && <Line yAxisId="right" type="monotone" dataKey="buy_pe" name={`Buy @ ${curSym}${bp}`} stroke="#2e7d32" strokeWidth={2}
                    dot={{ r: 3, fill: "#2e7d32" }} connectNulls strokeDasharray="8 4" />}
                  {sp > 0 && <Line yAxisId="right" type="monotone" dataKey="sell_pe" name={`Sell @ ${curSym}${sp}`} stroke="#c62828" strokeWidth={2}
                    dot={{ r: 3, fill: "#c62828" }} connectNulls strokeDasharray="8 4" />}
                </ComposedChart>
              </ResponsiveContainer>

              {/* Price simulator */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12, padding: "8px 0", borderTop: "1px solid #eee" }}>
                <label style={{ fontSize: 12 }}>Custom Price<br />
                  <input type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)}
                    placeholder={data?.current_price ? `${data.current_price}` : "Price"}
                    style={{ padding: 4, width: 90, border: "2px solid #9c27b0", borderRadius: 4 }} />
                </label>
                <label style={{ fontSize: 12, color: "#2e7d32" }}>Buy Target<br />
                  <input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)}
                    placeholder="Buy price"
                    style={{ padding: 4, width: 90, border: "2px solid #2e7d32", borderRadius: 4 }} />
                </label>
                <label style={{ fontSize: 12, color: "#c62828" }}>Sell Target<br />
                  <input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)}
                    placeholder="Sell price"
                    style={{ padding: 4, width: 90, border: "2px solid #c62828", borderRadius: 4 }} />
                </label>
                <span style={{ fontSize: 11, color: "#666" }}>Current: {curSym}{data?.current_price?.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Data table */}
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
                    <td style={{ padding: 6, textAlign: "right", color: d.operating_income != null ? (d.operating_income >= 0 ? "#2e7d32" : "#c62828") : "#999" }}>
                      {d.operating_income != null ? `${curSym}${fmtLarge(d.operating_income)}` : "—"}
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>{d.eps != null ? `${curSym}${d.eps.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{d.pe != null ? `${d.pe.toFixed(1)}x` : "—"}</td>
                    <td style={{ padding: 6, fontSize: 11, color: "#666" }}>{d.type === "estimate" ? "📊 Est" : "✅ Actual"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
