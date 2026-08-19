import "./styles/global.css";
import "./App.css";
import { EmptyServer } from "./components/EmptyServer/EmptyServer";
import { LogsModal } from "./components/LogsModal/LogsModal";
import { NoticeBanner } from "./components/NoticeBanner/NoticeBanner";
import { ServiceSections } from "./components/ServiceSections/ServiceSections";
import { SshSettingsModal } from "./components/SshSettingsModal/SshSettingsModal";
import { Summary } from "./components/Summary/Summary";
import { TopBar } from "./components/TopBar/TopBar";
import { useCabinDashboard } from "./hooks/useCabinDashboard";

function App() {
  const cabin = useCabinDashboard();

  return (
    <main className="app-shell">
      <TopBar servers={cabin.servers} activeServerId={cabin.activeServerId} refreshing={cabin.refreshing} secondsToRefresh={cabin.secondsToRefresh} onSelectServer={cabin.selectServer} onOpenSshSettings={cabin.openSshSettings} onRefresh={() => void cabin.refreshServices()} />
      <Summary total={cabin.services.length} active={cabin.activeCount} failed={cabin.failedCount} />
      {cabin.notice && <NoticeBanner notice={cabin.notice} onDismiss={() => cabin.setNotice(null)} />}

      {cabin.loading ? (
        <div className="empty-state">Connecting to the server…</div>
      ) : cabin.services.length === 0 ? (
        <EmptyServer server={cabin.activeServer} />
      ) : (
        <ServiceSections groups={cabin.serviceGroups} busyUnit={cabin.busyUnit} selectedUnit={cabin.selected?.unit} onSelect={cabin.setSelected} onAction={(service, action) => void cabin.runAction(service, action)} />
      )}

      {cabin.selectedService && <LogsModal service={cabin.selectedService} logs={cabin.logs} logsLoading={cabin.logsLoading} liveLogs={cabin.liveLogs} liveLogSecondsLeft={cabin.liveLogSecondsLeft} busy={cabin.busyUnit === cabin.selectedService.unit} onClose={cabin.closeLogs} onRefresh={() => void cabin.refreshLogs(cabin.selectedService!)} onSetLive={cabin.setLiveLogsEnabled} onResetLiveTimer={cabin.refreshLiveLogTimer} onAction={(action) => void cabin.runAction(cabin.selectedService!, action)} />}

      {cabin.showSshSettings && cabin.activeServer && <SshSettingsModal server={cabin.activeServer} configured={cabin.sshConfigured} form={cabin.sshForm} saving={cabin.savingSsh} error={cabin.sshError} onChange={cabin.setSshForm} onClearError={() => cabin.setSshError(null)} onClose={cabin.closeSshSettings} onSave={() => void cabin.saveSshSettings()} />}
    </main>
  );
}

export default App;
