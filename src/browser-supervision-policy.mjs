export const PERSISTENT_BROWSER_SUPERVISION_POLICY = Object.freeze({
  id: "persistent-browser-split-runtime-v1",
  backend: "playwright-persistent",
  appliesTo: ["chatgpt-web-image2", "tiktok-monitoring"],
  preparation: [
    "Reuse one shared source profile and clone dedicated automation-owned run profiles per task.",
    "Run TikTok monitoring in headless mode and ChatGPT web image work in headed mode so both can operate at the same time."
  ],
  operationMode: "openclaw-profile-clone-with-split-visibility",
  stepLimits: {
    maxSingleBrowserActionMs: 15000,
    maxPollWindowMs: 30000,
    pollIntervalMs: 2000,
    maxConsecutiveTimeoutsBeforeRecovery: 1
  },
  inspectionOrder: [
    "Read DOM snapshots or targeted element attributes first.",
    "Use page-visible media and download flows before screenshots.",
    "Use visible screenshots only as a final spot-check or human handoff aid.",
    "Avoid full-page screenshots on image-heavy ChatGPT conversations."
  ],
  downloadOrder: [
    "ChatGPT headed persistent session download",
    "recursive download-collector snapshot and move",
    "coordinate clicks only after logging that semantic or direct download controls were unavailable"
  ],
  checkpointing: [
    "Record each prompt submission, DOM/media read, accepted image, download move, timeout, and recovery in review logs.",
    "Keep the headed ChatGPT window open for human review while TikTok monitoring continues in its own headless run profile."
  ],
  chatgptWeb: {
    mode: "headed-persistent-session",
    rule: "Use a visible persistent Chrome session for ChatGPT image generation, human review, and downloads."
  },
  tiktokMonitoring: {
    mode: "headless-persistent-session",
    rule: "Use short DOM reads and targeted metadata checks for TikTok monitoring pages; keep monitoring in its own headless run profile."
  }
});

export const CHROME_SUPERVISION_POLICY = PERSISTENT_BROWSER_SUPERVISION_POLICY;

export function browserSupervisionPolicySummary() {
  return {
    id: PERSISTENT_BROWSER_SUPERVISION_POLICY.id,
    backend: PERSISTENT_BROWSER_SUPERVISION_POLICY.backend,
    appliesTo: [...PERSISTENT_BROWSER_SUPERVISION_POLICY.appliesTo],
    operationMode: PERSISTENT_BROWSER_SUPERVISION_POLICY.operationMode,
    stepLimits: { ...PERSISTENT_BROWSER_SUPERVISION_POLICY.stepLimits },
    inspectionOrder: [...PERSISTENT_BROWSER_SUPERVISION_POLICY.inspectionOrder],
    downloadOrder: [...PERSISTENT_BROWSER_SUPERVISION_POLICY.downloadOrder],
    chatgptWeb: { ...PERSISTENT_BROWSER_SUPERVISION_POLICY.chatgptWeb },
    tiktokMonitoring: { ...PERSISTENT_BROWSER_SUPERVISION_POLICY.tiktokMonitoring }
  };
}
