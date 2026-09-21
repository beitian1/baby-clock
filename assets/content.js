/* SECTION: content — 孩子端作业/课程表/专注倒计时 */
(function () {
"use strict";
const { state, $, $$, pad, DEVICES } = window.BC;
const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
function dateKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

/* SECTION: homework (child) */
function hwHTML(day) {
  const hw = state.dev[state.mode].homework[day];
  if (!hw || (!hw.text && !(hw.imgs || []).length)) return "";
  let h = "";
  if (hw.text) h += '<div class="hw-item">' + esc(hw.text) + "</div>";
  if ((hw.imgs || []).length) {
    h += '<div class="hw-imgs">';
    hw.imgs.forEach(im => { h += "<figure><img data-hwimg=\"" + im.id + "\" alt=\"" + esc(im.caption || "作业图片") + "\"><figcaption>" + esc(im.caption || "") + "</figcaption></figure>"; });
    h += "</div>";
  }
  return h;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
BC.esc = esc; BC.dateKey = dateKey;

function renderHomework() {
  if (state.mode === "parent") return;
  const today = dateKey();
  $("#hw-date-label").textContent = today + " " + WEEK[new Date().getDay()];
  const html = hwHTML(today);
  $("#hw-content").innerHTML = html || '<div class="empty-tip">今天还没有作业哦 🌼<br>爸妈在家长管理台发布后，这里 30 秒内就会自动出现</div>';
  hydrateHwImages($("#hw-content"));
}
function hydrateHwImages(scope) {
  scope.querySelectorAll("img[data-hwimg]").forEach(img => {
    window.BCAudioStore.getHwImage(img.dataset.hwimg).then(url => {
      if (url) { img.src = url; } else { img.style.display = "none"; }
    });
  });
}
BC.hydrateHwImages = hydrateHwImages;

function renderHwHistory() {
  const box = $("#hw-history");
  const days = Object.keys(state.dev[state.mode].homework).sort().reverse();
  if (!days.length) { box.innerHTML = '<div class="empty-tip">还没有历史作业</div>'; return; }
  let h = "";
  days.forEach(d => {
    const html = hwHTML(d);
    if (html) h += '<div style="margin-bottom:14px"><div class="badge">' + d + "</div>" + html + "</div>";
  });
  box.innerHTML = h || '<div class="empty-tip">作业内容都已删除</div>';
  hydrateHwImages(box);
}

/* SECTION: timetable (child) */
function renderTimetable() {
  if (state.mode === "parent") return;
  const n = new Date();
  const idx = n.getDay() === 0 ? 6 : n.getDay() - 1; // 0=周一
  $("#tt-day-label").textContent = WEEK[n.getDay()];
  const lessons = state.dev[state.mode].timetable[idx] || [];
  const now = n.getHours() * 60 + n.getMinutes();
  let h = "", hasAny = false;
  lessons.forEach((name, i) => {
    if (!name) return;
    hasAny = true;
    const start = 8 * 60 + i * 45, end = start + 40;
    const isNow = now >= start && now < end;
    h += '<div class="tt-row' + (isNow ? " now" : "") + '"><span class="no">' + (i + 1) + "</span><span>" + BC.esc(name) + "</span>" + (isNow ? '<span class="sub">进行中</span>' : "") + "</div>";
  });
  $("#tt-content").innerHTML = hasAny ? h : '<div class="empty-tip">今天没有课程安排 🎈</div>';
}

/* SECTION: focus timer */
let fc = { total: 0, remain: 0, timer: null, running: false };
const RING_LEN = 326.7;
function fcRender() {
  const r = $("#fc-time");
  if (!fc.total) { r.textContent = "--:--"; return; }
  r.textContent = pad(Math.floor(fc.remain / 60)) + ":" + pad(fc.remain % 60);
  $("#fc-prog").style.strokeDashoffset = RING_LEN * (1 - fc.remain / fc.total);
}
function fcStart(min) {
  fcStop();
  fc.total = fc.remain = Math.max(1, Math.min(180, min)) * 60;
  fc.running = true;
  $("#fc-label").textContent = "专注中，加油！";
  $("#fc-pause").classList.remove("hidden"); $("#fc-cancel").classList.remove("hidden");
  fc.timer = setInterval(() => {
    fc.remain--;
    fcRender();
    if (fc.remain <= 0) fcDone();
  }, 1000);
  fcRender();
  keepAwake(true);
}
function fcPauseToggle() {
  if (fc.running) { clearInterval(fc.timer); fc.running = false; $("#fc-pause").textContent = "▶ 继续"; $("#fc-label").textContent = "已暂停"; }
  else { fc.running = true; fc.timer = setInterval(() => { fc.remain--; fcRender(); if (fc.remain <= 0) fcDone(); }, 1000); $("#fc-pause").textContent = "⏸ 暂停"; $("#fc-label").textContent = "专注中，加油！"; }
}
function fcStop() { clearInterval(fc.timer); fc = { total: 0, remain: 0, timer: null, running: false }; $("#fc-pause").classList.add("hidden"); $("#fc-cancel").classList.add("hidden"); $("#fc-pause").textContent = "⏸ 暂停"; $("#fc-prog").style.strokeDashoffset = 0; keepAwake(false); }
function fcDone() {
  const wasTotal = fc.total;
  fcStop(); fcRender();
  $("#fc-time").textContent = "完成!";
  $("#fc-label").textContent = "专注 " + Math.round(wasTotal / 60) + " 分钟达成，休息一下吧 🎉";
  try {
    const ctx = window.BCAudioCtx || (window.BCAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === "suspended") ctx.resume();
    [523, 659, 784, 1046].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.18, o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = f;
      g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
  } catch (e) {}
  toast("⏳ 专注时间到！");
  if ("Notification" in window && Notification.permission === "granted") { try { new Notification("专注完成 🎉"); } catch (e) {} }
}
function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !window.BC.wl) navigator.wakeLock.request("screen").then(wl => { window.BC.wl = wl; }).catch(() => {});
    if (!on && window.BC.wl) { window.BC.wl.release(); window.BC.wl = null; }
  } catch (e) {}
}
function initFocus() {
  $$("#fc-presets .btn").forEach(b => b.addEventListener("click", () => fcStart(+b.dataset.min)));
  $("#fc-start").addEventListener("click", () => fcStart(parseInt($("#fc-custom").value, 10) || 10));
  $("#fc-pause").addEventListener("click", fcPauseToggle);
  $("#fc-cancel").addEventListener("click", () => { fcStop(); fcRender(); $("#fc-label").textContent = "选个时间开始专注吧"; });
}

/* SECTION: init */
window.BCContent = {
  init() {
    initFocus();
    $("#hw-history-btn").addEventListener("click", () => {
      const box = $("#hw-history");
      const open = box.classList.toggle("hidden");
      if (!open) renderHwHistory();
      $("#hw-history-btn").textContent = open ? "📜 查看历史作业" : "📜 收起历史作业";
    });
    BC.renderHooks.homework = renderHomework;
    BC.renderHooks.timetable = renderTimetable;
    renderHomework(); renderTimetable();
  },
  refresh() { renderHomework(); renderTimetable(); }
};
})();
