import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type ServiceStatus = {
  name: string;
  unit: string;
  description: string;
  loadState: string;
  activeState: string;
  subState: string;
  activeSince: string;
  mainPid: string;
};

type ServerInfo = {
  id: string;
  name: string;
  host: string;
  serviceCount: number;
};

type Notice = { kind: "success" | "error"; message: string } | null;

const STATUS_REFRESH_SECONDS = 60;
const LIVE_LOG_REFRESH_MS = 1_500;
const LIVE_LOG_TIMEOUT_SECONDS = 5 * 60;

function getServiceGroup(service: ServiceStatus) {
  // Feature: normalize common systemd combinations into the requested Running and Dead groups.
  if (service.activeState === "active" && service.subState === "running") return "running";
  if (
    service.activeState === "failed" ||
    service.activeState === "inactive" ||
    service.subState === "failed" ||
    service.subState === "dead"
  ) return "dead";

  // Feature: preserve uncommon systemd states so activating, exited, reloading, and others get their own section.
  return service.subState !== "unknown" ? service.subState : service.activeState;
}

function formatGroupName(state: string) {
  // Compatibility fix: regex replacement works with the project's current TypeScript target.
  return state
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function canStopService(service: ServiceStatus) {
  // Reliability fix: activating and reloading processes are running work and must offer Stop instead of Start.
  return ["active", "activating", "reloading", "deactivating"].includes(service.activeState);
}

function App() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [activeServerId, setActiveServerId] = useState("");
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsToRefresh, setSecondsToRefresh] = useState(STATUS_REFRESH_SECONDS);
  const [busyUnit, setBusyUnit] = useState<string | null>(null);
  const [selected, setSelected] = useState<ServiceStatus | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [liveLogs, setLiveLogs] = useState(false);
  const [liveLogSecondsLeft, setLiveLogSecondsLeft] = useState(LIVE_LOG_TIMEOUT_SECONDS);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const hasLoaded = useRef(false);
  const nextRefreshAt = useRef(Date.now() + STATUS_REFRESH_SECONDS * 1_000);
  const liveLogsExpireAt = useRef(Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const logsContainerRef = useRef<HTMLPreElement>(null);
  const matchRefs = useRef(new Map<number, HTMLElement>());
  // Feature: keep the open process panel synchronized with the latest one-minute or action-triggered status refresh.
  const selectedService = selected
    ? services.find((service) => service.unit === selected.unit) ?? selected
    : null;
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;

  const refreshServices = useCallback(async () => {
    if (!activeServerId) return;
    hasLoaded.current ? setRefreshing(true) : setLoading(true);
    nextRefreshAt.current = Date.now() + STATUS_REFRESH_SECONDS * 1_000;
    setSecondsToRefresh(STATUS_REFRESH_SECONDS);
    try {
      const result = await invoke<ServiceStatus[]>("get_services", { serverId: activeServerId });
      setServices(result);
      setNotice(null);
      hasLoaded.current = true;
    } catch (error) {
      // Reliability fix: retain the last known states when a temporary SSH refresh fails.
      setNotice({ kind: "error", message: String(error) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeServerId]);

  const refreshLogs = useCallback(async (service: ServiceStatus, quiet = false) => {
    if (!activeServerId) return;
    if (!quiet) setLogsLoading(true);
    try {
      const result = await invoke<string>("get_logs", {
        serverId: activeServerId,
        unit: service.unit,
        lines: 500,
      });
      setLogs(result || "No logs are available for this service.");
    } catch (error) {
      setLogs(`Could not load logs:\n${String(error)}`);
    } finally {
      setLogsLoading(false);
    }
  }, [activeServerId]);

  useEffect(() => {
    // Feature: server metadata comes from Rust so the UI and SSH allowlists cannot drift apart.
    void invoke<ServerInfo[]>("get_servers")
      .then((result) => {
        setServers(result);
        setActiveServerId((current) => current || result[0]?.id || "");
        if (result.length === 0) setLoading(false);
      })
      .catch((error) => {
        setNotice({ kind: "error", message: String(error) });
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!activeServerId) return;
    void refreshServices();
    // Feature: one visible countdown drives the requested one-minute automatic refresh cycle.
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextRefreshAt.current - Date.now()) / 1_000));
      setSecondsToRefresh(remaining);
      // Reliability fix: trigger refresh outside a state updater so React Strict Mode cannot run it twice.
      if (remaining === 0) void refreshServices();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeServerId, refreshServices]);

  useEffect(() => {
    if (!selected) return;
    setLogs("");
    setSearchQuery("");
    setCurrentMatch(0);
    // Feature: every newly opened log workspace starts a fresh, bounded five-minute Live session.
    liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
    setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    setLiveLogs(true);
    void refreshLogs(selected);
  }, [selected, refreshLogs]);

  useEffect(() => {
    if (!selected || !liveLogs) return;
    // Safety feature: live polling stops itself after five minutes so an unattended modal cannot keep issuing SSH log requests.
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((liveLogsExpireAt.current - Date.now()) / 1_000));
      setLiveLogSecondsLeft(remaining);
      if (remaining === 0) setLiveLogs(false);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [selected, liveLogs]);

  useEffect(() => {
    if (!selected || !liveLogs) return;
    // Feature: live mode polls journalctl frequently without leaving a remote SSH process behind.
    const timer = window.setInterval(() => void refreshLogs(selected, true), LIVE_LOG_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [selected, liveLogs, refreshLogs]);

  const matchOffsets = useMemo(() => {
    if (!searchQuery) return [];
    const source = logs.toLocaleLowerCase();
    const query = searchQuery.toLocaleLowerCase();
    const offsets: number[] = [];
    let cursor = 0;
    while (cursor <= source.length - query.length) {
      const found = source.indexOf(query, cursor);
      if (found === -1) break;
      offsets.push(found);
      cursor = found + Math.max(query.length, 1);
    }
    return offsets;
  }, [logs, searchQuery]);

  const highlightedLogs = useMemo(() => {
    if (!searchQuery || matchOffsets.length === 0) return logs;
    const pieces: React.ReactNode[] = [];
    let cursor = 0;
    matchOffsets.forEach((offset, index) => {
      pieces.push(logs.slice(cursor, offset));
      pieces.push(
        <mark
          className={index === currentMatch ? "current-match" : ""}
          key={`${offset}-${index}`}
          ref={(element) => {
            if (element) matchRefs.current.set(index, element);
            else matchRefs.current.delete(index);
          }}
        >
          {logs.slice(offset, offset + searchQuery.length)}
        </mark>,
      );
      cursor = offset + searchQuery.length;
    });
    pieces.push(logs.slice(cursor));
    return pieces;
  }, [currentMatch, logs, matchOffsets, searchQuery]);

  useEffect(() => {
    // Feature: opening or refreshing logs starts at the newest journal entry, matching terminal tail behavior.
    if (!logsLoading && !searchQuery && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, logsLoading, searchQuery]);

  useEffect(() => {
    if (matchOffsets.length === 0) {
      setCurrentMatch(0);
      return;
    }
    if (currentMatch >= matchOffsets.length) setCurrentMatch(0);
  }, [currentMatch, matchOffsets.length]);

  useEffect(() => {
    matchRefs.current.get(currentMatch)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatch, highlightedLogs]);

  useEffect(() => {
    if (!selected) return;
    // Feature: Cmd/Ctrl+F focuses Cabin's log search instead of the WebView browser search.
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [selected]);

  async function runAction(service: ServiceStatus, action: "start" | "stop" | "restart") {
    const verb = action === "start" ? "start" : action === "stop" ? "stop" : "restart";
    // Safety feature: service mutations require explicit confirmation.
    if (!window.confirm(`Are you sure you want to ${verb} ${service.name}?`)) return;

    setBusyUnit(service.unit);
    try {
      const message = await invoke<string>("service_action", {
        serverId: activeServerId,
        unit: service.unit,
        action,
      });
      setNotice({ kind: "success", message });
      await refreshServices();
      if (selected?.unit === service.unit) await refreshLogs(service);
    } catch (error) {
      setNotice({ kind: "error", message: String(error) });
    } finally {
      setBusyUnit(null);
    }
  }

  function moveMatch(direction: 1 | -1) {
    if (matchOffsets.length === 0) return;
    setCurrentMatch((value) => (value + direction + matchOffsets.length) % matchOffsets.length);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      setSearchQuery("");
      searchInputRef.current?.blur();
    }
  }

  function closeLogs() {
    setLiveLogs(false);
    setSelected(null);
  }

  function setLiveLogsEnabled(enabled: boolean) {
    // Feature: manually enabling Live always grants a complete five-minute session instead of reusing an expired deadline.
    if (enabled) {
      liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
      setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    }
    setLiveLogs(enabled);
  }

  function refreshLiveLogTimer() {
    // Feature: the timer control renews Live mode to exactly five minutes, including after automatic shutdown.
    liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
    setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    setLiveLogs(true);
  }

  function selectServer(serverId: string) {
    if (serverId === activeServerId) return;
    // Feature: switching servers clears stale process/log state before the next isolated SSH refresh.
    closeLogs();
    hasLoaded.current = false;
    setServices([]);
    setNotice(null);
    setLoading(true);
    setActiveServerId(serverId);
  }

  const activeCount = services.filter((service) => service.activeState === "active").length;
  const failedCount = services.filter((service) => service.activeState === "failed").length;
  const countdown = `0:${secondsToRefresh.toString().padStart(2, "0")}`;
  // Feature: display the Live deadline as a stable mm:ss countdown for quick scanning.
  const liveLogCountdown = `${Math.floor(liveLogSecondsLeft / 60)}:${(liveLogSecondsLeft % 60).toString().padStart(2, "0")}`;
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, ServiceStatus[]>();
    services.forEach((service) => {
      const state = getServiceGroup(service);
      groups.set(state, [...(groups.get(state) ?? []), service]);
    });

    // Feature: keep Running and Dead predictable, then append any additional states alphabetically.
    const priority = (state: string) => state === "running" ? 0 : state === "dead" ? 1 : 2;
    return [...groups.entries()]
      .sort(([left], [right]) => priority(left) - priority(right) || left.localeCompare(right))
      .map(([state, groupedServices]) => ({ state, services: groupedServices }));
  }, [services]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="server-navigation">
          <p className="eyebrow">Servers</p>
          <nav className="server-switcher" aria-label="Managed servers">
            {servers.map((server) => (
              <button
                className={`server-tab ${server.id === activeServerId ? "active" : ""}`}
                key={server.id}
                onClick={() => selectServer(server.id)}
                aria-pressed={server.id === activeServerId}
              >
                <span className="server-tab-dot" />
                <span className="server-tab-copy">
                  <strong>{server.name}</strong>
                  <small>{server.host}</small>
                </span>
                <span className="server-service-count">{server.serviceCount}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="refresh-group">
          <span>Auto refresh in {countdown}</span>
          <button className="refresh-button" onClick={() => void refreshServices()} disabled={refreshing}>
            <span className={refreshing ? "spin" : ""}>↻</span>
            {refreshing ? "Refreshing" : "Refresh now"}
          </button>
        </div>
      </header>

      <section className="summary" aria-label="Service overview">
        <div><strong>{services.length}</strong><span>services</span></div>
        <div><strong className="green">{activeCount}</strong><span>active</span></div>
        <div><strong className={failedCount ? "red" : ""}>{failedCount}</strong><span>failed</span></div>
      </section>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Connecting to the server…</div>
      ) : services.length === 0 ? (
        // UX fix: empty servers stay informational because services are managed only through Rust code.
        <section className="empty-server">
          <p className="eyebrow">{activeServer?.host}</p>
          <h2>No services configured</h2>
          <p>This server is available in Cabin and ready for its first whitelisted systemd process.</p>
          <code>root@{activeServer?.host}</code>
        </section>
      ) : (
        <div className="service-sections">
          {serviceGroups.map((group) => (
            <section className={`service-section state-${group.state}`} key={group.state}>
              <header className="section-heading">
                <span className="section-state-dot" />
                <h2>{formatGroupName(group.state)}</h2>
                <span className="section-count">{group.services.length}</span>
                <span className="section-rule" />
              </header>
              <div className="service-grid">
                {group.services.map((service) => {
                  const isActive = service.activeState === "active";
                  const isFailed = service.activeState === "failed";
                  const canStop = canStopService(service);
                  const isBusy = busyUnit === service.unit;
                  const logsAreOpen = selected?.unit === service.unit;
                  return (
                    <article className="service-card" key={service.unit}>
                      <div className="card-heading">
                        <span className={`status-dot ${isActive ? "active" : isFailed ? "failed" : "inactive"}`} />
                        <div>
                          <h2>{service.name}</h2>
                          <p>{service.description}</p>
                        </div>
                        <span className={`status-label ${isActive ? "active" : isFailed ? "failed" : "inactive"}`}>
                          {service.subState}
                        </span>
                      </div>

                      <dl className="metadata">
                        <div><dt>State</dt><dd>{service.activeState}</dd></div>
                        <div><dt>PID</dt><dd>{service.mainPid === "0" ? "—" : service.mainPid}</dd></div>
                        <div><dt>Active since</dt><dd>{service.activeSince || "—"}</dd></div>
                      </dl>

                      {service.loadState === "not-found" && (
                        <p className="unit-warning">Unit {service.unit} was not found. Check its configured name.</p>
                      )}

                      <div className="actions">
                        <button
                          className="logs-button"
                          disabled={logsAreOpen}
                          onClick={() => setSelected(service)}
                        >
                          {logsAreOpen ? "Logs open" : "Logs"}
                        </button>
                        {canStop ? (
                          <button className="stop-button" disabled={isBusy} onClick={() => void runAction(service, "stop")}>Stop</button>
                        ) : (
                          <button className="start-button" disabled={isBusy} onClick={() => void runAction(service, "start")}>Start</button>
                        )}
                        <button className="restart-button" disabled={isBusy || !isActive} onClick={() => void runAction(service, "restart")}>
                          {isBusy ? "Working…" : "Restart"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedService && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeLogs()}>
          <section className="logs-modal" role="dialog" aria-modal="true" aria-labelledby="logs-title">
            <header className="logs-header">
              <div className="logs-title"><p>journalctl · latest 500 lines</p><h2 id="logs-title">{selectedService.name}</h2></div>
              <div className="log-tools">
                <label className="live-toggle">
                  <input type="checkbox" checked={liveLogs} onChange={(event) => setLiveLogsEnabled(event.currentTarget.checked)} />
                  <span className="live-indicator" />
                  Live
                </label>
                <div className={`live-timer ${liveLogs ? "active" : "expired"}`} aria-live="polite">
                  <span>{liveLogCountdown}</span>
                  <button type="button" onClick={refreshLiveLogTimer}>Reset 5:00</button>
                </div>
                <div className="log-search" role="search">
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => { setSearchQuery(event.currentTarget.value); setCurrentMatch(0); }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Find in logs"
                    aria-label="Find in logs"
                  />
                  <span className="match-count">{searchQuery ? `${matchOffsets.length ? currentMatch + 1 : 0}/${matchOffsets.length}` : "—/—"}</span>
                  <button onClick={() => moveMatch(-1)} disabled={!matchOffsets.length} aria-label="Previous match">⌃</button>
                  <button onClick={() => moveMatch(1)} disabled={!matchOffsets.length} aria-label="Next match">⌄</button>
                  <button onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }} aria-label="Clear search">×</button>
                </div>
                <button className="icon-button" onClick={() => void refreshLogs(selectedService)} aria-label="Refresh logs">↻</button>
                <button className="icon-button close-button" onClick={closeLogs} aria-label="Close logs">×</button>
              </div>
            </header>
            <div className="logs-workspace">
              <pre ref={logsContainerRef} className={logsLoading ? "loading" : ""}>
                {logsLoading ? "Loading logs…" : highlightedLogs}
              </pre>
              <aside className="process-panel" aria-label={`${selectedService.name} process controls`}>
                <div className="process-panel-heading">
                  <span className={`status-dot ${selectedService.activeState === "active" ? "active" : selectedService.activeState === "failed" ? "failed" : "inactive"}`} />
                  <div>
                    <p>Process</p>
                    <h3>{selectedService.name}</h3>
                    <span>{selectedService.description}</span>
                  </div>
                  <span className={`status-label ${selectedService.activeState === "active" ? "active" : selectedService.activeState === "failed" ? "failed" : "inactive"}`}>
                    {selectedService.subState}
                  </span>
                </div>

                <dl className="process-metadata">
                  <div><dt>State</dt><dd>{selectedService.activeState}</dd></div>
                  <div><dt>PID</dt><dd>{selectedService.mainPid === "0" ? "—" : selectedService.mainPid}</dd></div>
                  <div><dt>Active since</dt><dd>{selectedService.activeSince || "—"}</dd></div>
                  <div><dt>Unit</dt><dd>{selectedService.unit}</dd></div>
                </dl>

                {selectedService.loadState === "not-found" && (
                  <p className="unit-warning">This systemd unit was not found.</p>
                )}

                <div className="process-actions">
                  {canStopService(selectedService) ? (
                    <button
                      className="stop-button"
                      disabled={busyUnit === selectedService.unit}
                      onClick={() => void runAction(selectedService, "stop")}
                    >
                      Stop process
                    </button>
                  ) : (
                    <button
                      className="start-button"
                      disabled={busyUnit === selectedService.unit}
                      onClick={() => void runAction(selectedService, "start")}
                    >
                      Start process
                    </button>
                  )}
                  <button
                    className="restart-button"
                    disabled={busyUnit === selectedService.unit || selectedService.activeState !== "active"}
                    onClick={() => void runAction(selectedService, "restart")}
                  >
                    {busyUnit === selectedService.unit ? "Working…" : "Restart process"}
                  </button>
                </div>
                <p className="process-note">Actions refresh both the process state and live journal output.</p>
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
