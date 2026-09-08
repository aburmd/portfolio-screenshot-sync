import React, { useState, useEffect, useCallback, useRef } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
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

function CandleChart({ ohlcv, zones, cur }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const volumeRef    = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !ohlcv?.length) return;

    // destroy previous instance
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 500,
      layout: { background: { color: "#ffffff" }, textColor: "#333" },
      grid:   { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#e0e0e0" },
      timeScale: { borderColor: "#e0e0e0", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor:          "#2e7d32",
      downColor:        "#c62828",
      borderUpColor:    "#2e7d32",
      borderDownColor:  "#c62828",
      wickUpColor:      "#2e7d32",
      wickDownColor:    "#c62828",
    });
    candleRef.current = candleSeries;

    const candleData = ohlcv.map(d => ({
      time:  d.date,
      open:  d.open  ?? d.close,
      high:  d.high  ?? d.close,
      low:   d.low   ?? d.close,
      close: d.close,
    })).filter(d => d.close != null);
    candleSeries.setData(candleData);

    // Volume series (histogram on separate pane)
    const volumeSeries = chart.addHistogramSeries({
      color:       "#90caf9",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    const volData = ohlcv
      .filter(d => d.volume > 0 && d.close != null)
      .map(d => ({
        time:  d.date,
        value: d.volume,
        color: (d.close >= (d.open ?? d.close)) ? "rgba(46,125,50,0.4)" : "rgba(198,40,40,0.4)",
      }));
    volumeSeries.setData(volData);

    // Buy zone lines
    const buyZones  = zones?.buy_zones  || [];
    const sellZones = zones?.sell_zones || [];

    buyZones.forEach(z => {
      const line = candleSeries.createPriceLine({
        price:      z.price_level,
        color:      z.in_zone_now ? "#2e7d32" : "#66bb6a",
        lineWidth:  z.in_zone_now ? 2 : 1,
        lineStyle:  z.in_zone_now ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `B ${cur}${z.price_level?.toFixed(2)} (${z.total_target_pct?.toFixed(1)}%)`,
      });
    });

    sellZones.forEach(z => {
      candleSeries.createPriceLine({
        price:      z.price_level,
        color:      z.note ? "#b71c1c" : "#ef5350",
        lineWidth:  z.note ? 2 : 1,
        lineStyle:  z.note ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: true,
        title: z.note
          ? `S ${cur}${z.price_level?.toFixed(2)} (${z.note})`
          : `S ${cur}${z.price_level?.toFixed(2)} →${z.total_target_pct?.toFixed(1)}%`,
      });
    });

    // Current price line
    if (zones?.current_price) {
      candleSeries.createPriceLine({
        price:     zones.current_price,
        color:     "#1976d2",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `Now ${cur}${zones.current_price?.toFixed(2)}`,
      });
    }

    // QQQ gate
    if (zones?.cagr_summary?.qqq_gate_price) {
      candleSeries.createPriceLine({
        price:     zones.cagr_summary.qqq_gate_price,
        color:     "#e65100",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `QQQ Gate`,
      });
    }

    chart.timeScale().fitContent();

    // Responsive resize
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [ohlcv, zones, cur]);

  return <div ref={containerRef} style={{ width: "100%", borderRadius: 4, overflow: "hidden", border: "1px solid #e0e0e0" }} />;
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
  const cur    = market === "IN" ? "₹" : "$";
  const ohlcv  = filterByRange(chartData?.cached_ohlcv, range);
  const zones  = chartData?.cached_zones;
  const buyZones  = zones?.buy_zones  || [];
  const sellZones = zones?.sell_zones || [];

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
      </div>

      {error && <div style={{ background: "#fce4ec", color: "#c62828", padding: 8, borderRadius: 4, marginBottom: 8 }}>❌ {error}</div>}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, marginBottom: 8 }}>
        <span style={{ color: "#2e7d32" }}>🟢 Buy zones (dashed=pending, solid=in zone)</span>
        <span style={{ color: "#ef5350" }}>🔴 Sell zones (dashed=fib, dotted=fixed)</span>
        <span style={{ color: "#1976d2" }}>━ Current price</span>
        <span style={{ color: "#e65100" }}>┅ QQQ Gate</span>
      </div>

      {loading ? <p>Loading chart...</p> : ohlcv.length > 0 ? (
        <>
          <CandleChart ohlcv={ohlcv} zones={zones} cur={cur} />

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
  const [charts, setCharts]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);

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
                background: "#fff", transition: "box-shadow 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 3px 8px rgba(0,0,0,0.15)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)"}
            >
              <div style={{ fontSize: 18, fontWeight: "bold" }}>{c.symbol}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{c.market}</div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 6 }}>Last refreshed: {c.last_refreshed_date || "—"}</div>
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
