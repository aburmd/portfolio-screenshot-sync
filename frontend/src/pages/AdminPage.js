import React, { useState, useEffect } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

function AdminPage() {
  const [unknowns, setUnknowns] = useState([]);
  const [symbolMap, setSymbolMap] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [edits, setEdits] = useState({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/admin/unknown-symbols`),
        fetch(`${API_BASE}/admin/symbol-map`),
      ]);
      setUnknowns(await uRes.json());
      setSymbolMap(await sRes.json());
    } catch (e) {
      setMessage("Failed to load: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSymbolChange = (stockName, value) => {
    setEdits({ ...edits, [stockName]: value.toUpperCase() });
  };

  const handleSave = async (stockName) => {
    const symbol = edits[stockName];
    if (!symbol || !symbol.trim()) return;
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("stock_name", stockName);
      formData.append("symbol", symbol.trim());
      const res = await fetch(`${API_BASE}/admin/update-symbol`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setMessage(`Updated "${stockName}" → ${symbol} (${data.records_updated} records)`);
      setEdits({ ...edits, [stockName]: "" });
      loadData();
    } catch (e) {
      setMessage("Update failed: " + e.message);
    }
  };

  // Deduplicate unknowns by stock_name
  const uniqueUnknowns = [...new Map(unknowns.map((u) => [u.stock_name, u])).values()];

  return (
    <div>
      <h3>⚠️ Unknown Symbols ({uniqueUnknowns.length})</h3>
      {message && <p style={{ color: "#2e7d32", background: "#e8f5e9", padding: 8, borderRadius: 4 }}>{message}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : uniqueUnknowns.length === 0 ? (
        <p style={{ color: "#999" }}>No unknown symbols. All stocks are mapped! ✅</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={th}>Stock Name</th>
              <th style={th}>Platform</th>
              <th style={th}>Qty</th>
              <th style={th}>Avg Price</th>
              <th style={th}>Enter Symbol</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {uniqueUnknowns.map((u) => (
              <tr key={u.stock_name} style={{ background: "#fff8e1" }}>
                <td style={td}>{u.stock_name}</td>
                <td style={td}>{u.platform_name}</td>
                <td style={td}>{u.quantity}</td>
                <td style={td}>${u.avg_buy_price}</td>
                <td style={td}>
                  <input
                    type="text"
                    placeholder="e.g. AAPL"
                    value={edits[u.stock_name] || ""}
                    onChange={(e) => handleSymbolChange(u.stock_name, e.target.value)}
                    style={{ padding: 4, width: 80, textTransform: "uppercase" }}
                  />
                </td>
                <td style={td}>
                  <button onClick={() => handleSave(u.stock_name)} disabled={!edits[u.stock_name]}>
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 30 }}>📋 Symbol Map ({symbolMap.length} entries)</h3>
      {symbolMap.length === 0 ? (
        <p style={{ color: "#999" }}>No mappings yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={th}>Stock Name</th>
              <th style={th}>Symbol</th>
            </tr>
          </thead>
          <tbody>
            {symbolMap.map((m) => (
              <tr key={m.stock_name}>
                <td style={td}>{m.stock_name}</td>
                <td style={td}><strong>{m.symbol}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={loadData} style={{ marginTop: 16 }} disabled={loading}>
        {loading ? "Loading..." : "Refresh"}
      </button>
    </div>
  );
}

const th = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const td = { padding: "8px 12px", borderBottom: "1px solid #eee" };

export default AdminPage;
