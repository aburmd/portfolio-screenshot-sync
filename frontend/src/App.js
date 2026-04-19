import React, { useState, useEffect } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";
import awsConfig from "./aws-config";
import Dashboard from "./pages/Dashboard";
import AdminPage from "./pages/AdminPage";
import SharedWithMe from "./pages/SharedWithMe";

Amplify.configure(awsConfig);

const tabStyle = (active) => ({
  padding: "8px 20px", cursor: "pointer", border: "none",
  borderBottom: active ? "3px solid #1976d2" : "3px solid transparent",
  background: "none", fontWeight: active ? "bold" : "normal", fontSize: 14,
});

function AppContent({ signOut, user }) {
  const [page, setPage] = useState("dashboard");
  const [role, setRole] = useState(null);

  useEffect(() => {
    async function getRole() {
      try { const attrs = await fetchUserAttributes(); setRole(attrs["custom:role"] || "user"); }
      catch { setRole("user"); }
    }
    getRole();
  }, [user]);

  const isAdmin = role === "admin";

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>📊 Portfolio Screenshot Sync</h2>
        <div>
          <span style={{ marginRight: 8, color: "#666" }}>{user?.signInDetails?.loginId || user?.username}</span>
          {isAdmin && <span style={{ marginRight: 8, background: "#e3f2fd", color: "#1565c0", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>ADMIN</span>}
          <button onClick={signOut} style={{ padding: "6px 16px", cursor: "pointer" }}>Sign out</button>
        </div>
      </header>

      <nav style={{ borderBottom: "1px solid #eee", marginBottom: 20 }}>
        <button style={tabStyle(page === "dashboard")} onClick={() => setPage("dashboard")}>Dashboard</button>
        <button style={tabStyle(page === "shared")} onClick={() => setPage("shared")}>Shared With Me</button>
        {isAdmin && <button style={tabStyle(page === "admin")} onClick={() => setPage("admin")}>Admin</button>}
      </nav>

      {page === "dashboard" && <Dashboard user={user} />}
      {page === "shared" && <SharedWithMe user={user} />}
      {page === "admin" && isAdmin && <AdminPage />}
    </div>
  );
}

function App() {
  return (
    <Authenticator signUpAttributes={["email"]}>
      {({ signOut, user }) => <AppContent signOut={signOut} user={user} />}
    </Authenticator>
  );
}

export default App;
