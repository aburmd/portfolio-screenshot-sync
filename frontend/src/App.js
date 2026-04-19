import React, { useState } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import awsConfig from "./aws-config";
import Dashboard from "./pages/Dashboard";
import AdminPage from "./pages/AdminPage";

Amplify.configure(awsConfig);

const tabStyle = (active) => ({
  padding: "8px 20px",
  cursor: "pointer",
  border: "none",
  borderBottom: active ? "3px solid #1976d2" : "3px solid transparent",
  background: "none",
  fontWeight: active ? "bold" : "normal",
  fontSize: 14,
});

function App() {
  const [page, setPage] = useState("dashboard");

  return (
    <Authenticator signUpAttributes={["email"]}>
      {({ signOut, user }) => (
        <div style={{ fontFamily: "sans-serif", maxWidth: 960, margin: "0 auto", padding: 20 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>📊 Portfolio Screenshot Sync</h2>
            <div>
              <span style={{ marginRight: 12, color: "#666" }}>{user?.signInDetails?.loginId || user?.username}</span>
              <button onClick={signOut} style={{ padding: "6px 16px", cursor: "pointer" }}>Sign out</button>
            </div>
          </header>

          <nav style={{ borderBottom: "1px solid #eee", marginBottom: 20 }}>
            <button style={tabStyle(page === "dashboard")} onClick={() => setPage("dashboard")}>Dashboard</button>
            <button style={tabStyle(page === "admin")} onClick={() => setPage("admin")}>Admin</button>
          </nav>

          {page === "dashboard" && <Dashboard user={user} />}
          {page === "admin" && <AdminPage />}
        </div>
      )}
    </Authenticator>
  );
}

export default App;
