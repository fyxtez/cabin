import type { ServerInfo } from "../../types/cabin";
import "./TopBar.css";

type Props = {
  servers: ServerInfo[];
  activeServerId: string;
  refreshing: boolean;
  secondsToRefresh: number;
  onSelectServer: (serverId: string) => void;
  onOpenSshSettings: () => void;
  onRefresh: () => void;
};

export function TopBar({ servers, activeServerId, refreshing, secondsToRefresh, onSelectServer, onOpenSshSettings, onRefresh }: Props) {
  const countdown = `0:${secondsToRefresh.toString().padStart(2, "0")}`;
  return (
    <header className="topbar">
      <div className="server-navigation">
        <p className="eyebrow">Servers</p>
        <nav className="server-switcher" aria-label="Managed servers">
          {servers.map((server) => (
            <button className={`server-tab ${server.id === activeServerId ? "active" : ""}`} key={server.id} onClick={() => onSelectServer(server.id)} aria-pressed={server.id === activeServerId}>
              <span className="server-tab-dot" />
              <span className="server-tab-copy"><strong>{server.name}</strong><small>{server.host}</small></span>
              <span className="server-service-count">{server.serviceCount ?? "—"}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="refresh-group">
        <span>Auto refresh in {countdown}</span>
        <button className="ssh-settings-button" onClick={onOpenSshSettings}>SSH settings</button>
        <button className="refresh-button" onClick={onRefresh} disabled={refreshing}>
          <span className={refreshing ? "spin" : ""}>↻</span>{refreshing ? "Refreshing" : "Refresh now"}
        </button>
      </div>
    </header>
  );
}
