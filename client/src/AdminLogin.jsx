import { useState } from "react";

function AdminLogin({ onLogin, onBackToStore }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    if (username === "admin02" && password === "robot01") {
      setError("");
      onLogin();
      return;
    }

    setError("Invalid demo username or password");
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="admin-login-title">
        <button type="button" className="text-button login-back" onClick={onBackToStore}>
          Back to shop
        </button>
        <p className="eyebrow">Restricted controls</p>
        <h1 id="admin-login-title">Admin sign in</h1>
        <p className="login-copy">
          Access device controls, diagnostics, telemetry, stock refill, and lab simulations.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          <button type="submit" className="login-submit">Sign in</button>
        </form>

        <div className="demo-credentials">
          <span>Demo access</span>
          <strong>admin02 / robot01</strong>
        </div>
      </section>
    </main>
  );
}

export default AdminLogin;
