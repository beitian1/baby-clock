/* SECTION: core — 存储/时钟/天气/夜灯/锁定/闹钟调度/设置 */
(function () {
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, "0");
const DEVICES = ["clock1", "clock2", "clock3"];
const DEV_EMOJI = { clock1: "👧", clock2: "🧒", clock3: "👦", parent: "👨‍👩‍👧" };
const WMO = {
  0: ["☀️", "晴"], 1: ["🌤️", "晴间多云"], 2: ["⛅", "多云"], 3: ["☁️", "阴"],
  45: ["🌫️", "雾"], 48: ["🌫️", "雾凇"], 51: ["🌦️", "毛毛雨"], 53: ["🌧️", "小雨"],
  55: ["🌧️", "中雨"], 61: ["🌧️", "小雨"], 63: ["🌧️", "中雨"], 65: ["🌧️", "大雨"],
  71: ["🌨️", "小雪"], 73: ["❄️", "中雪"], 75: ["❄️", "大雪"], 80: ["🌦️", "阵雨"],
  81: ["🌧️", "阵雨"], 82: ["⛈️", "强阵雨"], 95: ["⛈️", "雷阵雨"], 96: ["⛈️", "雷暴"], 99: ["⛈️", "雷暴"]
};

function defaults() {
  const dev = {};
  DEVICES.forEach((d) => {
    dev[d] = {
      alarms: [{ id: "a" + Date.now(), time: "07:00", repeat: "weekdays", days: "1,2,3,4,5", ring: "beep", audioId: null, dur: 15 }],
      homework: {},
      timetable: Array.from({ length: 7 }, (_, i) => {
        const base = i < 5 ? ["语文", "数学", "英语", i % 2 ? "科学" : "体育", "音乐", "美术", "阅读", "自习"] : ["自由活动", "课外阅读", "", "", "", "", "", ""];
        return base.slice();
      })
    };
  });
  return {
    mode: "clock1",
    names: { clock1: "姐姐的闹钟", clock2: "妹妹的闹钟", clock3: "弟弟的闹钟" },
    pin: "1234",
    city: "北京",
    night: { start: "21:30", end: "06:30", manual: false },
    audioDur: 15,
    callRoom: "h" + Math.random().toString(36).slice(2, 8),
    dev: dev
  };
}

function load() {
  try {
    const raw = localStorage.getItem("bc_state_v1");
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    return Object.assign(defaults(), d);
  } catch (e) { return defaults(); }
}
const state = load();
/* 首次访问且 URL 带 ?room=xxx 时自动采用该房号（家人点分享链接免手动设置）；已有存档则尊重存档 */
try {
  if (!localStorage.getItem("bc_state_v1")) {
    const r = (new URL(location.href).searchParams.get("room") || "").trim();
    if (r) state.callRoom = r;
  }
} catch (e) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem("bc_state_v1", JSON.stringify(state)); } catch (e) { toast("存储空间不足，部分内容未保存"); }
    if (window.BCSync) BCSync.post();
  }, 120);
}
window.BC = { state, save, $, $$, pad, DEVICES, DEV_EMOJI, renderHooks: {} };

/* SECTION: toast */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
window.toast = toast;

/* SECTION: sync (同浏览器多标签 30 秒内同步，实时通道兜底轮询) */
window.BCSync = (function () {
  const ch = ("BroadcastChannel" in window) ? new BroadcastChannel("bc-sync") : null;
  let lastSave = localStorage.getItem("bc_state_v1");
  function post() { if (ch) ch.postMessage(Date.now()); }
  function applyLocal() {
    const raw = localStorage.getItem("bc_state_v1");
    if (raw && raw !== lastSave) {
      lastSave = raw;
      try { Object.assign(state, JSON.parse(raw)); rerender(); } catch (e) {}
    }
  }
  if (ch) ch.onmessage = applyLocal;
  setInterval(applyLocal, 25000); // 需求 FR-009：30 秒内自动刷新
  return { post };
})();
function rerender() {
  Object.keys(window.BC.renderHooks).forEach((k) => { try { window.BC.renderHooks[k](); } catch (e) {} });
}
window.BCrerender = rerender;

