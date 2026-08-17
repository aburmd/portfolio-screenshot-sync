import React, { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../services/api";

const fmt = (n, prefix = "$") => n != null ? `${prefix}${Number(n).toFixed(2)}` : "—";
const pct = (n) => n != null ? <span style={{ color: n >= 0 ? "green" : "red" }}>{n >= 0 ? "+" : ""}{n.toFixed(2)}%</span> : "—";

export default function Trading({ user }) {
  const [paper, setPaper] = useState(true);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ symbol: "", qty: "", amount: "", by: "qty", side: "buy", order_type: "market", limit_price: "" });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acct, pos, ords] = await Promise.all([
        fetch(`${API_BASE}/trading/account?paper=${paper}`).then(r => r.json()),
        fetch(`${API_BASE}/trading/positions?paper=${paper}`).then(r => r.json()),
        fetch(`${API_BASE}/trading/orders?paper=${paper}&limit=20`).then(r => r.json()),
      ]);
      setAccount(acct.error ? null : acct);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      if (acct.error) setStatus("❌ " + acct.error);
    } catch (e) {
      setStatus("❌ " + e.message);
    }
    setLoading(false);
  }, [paper]);

  useEffect(() => { load(); }, [load]);

  const placeOrder = async () => {
    const byAmount = form.by === "amount";
    if (!form.symbol) return setStatus("Symbol required");
    if (byAmount && !form.amount) return setStatus("Amount required");
    if (!byAmount && !form.qty) return setStatus("Qty required");
    // amount mode only works with market orders
    if (byAmount && form.order_type !== "market") return setStatus("Dollar amount only works with Market orders");
    setStatus("Placing order...");
    const body = {
      symbol: form.symbol.toUpperCase(),
      side: form.side,
      order_type: form.order_type,
      paper,
      ...(byAmount ? { notional: parseFloat(form.amount) } : { qty: parseFloat(form.qty) }),
      ...(form.order_type === "limit" && form.limit_price ? { limit_price: parseFloat(form.limit_price) } : {}),
    };
    const res = await fetch(`${API_BASE}/trading/order`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());

    if (res.error) {
      setStatus("❌ " + res.error);
    } else {
      const detail = byAmount ? `$${form.amount}` : `${res.qty} shares`;
      setStatus(`✅ Order placed: ${res.side} ${detail} of ${res.symbol} @ ${res.type} — status: ${res.status}`);
      setForm(f => ({ ...f, symbol: "", qty: "", amount: "", limit_price: "" }));
      setTimeout(load, 1500);
    }
  };

  const statusColor = { filled: "green", accepted: "#2196f3", pending_new: "#ff9800", canceled: "#999", rejected: "red" };

  return (
    <div style={{ padding: "20px", maxWidth: 1000, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Trading</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={paper} onChange={e => setPaper(e.target.checked)} />
          Paper Trading
        </label>
        {!paper && <span style={{ background: "#ff5722", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>LIVE</span>}
        <button onClick={load} disabled={loading} style={{ marginLeft: "auto", padding: "6px 14px" }}>
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      {/* Account Summary */}
      {account && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            ["Portfolio Value", fmt(account.portfolio_value)],
            ["Cash", fmt(account.cash)],
            ["Buying Power", fmt(account.buying_power)],
            ["Equity", fmt(account.equity)],
          ].map(([label, val]) => (
            <div key={label} style={{ background: "#f5f5f5", borderRadius: 8, padding: "12px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Order Form */}
      <div style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Place Order</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Symbol</div>
            <input value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              placeholder="e.g. AAPL" style={{ width: 90, padding: "6px 8px", textTransform: "uppercase" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Buy by</div>
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
            <div style={{ fontSize: 11, marginBottom: 4 }}>Side</div>
            <select value={form.side} onChange={e => setForm(f => ({ ...f, side: e.target.value }))} style={{ padding: "6px 8px" }}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>Type</div>
            <select value={form.order_type} onChange={e => setForm(f => ({ ...f, order_type: e.target.value }))} style={{ padding: "6px 8px" }}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </div>
          {form.order_type === "limit" && (
            <div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>Limit Price</div>
              <input type="number" value={form.limit_price} onChange={e => setForm(f => ({ ...f, limit_price: e.target.value }))}
                placeholder="0.00" style={{ width: 90, padding: "6px 8px" }} step="0.01" />
            </div>
          )}
          <button onClick={placeOrder}
            style={{ padding: "7px 20px", background: form.side === "buy" ? "#4caf50" : "#f44336", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
            {form.side === "buy" ? "Buy" : "Sell"}
          </button>
        </div>
        {status && <div style={{ marginTop: 10, fontSize: 13 }}>{status}</div>}
      </div>

      {/* Positions */}
      {positions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Open Positions ({positions.length})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {["Symbol", "Qty", "Avg Entry", "Current", "Market Value", "Unrealized P/L", "P/L %"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{p.symbol}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{p.qty}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.avg_entry_price)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.current_price)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmt(p.market_value)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: p.unrealized_pl >= 0 ? "green" : "red" }}>
                      {fmt(p.unrealized_pl)}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{pct(p.unrealized_plpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Orders */}
      {orders.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Orders</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {["Symbol", "Side", "Type", "Qty", "Filled", "Price", "Status", "Submitted"].map(h => (
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
                    <td style={{ padding: "7px 10px" }}>{o.qty}</td>
                    <td style={{ padding: "7px 10px" }}>{o.filled_qty}</td>
                    <td style={{ padding: "7px 10px" }}>{o.filled_avg_price ? fmt(o.filled_avg_price) : (o.limit_price ? fmt(o.limit_price) : "market")}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: statusColor[o.status] || "#333", fontWeight: 500 }}>{o.status}</span>
                    </td>
                    <td style={{ padding: "7px 10px", color: "#888", fontSize: 12 }}>{o.submitted_at?.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!account && !loading && (
        <div style={{ color: "#888", marginTop: 20 }}>
          No account connected. Add your Alpaca API keys to SSM Parameter Store first.
        </div>
      )}
    </div>
  );
}
