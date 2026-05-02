import React, { useState, useEffect, useCallback } from "react";
import PortfolioTable from "../components/PortfolioTable";
import { getSharedWithMe, getPendingViewer, viewerRespond, revokeShare, fetchPortfolio, fetchPrices } from "../services/api";

const th = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const td = { padding: "6px 8px", borderBottom: "1px solid #eee" };
const btnStyle = { padding: "3px 10px", marginRight: 4, cursor: "pointer", fontSize: 12 };

function SharedWithMe({ user }) {
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [viewing, setViewing] = useState(null); // { owner_id, owner_email }
  const [portfolio, setPortfolio] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [livePrice, setLivePrice] = useState(false);

  const userId = user?.userId || user?.username;

  const loadData = useCallback(async () => {
    if (!userId) return;
    setPending(await getPendingViewer(userId));
    setApproved(await getSharedWithMe(userId));
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRespond = async (ownerId, action) => {
    await viewerRespond(ownerId, userId, action);
    setMessage(action === "approve" ? "Accepted!" : "Rejected");
    loadData();
  };

  const handleRevoke = async (ownerId) => {
    await revokeShare(ownerId, userId);
    setMessage("Removed shared dashboard");
    setViewing(null);
    loadData();
  };

  const viewPortfolio = async (share) => {
    setViewing(share);
    setLoading(true);
    try {
      const data = await fetchPortfolio(share.owner_id);
      setPortfolio(data);
      const symbols = [...new Set(data.map((d) => d.symbol).filter((s) => s && s !== "UNKNOWN"))];
      if (symbols.length > 0) setPrices(await fetchPrices(symbols, [], livePrice));
    } catch (e) { setMessage("Failed to load portfolio"); }
    setLoading(false);
  };

  if (viewing) {
    return (
      <div>
        <button onClick={() => setViewing(null)} style={{ marginBottom: 12 }}>← Back to list</button>
        <h3>📊 {viewing.owner_email}'s Portfolio</h3>
        <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => { setLivePrice(!livePrice); }} style={{
            padding: "3px 10px", border: livePrice ? "2px solid #2e7d32" : "1px solid #ccc",
            borderRadius: 3, background: livePrice ? "#e8f5e9" : "#fff",
            cursor: "pointer", fontWeight: livePrice ? "bold" : "normal", fontSize: 12,
          }}>{livePrice ? "🟢 Live" : "⚪ Static"}</button>
          <span style={{ color: "#999", fontSize: 11 }}>{livePrice ? "(real-time prices)" : "(daily close prices)"}</span>
          {livePrice && <button onClick={() => viewPortfolio(viewing)} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>🔄 Refresh</button>}
        </div>
        <PortfolioTable data={portfolio} prices={prices} loading={loading} readOnly />
        <button onClick={() => handleRevoke(viewing.owner_id)}
          style={{ marginTop: 16, color: "#d32f2f", border: "1px solid #d32f2f", background: "none", padding: "6px 16px", cursor: "pointer" }}>
          Remove this shared dashboard
        </button>
      </div>
    );
  }

  return (
    <div>
      {message && <p style={{ color: "#2e7d32", background: "#e8f5e9", padding: 8, borderRadius: 4 }}>{message}</p>}

      {pending.length > 0 && (
        <>
          <h4>📩 Incoming Share Requests</h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>From</th><th style={th}>Action</th></tr></thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.owner_id}>
                  <td style={td}>{p.owner_email}</td>
                  <td style={td}>
                    <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={() => handleRespond(p.owner_id, "approve")}>Accept</button>
                    <button style={{ ...btnStyle, border: "1px solid #d32f2f", color: "#d32f2f" }} onClick={() => handleRespond(p.owner_id, "reject")}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>📂 Shared Dashboards ({approved.length})</h4>
      {approved.length === 0 ? (
        <p style={{ color: "#999" }}>No shared dashboards yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Owner</th><th style={th}>Action</th></tr></thead>
          <tbody>
            {approved.map((s) => (
              <tr key={s.owner_id}>
                <td style={td}>{s.owner_email}</td>
                <td style={td}>
                  <button style={{ ...btnStyle, border: "1px solid #1976d2", color: "#1976d2" }} onClick={() => viewPortfolio(s)}>View Portfolio</button>
                  <button style={{ ...btnStyle, border: "1px solid #d32f2f", color: "#d32f2f" }} onClick={() => handleRevoke(s.owner_id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={loadData} style={{ marginTop: 12 }}>Refresh</button>
    </div>
  );
}

export default SharedWithMe;
