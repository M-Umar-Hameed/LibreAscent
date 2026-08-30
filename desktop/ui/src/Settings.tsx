import type { DesktopConfig, DesktopStatus } from "./types";
import { activeFriction } from "./types";
import { invoke } from "@tauri-apps/api/core";

type SettingsProps = {
  status: DesktopStatus | null;
  config: DesktopConfig;
  loading: boolean;
  onAction: (cmd: string, title?: string) => void;
  onChangeControlMode: (mode: DesktopConfig["controlMode"]) => void;
  onChangeFriction: (next: DesktopConfig["friction"]) => void;
  onChangeFrictionWindow: (next: DesktopConfig["frictionWindow"]) => void;
  onChangeFrictionMode: (next: DesktopConfig["frictionMode"]) => void;
};

const COUNTDOWN_MIN = 5;
const COUNTDOWN_MAX = 3600;
const COUNTDOWN_STEP = 5;
const CLICK_MIN = 1;
const CLICK_MAX = 999;
const CLICK_STEP = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function Settings({
  status,
  config,
  loading,
  onAction,
  onChangeControlMode,
  onChangeFriction,
  onChangeFrictionWindow,
  onChangeFrictionMode,
}: SettingsProps) {
  const setCountdown = (seconds: number) =>
    onChangeFriction({
      ...config.friction,
      countdownSeconds: clamp(seconds, COUNTDOWN_MIN, COUNTDOWN_MAX),
    });

  const setClicks = (count: number) =>
    onChangeFriction({
      ...config.friction,
      clickCount: clamp(count, CLICK_MIN, CLICK_MAX),
    });

  const w = config.frictionWindow;
  const setWindow = (patch: Partial<DesktopConfig["frictionWindow"]>) =>
    onChangeFrictionWindow({ ...w, ...patch });
  const wrapHour = (h: number) => ((h % 24) + 24) % 24;
  const active = activeFriction(config, new Date().getHours());

  return (
    <>
      <section className="panel">
        <h2>Protection service</h2>
        <div className="actions-row">
          {!status?.serviceInstalled ? (
            <button disabled={loading} onClick={() => onAction("install_service")}>
              Install Service
            </button>
          ) : (
            <>
              {!status?.serviceRunning ? (
                <button disabled={loading} onClick={() => onAction("start_service")}>
                  Start Service
                </button>
              ) : (
                <button
                  disabled={loading}
                  onClick={() => onAction("stop_service", "Stop Protection")}
                >
                  Stop Service
                </button>
              )}
              <button
                disabled={loading}
                className="btn-danger"
                onClick={() => onAction("uninstall_service", "Uninstall Protection")}
              >
                Uninstall
              </button>
              <button
                disabled={loading}
                className="btn-secondary"
                onClick={() => onAction("repair_service", "Repair Protection Service")}
              >
                Repair Service
              </button>
            </>
          )}
        </div>

        <div className="actions-row">
          <button
            disabled={loading || !status?.serviceRunning}
            onClick={() => onAction("enable_dns_protection")}
          >
            Enable DNS Protection
          </button>
          <button
            disabled={loading}
            className="btn-secondary"
            onClick={() => onAction("reset_dns", "Reset DNS Protection")}
          >
            Reset DNS
          </button>
          <button disabled={loading} onClick={() => invoke("show_overlay")}>
            Preview Overlay
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Control Mode</h2>
        <div className="actions-row">
          {(["flexible", "locked", "hardcore"] as const).map((mode) => (
            <button
              key={mode}
              disabled={loading}
              className={config.controlMode === mode ? "" : "btn-secondary"}
              onClick={() => onChangeControlMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="path">
          Raising restriction applies immediately. Lowering requires the Control Mode friction step.
        </p>
      </section>

      <section className="panel">
        <h2>Friction setup</h2>
        <p className="path" style={{ marginTop: 0 }}>
          Applied when Control Mode is Locked or Hardcore. Pick one friction type. Weakening requires the friction step.
        </p>

        <div className="actions-row">
          {(["timer", "clicks", "timeBased"] as const).map((mode) => (
            <button
              key={mode}
              disabled={loading}
              className={config.frictionMode === mode ? "" : "btn-secondary"}
              onClick={() => onChangeFrictionMode(mode)}
            >
              {mode === "timer" ? "Timer" : mode === "clicks" ? "Clicks" : "Time-based"}
            </button>
          ))}
        </div>

        <p className="warning" style={{ marginTop: 0 }}>
          {config.frictionMode === "timeBased"
            ? active.locked
              ? "Active now: locked (inside the time-based window)."
              : "Active now: no friction (outside the time-based window)."
            : `Active now: base friction — ` +
              (active.countdownSeconds > 0 ? `${active.countdownSeconds}s countdown` : "") +
              (active.clickCount > 0 ? `${active.clickCount} clicks` : "") +
              "."}
        </p>

        {config.frictionMode === "timer" && (
          <div className="stepper">
            <button className="btn-secondary" disabled={loading}
              onClick={() => setCountdown(config.friction.countdownSeconds - COUNTDOWN_STEP)}>-</button>
            <div className="stepper-value">
              <span className="stepper-number">{config.friction.countdownSeconds}</span>
              <span className="stepper-label">countdown seconds</span>
            </div>
            <button className="btn-secondary" disabled={loading}
              onClick={() => setCountdown(config.friction.countdownSeconds + COUNTDOWN_STEP)}>+</button>
          </div>
        )}

        {config.frictionMode === "clicks" && (
          <div className="stepper">
            <button className="btn-secondary" disabled={loading}
              onClick={() => setClicks(config.friction.clickCount - CLICK_STEP)}>-</button>
            <div className="stepper-value">
              <span className="stepper-number">{config.friction.clickCount}</span>
              <span className="stepper-label">required clicks</span>
            </div>
            <button className="btn-secondary" disabled={loading}
              onClick={() => setClicks(config.friction.clickCount + CLICK_STEP)}>+</button>
          </div>
        )}

        {config.frictionMode === "timeBased" && (
          <>
            <p className="path" style={{ marginTop: 0 }}>
              Protection is fully locked between the chosen hours (24h clock). End before start wraps past midnight. Set start and end to the same hour to lock all day.
            </p>
            <div className="stepper">
              <button className="btn-secondary" disabled={loading}
                onClick={() => setWindow({ startHour: wrapHour(w.startHour - 1) })}>-</button>
              <div className="stepper-value">
                <span className="stepper-number">{w.startHour}:00</span>
                <span className="stepper-label">start hour</span>
              </div>
              <button className="btn-secondary" disabled={loading}
                onClick={() => setWindow({ startHour: wrapHour(w.startHour + 1) })}>+</button>
            </div>
            <div className="stepper">
              <button className="btn-secondary" disabled={loading}
                onClick={() => setWindow({ endHour: wrapHour(w.endHour - 1) })}>-</button>
              <div className="stepper-value">
                <span className="stepper-number">{w.endHour}:00</span>
                <span className="stepper-label">end hour</span>
              </div>
              <button className="btn-secondary" disabled={loading}
                onClick={() => setWindow({ endHour: wrapHour(w.endHour + 1) })}>+</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
