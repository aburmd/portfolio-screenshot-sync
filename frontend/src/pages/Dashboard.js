import React, { useState, useEffect, useCallback } from "react";
import UploadArea from "../components/UploadArea";
import PortfolioTable from "../components/PortfolioTable";
import { fetchPortfolio, uploadScreenshots, downloadCsv, deleteStock, updateStock, addStock, fetchPrices, requestShare, getMyShares, revokeShare } from "../services/api";

function Dashboard({ user }) {
  const [portfolio, setPortfolio] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [myShares, setMyShares] = useState([]);

  const userId = user?.userId || user?.username;

  const loadPortfolio = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await fetchPortfolio(userId);
      setPortfolio(data);
      const symbols = [...new Set(data.map((d) => d.symbol).filter((s) => s && s !== "UNKNOWN"))];
      if (symbols.length > 0) setPrices(await fetchPrices(symbols));
    } catch (e) { setMessage("Failed to load portfolio"); }
    setLoading(false);
  }, [userId]);

  const loadShares = useCallback(async () => {
    if (!userId) return;
    setMyShares(await getMyShares(userId));
  }, [userId]);

  useEffect(() => { loadPortfolio(); loadShares(); }, [loadPortfolio, loadShares]);

  const handleUpload = async (files) => {
    if (!userId || files.length === 0) return;
    setUploading(true); setMessage("");
    try {
      const result = await uploadScreenshots(userId, files);
      setMessage(`Uploaded ${result.uploaded} file(s). Processing...`);
      setTimeout(loadPortfolio, 5000);
    } catch (e) { setMessage("Upload failed: " + e.message); }
    setUploading(false);
  };

  const handleDelete = async (sn) => { try { await deleteStock(userId, sn); setMessage(`Deleted "${sn}"`); loadPortfolio(); } catch (e) { setMessage("Delete failed"); } };
  const handleUpdate = async (sn, q, a) => { try { await updateStock(userId, sn, q, a); setMessage(`Updated "${sn}"`); loadPortfolio(); } catch (e) { setMessage("Update failed"); } };
  const handleAdd = async (sn, q, a) => { try { const r = await addStock(userId, sn, q, a); setMessage(`Added "${sn}" (${r.symbol})`); loadPortfolio(); } catch (e) { setMessage("Add failed"); } };
  const handleDownloadCsv = async () => { try { await downloadCsv(userId); } catch (e) { setMessage("CSV download failed"); } };

  const handleShare = async () => {
    if (!shareEmail.trim()) return;
    const result = await requestShare(userId, shareEmail.trim());
    if (result.error) { setMessage(result.error); }
    else { setMessage(`Share request sent to ${shareEmail} (pending admin approval)`); setShareEmail(""); setShowShare(false); loadShares(); }
  };

  const handleRevoke = async (viewerId) => {
    await revokeShare(userId, viewerId);
    setMessage("Share revoked");
    loadShares();
  };

  const statusLabel = (s) => {
    if (s === "pending_admin") return "⏳ Pending Admin";
    if (s === "pending_viewer") return "⏳ Pending Viewer";
    if (s === "approved") return "✅ Active";
    if (s === "rejected") return "❌ Rejected";
    return s;
  };

  return (
    <div>
      <UploadArea onUpload={handleUpload} uploading={uploading} />
      {message && <p style={{ color: "#666", marginTop: 10 }}>{message}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 30 }}>
        <h3 style={{ margin: 0 }}>My Portfolio</h3>
        <div>
          <button onClick={() => setShowShare(!showShare)} style={{ marginRight: 8 }}>🔗 Share</button>
          <button onClick={loadPortfolio} disabled={loading} style={{ marginRight: 8 }}>{loading ? "Loading..." : "Refresh"}</button>
          <button onClick={handleDownloadCsv} disabled={portfolio.length === 0}>Download CSV</button>
        </div>
      </div>

      {showShare && (
        <div style={{ background: "#e3f2fd", padding: 12, borderRadius: 4, marginTop: 8 }}>
          <input type="email" placeholder="Viewer's email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)}
            style={{ padding: 6, width: 220, marginRight: 8 }} />
          <button onClick={handleShare} disabled={!shareEmail.trim()}>Send Request</button>
          <button onClick={() => setShowShare(false)} style={{ marginLeft: 4 }}>Cancel</button>
        </div>
      )}

      <PortfolioTable data={portfolio} prices={prices} loading={loading} onDelete={handleDelete} onUpdate={handleUpdate} onAdd={handleAdd} />

      {myShares.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <h4>My Shared Dashboards</h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Shared With</th><th style={th}>Status</th><th style={th}>Action</th>
            </tr></thead>
            <tbody>
              {myShares.map((s) => (
                <tr key={s.viewer_id}>
                  <td style={td}>{s.viewer_email}</td>
                  <td style={td}>{statusLabel(s.status)}</td>
                  <td style={td}><button onClick={() => handleRevoke(s.viewer_id)} style={{ fontSize: 12 }}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const td = { padding: "6px 8px", borderBottom: "1px solid #eee" };

export default Dashboard;
