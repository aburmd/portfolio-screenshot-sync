import React, { useState } from "react";
import { fetchZones, saveChart } from "../services/api";

const btn = (color = "#1976d2") => ({
  padding: "6px 16px", cursor: "pointer", borderRadius: 4, fontSize: 13,
  background: color, color: "#fff", border: "none",
});
const btnOut = {
  padding: "6px 16px", cursor: "pointer", borderRadius: 4, fontSize: 13,
  border: "1px solid #ccc", background: "#fff",
};

const pct = (v, decimals = 1) =>
  v == null ? "—" : <span style={{ color: v >= 0 ? "#2e7d32" : "#c62828", fontWeight: "bold" }}>{v >= 0 ? "+" : ""}{v.toFixed(decimals)}%</span>;

const price = (v) => v == null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const levelBadge = (n) => {
  const colors = { 1: "#bdbdbd", 2: "#ff9800", 3: "#2e7d32" };
  return <span style={{ background: colors[n] || "#eee", color: "#fff", borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: "bold" }}>L{n}</span>;
};

export default function ZonesTab({ userId }) {
  const [symbol, setSymbol]     = useState("");
  const [market, setMarket]     = useState("US");
  const [basePos, setBasePos]   = useState(0.5);
  const [maxPos, setMaxPos]     = useState(3.0);
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [saved, setSaved]       = useState(false);

  const handleSearch = async () => {
    if (!symbol.trim()) return;
    setLoading(true); setError(null); setData(null); setSaved(false);
    try {
      const result = await fetchZones(market, symbol.trim().toUpperCase(), basePos, maxPos);
      if (result.error) setError(result.error);
      else setData(result);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleSaveChart = async () => {
    if (!data || !userId) return;
    setSaving(true);
    try {
      await saveChart(data.market, data.symbol, { user_id: userId, base_pos: basePos, max_pos: maxPos });
      setSaved(true);
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const cagr = data?.cagr_summary;
  const cur = market === "IN" ? "₹" : "$";

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "12px 0" }}>
        <label style={{ fontSize: 12 }}>Symbol<br />
          <input value={symbol} onChange={e => setSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="e.g. CRDO, AAPL" style={{ padding: 6, width: 130, fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: 6 }}>
            <option value="US">US</option>
            <option value="IN">India</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Base%<br />
          <input type="number" value={basePos} onChange={e => setBasePos(parseFloat(e.target.value) || 0.5)}
            step={0.1} style={{ padding: 6, width: 60 }} />
        </label>
        <label style={{ fontSize: 12 }}>Max%<br />
          <input type="number" value={maxPos} onChange={e => setMaxPos(parseFloat(e.target.value) || 3.0)}
            step={0.5} style={{ padding: 6, width: 60 }} />
        </label>
        <button style={btn()} onClick={handleSearch} disabled={loading}>
          {loading ? "Computing..." : "🔍 Compute Zones"}
        </button>
        {data && (
          <button style={btn(saved ? "#616161" : "#2e7d32")} onClick={handleSaveChart} disabled={saving || saved}>
            {saved ? "✅ Saved" : saving ? "Saving..." : "💾 Save Chart"}
          </button>
        )}
      </div>

      {error && <div style={{ background: "#fce4ec", color: "#c62828", padding: 10, borderRadius: 4, marginBottom: 8 }}>❌ {error}</div>}

      {data && (<>
        {/* CAGR Summary Card */}
        <div style={{ background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 20, fontWeight: "bold" }}>{data.symbol}</span>
              <span style={{ fontSize: 13, color: "#666", marginLeft: 8 }}>{data.market}</span>
            </div>
            <div style={{ fontSize: 13 }}>
              <b>Price:</b> {cur}{data.current_price?.toLocaleString()}
            </div>
            <div style={{ fontSize: 13 }}>
              <b>24M HH:</b> {cur}{data.period_hh?.toLocaleString()}
            </div>
            <div style={{ fontSize: 13 }}>
              <b>24M LL:</b> {cur}{data.period_ll?.toLocaleString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 8 }}>
            {cagr?.cagr_1y != null && <span style={{ fontSize: 12 }}>1Y CAGR: <b>{pct(cagr.cagr_1y)}</b></span>}
            {cagr?.cagr_3y != null && <span style={{ fontSize: 12 }}>3Y CAGR: <b>{pct(cagr.cagr_3y)}</b></span>}
            {cagr?.cagr_5y != null && <span style={{ fontSize: 12 }}>5Y CAGR: <b>{pct(cagr.cagr_5y)}</b></span>}
            {cagr?.avg_cagr != null && <span style={{ fontSize: 12, fontWeight: "bold" }}>Avg CAGR: {pct(cagr.avg_cagr)}</span>}
            {cagr?.qqq_avg_cagr != null && <span style={{ fontSize: 12, color: "#666" }}>QQQ CAGR: {pct(cagr.qqq_avg_cagr)}</span>}
            {cagr?.qqq_gate_price != null && (
              <span style={{ fontSize: 12, background: "#fff3e0", padding: "2px 6px", borderRadius: 3 }}>
                🚪 QQQ Gate: <b>{cur}{cagr.qqq_gate_price?.toLocaleString()}</b>
              </span>
            )}
            {cagr?.final_sell_price != null && (
              <span style={{ fontSize: 12, background: "#fce4ec", padding: "2px 6px", borderRadius: 3 }}>
                🎯 Final Sell: <b>{cur}{cagr.final_sell_price?.toLocaleString()}</b>
                <span style={{ color: "#999", marginLeft: 4 }}>({cagr.final_sell_window})</span>
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Buy Zones */}
          <div>
            <h4 style={{ margin: "0 0 8px", color: "#2e7d32" }}>🟢 Buy Zones ({data.buy_zones?.length || 0})</h4>
            {data.buy_zones?.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#e8f5e9" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Price</th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>Level</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Vol%</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>% from HH</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Target%</th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buy_zones.map((z, i) => {
                    const inZone = z.in_zone_now;
                    const bg = inZone ? "#c8e6c9" : i % 2 ? "#f9fbe7" : "#fff";
                    return (
                      <tr key={i} style={{ background: bg }}>
                        <td style={{ padding: "5px 8px", fontWeight: "bold" }}>
                          {cur}{z.price_level?.toLocaleString()}
                          {inZone && <span style={{ marginLeft: 4, fontSize: 10, background: "#2e7d32", color: "#fff", borderRadius: 3, padding: "1px 4px" }}>NOW</span>}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{levelBadge(z.level_count)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{z.vol_pct?.toFixed(2)}%</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{pct(z.pct_from_hh)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: "bold" }}>
                          {inZone && z.adjusted_target_pct !== z.total_target_pct
                            ? <><span style={{ color: "#e65100" }}>{z.adjusted_target_pct?.toFixed(2)}%</span><span style={{ color: "#999", fontSize: 10 }}> (50% rule)</span></>
                            : <span>{z.total_target_pct?.toFixed(2)}%</span>
                          }
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          {z.cagr_qualified && z.qqq_gate_qualified
                            ? <span style={{ color: "#2e7d32", fontSize: 11 }}>✅</span>
                            : <span style={{ color: "#999", fontSize: 11 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p style={{ color: "#999", fontSize: 12 }}>No qualified buy zones found.</p>}
          </div>

          {/* Sell Zones */}
          <div>
            <h4 style={{ margin: "0 0 8px", color: "#c62828" }}>🔴 Sell Zones ({data.sell_zones?.length || 0})</h4>
            {data.sell_zones?.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#ffebee" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Price</th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>Level</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Vol%</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>% from LL</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Trim to%</th>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sell_zones.map((z, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#fff8f8" : "#fff" }}>
                      <td style={{ padding: "5px 8px", fontWeight: "bold" }}>{cur}{z.price_level?.toLocaleString()}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center" }}>{levelBadge(z.level_count)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{z.vol_pct?.toFixed(2)}%</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{pct(z.pct_from_ll)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: "bold", color: z.total_target_pct === 0 ? "#c62828" : "#333" }}>
                        {z.total_target_pct?.toFixed(2)}%
                      </td>
                      <td style={{ padding: "5px 8px", fontSize: 11, color: "#666" }}>{z.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p style={{ color: "#999", fontSize: 12 }}>No sell zones above current price.</p>}
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 12, padding: 10, background: "#f5f5f5", borderRadius: 4, fontSize: 11, color: "#666" }}>
          <b>Legend:</b> L1 = 1 window confirmed | L2 = 2 windows | L3 = all 3 windows (strongest) &nbsp;·&nbsp;
          <b>Target%</b> = total portfolio allocation at that price level &nbsp;·&nbsp;
          <b>50% rule</b> = already in zone, buy half now &nbsp;·&nbsp;
          ✅ = CAGR qualified + QQQ gate qualified
        </div>
      </>)}
    </div>
  );
}