/* SECTION: clock */
function tickClock() {
  const n = new Date();
  const hm = $("#clk-hm"); if (!hm) return;
  hm.textContent = pad(n.getHours()) + ":" + pad(n.getMinutes());
  $("#clk-sec").textContent = pad(n.getSeconds());
  $("#clk-date").textContent = n.getFullYear() + "年" + (n.getMonth() + 1) + "月" + n.getDate() + "日";
  const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][n.getDay()];
  $("#clk-week").textContent = week;
  const h = n.getHours();
  $("#clk-greet").textContent = h < 6 ? "夜深了，早点休息" : h < 12 ? "早上好 ☀️" : h < 18 ? "下午好 🌤️" : "晚上好 🌙";
}

/* SECTION: weather */
async function loadWeather() {
  const el = $("#cv-weather");
  try {
    const g = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(state.city) + "&count=1&language=zh&format=json").then(r => r.json());
    if (!g.results || !g.results.length) throw new Error("no city");
    const c = g.results[0];
    const w = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + c.latitude + "&longitude=" + c.longitude + "&current=temperature_2m,weather_code&timezone=auto").then(r => r.json());
    const cur = w.current;
    const info = WMO[Math.round(cur.weather_code)] || ["🌡️", "天气"];
    el.innerHTML = info[0] + " " + state.city + " " + Math.round(cur.temperature_2m) + "°C";
    window.BC.weatherText = state.city + "，" + info[1] + "，气温 " + Math.round(cur.temperature_2m) + " 摄氏度";
  } catch (e) {
    el.innerHTML = "🌡️ --°C（天气获取失败，检查网络）";
    window.BC.weatherText = null;
  }
}

/* SECTION: nightlight */
function inNightRange() {
  const n = new Date(), cur = n.getHours() * 60 + n.getMinutes();
  const [sh, sm] = (state.night.start || "21:30").split(":").map(Number);
  const [eh, em] = (state.night.end || "06:30").split(":").map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);
}
function applyNight() {
  const on = !!state.night.manual || inNightRange();
  document.body.classList.toggle("nightlight", on);
  const btn = $("#nl-btn"); if (btn) btn.classList.toggle("on", on);
}

/* SECTION: kiosk lock */
let locked = false, lastTap = 0;
function tryLock() {
  locked = true; document.body.classList.add("locked");
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
  history.pushState(null, "", location.href);
  selectSection("sec-homework");
  toast("已锁定：按钮已隐藏，双击屏幕可解锁");
}
function inOverlay(t) {
  return !!(t.closest && (t.closest("#alarm-screen") || t.closest("#call-screen") || t.closest("#lk-mask") || t.closest("#img-lightbox")));
}
function unlock() {
  locked = false; document.body.classList.remove("locked");
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  $("#lk-mask").classList.add("hidden");
}
function lockPrompt() { $("#lk-pw").value = ""; $("#lk-err").textContent = ""; $("#lk-mask").classList.remove("hidden"); $("#lk-pw").focus(); }
function initKiosk() {
  $("#lock-btn").addEventListener("click", tryLock);
  $("#cv-settings-btn").addEventListener("click", () => selectSection("sec-settings"));
  $("#nl-btn").addEventListener("click", () => { state.night.manual = !state.night.manual; save(); applyNight(); toast(state.night.manual ? "小夜灯已手动开启" : "小夜灯已关闭"); });
  document.addEventListener("click", (e) => {
    if (locked && e.isTrusted && !inOverlay(e.target)) e.stopPropagation();
  }, true);
  const onDouble = () => { const t = Date.now(); if (t - lastTap < 400 && locked) lockPrompt(); lastTap = t; };
  document.addEventListener("touchend", onDouble);
  document.addEventListener("dblclick", () => { if (locked) lockPrompt(); });
  window.addEventListener("popstate", () => { if (locked) { history.pushState(null, "", location.href); } });
  $("#lk-ok").addEventListener("click", () => {
    if ($("#lk-pw").value === String(state.pin)) unlock();
    else { $("#lk-err").textContent = "密码不对，再试试"; $("#lk-pw").value = ""; }
  });
  $("#lk-close").addEventListener("click", () => $("#lk-mask").classList.add("hidden"));
}

