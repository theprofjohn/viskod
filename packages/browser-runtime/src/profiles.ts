export type CaptureProfile = 'default' | 'debug' | 'audit';

export interface ProfileConfig {
  collectConsole: boolean;
  collectNetwork: boolean;
  collectScreenshot: boolean;
  collectSelectedElement: boolean;
  collectDOM: boolean;
  collectStyles: boolean;
  collectHierarchy: boolean;
  collectSourceHints: boolean;
  enableRedaction: boolean;
  maxConsoleEntries: number;
  maxNetworkEntries: number;
  maxMessageLength: number;
}

export const PROFILES: Record<CaptureProfile, ProfileConfig> = {
  default: {
    collectConsole: true,
    collectNetwork: false,
    collectScreenshot: true,
    collectSelectedElement: true,
    collectDOM: true,
    collectStyles: true,
    collectHierarchy: true,
    collectSourceHints: true,
    enableRedaction: true,
    maxConsoleEntries: 50,
    maxNetworkEntries: 30,
    maxMessageLength: 2000,
  },
  debug: {
    collectConsole: true,
    collectNetwork: true,
    collectScreenshot: true,
    collectSelectedElement: true,
    collectDOM: true,
    collectStyles: true,
    collectHierarchy: true,
    collectSourceHints: true,
    enableRedaction: true,
    maxConsoleEntries: 200,
    maxNetworkEntries: 100,
    maxMessageLength: 5000,
  },
  audit: {
    collectConsole: true,
    collectNetwork: true,
    collectScreenshot: false,
    collectSelectedElement: true,
    collectDOM: true,
    collectStyles: true,
    collectHierarchy: true,
    collectSourceHints: false,
    enableRedaction: false,
    maxConsoleEntries: 500,
    maxNetworkEntries: 200,
    maxMessageLength: 10000,
  },
};

export function resolveProfile(name: string): ProfileConfig {
  const profile = PROFILES[name as CaptureProfile];
  if (profile) return profile;
  return PROFILES.default;
}
