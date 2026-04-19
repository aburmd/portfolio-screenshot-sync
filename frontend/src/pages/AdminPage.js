import React, { useState, useEffect } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";
const th = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const td = { padding: "8px 12px", borderBottom: "1px solid #eee" };

function AdminPage() {
  const [tab, setTab] = useState("symbols");

  const tabStyle = (active) => ({
    padding: "6px 16px", cursor: "pointer", border: "1px solid #ddd",
    borderBottom: active ? "none" : "1px solid #ddd", borderRadius: "4px 4px 0 0",
    background: active ? "#fff" : "#f5f5f5", fontWeight: active ? "bold" : "normal",
    marginRight: 4,
  });

  return (
    <div>
      <div style={{ marginBottom: -1 }}>
        <button style={tabStyle(tab === "symbols")} onClick={() => setTab("symbols")}>⚠️ Unknown Symbols</button>
        <button style={tabStyle(tab === "users")} onClick={() => setTab("users")}>👥 Manage Users</button>
      </div>
      <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: "0 4px 4px 4px" }}>
        {tab === "symbols" && <SymbolsTab />}
        {tab === "users" && <UsersTab />}
      </div>
    </div>
  );
}

function SymbolsTab() {
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

  const handleSave = async (stockName) => {
    const symbol = edits[stockName];
    if (!symbol?.trim()) return;
    try {
      const formData = new FormData();
      formData.append("stock_name", stockName);
      formData.append("symbol", symbol.trim());
      const res = await fetch(`${API_BASE}/admin/update-symbol`, { method: "POST", body: formData });
      const data = await res.json();
      setMessage(`Updated "${stockName}" → ${symbol.trim().toUpperCase()} (${data.records_updated} records)`);
      setEdits({ ...edits, [stockName]: "" });
      loadData();
    } catch (e) {
      setMessage("Update failed: " + e.message);
    }
  };

  const uniqueUnknowns = [...new Map(unknowns.map((u) => [u.stock_name, u])).values()];

  return (
    <div>
      {message && <p style={{ color: "#2e7d32", background: "#e8f5e9", padding: 8, borderRadius: 4 }}>{message}</p>}
      <h4>Unknown Symbols ({uniqueUnknowns.length})</h4>
      {loading ? <p>Loading...</p> : uniqueUnknowns.length === 0 ? (
        <p style={{ color: "#999" }}>All stocks are mapped ✅</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Stock Name</th><th style={th}>Platform</th><th style={th}>Enter Symbol</th><th style={th}></th></tr></thead>
          <tbody>
            {uniqueUnknowns.map((u) => (
              <tr key={u.stock_name} style={{ background: "#fff8e1" }}>
                <td style={td}>{u.stock_name}</td>
                <td style={td}>{u.platform_name}</td>
                <td style={td}>
                  <input type="text" placeholder="e.g. AAPL" value={edits[u.stock_name] || ""}
                    onChange={(e) => setEdits({ ...edits, [u.stock_name]: e.target.value.toUpperCase() })}
                    style={{ padding: 4, width: 80, textTransform: "uppercase" }} />
                </td>
                <td style={td}><button onClick={() => handleSave(u.stock_name)} disabled={!edits[u.stock_name]}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 24 }}>Symbol Map ({symbolMap.length})</h4>
      {symbolMap.length === 0 ? <p style={{ color: "#999" }}>No mappings yet.</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Stock Name</th><th style={th}>Symbol</th></tr></thead>
          <tbody>
            {symbolMap.map((m) => (
              <tr key={m.stock_name}><td style={td}>{m.stock_name}</td><td style={td}><strong>{m.symbol}</strong></td></tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={loadData} style={{ marginTop: 12 }} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users`);
      setUsers(await res.json());
    } catch (e) {
      setMessage("Failed to load users: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const toggleRole = async (username, currentRole) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("role", newRole);
      const res = await fetch(`${API_BASE}/admin/set-role`, { method: "POST", body: formData });
      const data = await res.json();
      setMessage(`${data.username} → ${data.role}`);
      loadUsers();
    } catch (e) {
      setMessage("Failed: " + e.message);
    }
  };

  return (
    <div>
      {message && <p style={{ color: "#2e7d32", background: "#e8f5e9", padding: 8, borderRadius: 4 }}>{message}</p>}
      <h4>Users ({users.length})</h4>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Email</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Created</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td style={td}>{u.email}</td>
                <td style={td}>
                  <span style={{
                    background: u.role === "admin" ? "#e3f2fd" : "#f5f5f5",
                    color: u.role === "admin" ? "#1565c0" : "#666",
                    padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: "bold",
                  }}>{u.role.toUpperCase()}</span>
                </td>
                <td style={td}>{u.status}</td>
                <td style={td}>{u.created?.split("T")[0]}</td>
                <td style={td}>
                  <button onClick={() => toggleRole(u.username, u.role)}
                    style={{ fontSize: 12, padding: "4px 10px" }}>
                    {u.role === "admin" ? "Demote to User" : "Promote to Admin"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={loadUsers} style={{ marginTop: 12 }} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  );
}

export default AdminPage;