/* SECTION: menu & lightbox */
function selectSection(id) {
  $$(".col-detail > section").forEach(s => s.classList.toggle("hidden", s.id !== id));
  $$("#cv-menu .menu-item").forEach(m => m.classList.toggle("active", m.dataset.sec === id));
}
BC.selectSection = selectSection;
function initMenu() {
  $$("#cv-menu .menu-item").forEach(m => m.addEventListener("click", () => { if (locked) return; selectSection(m.dataset.sec); }));
  document.addEventListener("click", (e) => {
    if (e.target.tagName === "IMG" && e.target.closest(".hw-imgs")) {
      $("#lb-img").src = e.target.src; $("#img-lightbox").classList.remove("hidden");
    }
  });
  $("#img-lightbox").addEventListener("click", () => $("#img-lightbox").classList.add("hidden"));
}

/* SECTION: alarm engine */
function beepLoop() {
  const ctx = window.BCAudioCtx || (window.BCAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === "suspended") ctx.resume();
  function oneBeep() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.08, t); g.gain.setValueAtTime(0, t + 0.28);
    o.frequency.value = 880; o.start(t); o.stop(t + 0.3);
  }
  oneBeep();
  const timer = setInterval(() => { if (!window.BCAlarm.ringing) { clearInterval(timer); return; } oneBeep(); }, 700);
  return timer;
}
window.BCAlarm = { ringing: false };
const firedKeys = {};
function checkAlarms() {
  if (state.mode === "parent") return;
  const n = new Date(), key = n.toDateString();
  const hm = pad(n.getHours()) + ":" + pad(n.getMinutes());
  const dow = n.getDay() === 0 ? 7 : n.getDay();
  (BC.state.dev[state.mode].alarms || []).forEach(a => {
    const hitKey = a.id + key + hm;
    if (a.time === hm && n.getSeconds() <= 3 && !firedKeys[hitKey]) {
      const ok = a.repeat === "daily" || (a.repeat === "weekdays" && dow <= 5) || (a.repeat === "custom" && String(a.days).split(",").includes(String(dow)));
      if (ok) { firedKeys[hitKey] = true; fireAlarm(a); }
    }
  });
}
function fireAlarm(a) {
  window.BCAlarm.ringing = true;
  const n = new Date();
  $("#as-clock").textContent = pad(n.getHours()) + ":" + pad(n.getMinutes());
  $("#as-msg").textContent = "⏰ 该起床啦！" + (BC.weatherText ? "今天" + BC.weatherText : "祝您有美好的一天");
  $("#alarm-screen").classList.remove("hidden");
  if ("speechSynthesis" in window) {
    try { const u = new SpeechSynthesisUtterance("早上好，现在是" + n.getHours() + "点" + n.getMinutes() + "分。" + (BC.weatherText || "")); u.lang = "zh-CN"; speechSynthesis.speak(u); } catch (e) {}
  }
  const durMin = a.dur || state.audioDur || 15;
  $("#as-audio").textContent = "将播放 " + durMin + " 分钟后自动停止";
  window.BCAlarm.stopTimer = setTimeout(closeAlarm, durMin * 60000);
  if (a.ring !== "beep" && a.audioId && window.BCAudioStore) {
    window.BCAudioStore.getBlob(a.audioId).then(({ name, blob }) => {
      if (!blob) throw new Error("gone");
      const url = URL.createObjectURL(blob);
      const el = window.BCPlayer ? BCPlayer.el : new Audio();
      if (window.BCPlayer) { BCPlayer.playExternalUrl(url, name, durMin * 60000); }
      else { el.src = url; el.play().catch(() => {}); }
      window.BCAlarm.extUrl = url;
    }).catch(() => { window.BCAlarm.beep = beepLoop(); });
  } else {
    window.BCAlarm.beep = beepLoop();
  }
}
function closeAlarm() {
  window.BCAlarm.ringing = false;
  clearTimeout(window.BCAlarm.stopTimer);
  clearInterval(window.BCAlarm.beep);
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (window.BCPlayer && window.BCPlayer.stopExternal) BCPlayer.stopExternal();
  if (window.BCAlarm.extUrl) { URL.revokeObjectURL(window.BCAlarm.extUrl); window.BCAlarm.extUrl = null; }
  $("#alarm-screen").classList.add("hidden");
}

