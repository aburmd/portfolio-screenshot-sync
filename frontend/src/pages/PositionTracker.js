import React, { useState, useEffect, useCallback } from "react";
import {
  freezePortfolio, fetchSnapshots, fetchDiff, confirmSells,
  addCashFlow, fetchCashFlows, deleteCashFlow, fetchPositions, fetchXirr,
  importFidelityCsv,
  fetchChartData, addBuyLot, fetchBuyLots, deleteBuyLot, triggerBackfill,
  fetchExchangeRate,
} from "../services/api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const btn = { padding: "6px 14px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc", background: "#fff", fontSize: 13 };
const btnPrimary = { ...btn, background: "#1976d2", color: "#fff", border: "none" };
const btnDanger = { ...btn, color: "#d32f2f", border: "1px solid #d32f2f" };
const card = { border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafafa" };
const subTab = (active) => ({ padding: "6px 16px", cursor: "pointer", border: "none", borderBottom: active ? "2px solid #1976d2" : "2px solid transparent", background: "none", fontWeight: active ? "bold" : "normal", fontSize: 13 });

const clr = (v) => (v > 0 ? "#2e7d32" : v < 0 ? "#c62828" : "#333");
const fmt = (v) => v != null ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

// Currency conversion helper
function convertValue(value, fromCurrency, toCurrency, exchangeRate) {
  if (!value || !exchangeRate || toCurrency === "default" || fromCurrency === toCurrency) return value;
  if (fromCurrency === "INR" && toCurrency === "USD") return value / exchangeRate;
  if (fromCurrency === "USD" && toCurrency === "INR") return value * exchangeRate;
  return value;
}
function getCurSymbol(displayCurrency, nativeCurrency) {
  if (displayCurrency === "INR" || (displayCurrency === "default" && nativeCurrency === "INR")) return "₹";
  return "$";
}

// Platform display name helpers (localStorage)
const PLATFORM_NAMES_KEY = "portfolio_platform_names";
function getPlatformNames() {
  try { return JSON.parse(localStorage.getItem(PLATFORM_NAMES_KEY) || "{}"); } catch { return {}; }
}
function setPlatformDisplayName(platform, name) {
  const names = getPlatformNames();
  names[platform] = name;
  localStorage.setItem(PLATFORM_NAMES_KEY, JSON.stringify(names));
}
function getDisplayName(platform) {
  const names = getPlatformNames();
  return names[platform] || platform;
}

export default function PositionTracker({ user }) {
  const userId = user?.username || user?.userId;
  const [tab, setTab] = useState("freeze");
  const [platforms, setPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [, forceUpdate] = useState(0);
  const [displayCurrency, setDisplayCurrency] = useState("default");
  const [exchangeRate, setExchangeRate] = useState(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8000"}/portfolio/${userId}`);
      const data = await res.json();
      const plats = [...new Set(data.map(d => d.platform_name).filter(Boolean))].sort();
      setPlatforms(plats);
      const rate = await fetchExchangeRate("USD", "INR");
      if (rate) setExchangeRate(rate);
    })();
  }, [userId]);

  // Force USD when All Platforms selected
  useEffect(() => {
    if (selectedPlatform === "all") setDisplayCurrency("USD");
    else setDisplayCurrency("default");
  }, [selectedPlatform]);

  const handleSaveName = () => {
    if (selectedPlatform !== "all" && nameInput.trim()) {
      setPlatformDisplayName(selectedPlatform, nameInput.trim());
      setEditingName(false);
      forceUpdate(n => n + 1);
    }
  };

  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>📈 Position Tracker</h3>

      {/* Platform selector */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: "bold" }}>Platform:</label>
        <select value={selectedPlatform} onChange={e => { setSelectedPlatform(e.target.value); setEditingName(false); }}
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }}>
          <option value="all">All Platforms</option>
          {platforms.map(p => <option key={p} value={p}>{getDisplayName(p)}</option>)}
        </select>
        {selectedPlatform !== "all" && !editingName && (
          <>
            <span style={{ fontSize: 12, color: "#666" }}>({selectedPlatform})</span>
            <button onClick={() => { setNameInput(getDisplayName(selectedPlatform)); setEditingName(true); }}
              style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>✏️ Rename</button>
          </>
        )}
        {editingName && (
          <>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)}
              placeholder="Display name" style={{ padding: 3, width: 150, fontSize: 12 }} />
            <button onClick={handleSaveName} style={{ fontSize: 11, padding: "2px 8px" }}>Save</button>
            <button onClick={() => setEditingName(false)} style={{ fontSize: 11, padding: "2px 8px" }}>Cancel</button>
          </>
        )}
      </div>

      {/* Currency toggle */}
      {exchangeRate && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, fontSize: 12 }}>
          <span style={{ fontWeight: "bold" }}>Currency:</span>
          {["default", "USD", "INR"].map(c => (
            <button key={c} onClick={() => { if (selectedPlatform !== "all" || c !== "default") setDisplayCurrency(c); }}
              style={{
                padding: "3px 10px", border: displayCurrency === c ? "2px solid #1976d2" : "1px solid #ccc",
                borderRadius: 3, background: displayCurrency === c ? "#e3f2fd" : "#fff",
                cursor: selectedPlatform === "all" && c === "default" ? "not-allowed" : "pointer",
                fontWeight: displayCurrency === c ? "bold" : "normal",
                opacity: selectedPlatform === "all" && c === "default" ? 0.4 : 1,
              }}>{c === "default" ? "Default" : c}</button>
          ))}
          <span style={{ color: "#999", marginLeft: 4 }}>1 USD = ₹{exchangeRate?.toFixed(2)}</span>
        </div>
      )}

      <nav style={{ borderBottom: "1px solid #eee", marginBottom: 16 }}>
        <button style={subTab(tab === "freeze")} onClick={() => setTab("freeze")}>Freeze & Diff</button>
        <button style={subTab(tab === "cashflows")} onClick={() => setTab("cashflows")}>Cash Flows</button>
        <button style={subTab(tab === "positions")} onClick={() => setTab("positions")}>Positions</button>
        <button style={subTab(tab === "xirr")} onClick={() => setTab("xirr")}>XIRR</button>
        <button style={subTab(tab === "performance")} onClick={() => setTab("performance")}>Performance</button>
      </nav>
      {tab === "freeze" && <FreezeSection userId={userId} platform={selectedPlatform} getDisplayName={getDisplayName} />}
      {tab === "cashflows" && <CashFlowSection userId={userId} platform={selectedPlatform} getDisplayName={getDisplayName} displayCurrency={displayCurrency} exchangeRate={exchangeRate} />}
      {tab === "positions" && <PositionsSection userId={userId} platform={selectedPlatform} displayCurrency={displayCurrency} exchangeRate={exchangeRate} />}
      {tab === "xirr" && <XirrSection userId={userId} platform={selectedPlatform} getDisplayName={getDisplayName} displayCurrency={displayCurrency} exchangeRate={exchangeRate} />}
      {tab === "performance" && <PerformanceSection userId={userId} platform={selectedPlatform} displayCurrency={displayCurrency} exchangeRate={exchangeRate} />}
    </div>
  );
}

