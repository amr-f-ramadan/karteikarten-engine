// Tägliche Erinnerung: Web Push über den Service Worker der App; Uhrzeit und Abo stehen in push.json (Branch progress).
import { $ } from "../ui/dom.js";

export function createPush({ T, vapid, local, github, getToken, flash, render }) {
  const RK = local.key("remind");
  let rem = { on: false, hour: 19, min: 0 }; try { rem = Object.assign(rem, JSON.parse(local.get(RK) || "{}")); } catch (e) {}
  let busy = false;
  const standalone = () => (navigator.standalone === true) || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const u8 = b => { const p = "=".repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, ch => ch.charCodeAt(0)); };

  async function enable(on) {
    if (busy) return;
    if (!getToken()) { flash(T("remNeedTok")); return; }
    const hr = $("#remHour"); if (hr) { const v = parseInt(hr.value, 10); rem.hour = Math.floor(v / 60); rem.min = v % 60; }
    busy = true; render();
    try {
      let sub = null;
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("denied");
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(vapid) });
      }
      await github.putProgressFile("push.json", { enabled: on, hour: rem.hour, minute: rem.min || 0, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin", sub: sub ? sub.toJSON() : null, updated: new Date().toISOString() });
      rem.on = on; local.set(RK, JSON.stringify(rem));
      flash(T("remDone"));
    } catch (e) { flash(e.message === "denied" ? T("remDenied") : T("remFail") + " (" + e.message + ")"); }
    busy = false; render();
  }
  async function test() {
    try {
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") { flash(T("remDenied")); return; }
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(T("appName"), { body: T("remTestBody"), tag: "test" });
    } catch (e) { flash(T("remFail") + " (" + e.message + ")"); }
  }
  return { get rem() { return rem; }, get busy() { return busy; }, enable, test, standalone, canPush };
}
