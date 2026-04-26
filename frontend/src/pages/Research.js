import React, { useState, useCallback } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell } from "recharts";
import { fetchFundamentals } from "../services/api";

const card = { border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafafa" };
const btn = { padding: "6px 16px", cursor: "pointer", borderRadius: 4, fontSize: 13 };
const btnPrimary = { ...btn, background: "#1976d2", color: "#fff", border: "none" };

export default function Research() {
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState("US");
  const [period, setPeriod] = useState("annual");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const chartData = data?.data?.map(d => ({
    year: d.label ? (d.type === "estimate" ? `${d.label}E` : d.label) : (d.type === "estimate" ? `${d.year}E` : `${d.year}`),
    operating_income: d.operating_income,
    pe: d.pe,
    eps: d.eps,
    revenue: d.revenue,
    type: d.type,
    op_income_display: d.operating_income != null ? d.operating_income / (data.currency === "INR" ? 1e7 : 1e6) : null,
  })) || [];

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
                        {d?.pe != null && <div>P/E: {d.pe.toFixed(1)}x</div>}
                      </div>
                    );
                  }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="op_income_display" name={`Op Income (${opUnit})`} radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.type === "estimate" ? "#90caf9" : (d.op_income_display >= 0 ? "#2e7d32" : "#c62828")} opacity={d.type === "estimate" ? 0.6 : 1} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="pe" name="P/E Ratio" stroke="#ff9800" strokeWidth={2}
                    dot={{ r: 4, fill: "#ff9800" }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
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
                    <td style={{ padding: 6, fontWeight: "bold" }}>{d.label || d.year}{d.type === "estimate" ? "E" : ""}</td></td>
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
