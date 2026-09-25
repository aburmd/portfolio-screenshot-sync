import React, { useState, useEffect, useCallback } from "react";
import { API_BASE, fetchLots } from "../services/api";
import { fetchAuthSession } from "aws-amplify/auth";

async function authFetch(url, options = {}) {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  } catch (_) {}
  return fetch(url, options);
}

const fmt = (n, prefix = "$") => n != null ? `${prefix}${Number(n).toFixed(2)}` : "—";
const pct = (n) => n != null ? <span style={{ color: n >= 0 ? "green" : "red" }}>{n >= 0 ? "+" : ""}{n.toFixed(2)}%</span> : "—";
const CANCELABLE = ["new", "accepted", "pending_new", "accepted_for_bidding", "held"];
const STATUS_COLOR = { active: "#1976d2", filled: "#2e7d32", cancelled: "#999" };
const STATUS_ICON  = { active: "🔄", filled: "✅", cancelled: "🚫" };

export default function Trading({ user }) {
  const userId = user?.userId || user?.username;
  const [paper, setPaper] = useState(true);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ symbol: "", qty: "", amount: "", by: "qty", side: "buy", order_type: "market", tif: "day", limit_price: "", extended_hours: false });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(null);
  const [editing, setEditing] = useState(null);
  const [posSort, setPosSort] = useState({ key: null, dir: "asc" });
  const [expanded, setExpanded] = useState({});
  const [lots, setLots]         = useState({});
  const [lotsLoading, setLotsLoading] = useState({});
  const [fracQueue, setFracQueue] = useState([]);
  const [fracCanceling, setFracCanceling] = useState(null);

  async function toggleExpand(symbol) {
    if (expanded[symbol]) {
      setExpanded(e => ({ ...e, [symbol]: false }));
      return;
    }
    setExpanded(e => ({ ...e, [symbol]: true }));
    if (lots[symbol]) return; // already loaded
    setLotsLoading(l => ({ ...l, [symbol]: true }));
    try {
      const data = await fetchLots(symbol, paper);
      setLots(l => ({ ...l, [symbol]: Array.isArray(data) ? data : [] }));
    } catch (_) {
      setLots(l => ({ ...l, [symbol]: [] }));
    }
    setLotsLoading(l => ({ ...l, [symbol]: false }));
  }

  function sellLot(symbol, lot) {}


  function sortPositions(rows) {
    if (!posSort.key) return rows;
    return [...rows].sort((a, b) => {
      const av = a[posSort.key] ?? (posSort.dir === "asc" ? Infinity : -Infinity);
      const bv = b[posSort.key] ?? (posSort.dir === "asc" ? Infinity : -Infinity);
      if (av < bv) return posSort.dir === "asc" ? -1 : 1;
      if (av > bv) return posSort.dir === "asc" ?  1 : -1;
      return 0;
    });
  }

  function togglePosSort(key) {
    setPosSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  }

  const switchMode = (toLive) => {
    if (toLive && !window.confirm("⚠️ Switch to LIVE trading?\n\nReal money will be used. Are you sure?")) return;
    setPaper(!toLive);
    setAccount(null); setPositions([]); setOrders([]); setStatus("");
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acct, pos, ords] = await Promise.all([
        authFetch(`${API_BASE}/trading/account?paper=${paper}`).then(r => r.json()),
        authFetch(`${API_BASE}/trading/positions?paper=${paper}`).then(r => r.json()),
        authFetch(`${API_BASE}/trading/orders?paper=${paper}&limit=20`).then(r => r.json()),
      ]);
      setAccount(acct.error ? null : acct);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      if (acct.error) setStatus("❌ " + acct.error);
    } catch (e) { setStatus("❌ " + e.message); }

    try {
      if (userId) {
        const frac = await fetch(`${API_BASE}/trading/fractional-queue?user_id=${userId}`).then(r => r.json());
        setFracQueue(Array.isArray(frac) ? frac : []);
      }
    } catch (e) {}

    setLoading(false);
  }, [paper, userId]);

  useEffect(() => { load(); }, [load]);

  // Pre-fill form when selecting a position to sell
  const sellPosition = (p) => {
    setForm(f => ({ ...f, symbol: p.symbol, side: "sell", by: "qty", qty: p.qty, amount: "" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    setStatus(`Selling ${p.symbol} — adjust qty/amount then click Sell`);
  };

  const placeOrder = async () => {
    const byAmount = form.by === "amount";
    if (!form.symbol) return setStatus("Symbol required");
    if (byAmount && !form.amount) return setStatus("Amount required");
    if (!byAmount && !form.qty) return setStatus("Qty required");
    if (byAmount && form.order_type !== "market") return setStatus("Dollar amount only works with Market orders");
    if (form.extended_hours && form.order_type !== "limit") return setStatus("Extended hours requires a Limit order with a limit price");
    if (form.extended_hours && !form.limit_price) return setStatus("Extended hours requires a limit price");
    setStatus("Placing order...");
    const body = {
      symbol: form.symbol.toUpperCase(), side: form.side,
      order_type: form.order_type, paper, user_id: userId,
      extended_hours: form.extended_hours,
      ...(byAmount ? { notional: parseFloat(form.amount) } : { qty: parseFloat(form.qty) }),
      ...(form.order_type === "limit" && form.limit_price ? { limit_price: parseFloat(form.limit_price), tif: form.tif } : {}),
    };
    const res = await authFetch(`${API_BASE}/trading/order`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());

    if (res.error) {
      let msg = res.error;
      try { const p = JSON.parse(msg); msg = p.message || msg; } catch {}
      setStatus("❌ " + msg);
    } else if (res.id || res.fractional_queued) {
      const detail = byAmount ? `$${form.amount}` : `${form.qty} shares`;
      const fracNote = res.fractional_queued ? ` + ${res.frac_qty?.toFixed(6)} frac shares placed (DAY) & queued daily` : "";
      setStatus(`✅ Order placed: ${form.side} ${detail} of ${form.symbol.toUpperCase()}${fracNote}`);
      setForm(f => ({ ...f, symbol: "", qty: "", amount: "", limit_price: "", side: "buy", extended_hours: false }));
      setTimeout(load, 1500);
    } else {
      setStatus("❌ Unexpected response: " + JSON.stringify(res));
    }
  };

  const cancelFracQueue = async (itemId) => {
    setFracCanceling(itemId);
    const res = await fetch(`${API_BASE}/trading/fractional-queue/${itemId}?user_id=${userId}`, { method: "DELETE" }).then(r => r.json());
    if (res.error) setStatus("❌ Cancel failed: " + res.error);
    else setStatus("✅ Fractional queue item cancelled");
    setFracCanceling(null);
    setTimeout(load, 600);
  };

  const cancelOrder = async (orderId) => {
    setCanceling(orderId);
    const res = await authFetch(`${API_BASE}/trading/order/${orderId}?paper=${paper}`, { method: "DELETE" }).then(r => r.json());
    if (res.error) setStatus("❌ Cancel failed: " + res.error);
    else setStatus("✅ Order cancelled");
    setCanceling(null);
    setTimeout(load, 800);
  };

  const editOrder = async (o) => {
    setEditing(o.id);
    const res = await authFetch(`${API_BASE}/trading/order/${o.id}?paper=${paper}`, { method: "DELETE" }).then(r => r.json());
    if (res.error) { setStatus("❌ Could not cancel for edit: " + res.error); setEditing(null); return; }
    setForm({
      symbol: o.symbol,
      side: o.side,
      by: o.notional ? "amount" : "qty",
      qty: o.qty ? String(o.qty) : "",
      amount: o.notional ? String(o.notional) : "",
      order_type: o.type,
      limit_price: o.limit_price ? String(o.limit_price) : "",
      extended_hours: o.extended_hours || false,
    });
    setEditing(null);
    setStatus(`✏️ Editing ${o.symbol} — order cancelled. Modify values and resubmit.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(load, 800);
  };

  const statusColor = { filled: "green", accepted: "#2196f3", pending_new: "#ff9800", canceled: "#999", rejected: "red", new: "#2196f3" };

  return (
    <div style={{ padding: "20px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Trading</h2>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #ddd", marginLeft: 8 }}>
          <button onClick={() => switchMode(false)}
            style={{ padding: "6px 18px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
              background: paper ? "#e8f5e9" : "#eee", color: paper ? "#2e7d32" : "#999" }}>
            📄 Paper
          </button>
          <button onClick={() => switchMode(true)}
            style={{ padding: "6px 18px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
              background: !paper ? "#ff5722" : "#eee", color: !paper ? "#fff" : "#999" }}>
            ⚡ Live
          </button>
        </div>
        {!paper && <span style={{ background: "#ff5722", color: "#fff", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>REAL MONEY</span>}
        {paper && <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "3px 10px", borderRadius: 4, fontSize: 12 }}>Paper account — no real money</span>}
        <button onClick={load} disabled={loading} style={{ marginLeft: "auto", padding: "6px 14px" }}>
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      {/* Account Summary */}
      {account && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {[["Portfolio Value", fmt(account.portfolio_value)], ["Cash", fmt(account.cash)],
            ["Buying Power", fmt(account.buying_power)], ["Equity", fmt(account.equity)]].map(([label, val]) => (
            <div key={label} style={{ background: "#f5f5f5", borderRadius: 8, padding: "12px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Order Form */}
      <div style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{status?.startsWith('✏️') ? '✏️ Modify Order' : 'Place Order'}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Symbol</div>
            <input value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              placeholder="e.g. AAPL" style={{ width: 90, padding: "6px 8px", textTransform: "uppercase" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Side</div>
            <select value={form.side} onChange={e => setForm(f => ({ ...f, side: e.target.value }))} style={{ padding: "6px 8px" }}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>{form.side === "sell" ? "Sell by" : "Buy by"}</div>
            <select value={form.by} onChange={e => setForm(f => ({ ...f, by: e.target.value, order_type: e.target.value === "amount" ? "market" : f.order_type }))} style={{ padding: "6px 8px" }}>
              <option value="qty">Qty (shares)</option>
              <option value="amount">Amount ($)</option>
            </select>
          </div>
          {form.by === "qty" ? (
            <div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>Shares</div>
              <input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                placeholder="1" style={{ width: 80, padding: "6px 8px" }} min="0.000001" step="any" />
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>Amount ($)</div>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="100" style={{ width: 90, padding: "6px 8px" }} min="1" step="1" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Type</div>
            <select value={form.order_type}
              onChange={e => setForm(f => ({ ...f, order_type: e.target.value, extended_hours: e.target.value !== "limit" ? false : f.extended_hours, tif: e.target.value !== "limit" ? "day" : f.tif }))}
              style={{ padding: "6px 8px" }}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </div>
          {form.order_type === "limit" && (
            <div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>TIF</div>
              <select value={form.tif}
                onChange={e => setForm(f => ({ ...f, tif: e.target.value, extended_hours: e.target.value === "gtc" ? false : f.extended_hours }))}
                style={{ padding: "6px 8px" }}>
                <option value="day">DAY</option>
                <option value="gtc">GTC</option>
              </select>
            </div>
          )}
          {form.order_type === "limit" && (
            <div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>Limit Price</div>
              <input type="number" value={form.limit_price} onChange={e => setForm(f => ({ ...f, limit_price: e.target.value }))}
                placeholder="0.00" style={{ width: 90, padding: "6px 8px" }} step="0.01" />
            </div>
          )}
          {form.order_type === "limit" && (
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                padding: "6px 10px", borderRadius: 4, border: `1px solid ${form.extended_hours ? "#ff9800" : "#ddd"}`,
                background: form.extended_hours ? "#fff8e1" : "#fff", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={form.extended_hours}
                  onChange={e => setForm(f => ({ ...f, extended_hours: e.target.checked }))}
                  style={{ cursor: "pointer" }} />
                🌙 Extended Hours
              </label>
            </div>
          )}
          <button onClick={placeOrder}
            style={{ padding: "7px 20px", background: form.side === "buy" ? "#4caf50" : "#f44336",
              color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600,
              outline: !paper ? "3px solid #ff5722" : "none" }}>
            {form.side === "buy" ? "Buy" : "Sell"}{!paper ? " (LIVE)" : ""}
          </button>
        </div>
        {status && <div style={{ marginTop: 10, fontSize: 13 }}>{status}</div>}
      </div>

      {/* Positions */}
      {positions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Open Positions ({positions.length})</div>
            <button
              onClick={() => {
                const url = `${API_BASE}/trading/positions/export-csv?paper=${paper}`;
                const a = document.createElement("a");
                a.href = url; a.click();
              }}
              style={{ padding: "4px 12px", background: "#1565c0", color: "#fff", border: "none",
                borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              ⬇ Export Fidelity CSV
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {[
                    { key: "symbol",        label: "Symbol" },
                    { key: "qty",           label: "Qty" },
                    { key: "avg_entry_price",label: "Avg Entry" },
                    { key: "current_price", label: "Current" },
                    { key: "lastday_price", label: "Prev Close" },
                    { key: "change_today",  label: "Today %" },
                    { key: "market_value",  label: "Mkt Value" },
                    { key: "unrealized_pl", label: "Unreal P/L" },
                    { key: "unrealized_plpc",label: "P/L %" },
                    { key: null,            label: "" },
                  ].map(({ key, label }) => (
                    <th key={label} onClick={() => key && togglePosSort(key)}
                      style={{ padding: "8px 10px", textAlign: label === "Symbol" || !label ? "left" : "right",
                        fontWeight: 600, whiteSpace: "nowrap", cursor: key ? "pointer" : "default",
                        userSelect: "none",
                        color: posSort.key === key ? "#1976d2" : "#333" }}>
                      {label}{posSort.key === key ? (posSort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortPositions(positions).map(p => {
                  const todayPl = p.change_today != null && p.market_value != null
                    ? p.market_value * (p.change_today / 100) / (1 + p.change_today / 100)
                    : null;
                  const isExpanded = expanded[p.symbol];
                  const symLots = lots[p.symbol] || [];
                  const isLoadingLots = lotsLoading[p.symbol];
                  return (
                  <React.Fragment key={p.symbol}>
                    <tr style={{ borderBottom: isExpanded ? "none" : "1px solid #eee" }}>
                      <td style={{ padding: "7px 10px", fontWeight: 600 }}>
                        <button onClick={() => toggleExpand(p.symbol)} style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 12, marginRight: 4, color: "#1976d2", padding: 0,
                        }}>{isExpanded ? "▼" : "▶"}</button>
                        {p.symbol}
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{p.qty}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.avg_entry_price)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.current_price)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", color: "#888" }}>{fmt(p.lastday_price)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>
                        {p.change_today != null
                          ? <span style={{ color: p.change_today >= 0 ? "green" : "red", fontWeight: 600 }}>
                              {p.change_today >= 0 ? "+" : ""}{p.change_today.toFixed(2)}%
                              {todayPl != null && <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.8 }}>({todayPl >= 0 ? "+" : ""}{fmt(todayPl)})</span>}
                            </span>
                          : "—"}
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.market_value)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", color: p.unrealized_pl >= 0 ? "green" : "red" }}>{fmt(p.unrealized_pl)}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{pct(p.unrealized_plpc)}</td>
                      <td style={{ padding: "7px 10px" }}>
                        <button onClick={() => sellPosition(p)}
                          style={{ padding: "4px 12px", background: "#f44336", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Sell All
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} style={{ padding: 0, background: "#fafafa", borderBottom: "1px solid #eee" }}>
                          {isLoadingLots
                            ? <div style={{ padding: "10px 24px", fontSize: 12, color: "#888" }}>Loading lots…</div>
                            : symLots.length === 0
                              ? <div style={{ padding: "10px 24px", fontSize: 12, color: "#888" }}>No filled buy orders found.</div>
                              : <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ background: "#f0f4ff" }}>
                                      {["Date", "Side", "Qty", "Fill Price", "Cost Basis", "Cur Value", "Unreal P/L", "P/L %", "Held", "Tax Status"].map(h => (
                                        <th key={h} style={{ padding: "5px 10px", textAlign: h === "Date" || h === "Side" || h === "Tax Status" ? "left" : "right",
                                          fontWeight: 600, color: "#555", borderBottom: "1px solid #e0e0e0" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {symLots.map((lot, i) => (
                                      <tr key={lot.order_id} style={{ background: i % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                                        <td style={{ padding: "5px 10px" }}>{lot.submitted_at}</td>
                                        <td style={{ padding: "5px 10px", color: lot.side === "buy" ? "green" : "red", fontWeight: 600 }}>{lot.side?.toUpperCase()}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{lot.qty}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt(lot.fill_price)}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt(lot.cost_basis)}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{lot.cur_value != null ? fmt(lot.cur_value) : "—"}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right", color: lot.unrealized_pl >= 0 ? "green" : "red" }}>
                                          {lot.unrealized_pl != null ? fmt(lot.unrealized_pl) : "—"}
                                        </td>
                                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{pct(lot.unrealized_plpc)}</td>
                                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#666" }}>
                                          {lot.held_days != null ? `${lot.held_days}d` : "—"}
                                        </td>
                                        <td style={{ padding: "5px 10px" }}>
                                          {lot.is_long_term
                                            ? <span style={{ color: "#2e7d32", fontWeight: 600 }}>🟢 Long-term</span>
                                            : lot.days_to_lt <= 30
                                              ? <span style={{ color: "#e65100", fontWeight: 600 }}>🟡 {lot.days_to_lt}d to LT</span>
                                              : <span style={{ color: "#c62828" }}>🔴 Short-term</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                          }
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fractional Queue */}
      {/* Fractional Queue */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          ⏳ Daily Fractional Queue ({fracQueue.filter(i => i.status === "active").length} active)
        </div>
        {fracQueue.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13 }}>No fractional orders queued.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {["Symbol", "Side", "Qty", "Limit Price", "Account", "Status", "Last Placed", "Last Order ID", "Created", ""].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fracQueue.map(item => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #eee", opacity: item.status !== "active" ? 0.55 : 1 }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{item.symbol}</td>
                    <td style={{ padding: "7px 10px", color: item.side === "buy" ? "green" : "red", fontWeight: 600 }}>{item.side.toUpperCase()}</td>
                    <td style={{ padding: "7px 10px" }}>{Number(item.qty).toFixed(6)}</td>
                    <td style={{ padding: "7px 10px" }}>{fmt(item.limit_price)}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 3,
                        background: item.paper === "True" ? "#e8f5e9" : "#fff3e0",
                        color: item.paper === "True" ? "#2e7d32" : "#e65100", fontWeight: 600 }}>
                        {item.paper === "True" ? "📄 Paper" : "⚡ Live"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: STATUS_COLOR[item.status] || "#333", fontWeight: 600 }}>
                        {STATUS_ICON[item.status]} {item.status}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", color: "#555" }}>{item.last_order_date || "—"}</td>
                    <td style={{ padding: "7px 10px", color: "#888", fontSize: 11, fontFamily: "monospace" }}>
                      {item.last_order_id ? item.last_order_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#888", fontSize: 11 }}>{item.created_at?.slice(0, 10)}</td>
                    <td style={{ padding: "7px 10px" }}>
                      {item.status === "active" && (
                        <button onClick={() => cancelFracQueue(item.id)} disabled={fracCanceling === item.id}
                          style={{ padding: "4px 10px", background: "#fff", color: "#f44336",
                            border: "1px solid #f44336", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          {fracCanceling === item.id ? "…" : "❌ Stop"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Orders */}
      {orders.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Orders</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {["Symbol", "Side", "Type", "TIF", "Qty / Amount", "Filled", "Price", "Status", "Submitted", ""].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{o.symbol}</td>
                    <td style={{ padding: "7px 10px", color: o.side === "buy" ? "green" : "red", fontWeight: 600 }}>{o.side.toUpperCase()}</td>
                    <td style={{ padding: "7px 10px" }}>{o.type}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11 }}>
                      <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 3,
                        background: o.extended_hours ? "#fff8e1" : "#f0f0f0",
                        color: o.extended_hours ? "#e65100" : "#555",
                        border: `1px solid ${o.extended_hours ? "#ff9800" : "#ddd"}`,
                        whiteSpace: "nowrap" }}>
                        {o.extended_hours ? "\uD83C\uDF19 Ext" : ""}{o.time_in_force ? (o.extended_hours ? " \u00B7 " : "") + o.time_in_force.toUpperCase() : ""}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px" }}>{o.notional ? `$${o.notional}` : (o.qty || "—")}</td>
                    <td style={{ padding: "7px 10px" }}>{o.filled_qty > 0 ? o.filled_qty : "—"}</td>
                    <td style={{ padding: "7px 10px" }}>{o.filled_avg_price ? fmt(o.filled_avg_price) : (o.limit_price ? fmt(o.limit_price) : "market")}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: statusColor[o.status] || "#333", fontWeight: 500 }}>{o.status}</span>
                    </td>
                    <td style={{ padding: "7px 10px", color: "#888", fontSize: 12 }}>{o.submitted_at?.slice(0, 16).replace("T", " ")}</td>
                    <td style={{ padding: "7px 10px", display: "flex", gap: 6 }}>
                      {CANCELABLE.includes(o.status) && (
                        <button onClick={() => editOrder(o)} disabled={editing === o.id}
                          style={{ padding: "4px 10px", background: "#fff", color: "#1976d2", border: "1px solid #1976d2", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          {editing === o.id ? "..." : "Edit"}
                        </button>
                      )}
                      {CANCELABLE.includes(o.status) && (
                        <button onClick={() => cancelOrder(o.id)} disabled={canceling === o.id}
                          style={{ padding: "4px 10px", background: "#fff", color: "#f44336", border: "1px solid #f44336", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          {canceling === o.id ? "..." : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!account && !loading && (
        <div style={{ color: "#888", marginTop: 20 }}>No account connected. Add your Alpaca API keys to SSM Parameter Store first.</div>
      )}
    </div>
  );
}
