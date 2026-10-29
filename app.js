(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const today = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  const UI_KEY = "reelshelf.ui";
  const PENDING_KEY = "reelshelf.pending";
  const CFG = window.REEL_SHELF_CONFIG || {};

  let sb = null;           // Supabase client
  let me = null;           // signed-in user
  let reels = [];          // rows from the reels table
  let names = {};          // user_id -> display name
  let editingId = null;
  let needOnly = false;

  function show(view){
    ["viewSetup","viewAuth","viewName","viewApp"].forEach(v => $(v).hidden = v !== view);
  }

  /* ---------- parsing ---------- */
  function parseLength(s){
    s = String(s || "").trim().toLowerCase();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) return (+m[1])*60 + (+m[2]);
    if ((m = s.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/)) && (m[1] || m[2])) return (+(m[1]||0))*60 + (+(m[2]||0));
    if (/^\d+$/.test(s)) return +s;
    return NaN;
  }
  const fmtLen = s => s == null ? "" : Math.floor(s/60) + ":" + String(s%60).padStart(2,"0");
  function lenBucket(s){
    if (s == null) return "none";
    if (s < 30) return "s"; if (s < 60) return "m"; if (s <= 180) return "l"; return "xl";
  }
  const LEN_LABEL = {s:"Under 30s", m:"30s to 1 min", l:"1 to 3 min", xl:"Over 3 min", none:"Length not set"};

  // Must match the cleaning in add_reel() in supabase-setup.sql, so duplicates are caught.
  function cleanUrl(raw){
    const found = String(raw || "").match(/https?:\/\/[^\s<>"']+/);
    if (!found) return null;
    let u;
    try { u = new URL(found[0]); } catch { return null; }
    if (/^(m|web|mbasic)\.facebook\.com$/.test(u.hostname)) u.hostname = "www.facebook.com";
    if (u.protocol === "http:") u.protocol = "https:";
    let s = u.toString();
    if (/^https:\/\/(www\.)?(facebook\.com\/(reel|share)\/|fb\.watch\/)/i.test(s)) s = s.replace(/[?#].*$/, "");
    return s;
  }
  const isFacebook = url => { try { return /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i.test(new URL(url).hostname); } catch { return false; } };
  function creatorFromUrl(url){
    try {
      const p = new URL(url).pathname.split("/").filter(Boolean);
      const skip = ["reel","reels","share","watch","videos","video.php","story.php","permalink.php","r","v","groups"];
      if (p.length >= 2 && (p[1] === "videos" || p[1] === "reels") && !skip.includes(p[0])) return p[0].replace(/[._-]+/g," ");
    } catch {}
    return "";
  }
  const monthKey = d => (d || "").slice(0,7);
  function monthLabel(k){
    if (!k) return "No date";
    const [y,m] = k.split("-").map(Number);
    return new Date(y, m-1, 1).toLocaleDateString(undefined, {month:"long", year:"numeric"});
  }
  function dateLabel(d){
    if (!d) return "";
    const [y,m,dd] = d.split("-").map(Number);
    return new Date(y, m-1, dd).toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"});
  }
  const needsDetails = r => !r.creator || r.seconds == null || !r.category;
  const whoName = id => !id ? "Someone" : (id === me?.id ? "You" : (names[id] || "Someone"));

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(text){
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------- data ---------- */
  let loading = false;
  async function load(){
    if (!me || loading) return;
    loading = true;
    try {
      const [r, m] = await Promise.all([
        sb.from("reels").select("*").order("date", {ascending:false}).limit(5000),
        sb.from("members").select("user_id,name")
      ]);
      if (r.error) throw r.error;
      reels = r.data || [];
      names = Object.fromEntries((m.data || []).map(x => [x.user_id, x.name]));
      render();
    } catch (err) {
      toast("Couldn't load your shelf: " + (err?.message || "check your connection."));
    } finally { loading = false; }
  }
  const store = {
    async add(rec){
      const {error} = await sb.from("reels").insert(rec);
      if (error) throw error;
      await load();
    },
    async update(id, rec){
      const {error} = await sb.from("reels").update(rec).eq("id", id);
      if (error) throw error;
      await load();
    },
    async remove(id){
      const {error} = await sb.from("reels").delete().eq("id", id);
      if (error) throw error;
      await load();
    }
  };

  /* ---------- UI state ---------- */
  function loadUI(){
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      if (ui.groupBy) $("groupBy").value = ui.groupBy;
      if (ui.sortBy) $("sortBy").value = ui.sortBy;
      if (ui.panel === "closed") setPanel(false);
    } catch {}
  }
  function saveUI(){
    try { localStorage.setItem(UI_KEY, JSON.stringify({groupBy:$("groupBy").value, sortBy:$("sortBy").value, panel: $("addBody").hidden ? "closed" : "open"})); } catch {}
  }
  function setPanel(open){
    $("addBody").hidden = !open; $("tabs").hidden = !open;
    $("togglePanel").textContent = open ? "Hide" : "Show";
    $("togglePanel").setAttribute("aria-expanded", String(open));
  }

  function uniq(field){
    const m = new Map();
    reels.forEach(r => { const v = (r[field] || "").trim(); if (v) { const k = v.toLowerCase(); m.set(k, {v, n:(m.get(k)?.n || 0) + 1}); } });
    return [...m.values()].sort((a,b) => a.v.localeCompare(b.v));
  }
  function fillSelect(sel, items, allLabel, labelFn = x => x){
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + items.map(i => `<option value="${esc(i.key)}">${esc(labelFn(i.key))} (${i.n})</option>`).join("");
    sel.value = items.some(i => i.key === cur) ? cur : "";
  }
  function refreshOptions(){
    const cats = uniq("category"), creators = uniq("creator");
    $("creatorList").innerHTML = creators.map(c => `<option value="${esc(c.v)}">`).join("");
    $("categoryList").innerHTML = cats.map(c => `<option value="${esc(c.v)}">`).join("");
    fillSelect($("filCat"), cats.map(c => ({key:c.v, n:c.n})), "All categories");
    fillSelect($("filCreator"), creators.map(c => ({key:c.v, n:c.n})), "All creators");
    const months = new Map();
    reels.forEach(r => { const k = monthKey(r.date); months.set(k, (months.get(k) || 0) + 1); });
    fillSelect($("filMonth"), [...months].sort((a,b) => b[0].localeCompare(a[0])).map(([key,n]) => ({key, n})), "All months", monthLabel);
    const who = new Map();
    reels.forEach(r => { const k = r.added_by || ""; who.set(k, (who.get(k) || 0) + 1); });
    const whoItems = [...who].map(([key,n]) => ({key, n})).filter(i => i.key).sort((a,b) => (b.key === me?.id) - (a.key === me?.id));
    fillSelect($("filWho"), whoItems, "Saved by anyone", k => k === me?.id ? "Saved by you" : `Saved by ${whoName(k)}`);
    $("filWho").hidden = whoItems.length < 2 && !$("filWho").value;
    const top = [...cats].sort((a,b) => b.n - a.n).slice(0, 8);
    const curCat = $("fCategory").value.trim().toLowerCase();
    $("catChips").innerHTML = top.map(c => `<button type="button" class="chip" data-cat="${esc(c.v)}" aria-pressed="${c.v.toLowerCase() === curCat}">${esc(c.v)}</button>`).join("");
  }

  /* ---------- filtering & render ---------- */
  function highlight(text, q){
    const s = esc(text);
    if (!q) return s;
    const qs = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return s.replace(new RegExp(qs, "ig"), m => `<mark>${m}</mark>`);
  }
  function filtered(){
    const q = $("q").value.trim().toLowerCase();
    const cat = $("filCat").value.toLowerCase(), cr = $("filCreator").value.toLowerCase();
    const mo = $("filMonth").value, len = $("filLen").value, who = $("filWho").value;
    return reels.filter(r => {
      if (needOnly && !needsDetails(r)) return false;
      if (who && r.added_by !== who) return false;
      if (cat && (r.category || "").toLowerCase() !== cat) return false;
      if (cr && (r.creator || "").toLowerCase() !== cr) return false;
      if (mo && monthKey(r.date) !== mo) return false;
      if (len && lenBucket(r.seconds) !== len) return false;
      if (q) {
        const hay = [r.title, r.creator, r.category, r.notes, r.url, whoName(r.added_by)].join(" ").toLowerCase();
        if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      return true;
    });
  }
  function sortList(list){
    const dateCmp = (a,b) => (a.date || "").localeCompare(b.date || "") || (a.added_at || "").localeCompare(b.added_at || "");
    const cmp = {
      new: (a,b) => dateCmp(b,a),
      old: dateCmp,
      long: (a,b) => (b.seconds ?? -1) - (a.seconds ?? -1),
      short: (a,b) => (a.seconds ?? 1e9) - (b.seconds ?? 1e9),
      az: (a,b) => (a.title || a.url).localeCompare(b.title || b.url)
    }[$("sortBy").value];
    return [...list].sort(cmp);
  }
  function groupOf(r, g){
    if (g === "month") return {key: monthKey(r.date), label: monthLabel(monthKey(r.date))};
    if (g === "category") return {key: (r.category || "").toLowerCase(), label: r.category || "No category"};
    if (g === "creator") return {key: (r.creator || "").toLowerCase(), label: r.creator || "Creator not set"};
    if (g === "length") { const b = lenBucket(r.seconds); return {key: b, label: LEN_LABEL[b]}; }
    if (g === "who") return {key: r.added_by || "", label: r.added_by === me?.id ? "Saved by you" : `Saved by ${whoName(r.added_by)}`};
    return {key: "", label: ""};
  }
  const LEN_ORDER = ["s","m","l","xl","none"];
  const GROUP_ORDER = {
    month: (a,b) => (b === "") - (a === "") || b.localeCompare(a),
    category: (a,b) => (a === "") - (b === "") || a.localeCompare(b),
    creator: (a,b) => (a === "") - (b === "") || a.localeCompare(b),
    length: (a,b) => LEN_ORDER.indexOf(a) - LEN_ORDER.indexOf(b),
    who: (a,b) => (b === me?.id) - (a === me?.id),
    none: () => 0
  };

  function reelHTML(r, q){
    const title = r.title || "Untitled reel";
    const link = r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${highlight(title, q)}</a>` : highlight(title, q);
    const tc = r.seconds == null ? `<span class="tc none">?:??</span>` : `<span class="tc">${fmtLen(r.seconds)}</span>`;
    const tags = [
      r.category ? `<span class="tag">${highlight(r.category, q)}</span>` : "",
      needsDetails(r) ? `<span class="tag need">Needs details</span>` : ""
    ].join("");
    const who = r.added_by === me?.id ? `<span class="who-me">Saved by you</span>` : `<span>Saved by ${esc(whoName(r.added_by))}</span>`;
    return `<article class="reel" data-id="${esc(r.id)}">
      <div class="frame" aria-hidden="true">${tc}</div>
      <div class="body">
        <p class="title">${link}</p>
        <div class="meta">
          <span class="who">${r.creator ? highlight(r.creator, q) : "Creator not set"}</span>
          ${r.date ? `<span>${dateLabel(r.date)}</span>` : ""}
          ${r.seconds != null ? `<span>${fmtLen(r.seconds)} long</span>` : ""}
        </div>
        <div class="meta">${tags}${who}</div>
        ${r.notes ? `<p class="notes">${highlight(r.notes, q)}</p>` : ""}
        <div class="row-actions">
          ${r.url ? `<a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">Watch on Facebook</a>` : ""}
          <button type="button" class="btn small" data-act="edit">Edit</button>
          <button type="button" class="btn small danger" data-act="del">Delete</button>
        </div>
      </div>
    </article>`;
  }

  function render(){
    refreshOptions();
    const q = $("q").value.trim();
    const list = sortList(filtered());
    const g = $("groupBy").value;
    const need = reels.filter(needsDetails).length;
    $("needBtn").textContent = needOnly ? "Show all" : (need ? `${need} need details` : "");
    $("needBtn").hidden = !needOnly && !need;
    const anyFilter = q || $("filCat").value || $("filCreator").value || $("filMonth").value || $("filLen").value || $("filWho").value || needOnly;
    $("clearFil").hidden = !anyFilter;
    $("countText").textContent = reels.length ? (anyFilter ? `${list.length} of ${reels.length} reels` : `${reels.length} reel${reels.length === 1 ? "" : "s"}`) : "";

    if (!reels.length) {
      $("list").innerHTML = `<div class="empty"><strong>Your shelf is empty</strong>Paste a reel link above, or set up the iPhone Shortcut in Settings to save reels straight from Facebook.</div>`;
      return;
    }
    if (!list.length) {
      $("list").innerHTML = `<div class="empty"><strong>No reels match</strong>Try a different search or clear the filters.</div>`;
      return;
    }
    const groups = new Map();
    list.forEach(r => { const {key, label} = groupOf(r, g); if (!groups.has(key)) groups.set(key, {label, items: []}); groups.get(key).items.push(r); });
    const keys = [...groups.keys()].sort(GROUP_ORDER[g]);
    $("list").innerHTML = keys.map(k => {
      const gr = groups.get(k);
      return `<section class="group">${g !== "none" ? `<h3>${esc(gr.label)} <span class="n">${gr.items.length}</span></h3>` : ""}${gr.items.map(r => reelHTML(r, q)).join("")}</section>`;
    }).join("");
  }

  /* ---------- add / edit forms ---------- */
  function setTab(bulk){
    $("tabOne").setAttribute("aria-selected", String(!bulk));
    $("tabBulk").setAttribute("aria-selected", String(bulk));
    $("oneForm").hidden = bulk; $("bulkForm").hidden = !bulk;
  }
  function msg(el, text, warn){ el.textContent = text; el.className = "msg" + (warn ? " warn" : ""); }
  function resetOne(){
    $("oneForm").reset(); $("fDate").value = today();
    editingId = null; $("saveBtn").textContent = "Save reel"; $("cancelEdit").hidden = true;
    $("addTitle").textContent = "Add a reel"; msg($("oneMsg"), "");
    refreshOptions();
  }
  function checkUrl(){
    const url = cleanUrl($("fUrl").value);
    if (!url) { msg($("oneMsg"), ""); return; }
    const dupe = reels.find(r => r.url === url && r.id !== editingId);
    if (dupe) msg($("oneMsg"), `Already saved as “${dupe.title || "Untitled reel"}”.`, true);
    else if (!isFacebook(url)) msg($("oneMsg"), "This isn't a Facebook link, but you can still save it.", true);
    else msg($("oneMsg"), "");
    if (!$("fCreator").value) { const c = creatorFromUrl(url); if (c) $("fCreator").value = c; }
  }
  function startEdit(r){
    setPanel(true); setTab(false); editingId = r.id;
    $("fUrl").value = r.url || ""; $("fTitle").value = r.title || ""; $("fCreator").value = r.creator || "";
    $("fCategory").value = r.category || ""; $("fLength").value = fmtLen(r.seconds); $("fDate").value = r.date || today();
    $("fNotes").value = r.notes || "";
    $("saveBtn").textContent = "Save changes"; $("cancelEdit").hidden = false; $("addTitle").textContent = "Edit reel";
    msg($("oneMsg"), ""); refreshOptions();
    $("addPanel").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
    const next = !r.title ? $("fTitle") : !r.creator ? $("fCreator") : !r.category ? $("fCategory") : r.seconds == null ? $("fLength") : $("fTitle");
    next.focus({preventScroll:true});
  }

  $("fUrl").addEventListener("input", checkUrl);
  $("fCategory").addEventListener("input", refreshOptions);
  $("catChips").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    $("fCategory").value = b.dataset.cat; refreshOptions();
  });

  $("oneForm").addEventListener("submit", async e => {
    e.preventDefault();
    const url = cleanUrl($("fUrl").value);
    if (!url) { msg($("oneMsg"), "That link doesn't look right. Copy it from Facebook's Share menu and paste it again.", true); return; }
    const secs = parseLength($("fLength").value);
    if (Number.isNaN(secs)) { msg($("oneMsg"), "Write the length as m:ss, like 0:45 or 2:10.", true); $("fLength").focus(); return; }
    if (reels.some(r => r.url === url && r.id !== editingId)) { msg($("oneMsg"), "This reel is already on your shelf.", true); return; }
    const rec = {
      url, title: $("fTitle").value.trim(), creator: $("fCreator").value.trim(), category: $("fCategory").value.trim(),
      seconds: secs, date: $("fDate").value || today(), notes: $("fNotes").value.trim()
    };
    $("saveBtn").disabled = true;
    try {
      if (editingId) { await store.update(editingId, rec); toast("Saved changes"); }
      else { await store.add(rec); toast("Reel saved"); }
      resetOne();
    } catch (err) {
      msg($("oneMsg"), err?.code === "23505" ? "This reel is already on your shelf." : "Couldn't save. Check your connection and try again.", true);
    } finally { $("saveBtn").disabled = false; }
  });
  $("cancelEdit").addEventListener("click", resetOne);

  $("bulkForm").addEventListener("submit", async e => {
    e.preventDefault();
    const found = ($("bText").value.match(/https?:\/\/[^\s<>"']+/g) || []).map(cleanUrl).filter(Boolean);
    const fresh = [...new Set(found)].filter(u => !reels.some(r => r.url === u));
    if (!fresh.length) { msg($("bulkMsg"), found.length ? "All of those links are already saved." : "No links found in that text.", true); return; }
    const cat = $("bCategory").value.trim(), cr = $("bCreator").value.trim();
    const rows = fresh.map(url => ({url, creator: cr || creatorFromUrl(url), category: cat, date: today()}));
    const {error} = await sb.from("reels").upsert(rows, {onConflict: "url", ignoreDuplicates: true});
    if (error) { msg($("bulkMsg"), "Couldn't add those links. Check your connection and try again.", true); return; }
    await load();
    $("bulkForm").reset();
    msg($("bulkMsg"), `Added ${fresh.length} reel${fresh.length === 1 ? "" : "s"}${found.length > fresh.length ? `, skipped ${found.length - fresh.length} already saved` : ""}.`);
    toast(`Added ${fresh.length} reel${fresh.length === 1 ? "" : "s"}`);
  });

  $("list").addEventListener("click", async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest(".reel").dataset.id;
    const r = reels.find(x => x.id === id); if (!r) return;
    if (b.dataset.act === "edit") { startEdit(r); return; }
    if (b.dataset.armed) {
      try { await store.remove(id); toast("Reel deleted"); } catch { toast("Couldn't delete. Check your connection."); }
      if (editingId === id) resetOne();
    } else {
      b.dataset.armed = "1"; b.textContent = "Tap again to delete";
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 3000);
    }
  });

  $("tabOne").addEventListener("click", () => setTab(false));
  $("tabBulk").addEventListener("click", () => setTab(true));
  $("togglePanel").addEventListener("click", () => { setPanel($("addBody").hidden); saveUI(); });
  ["q","filWho","filCat","filCreator","filMonth","filLen"].forEach(id => $(id).addEventListener(id === "q" ? "input" : "change", render));
  ["groupBy","sortBy"].forEach(id => $(id).addEventListener("change", () => { saveUI(); render(); }));
  $("needBtn").addEventListener("click", () => { needOnly = !needOnly; render(); });
  $("clearFil").addEventListener("click", () => {
    ["q","filWho","filCat","filCreator","filMonth","filLen"].forEach(id => $(id).value = ""); needOnly = false; render();
  });
  $("refreshBtn").addEventListener("click", async () => { await load(); toast("Up to date"); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });

  /* ---------- settings ---------- */
  function openSettings(open){
    $("settingsPanel").hidden = !open;
    $("settingsBtn").setAttribute("aria-expanded", String(open));
    if (open) { fillSettings(); $("settingsPanel").scrollIntoView({block:"start"}); }
  }
  async function fillSettings(){
    $("meLine").textContent = `${names[me.id] || "You"} (${me.email})`;
    $("sName").value = names[me.id] || "";
    $("kUrl").textContent = CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/add_reel";
    $("kApi").textContent = CFG.supabaseKey;
    const {data} = await sb.from("shortcut_keys").select("token").eq("user_id", me.id).maybeSingle();
    showKey(data?.token);
  }
  function showKey(token){
    $("keyNone").hidden = !!token; $("keyShown").hidden = !token;
    $("kKey").textContent = token || "";
  }
  function newToken(){
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }
  async function makeKey(replace){
    const token = newToken();
    const {error} = await sb.from("shortcut_keys").upsert({user_id: me.id, token});
    if (error) { toast("Couldn't make a key. Check your connection."); return; }
    showKey(token);
    $("newKeyNote").hidden = !replace;
  }
  $("settingsBtn").addEventListener("click", () => openSettings($("settingsPanel").hidden));
  $("settingsClose").addEventListener("click", () => openSettings(false));
  $("makeKey").addEventListener("click", () => makeKey(false));
  $("newKey").addEventListener("click", e => {
    const b = e.currentTarget;
    if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Replace my key"; makeKey(true); return; }
    b.dataset.armed = "1"; b.textContent = "Tap again: your Shortcut will need the new key";
    setTimeout(() => { delete b.dataset.armed; b.textContent = "Replace my key"; }, 4000);
  });
  $("settingsPanel").addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const el = $(b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1500); }
    catch { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Tap Copy in the menu."); }
  });
  $("renameForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("sName").value.trim(); if (!name) return;
    const {error} = await sb.from("members").upsert({user_id: me.id, name});
    if (error) { toast("Couldn't save your name: " + (error.message || "check your connection.")); return; }
    names[me.id] = name; fillSettings(); render(); toast("Name saved");
  });
  $("signOut").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  /* ---------- sign in ---------- */
  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("aBtn").disabled = true; $("aErr").hidden = true;
    const {error} = await sb.auth.signInWithPassword({email: $("aEmail").value.trim(), password: $("aPass").value});
    $("aBtn").disabled = false;
    if (error) { $("aErr").textContent = "That email and password didn't match. Check them and try again."; $("aErr").hidden = false; return; }
    await enter();
  });
  $("nameForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("nName").value.trim(); if (!name) return;
    const {error} = await sb.from("members").upsert({user_id: me.id, name});
    if (error) { toast("Couldn't save your name: " + (error.message || "check your connection.")); return; }
    names[me.id] = name;
    await enter();
  });

  // A link handed to the app by ?add=, ?url= or ?text= (Android share menu, or a bookmark).
  function takeSharedLink(){
    const p = new URLSearchParams(location.search);
    const raw = [p.get("add"), p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
    if (raw) {
      try { sessionStorage.setItem(PENDING_KEY, raw); } catch {}
      history.replaceState(null, "", location.pathname);
    }
  }
  function applyPending(){
    let raw = null;
    try { raw = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch {}
    const url = raw && cleanUrl(raw);
    if (!url) return;
    resetOne(); setPanel(true); setTab(false);
    $("fUrl").value = url; checkUrl();
    $("fTitle").focus();
  }

  async function enter(){
    const {data} = await sb.auth.getUser();
    me = data.user;
    if (!me) { show("viewAuth"); return; }
    const {data: mine} = await sb.from("members").select("name").eq("user_id", me.id).maybeSingle();
    if (!mine) { show("viewName"); $("nName").focus(); return; }
    names[me.id] = mine.name;
    show("viewApp");
    await load();
    applyPending();
  }

  async function start(){
    takeSharedLink();
    if (!CFG.supabaseUrl || !CFG.supabaseKey || /YOUR-|PASTE/.test(CFG.supabaseUrl + CFG.supabaseKey) || !window.supabase) { show("viewSetup"); return; }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth: {persistSession: true, autoRefreshToken: true}});
    $("fDate").value = today();
    loadUI();
    const {data} = await sb.auth.getSession();
    if (!data.session) { show("viewAuth"); return; }
    await enter();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  start();
})();