// ==================== FREEZE & DIFF ====================
function FreezeSection({ userId, platform, getDisplayName }) {
  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [soldPrices, setSoldPrices] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [initialDate, setInitialDate] = useState(new Date().toISOString().slice(0, 10));
  const [hasSnapshots, setHasSnapshots] = useState(false);

  const loadSnapshots = useCallback(async () => {
    const data = await fetchSnapshots(userId);
    const filtered = platform === "all" ? data : data.filter(s => s.platform === platform);
    setSnapshots(filtered);
    setHasSnapshots(filtered.length > 0);
  }, [userId, platform]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const handleFreeze = async () => {
    setLoading(true);
    try {
      const result = await freezePortfolio(userId, hasSnapshots ? null : initialDate, platform !== "all" ? platform : null);
      const filtered = platform === "all" ? (result.diffs || []) : (result.diffs || []).filter(d => d.platform === platform);
      setDiffs(filtered);
      setSoldPrices({});
      loadSnapshots();
    } catch (e) { alert("Freeze failed: " + e.message); }
    setLoading(false);
  };

  const handleViewDiff = async () => {
    const result = await fetchDiff(userId, platform !== "all" ? platform : null);
    const filtered = platform === "all" ? (result.diffs || []) : (result.diffs || []).filter(d => d.platform === platform);
    setDiffs(filtered);
    setSoldPrices({});
  };

  const handleConfirmSells = async (platform, sells) => {
    setConfirming(true);
    try {
      const payload = {
        platform,
        sells: sells.map((s) => ({
          symbol: s.symbol, stock_name: s.stock_name,
          quantity: s.type === "REMOVED" ? s.prev_qty : s.sold_qty,
          avg_buy_price: s.prev_avg,
          avg_sold_price: parseFloat(soldPrices[`${platform}_${s.symbol}`] || 0),
          currency: s.currency,
        })),
      };
      await confirmSells(userId, payload);
      alert("Sells recorded!");
      setDiffs(null);
    } catch (e) { alert("Failed: " + e.message); }
    setConfirming(false);
  };

  const typeColor = { ADDED: "#e8f5e9", REMOVED: "#ffebee", DECREASED: "#fff8e1", INCREASED: "#e3f2fd", UNCHANGED: "#f5f5f5" };
  const typeIcon = { ADDED: "🟢", REMOVED: "🔴", DECREASED: "🟡", INCREASED: "🔵", UNCHANGED: "⚪" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
        {!hasSnapshots && (
          <label style={{ fontSize: 12 }}>Initial Investment Date<br />
            <input type="date" value={initialDate} onChange={(e) => setInitialDate(e.target.value)} style={{ padding: 4 }} />
          </label>
        )}
        <button style={btnPrimary} onClick={handleFreeze} disabled={loading}>
          {loading ? "Freezing..." : "🔒 Freeze Portfolio"}
        </button>
        <button style={btn} onClick={handleViewDiff}>View Current Diff</button>
      </div>

      {diffs && diffs.map((diff) => {
        const needsSell = diff.changes.filter((c) => c.needs_sold_price);
        return (
          <div key={diff.platform} style={card}>
            <h4 style={{ margin: "0 0 8px" }}>{diff.platform}</h4>
            <p style={{ fontSize: 12, color: "#666", margin: "0 0 8px" }}>
              Snapshot: {diff.snapshot_date || "just now"} | Previous: {diff.previous_snapshot_date || "none (first freeze)"}
              {diff.auto_deposit != null && <span style={{ color: "#1976d2", marginLeft: 8 }}>💰 Auto-deposit: {fmt(diff.auto_deposit)}</span>}
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ padding: 6, textAlign: "left" }}>Type</th>
                  <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
                  <th style={{ padding: 6, textAlign: "left" }}>Name</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Prev Qty</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Curr Qty</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Avg Buy</th>
                  {needsSell.length > 0 && <th style={{ padding: 6, textAlign: "right" }}>Sold Price</th>}
                </tr>
              </thead>
              <tbody>
                {diff.changes.map((c) => (
                  <tr key={c.symbol} style={{ background: typeColor[c.type] || "#fff" }}>
                    <td style={{ padding: 6 }}>{typeIcon[c.type]} {c.type}</td>
                    <td style={{ padding: 6, fontWeight: "bold" }}>{c.symbol}</td>
                    <td style={{ padding: 6 }}>{c.stock_name}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{c.prev_qty != null ? c.prev_qty : c.qty ?? "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{c.curr_qty != null ? c.curr_qty : c.qty ?? "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{fmt(c.prev_avg || c.curr_avg || c.avg)}</td>
                    {needsSell.length > 0 && (
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {c.needs_sold_price ? (
                          <input type="number" step="any" placeholder="sold price"
                            value={soldPrices[`${diff.platform}_${c.symbol}`] || ""}
                            onChange={(e) => setSoldPrices({ ...soldPrices, [`${diff.platform}_${c.symbol}`]: e.target.value })}
                            style={{ width: 90, padding: 3, textAlign: "right" }} />
                        ) : ""}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {needsSell.length > 0 && (
              <button style={{ ...btnPrimary, marginTop: 8 }} disabled={confirming}
                onClick={() => handleConfirmSells(diff.platform, needsSell)}>
                {confirming ? "Saving..." : `Confirm ${needsSell.length} Sell(s)`}
              </button>
            )}
          </div>
        );
      })}

      {snapshots.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Snapshot History</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f5f5f5" }}>
              <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
              <th style={{ padding: 6, textAlign: "left" }}>Date</th>
              <th style={{ padding: 6, textAlign: "right" }}>Stocks</th>
              <th style={{ padding: 6, textAlign: "right" }}>Total Invested</th>
            </tr></thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.platform_ts}>
                  <td style={{ padding: 6 }}>{s.platform}</td>
                  <td style={{ padding: 6 }}>{s.frozen_date?.slice(0, 19)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{s.stock_count}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(s.total_invested)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==================== CASH FLOWS ====================
function CashFlowSection({ userId, platform: selectedPlatform, getDisplayName, displayCurrency, exchangeRate }) {
  const [flows, setFlows] = useState([]);
  const [platform, setPlatform] = useState("");
  const [cfType, setCfType] = useState("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const load = useCallback(async () => { setFlows(await fetchCashFlows(userId)); }, [userId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedPlatform !== "all") setPlatform(selectedPlatform); }, [selectedPlatform]);

  const filtered = selectedPlatform === "all" ? flows : flows.filter(f => f.platform === selectedPlatform);
  const isFidelity = selectedPlatform && selectedPlatform.startsWith("Fid-");

  const handleAdd = async () => {
    if (!platform || !amount) return;
    await addCashFlow(userId, { platform, type: cfType, amount: parseFloat(amount), currency, date });
    setAmount("");
    load();
  };

  const handleDelete = async (sk) => {
    if (window.confirm("Delete this cash flow?")) { await deleteCashFlow(userId, sk); load(); }
  };

  const handleImport = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importFidelityCsv(userId, Array.from(files));
      setImportResult(result);
      load();
    } catch (err) {
      setImportResult({ error: err.message });
    }
    setImporting(false);
    e.target.value = "";
  };

  const sourceIcon = (source) => {
    if (!source || source === "manual") return "✏️";
    if (source.includes("csv")) return "📄";
    if (source.includes("statement")) return "📊";
    return "✏️";
  };

  const sourceLabel = (source, sub) => {
    const icon = sourceIcon(source);
    const label = sub ? sub.replace(/_/g, " ").toLowerCase() : (source || "manual");
    return `${icon} ${label}`;
  };

  // Projected summary: total deposits - total withdrawals = net invested
  const totalDep = filtered.filter(f => f.type === "DEPOSIT").reduce((s, f) => s + f.amount, 0);
  const totalWd = filtered.filter(f => f.type === "WITHDRAW").reduce((s, f) => s + f.amount, 0);
  const netInvested = totalDep - totalWd;

  return (
    <div>
      {/* Projected Summary */}
      {filtered.length > 0 && (
        <div style={{ ...card, background: "#f0f7ff", border: "1px solid #90caf9", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💰 Cash Flow Summary</div>
          <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
            <span style={{ color: "#2e7d32" }}>⬇ Deposits: {fmt(totalDep)}</span>
            <span style={{ color: "#c62828" }}>⬆ Withdrawals: {fmt(totalWd)}</span>
            <span style={{ fontWeight: 600 }}>Net Invested: {fmt(netInvested)}</span>
            <span style={{ color: "#666" }}>({filtered.length} transactions)</span>
          </div>
        </div>
      )}

      <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Platform<br />
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. prostocks" style={{ padding: 4, width: 120 }} />
        </label>
        <label style={{ fontSize: 12 }}>Type<br />
          <select value={cfType} onChange={(e) => setCfType(e.target.value)} style={{ padding: 4 }}>
            <option value="DEPOSIT">Deposit</option><option value="WITHDRAW">Withdraw</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Amount<br />
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ padding: 4, width: 100 }} />
        </label>
        <label style={{ fontSize: 12 }}>Currency<br />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: 4 }}>
            <option value="USD">USD</option><option value="INR">INR</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Date<br />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 4 }} />
        </label>
        <button style={btnPrimary} onClick={handleAdd}>+ Add</button>
        {(isFidelity || selectedPlatform === "all") && (
          <label style={{ ...btnPrimary, background: "#1565c0", cursor: "pointer", display: "inline-block" }}>
            {importing ? "Importing..." : "📄 Import Fidelity CSV"}
            <input type="file" multiple accept=".csv" onChange={handleImport} style={{ display: "none" }} disabled={importing} />
          </label>
        )}
      </div>

      {importResult && (
        <div style={{ ...card, background: importResult.error ? "#fce4ec" : "#e8f5e9", fontSize: 13 }}>
          {importResult.error ? `❌ ${importResult.error}` : (
            <>
              ✅ Imported {importResult.imported} new transactions from {importResult.files_processed} files
              {importResult.accounts && importResult.accounts.map(a => (
                <div key={a.platform} style={{ marginLeft: 12 }}>
                  {getDisplayName(a.platform)}: {a.new_transactions} new (${a.new_deposits.toLocaleString()} deposits, ${a.new_withdrawals.toLocaleString()} withdrawals)
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f5f5f5" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
            <th style={{ padding: 6, textAlign: "left" }}>Type</th>
            <th style={{ padding: 6, textAlign: "right" }}>Amount</th>
            <th style={{ padding: 6, textAlign: "left" }}>Currency</th>
            <th style={{ padding: 6, textAlign: "left" }}>Date</th>
            <th style={{ padding: 6, textAlign: "left" }}>Source</th>
            <th style={{ padding: 6 }}></th>
          </tr></thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.platform_ts_type}>
                <td style={{ padding: 6 }}>{getDisplayName(f.platform)}</td>
                <td style={{ padding: 6, color: f.type === "DEPOSIT" ? "#2e7d32" : "#c62828" }}>{f.type === "DEPOSIT" ? "⬇ Deposit" : "⬆ Withdraw"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(f.amount)}</td>
                <td style={{ padding: 6 }}>{f.currency}</td>
                <td style={{ padding: 6 }}>{f.date}</td>
                <td style={{ padding: 6, fontSize: 11, color: "#666" }}>{sourceLabel(f.source, f.sub_type)}</td>
                <td style={{ padding: 6 }}><button style={btnDanger} onClick={() => handleDelete(f.platform_ts_type)}>Del</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {filtered.length === 0 && <p style={{ color: "#999" }}>No cash flows recorded{selectedPlatform !== "all" ? " for this platform" : ""}.</p>}
    </div>
  );
}

// ==================== POSITIONS ====================
function PositionsSection({ userId, platform: selectedPlatform, displayCurrency, exchangeRate }) {
  const [data, setData] = useState({ open: [], closed: [], summary: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const p = selectedPlatform !== "all" ? selectedPlatform : null;
      setData(await fetchPositions(userId, p));
      setLoading(false);
    })();
  }, [userId, selectedPlatform]);

  if (loading) return <p>Loading positions (fetching live prices)...</p>;

  const cv = (val, currency) => convertValue(val, currency || "USD", displayCurrency === "default" ? (currency || "USD") : displayCurrency, exchangeRate);
  const curSym = getCurSymbol(displayCurrency, selectedPlatform === "prostocks" ? "INR" : "USD");

  const openFiltered = selectedPlatform === "all" ? data.open : data.open.filter(p => p.platform_name === selectedPlatform);
  const closedFiltered = selectedPlatform === "all" ? data.closed : data.closed.filter(p => p.platform === selectedPlatform);

  const converted = openFiltered.map(p => {
    const inv = cv(p.invested, p.currency);
    const curVal = cv(p.cur_value, p.currency);
    return { ...p, invested_cv: inv, cur_value_cv: curVal, pnl_cv: curVal - inv,
      avg_cv: cv(p.avg_buy_price, p.currency), cur_price_cv: cv(p.cur_price, p.currency) };
  });
  const s = {
    total_invested: converted.reduce((a, p) => a + (p.invested_cv || 0), 0),
    total_current: converted.reduce((a, p) => a + (p.cur_value_cv || 0), 0),
    total_pnl: converted.reduce((a, p) => a + (p.pnl_cv || 0), 0),
  };
  s.total_pnl_pct = s.total_invested > 0 ? (s.total_pnl / s.total_invested * 100) : 0;

  return (
    <div>
      <h4>Open Positions ({openFiltered.length})</h4>
      {openFiltered.length > 0 ? (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
            <thead><tr style={{ background: "#e8f5e9" }}>
              <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
              <th style={{ padding: 6, textAlign: "left" }}>Name</th>
              <th style={{ padding: 6, textAlign: "right" }}>Qty</th>
              <th style={{ padding: 6, textAlign: "right" }}>Avg Buy</th>
              <th style={{ padding: 6, textAlign: "right" }}>Cur Price</th>
              <th style={{ padding: 6, textAlign: "right" }}>Invested</th>
              <th style={{ padding: 6, textAlign: "right" }}>Cur Value</th>
              <th style={{ padding: 6, textAlign: "right" }}>P/L</th>
              <th style={{ padding: 6, textAlign: "right" }}>P/L %</th>
              {selectedPlatform === "all" && <th style={{ padding: 6, textAlign: "left" }}>Platform</th>}
            </tr></thead>
            <tbody>
            {openFiltered.map((p, idx) => {
              const c = converted[idx];
              const pnlPct = c.invested_cv > 0 ? (c.pnl_cv / c.invested_cv * 100) : 0;
              return (
                <tr key={p.stock_name}>
                  <td style={{ padding: 6, fontWeight: "bold" }}>{p.symbol}</td>
                  <td style={{ padding: 6 }}>{p.stock_name}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{p.quantity}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(c.avg_cv)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(c.cur_price_cv)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(c.invested_cv)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(c.cur_value_cv)}</td>
                  <td style={{ padding: 6, textAlign: "right", color: clr(c.pnl_cv), fontWeight: "bold" }}>{curSym}{fmt(c.pnl_cv)}</td>
                  <td style={{ padding: 6, textAlign: "right", color: clr(pnlPct) }}>{pnlPct.toFixed(2)}%</td>
                  {selectedPlatform === "all" && <td style={{ padding: 6 }}>{p.platform_name}</td>}
                </tr>
              );
            })}
              <tr style={{ background: "#e8f5e9", fontWeight: "bold" }}>
                <td colSpan={5} style={{ padding: 6 }}>TOTAL</td>
                <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(s.total_invested)}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{curSym}{fmt(s.total_current)}</td>
                <td style={{ padding: 6, textAlign: "right", color: clr(s.total_pnl) }}>{curSym}{fmt(s.total_pnl)}</td>
                <td style={{ padding: 6, textAlign: "right", color: clr(s.total_pnl_pct) }}>{(s.total_pnl_pct || 0).toFixed(2)}%</td>
                {selectedPlatform === "all" && <td></td>}
              </tr>
            </tbody>
          </table>
        </>
      ) : <p style={{ color: "#999" }}>No open positions.</p>}

      <h4>Closed Positions ({closedFiltered.length})</h4>
      {closedFiltered.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#ffebee" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "right" }}>Qty</th>
            <th style={{ padding: 6, textAlign: "right" }}>Buy Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Sold Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Realized P/L</th>
            <th style={{ padding: 6, textAlign: "left" }}>Date</th>
            <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
          </tr></thead>
          <tbody>
            {closedFiltered.map((p, i) => (
              <tr key={i}>
                <td style={{ padding: 6, fontWeight: "bold" }}>{p.symbol}</td>
                <td style={{ padding: 6 }}>{p.stock_name}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{p.quantity}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.avg_buy_price)}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.avg_sold_price)}</td>
                <td style={{ padding: 6, textAlign: "right", color: clr(p.realized_pnl), fontWeight: "bold" }}>{fmt(p.realized_pnl)}</td>
                <td style={{ padding: 6 }}>{p.date}</td>
                <td style={{ padding: 6 }}>{p.platform}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ color: "#999" }}>No closed positions yet.</p>}
    </div>
  );
}

// ==================== XIRR ====================
function XirrSection({ userId, platform: selectedPlatform, getDisplayName, displayCurrency, exchangeRate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const p = selectedPlatform !== "all" ? selectedPlatform : null;
      setData(await fetchXirr(userId, p));
      setLoading(false);
    })();
  }, [userId, selectedPlatform]);

  if (loading) return <p>Calculating XIRR (fetching live prices)...</p>;
  if (!data) return <p>Failed to load XIRR.</p>;

  const filteredPlatforms = selectedPlatform === "all" ? data.platforms : data.platforms.filter(p => p.platform === selectedPlatform);

  const fmtC = (v, cur) => {
    const sym = cur === "INR" ? "₹" : "$";
    return v != null ? `${sym}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {filteredPlatforms.map((p) => {
          const cur = p.currency || "USD";
          const isINR = cur === "INR";
          return (
          <div key={p.platform} style={{ ...card, minWidth: 200, flex: 1 }}>
            <h4 style={{ margin: "0 0 8px" }}>{getDisplayName(p.platform)}</h4>
            <div style={{ fontSize: 28, fontWeight: "bold", color: clr(p.xirr) }}>{p.xirr_pct}</div>
            {p.total_pnl !== undefined && (
              <div style={{ fontSize: 16, fontWeight: "bold", color: clr(p.total_pnl), marginTop: 4 }}>
                P/L: {p.total_pnl >= 0 ? "+" : "-"}{fmtC(p.total_pnl, cur)}
                {isINR && p.total_pnl_usd !== undefined && (
                  <span style={{ fontSize: 12, color: "#888", fontWeight: "normal" }}> ({p.total_pnl_usd >= 0 ? "+" : "-"}${fmt(Math.abs(p.total_pnl_usd))})</span>
                )}
              </div>
            )}
            {(p.realized_pnl !== undefined || p.unrealized_pnl !== undefined) && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {p.unrealized_pnl !== undefined && <span style={{ color: clr(p.unrealized_pnl) }}>Unrealized: {p.unrealized_pnl >= 0 ? "+" : "-"}{fmtC(p.unrealized_pnl, cur)}</span>}
                {p.realized_pnl !== undefined && p.realized_pnl !== 0 && <span style={{ color: clr(p.realized_pnl), marginLeft: 8 }}>Realized: {p.realized_pnl >= 0 ? "+" : "-"}{fmtC(p.realized_pnl, cur)}</span>}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              Deposited: {fmtC(p.total_deposited, cur)}{isINR && p.total_deposited_usd ? ` ($${fmt(p.total_deposited_usd)})` : ""}<br />
              Withdrawn: {fmtC(p.total_withdrawn, cur)}{isINR && p.total_withdrawn_usd ? ` ($${fmt(p.total_withdrawn_usd)})` : ""}<br />
              Current Value: {fmtC(p.current_value, cur)}{isINR && p.current_value_usd ? ` ($${fmt(p.current_value_usd)})` : ""}
            </div>
          </div>
          );
        })}
      </div>

      <div style={{ ...card, background: "#e3f2fd" }}>
        <h4 style={{ margin: "0 0 8px" }}>Overall (USD)</h4>
        <div style={{ fontSize: 32, fontWeight: "bold", color: clr(data.overall.xirr) }}>{data.overall.xirr_pct}</div>
        {data.overall.total_pnl !== undefined && (
          <div style={{ fontSize: 18, fontWeight: "bold", color: clr(data.overall.total_pnl), marginTop: 4 }}>
            Total P/L: {data.overall.total_pnl >= 0 ? "+" : "-"}${fmt(Math.abs(data.overall.total_pnl))}
          </div>
        )}
        {(data.overall.realized_pnl !== undefined || data.overall.unrealized_pnl !== undefined) && (
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {data.overall.unrealized_pnl !== undefined && <span style={{ color: clr(data.overall.unrealized_pnl) }}>Unrealized: {data.overall.unrealized_pnl >= 0 ? "+" : "-"}${fmt(Math.abs(data.overall.unrealized_pnl))}</span>}
            {data.overall.realized_pnl !== undefined && data.overall.realized_pnl !== 0 && <span style={{ color: clr(data.overall.realized_pnl), marginLeft: 12 }}>Realized: {data.overall.realized_pnl >= 0 ? "+" : "-"}${fmt(Math.abs(data.overall.realized_pnl))}</span>}
          </div>
        )}
        <div style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
          Total Deposited: ${fmt(data.overall.total_deposited)} | Withdrawn: ${fmt(data.overall.total_withdrawn)} | Current Value: ${fmt(data.overall.current_value)}
        </div>
        {data.exchange_rate && <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>1 USD = ₹{data.exchange_rate.toFixed(2)}</div>}
      </div>

      {data.platforms.length === 0 && (
        <p style={{ color: "#999" }}>No cash flows recorded. Add deposits/withdrawals in the Cash Flows tab to calculate XIRR.</p>
      )}
    </div>
  );
}

// ==================== PERFORMANCE CHART ====================
const PERIODS = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "10Y", "Custom"];
const periodBtn = (active) => ({
  padding: "4px 12px", cursor: "pointer", borderRadius: 4, fontSize: 12,
  border: active ? "none" : "1px solid #ccc",
  background: active ? "#1976d2" : "#fff",
  color: active ? "#fff" : "#333",
});

function PerformanceSection({ userId, platform: selectedPlatform, displayCurrency, exchangeRate }) {
  const [period, setPeriod] = useState("1Y");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lotsOpen, setLotsOpen] = useState(true);
  const [lots, setLots] = useState([]);
  const [lotForm, setLotForm] = useState({ symbol: "", stock_name: "", quantity: "", buy_price: "", buy_date: new Date().toISOString().slice(0, 10), currency: "USD", platform: "" });
  const [backfilling, setBackfilling] = useState(false);

  const chartPlatform = selectedPlatform || "all";

  useEffect(() => {
    if (chartPlatform !== "all") setLotForm(f => ({ ...f, platform: chartPlatform }));
  }, [chartPlatform]);

  const loadChart = useCallback(async () => {
    setLoading(true);
    const data = await fetchChartData(userId, period,
      period === "custom" ? customStart : null,
      period === "custom" ? customEnd : null, chartPlatform);
    setChartData(data);
    setLoading(false);
  }, [userId, period, customStart, customEnd, chartPlatform]);

  const loadLots = useCallback(async () => {
    const allLots = await fetchBuyLots(userId);
    if (chartPlatform === "all") {
      setLots(allLots);
    } else {
      setLots(allLots.filter(l => (l.platform || "") === chartPlatform));
    }
  }, [userId, chartPlatform]);

  useEffect(() => { loadChart(); }, [loadChart]);
  useEffect(() => { loadLots(); }, [loadLots]);

  const handleAddLot = async () => {
    if (!lotForm.symbol || !lotForm.quantity || !lotForm.buy_price) return;
    await addBuyLot(userId, {
      ...lotForm,
      quantity: parseFloat(lotForm.quantity),
      buy_price: parseFloat(lotForm.buy_price),
    });
    setLotForm({ ...lotForm, symbol: "", stock_name: "", quantity: "", buy_price: "" });
    loadLots();
    loadChart();
  };

  const handleDeleteLot = async (sk) => {
    if (window.confirm("Delete this buy lot?")) {
      await deleteBuyLot(userId, sk);
      loadLots();
    }
  };

  const handleBackfillAll = async () => {
    setBackfilling(true);
    const result = await triggerBackfill(userId);
    alert(`Backfill complete: ${result.stocks} stocks, ${result.records_written} records`);
    setBackfilling(false);
    loadChart();
  };

  const s = chartData?.summary || {};
  const isPositive = s.period_gain >= 0;
  const nativeCur = chartData?.currency || "USD";
  const targetCur = displayCurrency === "default" ? nativeCur : displayCurrency;
  const cur = targetCur === "INR" ? "₹" : "$";
  const cv = (v) => {
    if (v == null) return v;
    return convertValue(v, nativeCur, targetCur, exchangeRate);
  };  const cfDates = new Set((chartData?.cash_flows || []).map(cf => cf.date));
  const sellDates = new Set((chartData?.sell_events || []).map(se => se.date));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const cf = (chartData?.cash_flows || []).filter(c => c.date === label);
    const se = (chartData?.sell_events || []).filter(c => c.date === label);
    return (
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, padding: 10, fontSize: 12 }}>
        <div style={{ fontWeight: "bold", marginBottom: 4 }}>{label}</div>
        <div>Total: {cur}{fmt(cv(payload[0].value))}</div>
        {payload[0].payload.stock_value != null && <div style={{ color: "#666" }}>Stocks: {cur}{fmt(cv(payload[0].payload.stock_value))}</div>}
        {payload[0].payload.cash > 0 && <div style={{ color: "#1976d2" }}>Cash: {cur}{fmt(cv(payload[0].payload.cash))}</div>}
        {cf.map((c, i) => (
          <div key={i} style={{ color: c.type === "DEPOSIT" ? "#2e7d32" : "#c62828", marginTop: 2 }}>
            {c.type === "DEPOSIT" ? "⬇" : "⬆"} {c.type}: {cur}{fmt(c.amount)}
          </div>
        ))}
        {se.map((e, i) => (
          <div key={i} style={{ color: "#6a1b9a", marginTop: 2 }}>
            💎 Sold {e.symbol} ({e.qty}) — P/L: {cur}{fmt(e.realized_pnl)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      {/* Timeframe selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {PERIODS.map(p => (
          <button key={p} style={periodBtn(period === p.toLowerCase() || period === p)}
            onClick={() => setPeriod(p === "Custom" ? "custom" : p)}>
            {p}
          </button>
        ))}
        {period === "custom" && (
          <>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: 3, fontSize: 12 }} />
            <span style={{ fontSize: 12 }}>to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: 3, fontSize: 12 }} />
            <button style={btnPrimary} onClick={loadChart}>Go</button>
          </>
        )}
      </div>

      {/* Summary card */}
      {chartData && chartData.data_points.length > 0 && (
        <div style={{ ...card, display: "flex", gap: 20, flexWrap: "wrap", background: isPositive ? "#e8f5e9" : "#ffebee" }}>
          <div><span style={{ fontSize: 12, color: "#666" }}>Start Value</span><br /><span style={{ fontSize: 18, fontWeight: "bold" }}>{cur}{fmt(cv(s.start_value))}</span></div>
          <div><span style={{ fontSize: 12, color: "#666" }}>End Value</span><br /><span style={{ fontSize: 18, fontWeight: "bold" }}>{cur}{fmt(cv(s.end_value))}</span></div>
          <div><span style={{ fontSize: 12, color: "#666" }}>Period Gain</span><br />
            <span style={{ fontSize: 18, fontWeight: "bold", color: clr(s.period_gain) }}>
              {s.period_gain >= 0 ? "+" : ""}{cur}{fmt(cv(s.period_gain))} ({s.period_gain_pct >= 0 ? "+" : ""}{s.period_gain_pct}%)
            </span>
          </div>
          <div><span style={{ fontSize: 12, color: "#666" }}>Stock Invested</span><br /><span style={{ fontSize: 18, fontWeight: "bold" }}>{cur}{fmt(cv(s.end_stock_value))}</span></div>
          <div><span style={{ fontSize: 12, color: "#666" }}>Balance Cash</span><br /><span style={{ fontSize: 18, fontWeight: "bold", color: "#1976d2" }}>{cur}{fmt(cv(s.end_cash))}</span></div>
          <div><span style={{ fontSize: 12, color: "#666" }}>Period</span><br /><span style={{ fontSize: 13 }}>{chartData.start_date} — {chartData.end_date}</span></div>
        </div>
      )}
      {chartData && chartData.data_points.length > 0 && s.net_invested > 0 && (
        <div style={{ ...card, display: "flex", gap: 20, flexWrap: "wrap", background: "#f5f5f5", padding: 12 }}>
          <div><span style={{ fontSize: 11, color: "#666" }}>Net Deposited</span><br /><span style={{ fontSize: 15, fontWeight: "bold" }}>{cur}{fmt(cv(s.net_invested))}</span></div>
          <div><span style={{ fontSize: 11, color: "#666" }}>Unrealized P/L</span><br /><span style={{ fontSize: 15, fontWeight: "bold", color: clr(s.unrealized_pnl) }}>{s.unrealized_pnl >= 0 ? "+" : ""}{cur}{fmt(cv(s.unrealized_pnl))}</span></div>
          <div><span style={{ fontSize: 11, color: "#666" }}>Realized P/L</span><br /><span style={{ fontSize: 15, fontWeight: "bold", color: clr(s.realized_pnl) }}>{s.realized_pnl >= 0 ? "+" : ""}{cur}{fmt(cv(s.realized_pnl))}</span></div>
          <div><span style={{ fontSize: 11, color: "#666" }}>Total P/L</span><br />
            <span style={{ fontSize: 15, fontWeight: "bold", color: clr(s.total_pnl) }}>
              {s.total_pnl >= 0 ? "+" : ""}{cur}{fmt(cv(s.total_pnl))} ({s.total_pnl_pct >= 0 ? "+" : ""}{s.total_pnl_pct}%)
            </span>
          </div>
        </div>
      )}

      {/* Chart */}
      {loading ? <p>Loading chart data...</p> : chartData && chartData.data_points.length > 0 ? (
        <div style={{ width: "100%", height: 350, marginBottom: 16 }}>
          <ResponsiveContainer>
            <AreaChart data={chartData.data_points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? "#2e7d32" : "#c62828"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isPositive ? "#2e7d32" : "#c62828"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => {
                const parts = d.split("-");
                const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                return chartData.data_points.length > 200
                  ? `${months[parseInt(parts[1])-1]} '${parts[0].slice(2)}`
                  : `${months[parseInt(parts[1])-1]} ${parseInt(parts[2])}`;
              }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${cur}${(cv(v)/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" stroke={isPositive ? "#2e7d32" : "#c62828"}
                fill="url(#colorVal)" strokeWidth={2} dot={false} />
              {/* Cash flow reference lines */}
              {(chartData.cash_flows || []).map((cf, i) => (
                <ReferenceLine key={`cf-${i}`} x={cf.date} stroke={cf.type === "DEPOSIT" ? "#2e7d32" : "#c62828"}
                  strokeDasharray="4 4" strokeWidth={1.5} />
              ))}
              {/* Sell event reference lines */}
              {(chartData.sell_events || []).map((se, i) => (
                <ReferenceLine key={`se-${i}`} x={se.date} stroke="#6a1b9a"
                  strokeDasharray="2 2" strokeWidth={1.5} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <p style={{ color: "#999" }}>No chart data. Add buy lots and run backfill to populate.</p>}

      {/* Buy Lots Management */}
      <div style={{ marginTop: 8 }}>
        <button style={btn} onClick={() => setLotsOpen(!lotsOpen)}>
          {lotsOpen ? "▼" : "▶"} Manage Buy Lots ({lots.length})
        </button>
        <button style={{ ...btn, marginLeft: 8 }} onClick={handleBackfillAll} disabled={backfilling}>
          {backfilling ? "Backfilling..." : "🔄 Backfill All"}
        </button>
      </div>

      {lotsOpen && (
        <div style={{ marginTop: 12 }}>
          {/* Add lot form */}
          <div style={{ ...card, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 11 }}>Symbol<br />
              <input value={lotForm.symbol} onChange={e => setLotForm({ ...lotForm, symbol: e.target.value })}
                placeholder="AAPL" style={{ padding: 3, width: 80 }} />
            </label>
            <label style={{ fontSize: 11 }}>Name<br />
              <input value={lotForm.stock_name} onChange={e => setLotForm({ ...lotForm, stock_name: e.target.value })}
                placeholder="Apple Inc" style={{ padding: 3, width: 120 }} />
            </label>
            <label style={{ fontSize: 11 }}>Qty<br />
              <input type="number" value={lotForm.quantity} onChange={e => setLotForm({ ...lotForm, quantity: e.target.value })}
                style={{ padding: 3, width: 70 }} />
            </label>
            <label style={{ fontSize: 11 }}>Buy Price<br />
              <input type="number" value={lotForm.buy_price} onChange={e => setLotForm({ ...lotForm, buy_price: e.target.value })}
                style={{ padding: 3, width: 80 }} />
            </label>
            <label style={{ fontSize: 11 }}>Buy Date<br />
              <input type="date" value={lotForm.buy_date} onChange={e => setLotForm({ ...lotForm, buy_date: e.target.value })}
                style={{ padding: 3 }} />
            </label>
            <label style={{ fontSize: 11 }}>Currency<br />
              <select value={lotForm.currency} onChange={e => setLotForm({ ...lotForm, currency: e.target.value })} style={{ padding: 3 }}>
                <option value="USD">USD</option><option value="INR">INR</option>
              </select>
            </label>
            <label style={{ fontSize: 11 }}>Platform<br />
              <input value={lotForm.platform} onChange={e => setLotForm({ ...lotForm, platform: e.target.value })}
                placeholder="webull" style={{ padding: 3, width: 90 }} />
            </label>
            <button style={btnPrimary} onClick={handleAddLot}>+ Add Lot</button>
          </div>

          {/* Lots table */}
          {lots.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
              <thead><tr style={{ background: "#f5f5f5" }}>
                <th style={{ padding: 5, textAlign: "left" }}>Symbol</th>
                <th style={{ padding: 5, textAlign: "left" }}>Name</th>
                <th style={{ padding: 5, textAlign: "right" }}>Qty</th>
                <th style={{ padding: 5, textAlign: "right" }}>Buy Price</th>
                <th style={{ padding: 5, textAlign: "left" }}>Buy Date</th>
                <th style={{ padding: 5, textAlign: "left" }}>Currency</th>
                <th style={{ padding: 5, textAlign: "left" }}>Platform</th>
                <th style={{ padding: 5, textAlign: "left" }}>Source</th>
                <th style={{ padding: 5 }}></th>
              </tr></thead>
              <tbody>
                {lots.map(l => (
                  <tr key={l.symbol_ts} style={{ background: l.is_default ? "#fff8e1" : l.is_remainder ? "#e3f2fd" : "#fff" }}>
                    <td style={{ padding: 5, fontWeight: "bold" }}>{l.symbol}</td>
                    <td style={{ padding: 5 }}>{l.stock_name}</td>
                    <td style={{ padding: 5, textAlign: "right" }}>{l.quantity}</td>
                    <td style={{ padding: 5, textAlign: "right" }}>{fmt(l.buy_price)}</td>
                    <td style={{ padding: 5 }}>{l.buy_date}</td>
                    <td style={{ padding: 5 }}>{l.currency}</td>
                    <td style={{ padding: 5 }}>{l.platform}</td>
                    <td style={{ padding: 5, fontSize: 11, color: l.is_default ? "#f57c00" : l.is_remainder ? "#1565c0" : "#388e3c" }}>
                      {l.is_default ? "⚠ Auto (edit date)" : l.is_remainder ? "📊 Remainder" : "✅ Manual"}
                    </td>
                    <td style={{ padding: 5 }}>
                      {!l.is_default && !l.is_remainder && <button style={btnDanger} onClick={() => handleDeleteLot(l.symbol_ts)}>Del</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: "#999", fontSize: 12, marginTop: 8 }}>No stocks in portfolio.</p>}
        </div>
      )}
    </div>
  );
}
