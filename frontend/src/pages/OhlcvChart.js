import React, { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode, LineStyle } from "lightweight-charts";
import { fetchOhlcv, fetchIntraday, addTrigger, listTriggers, deleteTrigger } from "../services/api";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";

const RANGES = ["6M", "1Y", "2Y", "5Y", "All"];

function filterByRange(rows, range) {
  if (!rows?.length || range === "All") return rows || [];
  const months = { "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60 }[range];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter(r => r.date >= cutoffStr);
}

function CandleChart({ ohlcv, intraday, cur, triggers, onChartClick }) {
  const containerRef    = useRef(null);
  const chartRef        = useRef(null);
  const candleRef       = useRef(null);
  const tooltipRef      = useRef(null);
  const onChartClickRef = useRef(onChartClick);
  const lastPriceRef    = useRef(null);  // tracks price under crosshair
  // keep ref current so click handler never goes stale
  useEffect(() => { onChartClickRef.current = onChartClick; }, [onChartClick]);

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
      timeScale: { borderColor: "#e0e0e0", timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 8 },
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

    // Append today's live daily bar from yfinance if not already in S3 data
    if (intraday?.length) {
      const b = intraday[0];
      const alreadyPresent = ohlcv.some(d => d.date === b.date);
      if (!alreadyPresent) {
        candleSeries.update({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close });
      }
    }

    // Draw trigger price lines
    (triggers || []).forEach(t => {
      const color = t.status === "fired" ? "#9e9e9e" : (t.direction === "above" ? "#e53935" : "#1976d2");
      const style = t.status === "fired" ? LineStyle.Dashed : LineStyle.Solid;
      candleSeries.createPriceLine({
        price:     t.trigger_price,
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title: `${t.direction === "above" ? "▲" : "▼"} ${t.trigger_price.toFixed(2)}${t.repeat ? " ↺" : ""}${t.status === "fired" ? " ✓" : ""}`,
      });
    });

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

    // Track price under crosshair (most reliable way to get price at cursor)
    chart.subscribeCrosshairMove(param => {
      const tooltip = tooltipRef.current;
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        if (tooltip) tooltip.style.display = "none";
        return;
      }
      // Use first entry from seriesData map (candlestick series)
      const data = param.seriesData.get(candleSeries) || [...param.seriesData.values()][0];
      // Store the exact price under cursor via coordinateToPrice
      const hoverPrice = candleSeries.coordinateToPrice(param.point.y);
      if (hoverPrice != null && hoverPrice > 0) lastPriceRef.current = hoverPrice;
      if (!data || data.open == null) { if (tooltip) tooltip.style.display = "none"; return; }
      const { open, high, low, close } = data;
      const up = close >= open;
      if (tooltip) {
        tooltip.innerHTML = [
          `<span style="color:#999;font-size:10px">${typeof param.time === "object" ? `${param.time.year}-${String(param.time.month).padStart(2,"0")}-${String(param.time.day).padStart(2,"0")}` : param.time}</span>`,
          `<span>O <b>${cur}${open?.toFixed(2)}</b></span>`,
          `<span>H <b>${cur}${high?.toFixed(2)}</b></span>`,
          `<span>L <b>${cur}${low?.toFixed(2)}</b></span>`,
          `<span>C <b style="color:${up ? "#2e7d32" : "#c62828"}">${cur}${close?.toFixed(2)}</b></span>`,
        ].join("  ");
        const flipX = param.point.x > containerRef.current.clientWidth - 220;
        tooltip.style.left    = flipX ? `${param.point.x - 220}px` : `${param.point.x + 12}px`;
        tooltip.style.top     = "8px";
        tooltip.style.display = "flex";
      }
    });

    // Click → use last known crosshair price (set by subscribeCrosshairMove above)
    chart.subscribeClick(param => {
      if (!param.point) return;
      // Primary: use lastPriceRef set by crosshair move (exact cursor price)
      // Fallback: coordinateToPrice directly
      let price = lastPriceRef.current;
      if (price == null) price = candleSeries.coordinateToPrice(param.point.y);
      console.log("chart click: price=", price, "point=", param.point);
      if (price != null && price > 0) onChartClickRef.current(parseFloat(price.toFixed(2)));
    });

    // Fallback: plain DOM click on container
    const handleDomClick = () => {
      const price = lastPriceRef.current;
      console.log("DOM click fallback: price=", price);
      if (price != null && price > 0) onChartClickRef.current(parseFloat(price.toFixed(2)));
    };
    containerRef.current.addEventListener("click", handleDomClick);

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; containerRef.current?.removeEventListener("click", handleDomClick); };
  }, [ohlcv, cur, triggers, intraday]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", borderRadius: 4, overflow: "hidden",
        border: "1px solid #e0e0e0", cursor: "crosshair" }} />
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

// ── Trigger creation panel ────────────────────────────────────────────────────

