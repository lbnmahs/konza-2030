// K8 settings. Per device only: nothing here is sent to the backend or
// stored with a case. Apart from Settings.tsx so the settings view can load on demand (the /sia
// first-load budget).

export type Prefs = {
  theme: "system" | "light" | "dark";
  captions: boolean;
  volume: number;
  motion: "system" | "on";
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  captions: true,
  volume: 80,
  motion: "system",
};
