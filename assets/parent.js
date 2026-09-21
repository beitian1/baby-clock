/* SECTION: parent — 家长管理台（设备切换/闹钟/作业/课程表/设置） */
(function () {
"use strict";
const { state, $, $$, pad, DEVICES, DEV_EMOJI, save, bindSettings, settingsHTML } = window.BC;
const RING_LABEL = { beep: "蜂鸣声" };
let activeDev = state.mode === "parent" ? "clock1" : state.mode;
let hwDate = null; // 当前编辑日期

/* SECTION: device tabs */
function renderTabs() {
  $("#pm-dev-tabs").innerHTML = DEVICES.map(d =>
    '<button class="dev-tab' + (d === activeDev ? " active" : "") + '" data-dev="' + d + '">' + DEV_EMOJI[d] + " " + BC.esc(state.names[d]) + "</button>"
  ).join("");
}

/* SECTION: alarms */
function alarmMeta(a) {
  const r = a.repeat === "daily" ? "每天" : a.repeat === "weekdays" ? "工作日" : "自定义";
  const ring = a.ring === "beep" ? "蜂鸣声" : "音频：" + a.ring;
  return r + " · " + ring + " · 播 " + (a.dur || state.audioDur) + " 分";
}
function renderRingOptions() {
  const sel = $("#al-ring");
  const tracks = (window.BCAudioStore ? BCAudioStore.list() : []);
  sel.innerHTML = '<option value="beep">🔔 蜂鸣声</option>' + tracks.map(t => '<option value="' + BC.esc(t.name) + '" data-id="' + t.id + '">🎵 ' + BC.esc(t.name) + "</option>").join("");
}
function renderAlarms() {
  const list = state.dev[activeDev].alarms;
  $("#al-dev-label").textContent = DEV_EMOJI[activeDev] + " " + state.names[activeDev];
  $("#al-list").innerHTML = list.length ? list.map(a =>
    '<div class="al-item"><b>' + a.time + '</b><span class="meta">' + alarmMeta(a) + '</span><button class="btn small danger" data-del="' + a.id + '">删除</button></div>'
  ).join("") : '<div class="empty-tip">还没有闹钟，在下面添加一个吧</div>';
}

/* SECTION: homework editor */
let heImages = []; // [{id,caption}]
function todayKey() { const n = new Date(); return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate()); }
function loadHwEditor() {
  const dev = state.dev[activeDev];
  if (!hwDate) hwDate = todayKey();
  const hw = dev.homework[hwDate] || { text: "", imgs: [] };
  $("#ph-date").value = hwDate;
  $("#ph-text").value = hw.text || "";
  heImages = (hw.imgs || []).slice();
  renderHeImgs();
}
function renderHeImgs() {
  $("#ph-imgs").innerHTML = heImages.map((im, i) =>
    '<div class="hei" data-i="' + i + '"><span class="del" data-rm="' + i + '">✕</span><img data-hwimg="' + im.id + '" alt=""><span>' + BC.esc(im.caption || "图片" + (i + 1)) + "</span></div>"
  ).join("");
  BC.hydrateHwImages($("#ph-imgs"));
}

/* SECTION: timetable editor */
function renderTtEditor() {
  const tt = state.dev[activeDev].timetable;
  let grid = "";
  ["节次", "周一", "周二", "周三", "周四", "周五", "周六", "周日"].forEach(d => { grid += '<div class="hd">' + d + "</div>"; });
  for (let i = 0; i < 8; i++) {
    grid += '<div class="hd">第' + (i + 1) + "节</div>";
    for (let d = 0; d < 7; d++) {
      grid += '<input data-d="' + d + '" data-i="' + i + '" value="' + BC.esc((tt[d] && tt[d][i]) || "") + '" maxlength="8">';
    }
  }
  $("#pt-grid").innerHTML = grid;
}

/* SECTION: render all */
function renderAll() {
  if (state.mode !== "parent") return;
  renderTabs(); renderAlarms(); renderRingOptions(); loadHwEditor(); renderTtEditor();
  if (window.BCCall) BCCall.refreshList();
}
BC.renderHooks.parent = renderAll;

/* SECTION: child settings panel */
function renderChildSettings() {
  const box = $("#child-settings");
  if (box.dataset.bound !== "1") {
    box.innerHTML = settingsHTML(true);
    bindSettings(box, true);
    box.dataset.bound = "1";
    box.insertAdjacentHTML("beforeend", '<div class="hint">锁定屏幕后，双击屏幕输入密码可解锁。默认密码 1234，请及时修改。对讲房号建议设成唯一值（如 home0921），同一家所有设备填同一房号。</div>');
  } else {
    $("#st-mode", box).value = state.mode;
    $("#st-name", box).value = state.names[state.mode] || "";
    $("#st-pin", box).value = state.pin; $("#st-city", box).value = state.city;
    $("#st-room", box).value = state.callRoom; $("#st-dur", box).value = state.audioDur;
    $("#st-ns", box).value = state.night.start; $("#st-ne", box).value = state.night.end;
  }
}
BC.renderHooks.childSettings = renderChildSettings;

/* SECTION: init */
let inited = false;
window.BCParent = {
  init() {
    if (!hwDate) hwDate = todayKey();
    renderChildSettings();
    $("#pm-settings").innerHTML = settingsHTML(false) + '<div class="hint">作业、课程表、闹钟数据保存在本机浏览器，供体验完整管理流程。</div>';
    bindSettings($("#pm-settings"), false);
    $("#pm-env").textContent = location.protocol === "https:" || location.hostname === "localhost" || location.protocol === "file:" ? (location.protocol === "file:" ? "本地文件（通话需在 https 或 localhost 下使用）" : "安全环境 ✓ 可用麦克风") : "非安全环境（通话不可用，请用 https 或 localhost 打开）";
    if (!inited) {
      inited = true;
      $("#pm-back-child").addEventListener("click", () => { state.mode = activeDev; save(); BC.applyMode(true); });
      $("#pm-dev-tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-dev]"); if (t) { activeDev = t.dataset.dev; renderAll(); } });
      $("#al-repeat").addEventListener("change", (e) => { $("#al-days").classList.toggle("hidden", e.target.value !== "custom"); });
      $("#al-add").addEventListener("click", () => {
        const time = $("#al-time").value || "07:00";
        const sel = $("#al-ring"), opt = sel.selectedOptions[0];
        state.dev[activeDev].alarms.push({
          id: "a" + Date.now(), time, repeat: $("#al-repeat").value,
          days: $("#al-days").value, ring: sel.value, audioId: opt && opt.dataset.id ? opt.dataset.id : null,
          dur: Math.max(1, Math.min(120, +$("#al-dur").value || 15))
        });
        save(); renderAlarms(); window.toast("闹钟 " + time + " 已添加");
      });
      $("#al-list").addEventListener("click", (e) => {
        const d = e.target.closest("[data-del]"); if (!d) return;
        const list = state.dev[activeDev].alarms;
        const i = list.findIndex(a => a.id === d.dataset.del);
        if (i >= 0) { list.splice(i, 1); save(); renderAlarms(); window.toast("闹钟已删除"); }
      });
      /* 作业编辑 */
      $("#ph-date").addEventListener("change", (e) => { hwDate = e.target.value || hwDate; loadHwEditor(); });
      $("#ph-today").addEventListener("click", () => { hwDate = (function () { const n = new Date(); return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate()); })(); loadHwEditor(); });
      $("#ph-img").addEventListener("change", async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        try {
          const id = await BCAudioStore.saveHwImage(f);
          heImages.push({ id, caption: $("#ph-caption").value.trim() || ("图片" + (heImages.length + 1)) });
          $("#ph-caption").value = "";
          renderHeImgs(); window.toast("图片已添加，记得点保存");
        } catch (err) { window.toast("图片保存失败，请换一张小图"); }
      });
      $("#ph-imgs").addEventListener("click", (e) => {
        const rm = e.target.closest("[data-rm]"); if (!rm) return;
        const im = heImages.splice(+rm.dataset.rm, 1)[0];
        if (im) BCAudioStore.delHwImage(im.id);
        renderHeImgs();
      });
      $("#ph-save").addEventListener("click", () => {
        const dev = state.dev[activeDev];
        dev.homework[hwDate] = { text: $("#ph-text").value.trim(), imgs: heImages.slice() };
        if (!dev.homework[hwDate].text && !dev.homework[hwDate].imgs.length) delete dev.homework[hwDate];
        save(); window.toast("已保存到 " + state.names[activeDev] + "，孩子端 30 秒内可见");
      });
      $("#ph-del-all").addEventListener("click", () => {
        const dev = state.dev[activeDev];
        if (dev.homework[hwDate]) { (dev.homework[hwDate].imgs || []).forEach(im => BCAudioStore.delHwImage(im.id)); delete dev.homework[hwDate]; save(); loadHwEditor(); window.toast(hwDate + " 的作业已删除"); }
        else window.toast("这一天没有作业");
      });
      /* 课程表编辑（输入即存） */
      $("#pt-grid").addEventListener("change", (e) => {
        const inp = e.target.closest("input[data-d]"); if (!inp) return;
        state.dev[activeDev].timetable[+inp.dataset.d][+inp.dataset.i] = inp.value.trim();
        save(); window.toast("课程表已保存");
      });
    }
    renderAll();
  }
};
})();
