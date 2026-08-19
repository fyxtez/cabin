export type ServiceStatus = {
  name: string;
  unit: string;
  description: string;
  loadState: string;
  activeState: string;
  subState: string;
  activeSince: string;
  mainPid: string;
};

export type ServerInfo = {
  id: string;
  name: string;
  host: string;
  serviceCount: number | null;
};

export type Notice = { kind: "success" | "error"; message: string } | null;
export type SshCredentials = { username: string; privateKey: string };
export type ServiceAction = "start" | "stop" | "restart";
