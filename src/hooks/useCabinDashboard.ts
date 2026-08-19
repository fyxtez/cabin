import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Notice, ServerInfo, ServiceAction, ServiceStatus, SshCredentials } from "../types/cabin";
import { getServiceGroup } from "../utils/services";

const STATUS_REFRESH_SECONDS = 60;
const LIVE_LOG_REFRESH_MS = 1_500;
const LIVE_LOG_TIMEOUT_SECONDS = 5 * 60;

export function useCabinDashboard() {
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
  const [notice, setNotice] = useState<Notice>(null);
  const [sshConfigured, setSshConfigured] = useState<boolean | null>(null);
  const [showSshSettings, setShowSshSettings] = useState(false);
  const [sshForm, setSshForm] = useState<SshCredentials>({ username: "root", privateKey: "" });
  const [savingSsh, setSavingSsh] = useState(false);
  const [sshError, setSshError] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const nextRefreshAt = useRef(Date.now() + STATUS_REFRESH_SECONDS * 1_000);
  const liveLogsExpireAt = useRef(Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000);

  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;
  const selectedService = selected ? services.find((service) => service.unit === selected.unit) ?? selected : null;

  const refreshServices = useCallback(async () => {
    if (!activeServerId || sshConfigured !== true) return;
    hasLoaded.current ? setRefreshing(true) : setLoading(true);
    nextRefreshAt.current = Date.now() + STATUS_REFRESH_SECONDS * 1_000;
    setSecondsToRefresh(STATUS_REFRESH_SECONDS);
    try {
      const result = await invoke<ServiceStatus[]>("get_services", { serverId: activeServerId });
      setServices(result);
      // Auto-discovery feature: keep the server badge synchronized with the latest /opt scan.
      setServers((current) => current.map((server) => (
        server.id === activeServerId ? { ...server, serviceCount: result.length } : server
      )));
      setNotice(null);
      hasLoaded.current = true;
    } catch (error) {
      // Reliability fix: retain the last known states when a temporary SSH refresh fails.
      setNotice({ kind: "error", message: String(error) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeServerId, sshConfigured]);

  const refreshLogs = useCallback(async (service: ServiceStatus, quiet = false) => {
    if (!activeServerId) return;
    if (!quiet) setLogsLoading(true);
    try {
      const result = await invoke<string>("get_logs", { serverId: activeServerId, unit: service.unit, lines: 500 });
      setLogs(result || "No logs are available for this service.");
    } catch (error) {
      setLogs(`Could not load logs:\n${String(error)}`);
    } finally {
      setLogsLoading(false);
    }
  }, [activeServerId]);

  useEffect(() => {
    // Feature: server metadata comes from Rust so UI labels and the backend allowlist stay aligned.
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
    // Mobile feature: check per-device credentials before any SSH request for the selected server.
    setSshConfigured(null);
    void invoke<boolean>("has_ssh_credentials", { serverId: activeServerId })
      .then((configured) => {
        setSshConfigured(configured);
        if (!configured) {
          setNotice(null);
          setSshError(null);
          setLoading(false);
          setShowSshSettings(true);
        }
      })
      .catch((error) => {
        setLoading(false);
        setNotice({ kind: "error", message: String(error) });
      });
  }, [activeServerId]);

  useEffect(() => {
    if (!activeServerId || sshConfigured !== true) return;
    void refreshServices();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextRefreshAt.current - Date.now()) / 1_000));
      setSecondsToRefresh(remaining);
      // Reliability fix: trigger refresh outside a state updater so React Strict Mode cannot duplicate the request.
      if (remaining === 0) void refreshServices();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeServerId, refreshServices, sshConfigured]);

  useEffect(() => {
    if (!selected) return;
    setLogs("");
    liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
    setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    setLiveLogs(true);
    void refreshLogs(selected);
  }, [selected, refreshLogs]);

  useEffect(() => {
    if (!selected || !liveLogs) return;
    // Safety feature: unattended live polling stops automatically after five minutes.
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((liveLogsExpireAt.current - Date.now()) / 1_000));
      setLiveLogSecondsLeft(remaining);
      if (remaining === 0) setLiveLogs(false);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [selected, liveLogs]);

  useEffect(() => {
    if (!selected || !liveLogs) return;
    // Feature: live mode polls journalctl without leaving a remote SSH process running.
    const timer = window.setInterval(() => void refreshLogs(selected, true), LIVE_LOG_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [selected, liveLogs, refreshLogs]);

  async function runAction(service: ServiceStatus, action: ServiceAction) {
    if (!window.confirm(`Are you sure you want to ${action} ${service.name}?`)) return;
    setBusyUnit(service.unit);
    try {
      const message = await invoke<string>("service_action", { serverId: activeServerId, unit: service.unit, action });
      setNotice({ kind: "success", message });
      await refreshServices();
      if (selected?.unit === service.unit) await refreshLogs(service);
    } catch (error) {
      setNotice({ kind: "error", message: String(error) });
    } finally {
      setBusyUnit(null);
    }
  }

  function closeLogs() {
    setLiveLogs(false);
    setSelected(null);
  }

  function setLiveLogsEnabled(enabled: boolean) {
    // Feature: manually enabling Live always grants a complete five-minute session.
    if (enabled) {
      liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
      setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    }
    setLiveLogs(enabled);
  }

  function refreshLiveLogTimer() {
    // Feature: reset renews Live mode to exactly five minutes, including after automatic shutdown.
    liveLogsExpireAt.current = Date.now() + LIVE_LOG_TIMEOUT_SECONDS * 1_000;
    setLiveLogSecondsLeft(LIVE_LOG_TIMEOUT_SECONDS);
    setLiveLogs(true);
  }

  function selectServer(serverId: string) {
    if (serverId === activeServerId) return;
    closeLogs();
    hasLoaded.current = false;
    setServices([]);
    setNotice(null);
    setLoading(true);
    setActiveServerId(serverId);
  }

  function openSshSettings() {
    setNotice(null);
    setSshError(null);
    setShowSshSettings(true);
  }

  function closeSshSettings() {
    setSshError(null);
    setShowSshSettings(false);
  }

  async function saveSshSettings() {
    if (!activeServerId) return;
    setSshError(null);
    setSavingSsh(true);
    try {
      await invoke("save_ssh_credentials", { serverId: activeServerId, credentials: sshForm });
      setSshConfigured(true);
      setShowSshSettings(false);
      setSshForm((current) => ({ ...current, privateKey: "" }));
      setNotice({ kind: "success", message: "SSH connection verified and saved on this device." });
    } catch (error) {
      setSshError(String(error));
    } finally {
      setSavingSsh(false);
    }
  }

  const serviceGroups = useMemo(() => {
    const groups = new Map<string, ServiceStatus[]>();
    services.forEach((service) => {
      const state = getServiceGroup(service);
      groups.set(state, [...(groups.get(state) ?? []), service]);
    });
    const priority = (state: string) => state === "running" ? 0 : state === "dead" ? 1 : 2;
    return [...groups.entries()]
      .sort(([left], [right]) => priority(left) - priority(right) || left.localeCompare(right))
      .map(([state, groupedServices]) => ({ state, services: groupedServices }));
  }, [services]);

  return {
    servers, activeServerId, activeServer, services, loading, refreshing, secondsToRefresh,
    busyUnit, selected, selectedService, logs, logsLoading, liveLogs, liveLogSecondsLeft,
    notice, sshConfigured, showSshSettings, sshForm, savingSsh, sshError, serviceGroups,
    activeCount: services.filter((service) => service.activeState === "active").length,
    failedCount: services.filter((service) => service.activeState === "failed").length,
    selectServer, refreshServices, setSelected, refreshLogs, runAction, closeLogs,
    setLiveLogsEnabled, refreshLiveLogTimer, setNotice, openSshSettings, closeSshSettings,
    setSshForm, setSshError, saveSshSettings,
  };
}
