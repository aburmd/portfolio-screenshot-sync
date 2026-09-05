import React, { useState, useEffect, useCallback } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { fetchSavedCharts, fetchSavedChart, refreshChart, deleteChart } from "../services/api";

const btn = (color = "#1976d2", disabled = false) => ({
  padding: "5px 14px", cursor: disabled ? "not-allowed" : "pointer", borderRadius: 4,
  fontSize: 12, background: disabled ? "#bdbdbd" : color, color: "#fff", border: "none", opacity: disabled ? 0.7 : 1,
});
const btnOut = {
  padding: "5px 14px", cursor: "pointer", borderRadius: 4, fontSize: 12,
  border: "1px solid #ccc", background: "#fff",
};

const RANGES = ["6M", "1Y", "2Y"];

function filterByRange(ohlcv, range) {
  if (!ohlcv?.length) return [];
  const months = range === "6M" ? 6 : range === "1Y" ? 12 : 24;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return ohlcv.filter(r => r.date >= cutoffStr);
}

// Candlestick bar shape for Recharts
function CandleBar({ x, y, width, height, payload }) {
  if (!payload) return null;
  const { open, close, high, low } = payload;
  if (open == null || close == null) return null;
  const isUp = close >= open;
  const color = isUp ? "#2e7d32" : "#c62828";
  const bodyTop = Math.min(open, close);
  const bodyBot = Math.max(open, close);
  // We need pixel coords — use the chart's scale. Since we're using Bar with custom shape,
  // x/y/width/height are provided by Recharts based on the value.
  // We'll render a simple colored bar (open-close body) + wick lines.
  const barW = Math.max(width - 2, 1);
  const cx = x + width / 2;
  return (
    <g>
      {/* Wick */}
      <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1} />
      {/* Body — drawn as rect using y/height from Recharts (which maps to close value) */}
      <rect x={x + 1} y={y} width={barW} height={Math.max(height, 1)} fill={color} opacity={0.85} />
    </g>
  );
}

// Custom tooltip
function ChartTooltip({ active, payload, label, cur }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #ccc", padding: 8, fontSize: 11, borderRadius: 4 }}>
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>{label}</div>
      {d.open  != null && <div>O: {cur}{d.open?.toFixed(2)}</div>}
      {d.high  != null && <div>H: {cur}{d.high?.toFixed(2)}</div>}
      {d.low   != null && <div>L: {cur}{d.low?.toFixed(2)}</div>}
      {d.close != null && <div>C: <b>{cur}{d.close?.toFixed(2)}</b></div>}
      {d.volume > 0    && <div style={{ color: "#666" }}>Vol: {(d.volume / 1e6).toFixed(1)}M</div>}
    </div>
  );
}

