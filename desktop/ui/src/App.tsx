import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FrictionGuard } from "./FrictionGuard";
import { Settings } from "./Settings";
import type { DesktopConfig, DesktopStatus } from "./types";
import { activeFriction } from "./types";
import logo from "./assets/logo.png";

type DomainResult = "idle" | "blocked" | "allowed" | "error";

function describeBlockEvent(message: string) {
  if (message.startsWith("block:app:")) {
    return `Blocked app: ${message.slice("block:app:".length)}`;
  }

  if (message.startsWith("block:dns:")) {
    return `Blocked domain: ${message.slice("block:dns:".length)}`;
  }

  if (message === "block:app") return "Blocked app";
  if (message === "block:dns") return "Blocked domain";
  return "Blocked content";
}

export function App() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [domain, setDomain] = useState("example.com");
  const [newDomain, setNewDomain] = useState("");
  const [newApp, setNewApp] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [domainResult, setDomainResult] = useState<DomainResult>("idle");
  const [loading, setLoading] = useState(false);
  const [lastBlock, setLastBlock] = useState<string | null>(null);
  const [frictionTarget, setFrictionTarget] = useState<{
    title: string;
    run: () => Promise<void>;
  } | null>(null);
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");

  const refreshStatus = () => {
    invoke<DesktopStatus>("get_status")
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  const loadConfig = () => {
    invoke<DesktopConfig>("get_config")
      .then(setConfig)
      .catch(console.error);
  };

  useEffect(() => {
    refreshStatus();
    loadConfig();
    const interval = setInterval(refreshStatus, 5000);
    let unlisten: (() => void) | undefined;
    invoke<string | null>("get_last_block_event")
      .then((message) => {
        if (message) {
          setLastBlock(describeBlockEvent(message));
        }
      })
      .catch(() => {});

    listen<string>("block-event", (event) => {
      setLastBlock(describeBlockEvent(event.payload));
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      clearInterval(interval);
      unlisten?.();
    };
  }, []);

  async function testDomain() {
    setDomainResult("idle");
    try {
      const blocked = await invoke<boolean>("test_domain", { domain });
      setDomainResult(blocked ? "blocked" : "allowed");
    } catch {
      setDomainResult("error");
    }
  }

  async function runAction(cmd: string, title?: string) {
    if (config?.controlMode !== "flexible" && title) {
      setFrictionTarget({ title, run: () => invoke(cmd).then(() => {}) });
      return;
    }

    setLoading(true);
    try {
      await invoke(cmd);
      refreshStatus();
    } catch (e) {
      alert(`Action failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function addApp() {
    if (!config || !newApp) return;
    const updated = {
      ...config,
      blockedApps: [...config.blockedApps, { name: newApp, executable: newApp, fullPath: null }],
    };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
      setNewApp("");
    } catch (e) {
      alert(e);
    }
  }

  async function removeApp(exe: string) {
    if (!config) return;
    if (config.controlMode !== "flexible") {
      alert("Control Mode prevents removing rules directly.");
      return;
    }
    const updated = {
      ...config,
      blockedApps: config.blockedApps.filter((a) => a.executable !== exe),
    };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
    } catch (e) {
      alert(e);
    }
  }

  async function addDomain() {
    const value = newDomain.trim();
    if (!config || !value) return;
    const updated = {
      ...config,
      includedDomains: [...config.includedDomains, value],
    };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
      setNewDomain("");
      if (domainResult !== "idle") {
        setDomain(value);
        setDomainResult("idle");
      }
    } catch (e) {
      alert(e);
    }
  }

  async function removeDomain(value: string) {
    if (!config) return;
    if (config.controlMode !== "flexible") {
      alert("Control Mode prevents removing rules directly.");
      return;
    }
    const updated = {
      ...config,
      includedDomains: config.includedDomains.filter((domain) => domain !== value),
    };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
    } catch (e) {
      alert(e);
    }
  }

  async function addKeyword() {
    const value = newKeyword.trim().toLowerCase();
    if (!config || !value) return;
    if (config.keywords.includes(value)) {
      setNewKeyword("");
      return;
    }
    const updated = { ...config, keywords: [...config.keywords, value] };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
      setNewKeyword("");
    } catch (e) {
      alert(e);
    }
  }

  async function removeKeyword(value: string) {
    if (!config) return;
    if (config.controlMode !== "flexible") {
      alert("Control Mode prevents removing rules directly.");
      return;
    }
    const updated = { ...config, keywords: config.keywords.filter((k) => k !== value) };
    try {
      await invoke("update_config", { config: updated });
      setConfig(updated);
    } catch (e) {
      alert(e);
    }
  }

  const MODE_RANK: Record<DesktopConfig["controlMode"], number> = {
    flexible: 0,
    locked: 1,
    hardcore: 2,
  };

  async function writeControlMode(mode: DesktopConfig["controlMode"]) {
    if (!config) return;
    const updated = { ...config, controlMode: mode };
    await invoke("update_config", { config: updated });
    setConfig(updated);
  }

  function changeControlMode(mode: DesktopConfig["controlMode"]) {
    if (!config || mode === config.controlMode) return;
    const lowering = MODE_RANK[mode] < MODE_RANK[config.controlMode];
    if (lowering) {
      setFrictionTarget({
        title: `Lower Control Mode to ${mode}`,
        run: () => writeControlMode(mode),
      });
      return;
    }
    writeControlMode(mode).catch((e) => alert(e));
  }

  async function writeFriction(next: DesktopConfig["friction"]) {
    if (!config) return;
    const updated = { ...config, friction: next };
    await invoke("update_config", { config: updated });
    setConfig(updated);
  }

  function changeFriction(next: DesktopConfig["friction"]) {
    if (!config) return;
    const weaker =
      next.countdownSeconds < config.friction.countdownSeconds ||
      next.clickCount < config.friction.clickCount;
    if (weaker && config.controlMode !== "flexible") {
      setFrictionTarget({
        title: "Weaken friction settings",
        run: () => writeFriction(next),
      });
      return;
    }
    writeFriction(next).catch((e) => alert(e));
  }

  async function writeFrictionWindow(next: DesktopConfig["frictionWindow"]) {
    if (!config) return;
    const updated = { ...config, frictionWindow: next };
    await invoke("update_config", { config: updated });
    setConfig(updated);
  }

  function changeFrictionWindow(next: DesktopConfig["frictionWindow"]) {
    if (!config) return;
    const cur = config.frictionWindow;
    // Weakening = disabling an active window, or lowering its countdown/clicks.
    const weaker =
      (cur.enabled && !next.enabled) ||
      next.countdownSeconds < cur.countdownSeconds ||
      next.clickCount < cur.clickCount;
    if (weaker && config.controlMode !== "flexible") {
      setFrictionTarget({
        title: "Weaken time-based friction",
        run: () => writeFrictionWindow(next),
      });
      return;
    }
    writeFrictionWindow(next).catch((e) => alert(e));
  }

  async function writeFrictionMode(next: DesktopConfig["frictionMode"]) {
    if (!config) return;
    const updated = { ...config, frictionMode: next };
    await invoke("update_config", { config: updated });
    setConfig(updated);
  }

  function changeFrictionMode(next: DesktopConfig["frictionMode"]) {
    if (!config || next === config.frictionMode) return;
    // Cross-mode strength is not comparable; gate every switch behind the
    // friction step when a control mode is active.
    if (config.controlMode !== "flexible") {
      setFrictionTarget({
        title: "Change friction type",
        run: () => writeFrictionMode(next),
      });
      return;
    }
    writeFrictionMode(next).catch((e) => alert(e));
  }

  if (frictionTarget && config) {
    return (
      <FrictionGuard
        title={frictionTarget.title}
        countdownSeconds={activeFriction(config, new Date().getHours()).countdownSeconds}
        clickCount={activeFriction(config, new Date().getHours()).clickCount}
        onCancel={() => setFrictionTarget(null)}
        onSuccess={async () => {
          const run = frictionTarget.run;
          setFrictionTarget(null);
          setLoading(true);
          try {
            await run();
            refreshStatus();
          } catch (e) {
            alert(e);
          } finally {
            setLoading(false);
          }
        }}
      />
    );
  }

  return (
    <main className="shell">
      <div className="actions-row" style={{ margin: 0 }}>
        <button
          className={view === "dashboard" ? "" : "btn-secondary"}
          onClick={() => setView("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={view === "settings" ? "" : "btn-secondary"}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </div>

      {view === "settings" && config ? (
        <Settings
          status={status}
          config={config}
          loading={loading}
          onAction={runAction}
          onChangeControlMode={changeControlMode}
          onChangeFriction={changeFriction}
          onChangeFrictionWindow={changeFrictionWindow}
          onChangeFrictionMode={changeFrictionMode}
        />
      ) : (
        <>
          <section className="panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <img src={logo} alt="LibreAscent" style={{ width: '40px', height: '40px' }} />
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>LibreAscent Desktop</p>
                <h1 style={{ margin: 0 }}>Windows protection</h1>
              </div>
            </div>
            <dl className="status-grid">
              <div>
                <dt>Service installed</dt>
                <dd>{status?.serviceInstalled ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Service running</dt>
                <dd>{status?.serviceRunning ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>System DNS</dt>
                <dd>{status?.dnsControlled ? "Managed" : "External"}</dd>
              </div>
              <div>
                <dt>Bypass guard</dt>
                <dd>{status?.firewallControlled ? "Active" : "Missing"}</dd>
              </div>
            </dl>

            {status && !status.dnsControlled && !status.firewallControlled ? (
              <p className="warning">
                Browser blocking is not active until System DNS or the firewall bypass guard is managed by LibreAscent.
              </p>
            ) : null}

            {status && !status.dnsControlled && status.firewallControlled ? (
              <p className="warning">
                System DNS is external, but LibreAscent is blocking Cloudflare DNS/WARP bypass routes with Windows Firewall.
              </p>
            ) : null}

            {lastBlock ? <p className="warning">Last block: {lastBlock}</p> : null}

            <p className="path">
              {status?.configPath ?? "Config path unavailable"}
              <br />
              Mode: {config?.controlMode ?? "Unknown"}
            </p>
          </section>

          <section className="panel">
            <h2>Blocked domains</h2>
            <div className="domain-row">
              <input
                placeholder="e.g. example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <button onClick={addDomain}>Add</button>
            </div>
            <ul className="app-list">
              {config?.includedDomains.map((blockedDomain) => (
                <li key={blockedDomain}>
                  <span>{blockedDomain}</span>
                  <button className="btn-link" onClick={() => removeDomain(blockedDomain)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Blocked keywords</h2>
            <div className="domain-row">
              <input
                placeholder="e.g. porn"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
              />
              <button onClick={addKeyword}>Add</button>
            </div>
            <ul className="app-list">
              {config?.keywords.map((keyword) => (
                <li key={keyword}>
                  <span>{keyword}</span>
                  <button className="btn-link" onClick={() => removeKeyword(keyword)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Blocked apps</h2>
            <div className="domain-row">
              <input
                placeholder="e.g. discord.exe"
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
              />
              <button onClick={addApp}>Add</button>
            </div>
            <ul className="app-list">
              {config?.blockedApps.map((app) => (
                <li key={app.executable}>
                  <span>{app.executable}</span>
                  <button className="btn-link" onClick={() => removeApp(app.executable)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Domain test</h2>
            <div className="domain-row">
              <input
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
              <button onClick={testDomain}>Test</button>
            </div>
            <p className={`result result-${domainResult}`}>{domainResult}</p>
          </section>
        </>
      )}
    </main>
  );
}
