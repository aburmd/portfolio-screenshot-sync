import React, { useState, useEffect } from "react";
import "../styles/admin.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

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
      <div className="admin-tabs">
        <button style={tabStyle(tab === "symbols")} onClick={() => setTab("symbols")}>⚠️ Unknown Symbols</button>
        <button style={tabStyle(tab === "shares")} onClick={() => setTab("shares")}>🔗 Share Requests</button>
        <button style={tabStyle(tab === "users")} onClick={() => setTab("users")}>👥 Manage Users</button>
      </div>
      <div className="admin-content">
        {tab === "symbols" && <SymbolsTab />}
        {tab === "shares" && <SharesTab />}
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
  const [symbolSort, setSymbolSort] = useState("name_asc");

  const sortedSymbolMap = [...symbolMap].sort((a, b) => {
    if (symbolSort === "name_asc") return (a.stock_name || "").localeCompare(b.stock_name || "");
    if (symbolSort === "name_desc") return (b.stock_name || "").localeCompare(a.stock_name || "");
    if (symbolSort === "sym_asc") return (a.symbol || "").localeCompare(b.symbol || "");
    if (symbolSort === "sym_desc") return (b.symbol || "").localeCompare(a.symbol || "");
    return 0;
  });

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

  const handleSave = async (stockName, symbolOverride) => {
    const symbol = symbolOverride || edits[stockName];
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

  const handleDeleteMapping = async (stockName) => {
    if (!window.confirm(`Delete mapping for "${stockName}"?`)) return;
    try {
      await fetch(`${API_BASE}/admin/symbol-map/${encodeURIComponent(stockName)}`, { method: "DELETE" });
      setMessage(`Deleted mapping for "${stockName}"`);
      loadData();
    } catch (e) {
      setMessage("Delete failed: " + e.message);
    }
  };

  const uniqueUnknowns = [...new Map(unknowns.map((u) => [u.stock_name, u])).values()];

  return (
    <div>
      {message && <p className="admin-msg">{message}</p>}
      <h4>Unknown Symbols ({uniqueUnknowns.length})</h4>
      {loading ? <p>Loading...</p> : uniqueUnknowns.length === 0 ? (
        <p style={{ color: "#999" }}>All stocks are mapped ✅</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th >Stock Name</th><th >Platform</th><th >Enter Symbol</th><th ></th></tr></thead>
          <tbody>
            {uniqueUnknowns.map((u) => (
              <tr key={u.stock_name} style={{ background: "#fff8e1" }}>
                <td >{u.stock_name}</td>
                <td >{u.platform_name}</td>
                <td >
                  <input type="text" placeholder="e.g. AAPL" value={edits[u.stock_name] || ""}
                    onChange={(e) => setEdits({ ...edits, [u.stock_name]: e.target.value.toUpperCase() })}
                    style={{ padding: 4, width: 80, textTransform: "uppercase" }} />
                </td>
                <td ><button onClick={() => handleSave(u.stock_name)} disabled={!edits[u.stock_name]}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 24 }}>Symbol Map ({symbolMap.length})</h4>
      {symbolMap.length > 0 && (
        <div style={{ marginBottom: 8, fontSize: 12 }}>
          Sort by:
          <button onClick={() => setSymbolSort(s => s === "name_asc" ? "name_desc" : "name_asc")}
            style={{ marginLeft: 6, padding: "2px 8px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: symbolSort.startsWith("name") ? "#e3f2fd" : "#fff" }}>
            Name {symbolSort === "name_asc" ? "↑" : symbolSort === "name_desc" ? "↓" : "↕"}
          </button>
          <button onClick={() => setSymbolSort(s => s === "sym_asc" ? "sym_desc" : "sym_asc")}
            style={{ marginLeft: 4, padding: "2px 8px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: symbolSort.startsWith("sym") ? "#e3f2fd" : "#fff" }}>
            Symbol {symbolSort === "sym_asc" ? "↑" : symbolSort === "sym_desc" ? "↓" : "↕"}
          </button>
        </div>
      )}
      {symbolMap.length === 0 ? <p style={{ color: "#999" }}>No mappings yet.</p> : (
        <table className="admin-table">
          <thead><tr><th >Stock Name</th><th >Symbol</th><th >Edit</th><th ></th></tr></thead>
          <tbody>
            {sortedSymbolMap.map((m) => (
              <tr key={m.stock_name}>
                <td >{m.stock_name}</td>
                <td >
                  {edits[`map_${m.stock_name}`] !== undefined ? (
                    <input type="text" value={edits[`map_${m.stock_name}`]}
                      onChange={(e) => setEdits({ ...edits, [`map_${m.stock_name}`]: e.target.value.toUpperCase() })}
                      style={{ padding: 4, width: 80, textTransform: "uppercase" }} />
                  ) : (
                    <strong>{m.symbol}</strong>
                  )}
                </td>
                <td >
                  {edits[`map_${m.stock_name}`] !== undefined ? (
                    <>
                      <button onClick={async () => { await handleSave(m.stock_name, edits[`map_${m.stock_name}`]); setEdits(prev => ({ ...prev, [`map_${m.stock_name}`]: undefined })); }}
                        style={{ fontSize: 12, marginRight: 4 }}>Save</button>
                      <button onClick={() => setEdits(prev => ({ ...prev, [`map_${m.stock_name}`]: undefined }))}
                        style={{ fontSize: 12 }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setEdits({ ...edits, [`map_${m.stock_name}`]: m.symbol })}
                      style={{ fontSize: 12 }}>✏️ Edit</button>
                  )}
                </td>
                <td >
                  <button onClick={() => handleDeleteMapping(m.stock_name)}
                    style={{ fontSize: 12, color: "#d32f2f", border: "1px solid #d32f2f", background: "#fff", cursor: "pointer", padding: "2px 8px" }}>✖ Del</button>
                </td>
              </tr>
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
      {message && <p className="admin-msg">{message}</p>}
      <h4>Users ({users.length})</h4>
      {loading ? <p>Loading...</p> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th >Email</th>
              <th >Role</th>
              <th >Status</th>
              <th >Created</th>
              <th >Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td >{u.email}</td>
                <td >
                  <span style={{
                    background: u.role === "admin" ? "#e3f2fd" : "#f5f5f5",
                    color: u.role === "admin" ? "#1565c0" : "#666",
                    padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: "bold",
                  }}>{u.role.toUpperCase()}</span>
                </td>
                <td >{u.status}</td>
                <td >{u.created?.split("T")[0]}</td>
                <td >
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

function SharesTab() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadPending = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/pending-shares`);
      setPending(await res.json());
    } catch (e) { setMessage("Failed to load"); }
    setLoading(false);
  };

  useEffect(() => { loadPending(); }, []);

  const handleRespond = async (ownerId, viewerId, action) => {
    const fd = new FormData();
    fd.append("owner_id", ownerId); fd.append("viewer_id", viewerId); fd.append("action", action);
    await fetch(`${API_BASE}/admin/share-respond`, { method: "POST", body: fd });
    setMessage(action === "approve" ? "Approved → sent to viewer for acceptance" : "Rejected");
    loadPending();
  };

  return (
    <div>
      {message && <p className="admin-msg">{message}</p>}
      <h4>Pending Share Requests ({pending.length})</h4>
      {loading ? <p>Loading...</p> : pending.length === 0 ? (
        <p style={{ color: "#999" }}>No pending share requests ✅</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th >Owner</th><th >Viewer</th><th >Requested</th><th >Action</th></tr></thead>
          <tbody>
            {pending.map((p) => (
              <tr key={`${p.owner_id}-${p.viewer_id}`} style={{ background: "#fff8e1" }}>
                <td >{p.owner_email}</td>
                <td >{p.viewer_email}</td>
                <td >{p.created_at?.split("T")[0]}</td>
                <td >
                  <button style={{ padding: "3px 10px", marginRight: 4, background: "#4CAF50", color: "#fff", border: "none", cursor: "pointer", fontSize: 12 }}
                    onClick={() => handleRespond(p.owner_id, p.viewer_id, "approve")}>Approve</button>
                  <button style={{ padding: "3px 10px", border: "1px solid #d32f2f", color: "#d32f2f", cursor: "pointer", fontSize: 12 }}
                    onClick={() => handleRespond(p.owner_id, p.viewer_id, "reject")}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={loadPending} style={{ marginTop: 12 }} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
  );
}

export default AdminPage;
