// Optionen: GitHub-Sync, Erinnerung, Gemini-Key, Sicherung, Lernoptionen, Zurücksetzen.
import { today, hhmm } from "../../core/text.js";
import { emptyP, merge } from "../../core/progress.js";
import { $ } from "../dom.js";

export function createSettingsView(ctx) {
  const { S, T, C, local, github, push, session, flash } = ctx, PH = C.phrases || null;
  const TK = local.key("token"), GK = local.key("gemini");

  function exportFile() {
    const blob = new Blob([JSON.stringify(S.P, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = C.key + "-" + today() + ".json";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importFile(f) {
    const r = new FileReader();
    r.onload = () => {
      try { const p = JSON.parse(r.result); if (!p || p.v !== 1) throw 0; S.P = merge(S.P, p); ctx.changed(); flash(T("imported")); session.restart(); }
      catch (e) { flash(T("importFail")); }
    };
    r.readAsText(f);
  }
  function renderRem() {
    const rem = push.rem, sel = rem.hour * 60 + (rem.min || 0);
    const hours = Array.from({ length: 96 }, (_, i) => `<option value="${i * 15}" ${i * 15 === sel ? "selected" : ""}>${hhmm(Math.floor(i / 4), (i % 4) * 15)}</option>`).join("");
    let body;
    if (!push.canPush() || !push.standalone()) body = `<p class="dim">${T("remNoApp")}</p>`;
    else body = `<p><span id="remDot" data-on="${rem.on}"></span> ${rem.on ? T("remActive").replace("{h}", hhmm(rem.hour, rem.min)) : T("remInactive")}</p>
      <label class="fld inline">${T("remHour")} <select id="remHour">${hours}</select></label>
      <div class="row2">${rem.on
        ? `<button class="btn" data-act="remon" ${push.busy ? "disabled" : ""}>${T("remSave")}</button><button class="btn" data-act="remoff" ${push.busy ? "disabled" : ""}>${T("remOff")}</button>`
        : `<button class="btn ok" data-act="remon" ${push.busy ? "disabled" : ""}>${T("remOn")}</button>`}</div>
      <button class="btn wide" data-act="remtest">${T("remTest")}</button>`;
    return `<h2>${T("remH")}</h2><p class="dim">${T("remHelp")}</p>${body}`;
  }
  function render() {
    const st = S.sync.status;
    return `<div class="settings">
      <h2>${T("syncH")}</h2>
      <p class="dim">${T("syncHelp")}</p>
      <p><span id="syncDot" data-s="${st}"></span> <span id="syncState">${T("st_" + st)}</span></p>
      ${S.sync.token
        ? `<div class="row2"><button class="btn" data-act="syncnow">${T("syncNow")}</button><button class="btn" data-act="deltoken">${T("delToken")}</button></div>`
        : `<label class="fld">${T("tokenLabel")}<input id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
           <button class="btn ok" data-act="savetoken">${T("saveToken")}</button>`}
      ${renderRem()}
      <h2>${T("gemH")}</h2>
      <p class="dim">${T("gemHelp")}</p>
      ${S.gkey
        ? `<p><span id="gemDot"></span> ${T("gemSet")}</p><button class="btn" data-act="delgem">${T("gemDel")}</button>`
        : `<label class="fld">${T("gemLabel")}<input id="gem" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…"></label>
           <button class="btn ok" data-act="savegem">${T("gemSave")}</button>`}
      <h2>${T("backupH")}</h2>
      <div class="row2"><button class="btn" data-act="export">${T("export")}</button>
      <label class="btn filebtn">${T("import")}<input id="imp" type="file" accept="application/json,.json"></label></div>
      <h2>${T("optsH")}</h2>
      <label class="fld inline">${T("newPerDay")} <input id="npd" type="number" min="0" max="50" value="${ctx.opt("newPerDay", C.newPerDay || 10)}"></label>
      ${PH ? `<label class="fld inline">${T("newPhrases")} <input id="nppd" type="number" min="0" max="20" value="${ctx.opt("newPhrases", PH.perDay || 3)}"></label>` : ""}
      <label class="chk"><input id="pda" type="checkbox" ${ctx.opt("prodAuto", true) ? "checked" : ""}> ${T("prodAuto")}</label>
      <label class="chk"><input id="arf" type="checkbox" ${ctx.opt("arFirst", false) ? "checked" : ""}> ${T("arFirst")}</label>
      <label class="chk"><input id="gvo" type="checkbox" ${ctx.opt("gvoice", true) ? "checked" : ""}> ${T("gvoice")}</label>
      <label class="chk"><input id="slw" type="checkbox" ${ctx.opt("slow", false) ? "checked" : ""}> ${T("slow")}</label>
      <h2>${T("resetH")}</h2>
      <button class="btn again" data-act="reset">${T("reset")}</button>
    </div>`;
  }
  const num = (v, max) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
  return {
    mode: "settings", render,
    actions: {
      savetoken: () => {
        const v = ($("#tok").value || "").trim(); if (!v) return;
        S.sync.token = v; local.set(TK, v);
        ctx.sync.sync(true).then(() => flash(S.sync.status === "ok" ? T("tokenOk") : T("st_" + S.sync.status)));
      },
      deltoken: () => { S.sync.token = ""; github.forget(); local.remove(TK); ctx.sync.setStatus("local"); ctx.render(); },
      syncnow: () => ctx.sync.sync(true).then(() => flash(T("st_" + S.sync.status))),
      export: exportFile,
      remon: () => push.enable(true),
      remoff: () => push.enable(false),
      remtest: () => push.test(),
      savegem: () => { const v = ($("#gem").value || "").trim(); if (!v) return; S.gkey = v; local.set(GK, v); flash(T("gemSet")); ctx.render(); },
      delgem: () => { S.gkey = ""; local.remove(GK); ctx.render(); },
      reset: () => { if (confirm(T("resetQ"))) { S.P = Object.assign(emptyP(), { opts: S.P.opts }); ctx.changed(); session.restart(); } }
    },
    change: {
      imp: el => { if (el.files[0]) importFile(el.files[0]); },
      npd: el => { ctx.setOpt("newPerDay", num(el.value, 50)); session.ensureCur(); },
      nppd: el => { ctx.setOpt("newPhrases", num(el.value, 20)); session.ensureCur(); },
      arf: el => ctx.setOpt("arFirst", el.checked),
      slw: el => ctx.setOpt("slow", el.checked),
      gvo: el => ctx.setOpt("gvoice", el.checked),
      pda: el => ctx.setOpt("prodAuto", el.checked)
    }
  };
}