/* SECTION: settings (孩子端 + 父母端共用配置区块) */
function setRow(label, control) { return '<div class="set-row"><label>' + label + "</label>" + control + "</div>"; }
function settingsHTML(withDevice) {
  let h = "";
  if (withDevice) {
    h += setRow("设备模式", '<select id="st-mode"><option value="clock1">闹钟一</option><option value="clock2">闹钟二</option><option value="clock3">闹钟三</option><option value="parent">父母端</option></select>');
    h += setRow("本机名称", '<input type="text" id="st-name" maxlength="10">');
  }
  h += setRow("解锁密码", '<input type="text" id="st-pin" inputmode="numeric" maxlength="8">');
  h += setRow("城市（天气）", '<input type="text" id="st-city">');
  h += setRow("小夜灯开始", '<input type="time" id="st-ns">');
  h += setRow("小夜灯结束", '<input type="time" id="st-ne">');
  h += setRow("闹钟播放时长(分)", '<input type="number" id="st-dur" min="1" max="120">');
  h += setRow("对讲房号", '<input type="text" id="st-room" maxlength="12">');
  return h;
}
function bindSettings(root, withDevice) {
  const s = BC.state;
  const modeSel = $("#st-mode", root), nameIn = $("#st-name", root);
  if (withDevice) { modeSel.value = s.mode; nameIn.value = s.names[s.mode] || ""; }
  $("#st-pin", root).value = s.pin; $("#st-city", root).value = s.city;
  $("#st-ns", root).value = s.night.start; $("#st-ne", root).value = s.night.end;
  $("#st-dur", root).value = s.audioDur; $("#st-room", root).value = s.callRoom;
  if (withDevice) {
    modeSel.addEventListener("change", () => { s.mode = modeSel.value; save(); applyMode(true); toast("已切换为：" + (s.mode === "parent" ? "父母端" : s.names[s.mode])); });
    nameIn.addEventListener("change", () => { if (s.mode !== "parent") { s.names[s.mode] = nameIn.value.trim() || s.names[s.mode]; save(); renderDeviceChip(); } });
  }
  $("#st-pin", root).addEventListener("change", (e) => { const v = e.target.value.trim(); if (/^\d{4,8}$/.test(v)) { s.pin = v; save(); toast("密码已更新"); } else { e.target.value = s.pin; toast("密码须为 4-8 位数字"); } });
  $("#st-city", root).addEventListener("change", (e) => { s.city = e.target.value.trim() || "北京"; save(); loadWeather(); toast("天气已刷新"); });
  $("#st-ns", root).addEventListener("change", (e) => { s.night.start = e.target.value; s.night.manual = false; save(); applyNight(); });
  $("#st-ne", root).addEventListener("change", (e) => { s.night.end = e.target.value; s.night.manual = false; save(); applyNight(); });
  $("#st-dur", root).addEventListener("change", (e) => { s.audioDur = Math.max(1, Math.min(120, +e.target.value || 15)); save(); });
  $("#st-room", root).addEventListener("change", (e) => { s.callRoom = e.target.value.trim() || ("h" + Math.random().toString(36).slice(2, 8)); e.target.value = s.callRoom; save(); if (window.BCCall) BCCall.restart(); toast("对讲房号已更新"); });
}
BC.bindSettings = bindSettings;
BC.settingsHTML = settingsHTML;

/* SECTION: mode routing */
function renderDeviceChip() {
  const s = BC.state;
  if (s.mode !== "parent") $("#cv-device-chip").textContent = DEV_EMOJI[s.mode] + " " + s.names[s.mode];
}
function applyMode(jump) {
  const s = BC.state, isParent = s.mode === "parent";
  $("#child-view").classList.toggle("hidden", isParent);
  $("#parent-view").classList.toggle("hidden", !isParent);
  if (isParent) { renderDeviceChip(); if (window.BCParent) BCParent.init(); }
  else { renderDeviceChip(); if (jump) selectSection("sec-homework"); if (window.BCContent) BCContent.refresh(); if (BC.renderHooks.childSettings) BC.renderHooks.childSettings(); }
  if (window.BCCall) BCCall.restart();
}
BC.applyMode = applyMode;

/* SECTION: boot */
document.addEventListener("DOMContentLoaded", () => {
  tickClock(); setInterval(tickClock, 1000);
  setInterval(checkAlarms, 1000);
  setInterval(applyNight, 20000);
  applyNight();
  loadWeather(); setInterval(loadWeather, 3600000);
  initKiosk(); initMenu();
  if (window.BCAudioStore && window.BCPlayer) BCPlayer.init();
  if (window.BCContent) BCContent.init();
  if (window.BCParent) BCParent.init();
  if (window.BCCall) BCCall.init();
  $("#as-close").addEventListener("click", closeAlarm);
  applyMode(false);
});
})();
