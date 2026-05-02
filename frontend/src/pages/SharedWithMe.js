import React, { useState, useEffect, useCallback } from "react";
import PortfolioTable from "../components/PortfolioTable";
import { getSharedWithMe, getPendingViewer, viewerRespond, revokeShare, fetchPortfolio, fetchPrices, fetchPriceChanges } from "../services/api";
import "../styles/shared.css";

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
  const [priceChanges, setPriceChanges] = useState({});
  const [lastClosePrices, setLastClosePrices] = useState({});
  const [showExtendedPct, setShowExtendedPct] = useState(false);

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
      const usdSymbols = [...new Set(data.filter(d => (!d.currency || d.currency === "USD") && d.symbol && d.symbol !== "UNKNOWN").map(d => d.symbol))];
      const inrSymbols = [...new Set(data.filter(d => d.currency === "INR" && d.symbol && d.symbol !== "UNKNOWN").map(d => d.symbol))];
      if (usdSymbols.length > 0 || inrSymbols.length > 0) {
        const screenerPrices = await fetchPrices(usdSymbols, inrSymbols, false);
        setLastClosePrices(screenerPrices);
        setPrices(livePrice ? await fetchPrices(usdSymbols, inrSymbols, true) : screenerPrices);
        setPriceChanges(await fetchPriceChanges(usdSymbols, inrSymbols));
      }
    } catch (e) { setMessage("Failed to load portfolio"); }
    setLoading(false);
  };

  if (viewing) {
    return (
      <div>
        <button onClick={() => setViewing(null)} style={{ marginBottom: 12 }}>← Back to list</button>
        <h3>📊 {viewing.owner_email}'s Portfolio</h3>
        <div className="shared-toggles">
          <button onClick={() => { setLivePrice(!livePrice); }} style={{
            padding: "3px 10px", border: livePrice ? "2px solid #2e7d32" : "1px solid #ccc",
            borderRadius: 3, background: livePrice ? "#e8f5e9" : "#fff",
            cursor: "pointer", fontWeight: livePrice ? "bold" : "normal", fontSize: 12,
          }}>{livePrice ? "🟢 Live" : "⚪ Static"}</button>
          <span style={{ color: "#999", fontSize: 11 }}>{livePrice ? "(real-time prices)" : "(daily close prices)"}</span>
          {livePrice && <button onClick={() => viewPortfolio(viewing)} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>🔄 Refresh</button>}
          <span style={{ marginLeft: 8 }}>|</span>
          <button onClick={() => setShowExtendedPct(!showExtendedPct)} style={{
            padding: "3px 10px", border: showExtendedPct ? "2px solid #1565c0" : "1px solid #ccc",
            borderRadius: 3, background: showExtendedPct ? "#e3f2fd" : "#fff",
            cursor: "pointer", fontWeight: showExtendedPct ? "bold" : "normal", fontSize: 12,
          }}>{showExtendedPct ? "1W 3W 1M 3M ✔" : "1W 3W 1M 3M"}</button>
        </div>
        <PortfolioTable data={portfolio} prices={prices} loading={loading} readOnly
          priceChanges={priceChanges} showExtendedPct={showExtendedPct}
          livePrice={livePrice} lastClosePrices={lastClosePrices} />
        <button onClick={() => handleRevoke(viewing.owner_id)}
          style={{ marginTop: 16, color: "#d32f2f", border: "1px solid #d32f2f", background: "none", padding: "6px 16px", cursor: "pointer" }}>
          Remove this shared dashboard
        </button>
      </div>
    );
  }

  return (
    <div>
      {message && <p className="shared-msg">{message}</p>}

      {pending.length > 0 && (
        <>
          <h4>📩 Incoming Share Requests</h4>
          <table className="shared-table">
            <thead><tr><th>From</th><th>Action</th></tr></thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.owner_id}>
                  <td>{p.owner_email}</td>
                  <td>
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
        <table className="shared-table">
          <thead><tr><th>Owner</th><th>Action</th></tr></thead>
          <tbody>
            {approved.map((s) => (
              <tr key={s.owner_id}>
                <td>{s.owner_email}</td>
                <td>
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