function ChartPage({ userId, market, symbol, onBack }) {
  const [chartData, setChartData]   = useState(null);
  const [range, setRange]           = useState("1Y");
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setChartData(await fetchSavedChart(market, symbol, userId)); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, [market, symbol, userId]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await refreshChart(market, symbol, userId);
      if (res.refreshed) await load();
      else alert("Already refreshed today — data is current.");
    } catch (e) { setError(e.message); }
    setRefreshing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete saved chart for ${symbol}?`)) return;
    await deleteChart(market, symbol, userId);
    onBack();
  };

  const alreadyRefreshed = chartData?.last_refreshed_date === today;
  const cur = market === "IN" ? "₹" : "$";

  const ohlcv = filterByRange(chartData?.cached_ohlcv, range);
  const zones = chartData?.cached_zones;

  // Thin out data for performance: show every Nth candle based on range
  const step = range === "6M" ? 1 : range === "1Y" ? 1 : 2;
  const displayData = ohlcv.filter((_, i) => i % step === 0);

  // Buy zone reference lines
  const buyZones  = zones?.buy_zones  || [];
  const sellZones = zones?.sell_zones || [];
  const gatePrice = zones?.cagr_summary?.qqq_gate_price;
  const finalSell = zones?.cagr_summary?.final_sell_price;

  // Y axis domain with padding
  const allPrices = displayData.flatMap(d => [d.high, d.low].filter(Boolean));
  const yMin = allPrices.length ? Math.min(...allPrices) * 0.97 : 0;
  const yMax = allPrices.length ? Math.max(...allPrices) * 1.03 : 100;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button style={btnOut} onClick={onBack}>← Back</button>
        <span style={{ fontSize: 18, fontWeight: "bold" }}>{symbol}</span>
        <span style={{ fontSize: 12, color: "#666" }}>{market}</span>
        {chartData?.last_refreshed_date && (
          <span style={{ fontSize: 11, color: "#999" }}>Last refreshed: {chartData.last_refreshed_date}</span>
        )}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ ...btnOut, background: range === r ? "#1976d2" : "#fff", color: range === r ? "#fff" : "#333", border: range === r ? "none" : "1px solid #ccc" }}>
              {r}
            </button>
          ))}
          <button style={btn(alreadyRefreshed ? "#9e9e9e" : "#2e7d32", alreadyRefreshed)}
            onClick={handleRefresh} disabled={refreshing || alreadyRefreshed}>
            {refreshing ? "Refreshing..." : alreadyRefreshed ? "✅ Up to date" : "🔄 Refresh"}
          </button>
          <button style={btn("#c62828")} onClick={handleDelete}>🗑 Delete</button>
        </div>
      </div>

      {/* Avg price placeholder */}
      <div style={{ background: "#f5f5f5", border: "1px dashed #bdbdbd", borderRadius: 4, padding: "6px 12px", fontSize: 11, color: "#999", marginBottom: 10 }}>
        📊 Avg price overlay — <i>multi-account feature coming soon</i>
        <select disabled style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11, color: "#bdbdbd" }}>
          <option>Select account...</option>
        </select>
      </div>

      {error && <div style={{ background: "#fce4ec", color: "#c62828", padding: 8, borderRadius: 4, marginBottom: 8 }}>❌ {error}</div>}

      {loading ? <p>Loading chart...</p> : displayData.length > 0 ? (
        <>
          {/* Zone legend */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, marginBottom: 6 }}>
            <span style={{ color: "#2e7d32" }}>━━ Buy zones</span>
            <span style={{ color: "#c62828" }}>━━ Sell zones</span>
            {gatePrice && <span style={{ color: "#e65100" }}>┅┅ QQQ Gate</span>}
            {finalSell && <span style={{ color: "#b71c1c" }}>┅┅ Final Sell</span>}
            <span style={{ color: "#1976d2" }}>━ Current price</span>
          </div>

          <ResponsiveContainer width="100%" height={480}>
            <ComposedChart data={displayData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                tickFormatter={v => v?.slice(5)}  // show MM-DD
                interval={Math.floor(displayData.length / 8)} />
              <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }}
                tickFormatter={v => `${cur}${v >= 1000 ? (v/1000).toFixed(0)+"K" : v.toFixed(0)}`}
                width={55} />
              <Tooltip content={<ChartTooltip cur={cur} />} />

              {/* Candlestick bars — use high as value, shape draws full candle */}
              <Bar dataKey="high" shape={<CandleBar />} isAnimationActive={false}>
                {displayData.map((d, i) => <Cell key={i} />)}
              </Bar>

              {/* Current price */}
              {zones?.current_price && (
                <ReferenceLine y={zones.current_price} stroke="#1976d2" strokeWidth={1.5}
                  label={{ value: `${cur}${zones.current_price?.toFixed(2)}`, position: "right", fontSize: 10, fill: "#1976d2" }} />
              )}

              {/* Buy zones — green solid/dashed */}
              {buyZones.map((z, i) => (
                <ReferenceLine key={`buy-${i}`} y={z.price_level}
                  stroke="#2e7d32" strokeWidth={1}
                  strokeDasharray={z.in_zone_now ? undefined : "4 3"}
                  label={{ value: `${cur}${z.price_level?.toFixed(0)} (${z.total_target_pct?.toFixed(1)}%)`, position: "insideBottomLeft", fontSize: 9, fill: "#2e7d32" }} />
              ))}

              {/* Sell zones — red solid/dashed */}
              {sellZones.map((z, i) => (
                <ReferenceLine key={`sell-${i}`} y={z.price_level}
                  stroke="#c62828" strokeWidth={1}
                  strokeDasharray="4 3"
                  label={{ value: `${cur}${z.price_level?.toFixed(0)}`, position: "insideTopLeft", fontSize: 9, fill: "#c62828" }} />
              ))}

              {/* QQQ gate */}
              {gatePrice && (
                <ReferenceLine y={gatePrice} stroke="#e65100" strokeWidth={1} strokeDasharray="6 3"
                  label={{ value: `Gate ${cur}${gatePrice?.toFixed(0)}`, position: "right", fontSize: 9, fill: "#e65100" }} />
              )}

              {/* Final sell */}
              {finalSell && (
                <ReferenceLine y={finalSell} stroke="#b71c1c" strokeWidth={1} strokeDasharray="6 3"
                  label={{ value: `Exit ${cur}${finalSell?.toFixed(0)}`, position: "right", fontSize: 9, fill: "#b71c1c" }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Zone summary below chart */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div style={{ fontSize: 11 }}>
              <b style={{ color: "#2e7d32" }}>Buy Zones</b>
              {buyZones.map((z, i) => (
                <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #f0f0f0" }}>
                  {cur}{z.price_level?.toFixed(2)} — target {z.total_target_pct?.toFixed(2)}%
                  {z.in_zone_now && <span style={{ marginLeft: 4, background: "#2e7d32", color: "#fff", borderRadius: 3, padding: "0 3px", fontSize: 9 }}>NOW</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11 }}>
              <b style={{ color: "#c62828" }}>Sell Zones</b>
              {sellZones.map((z, i) => (
                <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #f0f0f0" }}>
                  {cur}{z.price_level?.toFixed(2)} — trim to {z.total_target_pct?.toFixed(2)}%
                  {z.note && <span style={{ color: "#999", marginLeft: 4 }}>({z.note})</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : <p style={{ color: "#999" }}>No OHLCV data available for this range.</p>}
    </div>
  );
}

export default function ChartsTab({ userId }) {
  const [charts, setCharts]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null); // { market, symbol }

  const loadCharts = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try { setCharts(await fetchSavedCharts(userId)); }
    catch (e) { /* silent */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadCharts(); }, [loadCharts]);

  if (selected) {
    return (
      <ChartPage
        userId={userId}
        market={selected.market}
        symbol={selected.symbol}
        onBack={() => { setSelected(null); loadCharts(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>📈 Saved Charts</h4>
        <button style={btnOut} onClick={loadCharts}>🔄 Reload</button>
      </div>

      {loading ? <p>Loading...</p> : charts.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "#999", background: "#fafafa", borderRadius: 6, border: "1px dashed #ddd" }}>
          No saved charts yet. Go to <b>Zones</b> tab, search a stock, and click <b>💾 Save Chart</b>.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {charts.map(c => (
            <div key={c.market_symbol}
              onClick={() => setSelected({ market: c.market, symbol: c.symbol })}
              style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, cursor: "pointer",
                background: "#fff", transition: "box-shadow 0.15s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 3px 8px rgba(0,0,0,0.15)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)"}
            >
              <div style={{ fontSize: 18, fontWeight: "bold" }}>{c.symbol}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{c.market}</div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 6 }}>
                Last refreshed: {c.last_refreshed_date || "—"}
              </div>
              {c.last_refreshed_date === new Date().toISOString().slice(0, 10) && (
                <div style={{ fontSize: 10, color: "#2e7d32", marginTop: 2 }}>✅ Up to date</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
