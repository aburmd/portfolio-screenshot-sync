import React, { useState, useEffect, useCallback, useRef } from "react";
import UploadArea from "../components/UploadArea";
import PortfolioTable from "../components/PortfolioTable";
import { fetchPortfolio, uploadScreenshots, downloadCsv, deleteStock, bulkDeleteStocks, updateStock, addStock, fetchPrices, fetchExchangeRate, fetchUploadStatus, requestShare, getMyShares, revokeShare } from "../services/api";

const tabStyle = (active) => ({
  padding: "5px 14px", cursor: "pointer", border: "1px solid #ddd",
  borderBottom: active ? "2px solid #1976d2" : "1px solid #ddd",
  background: active ? "#fff" : "#f9f9f9", fontWeight: active ? "bold" : "normal",
  fontSize: 12, borderRadius: "4px 4px 0 0", marginRight: 2,
});

function ProcessingStatus({ items }) {
  if (!items || items.length === 0) return null;
  const completed = items.filter((i) => i.ocr_status === "COMPLETED");
  const processing = items.filter((i) => i.ocr_status === "PROCESSING");
  const failed = items.filter((i) => i.ocr_status === "FAILED");
  const totalStocks = completed.reduce((s, i) => s + (i.extracted_stocks || 0), 0);

  return (
    <div style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 4, padding: "8px 12px", marginTop: 8, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span>📊 <strong>{completed.length}/{items.length}</strong> files processed</span>
        <span>📈 <strong>{totalStocks}</strong> stocks extracted</span>
        {processing.length > 0 && <span style={{ color: "#f57c00" }}>⏳ {processing.length} processing...</span>}
        {failed.length > 0 && <span style={{ color: "#d32f2f" }}>❌ {failed.length} failed</span>}
        {completed.length === items.length && failed.length === 0 && <span style={{ color: "#2e7d32" }}>✅ All done!</span>}
      </div>
      {/* Progress bar */}
      <div style={{ background: "#ddd", borderRadius: 4, height: 4, marginTop: 6 }}>
        <div style={{
          background: failed.length > 0 ? "#f57c00" : "#4CAF50",
          borderRadius: 4, height: 4,
          width: `${(completed.length / items.length) * 100}%`,
          transition: "width 0.3s",
        }} />
      </div>
    </div>
  );
}

