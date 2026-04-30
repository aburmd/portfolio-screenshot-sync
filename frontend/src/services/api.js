const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

export async function fetchPortfolio(userId) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch portfolio");
  return res.json();
}

export async function fetchUploadStatus(userId) {
  const res = await fetch(`${API_BASE}/upload-status/${userId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function uploadScreenshots(userId, files, platform) {
  const formData = new FormData();
  formData.append("user_id", userId);
  formData.append("platform", platform || "unknown");
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function uploadCsv(userId, file) {
  const formData = new FormData();
  formData.append("user_id", userId);
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/upload/csv`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("CSV upload failed");
  return res.json();
}

export async function addStock(userId, stockName, quantity, avgBuyPrice, platform, currency) {
  const formData = new FormData();
  formData.append("stock_name", stockName);
  formData.append("quantity", quantity);
  formData.append("avg_buy_price", avgBuyPrice);
  if (platform) formData.append("platform", platform);
  if (currency) formData.append("currency", currency);
  const res = await fetch(`${API_BASE}/portfolio/${userId}/add`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Add failed");
  return res.json();
}

export async function deleteStock(userId, stockName) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}/${encodeURIComponent(stockName)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
  return res.json();
}

export async function bulkDeleteStocks(userId, stockNames) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stockNames),
  });
  if (!res.ok) throw new Error("Bulk delete failed");
  return res.json();
}

