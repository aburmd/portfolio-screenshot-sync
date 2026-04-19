import React from "react";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import awsConfig from "./aws-config";
import Dashboard from "./pages/Dashboard";

Amplify.configure(awsConfig);

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div style={{ fontFamily: "sans-serif", maxWidth: 960, margin: "0 auto", padding: 20 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>Portfolio Screenshot Sync</h2>
            <div>
              <span style={{ marginRight: 12 }}>{user?.signInDetails?.loginId}</span>
              <button onClick={signOut}>Sign out</button>
            </div>
          </header>
          <Dashboard user={user} />
        </div>
      )}
    </Authenticator>
  );
}

export default App;
