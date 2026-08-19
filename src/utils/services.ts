import type { ServiceStatus } from "../types/cabin";

export function getServiceGroup(service: ServiceStatus) {
  // Feature: normalize common systemd combinations into predictable Running and Dead groups.
  if (service.activeState === "active" && service.subState === "running") return "running";
  if (
    service.activeState === "failed" ||
    service.activeState === "inactive" ||
    service.subState === "failed" ||
    service.subState === "dead"
  ) return "dead";

  // Feature: preserve uncommon systemd states so activating, exited, reloading, and others remain visible.
  return service.subState !== "unknown" ? service.subState : service.activeState;
}

export function formatGroupName(state: string) {
  // Compatibility fix: regex replacement works with the project's current TypeScript target.
  return state.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canStopService(service: ServiceStatus) {
  // Reliability fix: transitional running states must offer Stop instead of Start.
  return ["active", "activating", "reloading", "deactivating"].includes(service.activeState);
}

export function getStatusTone(service: ServiceStatus) {
  if (service.activeState === "active") return "active";
  if (service.activeState === "failed") return "failed";
  return "inactive";
}