function TriggerPanel({ symbol, market, cur, clickedPrice, isAdmin, onAdded }) {
  const [price,     setPrice]     = useState("");
  const [direction, setDirection] = useState("below");
  const [repeat,    setRepeat]    = useState(false);
  const [broadcast, setBroadcast] = useState("self");
  const [note,      setNote]      = useState("");
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState(null);

  // When user clicks chart, pre-fill price and auto-set direction
  useEffect(() => {
    if (clickedPrice == null) return;
    setPrice(String(clickedPrice));
    setMsg(null);
  }, [clickedPrice]);

  const handleAdd = async () => {
    const p = parseFloat(price);
    if (!p || isNaN(p)) { setMsg({ type: "error", text: "Enter a valid price" }); return; }
    setSaving(true); setMsg(null);
    try {
      const attrs = await fetchUserAttributes();
      const userId = attrs.sub;
      const res = await addTrigger(market, symbol, {
        triggerPrice: p, direction, repeat, note, broadcast,
      });
      if (res.error) { setMsg({ type: "error", text: res.error }); }
      else {
        const broadcastLabel = broadcast === "subscribers" ? " — broadcast to all subscribers" : "";
        setMsg({ type: "ok", text: `Trigger set at ${cur}${p} (${direction})${repeat ? " — repeating" : ""}${broadcastLabel}` });
        setNote("");
        onAdded();
      }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    setSaving(false);
  };

  return (
    <div style={{ background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: 6,
      padding: "12px 16px", marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: "bold", color: "#555", marginBottom: 8 }}>
        🎯 Add Price Trigger — <span style={{ color: "#999", fontWeight: "normal" }}>click chart to set price</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Price */}
        <label style={{ fontSize: 12 }}>Price ({cur})
          <br />
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="e.g. 150.00"
            style={{ padding: "5px 8px", width: 110, fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
          />
        </label>

        {/* Direction */}
        <label style={{ fontSize: 12 }}>Direction
          <br />
          <select value={direction} onChange={e => setDirection(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }}>
            <option value="below">▼ Price drops to / below</option>
            <option value="above">▲ Price rises to / above</option>
          </select>
        </label>

        {/* Note */}
        <label style={{ fontSize: 12 }}>Note (optional)
          <br />
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. support zone"
            style={{ padding: "5px 8px", width: 160, fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
          />
        </label>

        {/* Repeat toggle */}
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          Repeat
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            background: repeat ? "#e3f2fd" : "#fff", border: "1px solid #ccc",
            borderRadius: 4, padding: "5px 10px", fontSize: 13 }}>
            <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} />
            {repeat ? "↺ Every hit" : "Once only"}
          </label>
        </label>

        {/* Broadcast — admin only */}
        {isAdmin && (
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Send alert to
            <select value={broadcast} onChange={e => setBroadcast(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13,
                background: broadcast === "subscribers" ? "#fff8e1" : "#fff" }}>
              <option value="self">👤 Only me</option>
              <option value="subscribers">📢 All subscribers</option>
            </select>
          </label>
        )}

        <button
          onClick={handleAdd}
          disabled={saving || !price}
          style={{ padding: "6px 18px", background: saving ? "#bdbdbd" : "#1565c0", color: "#fff",
            border: "none", borderRadius: 4, cursor: saving ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: "bold", alignSelf: "flex-end" }}>
          {saving ? "Saving…" : "Add Trigger"}
        </button>
      </div>

      {msg && (
        <div style={{ marginTop: 8, fontSize: 12,
          color: msg.type === "ok" ? "#2e7d32" : "#c62828" }}>
          {msg.type === "ok" ? "✅" : "❌"} {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Triggers list ─────────────────────────────────────────────────────────────

function TriggersList({ symbol, market, cur, triggers, onDeleted }) {
  const [deleting, setDeleting] = useState(null);

  if (!triggers?.length) return (
    <div style={{ fontSize: 12, color: "#999", marginTop: 8 }}>No triggers set for {symbol}.</div>
  );

  const handleDelete = async (t) => {
    setDeleting(t.trigger_id);
    try {
      const attrs = await fetchUserAttributes();
      await deleteTrigger(t.trigger_id, attrs.sub);
      onDeleted();
    } catch (_) {}
    setDeleting(null);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: "bold", color: "#555", marginBottom: 6 }}>
        Triggers for {symbol} ({market})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f5f5f5" }}>
            {["Price", "Direction", "Repeat", "Broadcast", "Note", "Status", ""].map(h => (
              <th key={h} style={{ padding: "5px 8px", textAlign: "left", borderBottom: "1px solid #e0e0e0" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {triggers.map(t => (
            <tr key={t.trigger_id} style={{ opacity: t.status === "fired" ? 0.5 : 1 }}>
              <td style={{ padding: "5px 8px", fontWeight: "bold" }}>{cur}{t.trigger_price.toFixed(2)}</td>
              <td style={{ padding: "5px 8px", color: t.direction === "above" ? "#e53935" : "#1976d2" }}>
                {t.direction === "above" ? "▲ above" : "▼ below"}
              </td>
              <td style={{ padding: "5px 8px" }}>{t.repeat ? "↺ repeating" : "once"}</td>
              <td style={{ padding: "5px 8px" }}>
                {t.broadcast === "subscribers"
                  ? <span style={{ background: "#fff8e1", color: "#f57f17", padding: "2px 6px", borderRadius: 10, fontSize: 11 }}>📢 subscribers</span>
                  : <span style={{ color: "#999", fontSize: 11 }}>👤 only me</span>}
              </td>
              <td style={{ padding: "5px 8px", color: "#666" }}>{t.note || "—"}</td>
              <td style={{ padding: "5px 8px" }}>
                <span style={{
                  background: t.status === "fired" ? "#e0e0e0" : "#e8f5e9",
                  color: t.status === "fired" ? "#757575" : "#2e7d32",
                  padding: "2px 7px", borderRadius: 10, fontSize: 11,
                }}>
                  {t.status === "fired" ? "✓ fired" : "● active"}
                </span>
              </td>
              <td style={{ padding: "5px 8px" }}>
                <button
                  onClick={() => handleDelete(t)}
                  disabled={deleting === t.trigger_id}
                  style={{ padding: "2px 8px", fontSize: 11, background: "#fff",
                    border: "1px solid #e57373", color: "#e53935", borderRadius: 4, cursor: "pointer" }}>
                  {deleting === t.trigger_id ? "…" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OhlcvChart() {
  const [symbol,       setSymbol]       = useState("");
  const [market,       setMarket]       = useState("US");
  const [range,        setRange]        = useState("1Y");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [clickedPrice,  setClickedPrice]  = useState(null);
  const [triggers,      setTriggers]      = useState([]);
  const [userId,        setUserId]        = useState(null);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [intradayBars,  setIntradayBars]  = useState([]);
  const [intradayLoad,  setIntradayLoad]  = useState(false);

  // Fetch current user id and role once
  useEffect(() => {
    fetchUserAttributes().then(a => {
      setUserId(a.sub);
      setIsAdmin((a["custom:role"] || "") === "admin");
    }).catch(() => {});
  }, []);

  const loadTriggers = useCallback(async (sym, mkt) => {
    if (!userId || !sym) return;
    try {
      const res = await listTriggers(userId);
      const all = res.triggers || [];
      setTriggers(all.filter(t => t.symbol === sym.toUpperCase() && t.market === mkt.toUpperCase()));
    } catch (_) {}
  }, [userId]);

  const loadIntraday = useCallback(async (sym, mkt) => {
    setIntradayLoad(true);
    try {
      const res = await fetchIntraday(mkt, sym);
      setIntradayBars(res.bar ? [res.bar] : []);
    } catch (_) { setIntradayBars([]); }
    setIntradayLoad(false);
  }, []);

  const handleSearch = async (sym = symbol, mkt = market) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setLoading(true); setError(null); setData(null); setClickedPrice(null); setIntradayBars([]);
    try {
      const result = await fetchOhlcv(mkt, s);
      if (result.error) { setError(result.error); }
      else {
        setData(result);
        await loadTriggers(s, mkt);
        loadIntraday(s, mkt);  // fire-and-forget, shows when ready
      }
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
            border: "none", borderRadius: 4, cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: "bold" }}>
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
          Checking master list… if new symbol, fetching full history from Yahoo Finance (~10s)
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
            {intradayLoad && (
              <span style={{ fontSize: 11, color: "#1976d2" }}>⏳ loading today…</span>
            )}
            {!intradayLoad && intradayBars.length > 0 && (
              <span style={{ fontSize: 11, background: "#e3f2fd", color: "#1565c0", padding: "2px 8px", borderRadius: 4 }}>
                📈 +{intradayBars.length} intraday bars (today)
              </span>
            )}

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

          {/* Clicked price hint */}
          {clickedPrice != null && (
            <div style={{ fontSize: 12, color: "#1565c0", marginBottom: 4 }}>
              📍 Clicked: {cur}{clickedPrice} — price pre-filled below
            </div>
          )}

          {filtered.length > 0
            ? <CandleChart
                ohlcv={filtered}
                intraday={intradayBars}
                cur={cur}
                triggers={triggers}
                onChartClick={setClickedPrice}
              />
            : <p style={{ color: "#999" }}>No data for selected range.</p>
          }

          {/* Trigger creation panel */}
          <TriggerPanel
            symbol={data.symbol}
            market={data.market}
            cur={cur}
            clickedPrice={clickedPrice}
            isAdmin={isAdmin}
            onAdded={() => loadTriggers(data.symbol, data.market)}
          />

          {/* Triggers list */}
          <TriggersList
            symbol={data.symbol}
            market={data.market}
            cur={cur}
            triggers={triggers}
            onDeleted={() => loadTriggers(data.symbol, data.market)}
          />
        </>
      )}

      {!data && !loading && !error && (
        <div style={{ padding: 32, textAlign: "center", color: "#999", background: "#fafafa",
          borderRadius: 6, border: "1px dashed #ddd" }}>
          Enter a symbol and click Search.<br />
          <span style={{ fontSize: 12 }}>Click anywhere on the chart to set a trigger price.</span>
        </div>
      )}
    </div>
  );
}
