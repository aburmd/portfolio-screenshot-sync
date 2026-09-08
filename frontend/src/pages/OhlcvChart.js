import React, { useState, useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } from "lightweight-charts";
import { fetchOhlcv } from "../services/api";

const RANGES = ["6M", "1Y", "2Y", "5Y", "All"];

function filterByRange(rows, range) {
  if (!rows?.length || range === "All") return rows || [];
  const months = { "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60 }[range];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter(r => r.date >= cutoffStr);
}

function CandleChart({ ohlcv, cur }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const tooltipRef   = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !ohlcv?.length) return;
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#2e7d32", downColor: "#c62828",
      borderUpColor: "#2e7d32", borderDownColor: "#c62828",
      wickUpColor: "#2e7d32", wickDownColor: "#c62828",
    });
    candleRef.current = candleSeries;

    candleSeries.setData(ohlcv.map(d => ({
      time: d.date, open: d.open ?? d.close, high: d.high ?? d.close,
      low: d.low ?? d.close, close: d.close,
    })).filter(d => d.close != null));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#90caf9", priceFormat: { type: "volume" }, priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeSeries.setData(ohlcv
      .filter(d => d.volume > 0 && d.close != null)
      .map(d => ({
        time: d.date, value: d.volume,
        color: (d.close >= (d.open ?? d.close)) ? "rgba(46,125,50,0.4)" : "rgba(198,40,40,0.4)",
      }))
    );

    chart.timeScale().fitContent();

    // OHLC tooltip
    chart.subscribeCrosshairMove(param => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tooltip.style.display = "none"; return;
      }
      const data = param.seriesData.get(candleSeries);
      if (!data) { tooltip.style.display = "none"; return; }
      const { open, high, low, close } = data;
      const up = close >= open;
      tooltip.innerHTML = [
        `<span style="color:#999;font-size:10px">${param.time}</span>`,
        `<span>O <b>${cur}${open?.toFixed(2)}</b></span>`,
        `<span>H <b>${cur}${high?.toFixed(2)}</b></span>`,
        `<span>L <b>${cur}${low?.toFixed(2)}</b></span>`,
        `<span>C <b style="color:${up ? "#2e7d32" : "#c62828"}">${cur}${close?.toFixed(2)}</b></span>`,
      ].join("  ");
      const flipX = param.point.x > containerRef.current.clientWidth - 220;
      tooltip.style.left    = flipX ? `${param.point.x - 220}px` : `${param.point.x + 12}px`;
      tooltip.style.top     = "8px";
      tooltip.style.display = "flex";
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [ohlcv, cur]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", borderRadius: 4, overflow: "hidden", border: "1px solid #e0e0e0" }} />
      <div ref={tooltipRef} style={{
        display: "none", position: "absolute", top: 8, left: 0,
        background: "rgba(255,255,255,0.95)", border: "1px solid #e0e0e0",
        borderRadius: 4, padding: "4px 10px", fontSize: 12, gap: 10,
        pointerEvents: "none", whiteSpace: "nowrap", zIndex: 10,
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
      }} />
    </div>
  );
}

export default function OhlcvChart() {
  const [symbol,  setSymbol]  = useState("");
  const [market,  setMarket]  = useState("US");
  const [range,   setRange]   = useState("1Y");
  const [data,    setData]    = useState(null);   // {symbol, market, rows, source}
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const handleSearch = async (sym = symbol, mkt = market) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setLoading(true); setError(null); setData(null);
    try {
      const result = await fetchOhlcv(mkt, s);
      if (result.error) { setError(result.error); }
      else { setData(result); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const cur      = market === "IN" ? "₹" : "$";
  const filtered = filterByRange(data?.rows, range);
  const last     = data?.rows?.length ? data.rows[data.rows.length - 1] : null;

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16,
        background: "#f5f5f5", padding: 12, borderRadius: 6, border: "1px solid #e0e0e0" }}>
        <label style={{ fontSize: 12 }}>Symbol<br />
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="e.g. AAPL, CRDO, INFY"
            style={{ padding: "6px 10px", width: 160, fontSize: 14, borderRadius: 4, border: "1px solid #ccc" }}
          />
        </label>
        <label style={{ fontSize: 12 }}>Market<br />
          <select value={market} onChange={e => setMarket(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc" }}>
            <option value="US">US</option>
            <option value="IN">India (NSE)</option>
          </select>
        </label>
        <button
          onClick={() => handleSearch()}
          disabled={loading || !symbol.trim()}
          style={{ padding: "7px 20px", background: loading ? "#bdbdbd" : "#1976d2", color: "#fff",
            border: "none", borderRadius: 4, cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: "bold" }}>
          {loading ? "Loading..." : "🔍 Search"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#fce4ec", color: "#c62828", padding: "8px 12px", borderRadius: 4, marginBottom: 12 }}>
          ❌ {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: 24, textAlign: "center", color: "#666" }}>
          {data === null ? "Fetching OHLCV data from S3… (first-time fetch may take ~10s)" : "Loading..."}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: "bold" }}>{data.symbol}</span>
            <span style={{ fontSize: 12, color: "#666", background: "#e3f2fd", padding: "2px 8px", borderRadius: 4 }}>{data.market}</span>
            {last && (
              <span style={{ fontSize: 13 }}>
                {cur}{parseFloat(last.close).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            {data.source === "fetched" && (
              <span style={{ fontSize: 11, background: "#e8f5e9", color: "#2e7d32", padding: "2px 8px", borderRadius: 4 }}>
                ✅ Fetched & saved to S3 — added to daily EOD run
              </span>
            )}
            <span style={{ fontSize: 11, color: "#999" }}>{data.rows?.length} daily bars</span>

            {/* Range selector */}
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              {RANGES.map(r => (
                <button key={r} onClick={() => setRange(r)} style={{
                  padding: "4px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                  background: range === r ? "#1976d2" : "#fff",
                  color: range === r ? "#fff" : "#333",
                  border: range === r ? "none" : "1px solid #ccc",
                }}>{r}</button>
              ))}
            </div>
          </div>

          {filtered.length > 0
            ? <CandleChart ohlcv={filtered} cur={cur} />
            : <p style={{ color: "#999" }}>No data for selected range.</p>
          }
        </>
      )}

      {!data && !loading && !error && (
        <div style={{ padding: 32, textAlign: "center", color: "#999", background: "#fafafa",
          borderRadius: 6, border: "1px dashed #ddd" }}>
          Enter a symbol and click Search.<br />
          <span style={{ fontSize: 12 }}>Data is read from S3. If not cached, it will be fetched from Yahoo Finance and saved automatically.</span>
        </div>
      )}
    </div>
  );
}