export async function updateStock(userId, stockName, quantity, avgBuyPrice, currentPrice) {
  const formData = new FormData();
  formData.append("quantity", quantity);
  formData.append("avg_buy_price", avgBuyPrice);
  if (currentPrice != null && currentPrice !== "") {
    formData.append("current_price", currentPrice);
  }
  const res = await fetch(`${API_BASE}/portfolio/${userId}/${encodeURIComponent(stockName)}`, {
    method: "PUT",
    body: formData,
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function fetchPrices(symbols, inrSymbols, live = false) {
  const res = await fetch(`${API_BASE}/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: symbols || [], inr_symbols: inrSymbols || [], live }),
  });
  if (!res.ok) return {};
  return res.json();
}

export async function fetchExchangeRate(from_cur, to_cur) {
  const res = await fetch(`${API_BASE}/exchange-rate/${from_cur}/${to_cur}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.rate;
}

export async function downloadCsv(userId) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}/csv`);
  if (!res.ok) throw new Error("CSV download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "portfolio.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// --- Sharing ---
export async function requestShare(ownerId, viewerEmail) {
  const fd = new FormData(); fd.append("owner_id", ownerId); fd.append("viewer_email", viewerEmail);
  const res = await fetch(`${API_BASE}/shares/request`, { method: "POST", body: fd });
  return res.json();
}
export async function getMyShares(userId) {
  const res = await fetch(`${API_BASE}/shares/my-shares/${userId}`); return res.json();
}
export async function getSharedWithMe(userId) {
  const res = await fetch(`${API_BASE}/shares/shared-with-me/${userId}`); return res.json();
}
export async function getPendingViewer(userId) {
  const res = await fetch(`${API_BASE}/shares/pending-viewer/${userId}`); return res.json();
}
export async function viewerRespond(ownerId, viewerId, action) {
  const fd = new FormData(); fd.append("owner_id", ownerId); fd.append("viewer_id", viewerId); fd.append("action", action);
  const res = await fetch(`${API_BASE}/shares/viewer-respond`, { method: "POST", body: fd }); return res.json();
}
export async function revokeShare(ownerId, viewerId) {
  const res = await fetch(`${API_BASE}/shares/${ownerId}/${viewerId}`, { method: "DELETE" }); return res.json();
}

// --- Position Tracker ---
export async function freezePortfolio(userId, initialDate, platform) {
  const body = {};
  if (initialDate) body.initial_date = initialDate;
  if (platform) body.platform = platform;
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/freeze`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
export async function fetchSnapshots(userId) {
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/snapshots`); return res.json();
}
export async function fetchDiff(userId, platform) {
  const url = platform ? `${API_BASE}/position-tracker/${userId}/diff?platform=${platform}` : `${API_BASE}/position-tracker/${userId}/diff`;
  const res = await fetch(url); return res.json();
}
export async function confirmSells(userId, data) {
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/confirm-sells`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }); return res.json();
}
export async function addCashFlow(userId, data) {
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/cash-flow`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }); return res.json();
}
export async function fetchCashFlows(userId) {
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/cash-flows`); return res.json();
}
export async function importFidelityCsv(userId, files) {
  const formData = new FormData();
  formData.append("user_id", userId);
  for (const file of files) formData.append("files", file);
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/import-fidelity-csv`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}
export async function deleteCashFlow(userId, sk) {
  const res = await fetch(`${API_BASE}/position-tracker/${userId}/cash-flow/${encodeURIComponent(sk)}`, { method: "DELETE" }); return res.json();
}
export async function fetchPositions(userId, platform) {
  const url = platform ? `${API_BASE}/position-tracker/${userId}/positions?platform=${platform}` : `${API_BASE}/position-tracker/${userId}/positions`;
  const res = await fetch(url); return res.json();
}
export async function fetchXirr(userId, platform) {
  const url = platform ? `${API_BASE}/position-tracker/${userId}/xirr?platform=${platform}` : `${API_BASE}/position-tracker/${userId}/xirr`;
  const res = await fetch(url); return res.json();
}

// --- Performance Chart ---
export async function fetchChartData(userId, period, startDate, endDate, platform) {
  let url = `${API_BASE}/performance/${userId}/chart?period=${period}`;
  if (period === "custom" && startDate && endDate) url += `&start_date=${startDate}&end_date=${endDate}`;
  if (platform && platform !== "all") url += `&platform=${platform}`;
  const res = await fetch(url); return res.json();
}
export async function addBuyLot(userId, data) {
  const res = await fetch(`${API_BASE}/performance/${userId}/buy-lot`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }); return res.json();
}
export async function fetchBuyLots(userId, symbol) {
  const url = symbol ? `${API_BASE}/performance/${userId}/buy-lots?symbol=${symbol}` : `${API_BASE}/performance/${userId}/buy-lots`;
  const res = await fetch(url); return res.json();
}
export async function deleteBuyLot(userId, sk) {
  const res = await fetch(`${API_BASE}/performance/${userId}/buy-lot/${encodeURIComponent(sk)}`, { method: "DELETE" }); return res.json();
}
export async function triggerBackfill(userId, symbol) {
  const url = symbol ? `${API_BASE}/performance/${userId}/backfill/${symbol}` : `${API_BASE}/performance/${userId}/backfill`;
  const res = await fetch(url, { method: "POST" }); return res.json();
}

// --- Research ---
export async function fetchFundamentals(symbol, market = "US", period = "annual") {
  const res = await fetch(`${API_BASE}/research/fundamentals/${encodeURIComponent(symbol)}?market=${market}&period=${period}`);
  if (!res.ok) throw new Error("Failed to fetch fundamentals");
  return res.json();
}
export async function fetchScreenerResults(market) {
  const res = await fetch(`${API_BASE}/research/screener/${market}`);
  if (!res.ok) throw new Error("Failed to fetch screener");
  return res.json();
}
export async function runScreener(market) {
  const res = await fetch(`${API_BASE}/research/screener/run/${market}`, { method: "POST" });
  if (!res.ok) throw new Error("Screener run failed");
  return res.json();
}
export async function runMaScanner(market) {
  const res = await fetch(`${API_BASE}/research/ma-scanner/run/${market}`, { method: "POST" });
  if (!res.ok) throw new Error("MA scanner run failed");
  return res.json();
}
export async function fetchBuyCandidates(market) {
  const res = await fetch(`${API_BASE}/research/buy-candidates/${market}`);
  if (!res.ok) throw new Error("Failed to fetch buy candidates");
  return res.json();
}
export async function fetchPullbackBuys(market) {
  const res = await fetch(`${API_BASE}/research/pullback-buy/${market}`);
  if (!res.ok) throw new Error("Failed to fetch pullback buys");
  return res.json();
}
export async function fetchPositionMonitor(userId, platform) {
  let url = `${API_BASE}/research/position-monitor/${userId}`;
  if (platform) url += `?platform=${platform}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch position monitor");
  return res.json();
}
export async function checkStock(symbol, market = "US", userId = "") {
  let url = `${API_BASE}/research/stock-check/${encodeURIComponent(symbol)}?market=${market}`;
  if (userId) url += `&user_id=${userId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to check stock");
  return res.json();
}
export async function refreshIndexes(market) {
  const res = await fetch(`${API_BASE}/research/refresh-indexes/${market}`, { method: "POST" });
  if (!res.ok) throw new Error("Index refresh failed");
  return res.json();
}