function Dashboard({ user }) {
  const [portfolio, setPortfolio] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [myShares, setMyShares] = useState([]);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [uploadStatus, setUploadStatus] = useState([]);
  const [showStatus, setShowStatus] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [exchangeRate, setExchangeRate] = useState(null); // INR per USD
  const pollRef = useRef(null);

  const userId = user?.userId || user?.username;

  const loadPortfolio = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await fetchPortfolio(userId);
      setPortfolio(data);
      const usdSymbols = [...new Set(data.filter((d) => (!d.currency || d.currency === "USD") && d.symbol && d.symbol !== "UNKNOWN").map((d) => d.symbol))];
      const inrSymbols = [...new Set(data.filter((d) => d.currency === "INR" && d.symbol && d.symbol !== "UNKNOWN").map((d) => d.symbol))];
      if (usdSymbols.length > 0 || inrSymbols.length > 0) setPrices(await fetchPrices(usdSymbols, inrSymbols));
      // Fetch exchange rate if we have mixed currencies
      const hasMixed = data.some((d) => d.currency === "INR") && data.some((d) => !d.currency || d.currency === "USD");
      if (hasMixed && !exchangeRate) {
        const rate = await fetchExchangeRate("USD", "INR");
        if (rate) setExchangeRate(rate);
      }
    } catch (e) { setMessage("Failed to load portfolio"); }
    setLoading(false);
  }, [userId, exchangeRate]);

  const loadShares = useCallback(async () => {
    if (!userId) return;
    setMyShares(await getMyShares(userId));
  }, [userId]);

  useEffect(() => { loadPortfolio(); loadShares(); }, [loadPortfolio, loadShares]);

  // Cleanup polling on unmount
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const pollStatus = useCallback(async (uploadedCount) => {
    if (!userId) return;
    const status = await fetchUploadStatus(userId);
    // Get the most recent N uploads matching our batch
    const recent = status.slice(0, uploadedCount);
    setUploadStatus(recent);

    const allDone = recent.length >= uploadedCount &&
      recent.every((s) => s.ocr_status === "COMPLETED" || s.ocr_status === "FAILED");

    if (allDone) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      const completed = recent.filter((s) => s.ocr_status === "COMPLETED");
      const totalStocks = completed.reduce((s, i) => s + (i.extracted_stocks || 0), 0);
      setMessage(`✅ Processing complete: ${totalStocks} stocks from ${completed.length} file(s)`);
      loadPortfolio();
    }
  }, [userId, loadPortfolio]);

  const handleUpload = async (files, platform) => {
    if (!userId || files.length === 0) return;
    setUploading(true); setMessage(""); setUploadStatus([]); setShowStatus(true);
    try {
      const result = await uploadScreenshots(userId, files, platform);
      setMessage(`Uploaded ${result.uploaded} file(s) for ${platform}. Processing...`);

      // Start polling for status every 2 seconds
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollStatus(result.uploaded), 2000);

      // Safety timeout: stop polling after 60 seconds
      setTimeout(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        loadPortfolio();
      }, 60000);
    } catch (e) { setMessage("Upload failed: " + e.message); }
    setUploading(false);
  };

  const handleDelete = async (sn) => { try { await deleteStock(userId, sn); setMessage(`Deleted "${sn}"`); loadPortfolio(); } catch (e) { setMessage("Delete failed"); } };
  const handleBulkDelete = async (stockNames) => {
    try {
      const result = await bulkDeleteStocks(userId, stockNames);
      setMessage(`Deleted ${result.count} stock(s)`);
      loadPortfolio();
    } catch (e) { setMessage("Bulk delete failed"); }
  };
  const handleUpdate = async (sn, q, a, cp) => { try { await updateStock(userId, sn, q, a, cp); setMessage(`Updated "${sn}"`); loadPortfolio(); } catch (e) { setMessage("Update failed"); } };
  const handleAdd = async (sn, q, a) => { try { const r = await addStock(userId, sn, q, a); setMessage(`Added "${sn}" (${r.symbol})`); loadPortfolio(); } catch (e) { setMessage("Add failed"); } };
  const handleDownloadCsv = async () => { try { await downloadCsv(userId); } catch (e) { setMessage("CSV download failed"); } };

  const handleShare = async () => {
    if (!shareEmail.trim()) return;
    const result = await requestShare(userId, shareEmail.trim());
    if (result.error) { setMessage(result.error); }
    else { setMessage(`Share request sent to ${shareEmail} (pending admin approval)`); setShareEmail(""); setShowShare(false); loadShares(); }
  };

  const handleRevoke = async (viewerId) => { await revokeShare(userId, viewerId); setMessage("Share revoked"); loadShares(); };

  const platforms = [...new Set(portfolio.map((p) => p.platform_name).filter(Boolean))];
  const filteredPortfolio = platformFilter === "all" ? portfolio : portfolio.filter((p) => p.platform_name === platformFilter);

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
      {showStatus && uploadStatus.length > 0 && <ProcessingStatus items={uploadStatus} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 30 }}>
        <h3 style={{ margin: 0 }}>My Portfolio <span style={{ fontSize: 13, color: "#999", fontWeight: "normal" }}>({portfolio.length} stocks)</span></h3>
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

      {platforms.length > 1 && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <div>
            <button style={tabStyle(platformFilter === "all")} onClick={() => setPlatformFilter("all")}>All ({portfolio.length})</button>
            {platforms.map((p) => (
              <button key={p} style={tabStyle(platformFilter === p)} onClick={() => setPlatformFilter(p)}>
                {p} ({portfolio.filter((s) => s.platform_name === p).length})
              </button>
            ))}
          </div>
          {platformFilter === "all" && exchangeRate && (
            <div style={{ marginLeft: "auto", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <span>Show in:</span>
              <button onClick={() => setDisplayCurrency("USD")} style={{ padding: "2px 8px", border: displayCurrency === "USD" ? "2px solid #1976d2" : "1px solid #ccc", borderRadius: 3, background: displayCurrency === "USD" ? "#e3f2fd" : "#fff", cursor: "pointer" }}>USD</button>
              <button onClick={() => setDisplayCurrency("INR")} style={{ padding: "2px 8px", border: displayCurrency === "INR" ? "2px solid #1976d2" : "1px solid #ccc", borderRadius: 3, background: displayCurrency === "INR" ? "#e3f2fd" : "#fff", cursor: "pointer" }}>INR</button>
              <span style={{ color: "#999" }}>1 USD = ₹{exchangeRate?.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <PortfolioTable data={filteredPortfolio} prices={prices} loading={loading}
        onDelete={handleDelete} onBulkDelete={handleBulkDelete} onUpdate={handleUpdate} onAdd={handleAdd}
        displayCurrency={platformFilter === "all" ? displayCurrency : null}
        exchangeRate={exchangeRate} />

      {myShares.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <h4>My Shared Dashboards</h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Shared With</th><th style={th}>Status</th><th style={th}>Action</th></tr></thead>
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
