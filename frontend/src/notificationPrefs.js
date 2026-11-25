const BASE_KEY = "gst-notification-preferences";

export const DEFAULT_NOTIFICATION_PREFS = {
  popup: true,
  sound: true,
  desktop: true,
  quietHours: false,
  quietFrom: "22:00",
  quietTo: "08:00",
  maxPopups: 3,
};

function keyFor(userId) {
  return `${BASE_KEY}:${userId || "shared"}`;
}

export function loadNotificationPrefs(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    return raw ? { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_NOTIFICATION_PREFS };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export function saveNotificationPrefs(userId, prefs) {
  const next = { ...DEFAULT_NOTIFICATION_PREFS, ...prefs };
  localStorage.setItem(keyFor(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("gst:notification-prefs-changed", { detail: next }));
  return next;
}

export function resetNotificationPrefs(userId) {
  localStorage.removeItem(keyFor(userId));
  const next = { ...DEFAULT_NOTIFICATION_PREFS };
  window.dispatchEvent(new CustomEvent("gst:notification-prefs-changed", { detail: next }));
  return next;
}

function minutes(value) {
  const [hours, mins] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (mins || 0);
}

export function isQuietTime(prefs, now = new Date()) {
  if (!prefs.quietHours) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(prefs.quietFrom);
  const end = minutes(prefs.quietTo);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}
