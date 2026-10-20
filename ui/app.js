const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let chats = store.get("chats", []);          // [{id, title, messages:[{role, content, images?, reasoning?, stats?}]}]
let currentId = store.get("current", null);
const settings = Object.assign({ system: "", temp: 0.7, maxTok: 4096, think: true }, store.get("settings", {}));
let pending = [];                            // data: URLs of images to send
let controller = null;

const save = () => { store.set("chats", chats); store.set("current", currentId); };
const saveSettings = () => store.set("settings", settings);
const current = () => chats.find((c) => c.id === currentId);

function md(text) {
  if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(text));
  const d = document.createElement("div"); d.textContent = text; return `<div style="white-space:pre-wrap">${d.innerHTML}</div>`;
}

/* ---------- sidebar ---------- */
function renderChats() {
  const list = $("chats"); list.innerHTML = "";
  for (const c of chats) {
    const el = document.createElement("div");
    el.className = "chat-item" + (c.id === currentId ? " active" : "");
    el.innerHTML = `<span></span><button title="Delete">✕</button>`;
    el.querySelector("span").textContent = c.title || "New chat";
    el.onclick = () => { currentId = c.id; save(); renderAll(); $("side").classList.remove("open"); };
    el.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      if (!confirm("Delete this chat?")) return;
      chats = chats.filter((x) => x.id !== c.id);
      if (currentId === c.id) currentId = chats[0]?.id ?? null;
      save(); renderAll();
    };
    list.appendChild(el);
  }
}

/* ---------- messages ---------- */
function messageEl(m, i) {
  const el = document.createElement("div");
  el.className = "msg " + m.role;
  if (m.role === "user") {
    for (const src of m.images || []) { const img = new Image(); img.src = src; el.appendChild(img); }
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.content; el.appendChild(b);
    return el;
  }
  if (m.reasoning) {
    const d = document.createElement("details"); d.className = "think";
    d.innerHTML = `<summary>Thought process</summary><div></div>`;
    d.querySelector("div").textContent = m.reasoning;
    el.appendChild(d);
  }
  const body = document.createElement("div"); body.className = "body";
  body.innerHTML = m.error ? `<p class="error"></p>` : md(m.content || "");
  if (m.error) body.firstChild.textContent = m.error;
  el.appendChild(body);
  const meta = document.createElement("div"); meta.className = "meta";
  if (m.stats) meta.append(Object.assign(document.createElement("span"), { textContent: m.stats }));
  const copy = Object.assign(document.createElement("button"), { textContent: "Copy" });
  copy.onclick = () => navigator.clipboard?.writeText(m.content || "").then(() => { copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1200); });
  meta.append(copy);
  const chat = current();
  if (chat && i === chat.messages.length - 1) {
    const regen = Object.assign(document.createElement("button"), { textContent: "Regenerate" });
    regen.onclick = () => { if (controller) return; chat.messages.pop(); save(); renderMessages(); generate(); };
    meta.append(regen);
  }
  el.appendChild(meta);
  return el;
}

function renderMessages() {
  const box = $("msgs"); box.innerHTML = "";
  const chat = current();
  if (!chat || !chat.messages.length) {
    box.innerHTML = `<div class="empty"><h1>Uncensored Chat</h1><p>Qwen3.6-27B Uncensored · runs entirely on your server</p></div>`;
    return;
  }
  chat.messages.forEach((m, i) => box.appendChild(messageEl(m, i)));
  scrollDown(true);
}

function scrollDown(force) {
  const log = $("log");
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
}

function renderAll() { renderChats(); renderMessages(); }

/* ---------- sending ---------- */
function toApi(m) {
  if (m.role === "user" && m.images?.length) {
    return { role: "user", content: [
      ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
      { type: "text", text: m.content },
    ] };
  }
  return { role: m.role, content: m.content || "" };
}

async function send() {
  const text = $("input").value.trim();
  if ((!text && !pending.length) || controller) return;
  let chat = current();
  if (!chat) {
    chat = { id: Date.now().toString(36), title: "", messages: [] };
    chats.unshift(chat); currentId = chat.id;
  }
  if (!chat.title) chat.title = (text || "Image").slice(0, 48);
  chat.messages.push({ role: "user", content: text, images: pending });
  pending = []; renderAttachments();
  $("input").value = ""; autosize();
  // move the active chat to the top of the list
  chats = [chat, ...chats.filter((c) => c !== chat)];
  save(); renderAll();
  generate();
}

async function generate() {
  const chat = current();
  const reply = { role: "assistant", content: "", reasoning: "" };
  chat.messages.push(reply);
  const msgs = $("msgs");
  if (msgs.querySelector(".empty")) msgs.innerHTML = "";
  let el = messageEl(reply, -1); el.querySelector(".body").classList.add("cursor"); el.querySelector(".meta").hidden = true;
  msgs.appendChild(el); scrollDown(true);

  const history = chat.messages.slice(0, -1).map(toApi);
  if (settings.system.trim()) history.unshift({ role: "system", content: settings.system.trim() });

  controller = new AbortController();
  setBusy(true);
  const t0 = performance.now();
  let timings = null, lastPaint = 0;

  const paint = (final) => {
    const fresh = messageEl(reply, final ? chat.messages.length - 1 : -1);
    if (!final) { fresh.querySelector(".body").classList.add("cursor"); fresh.querySelector(".meta").hidden = true; }
    const open = el.querySelector("details.think")?.open;
    if (open || (!final && reply.reasoning && !reply.content)) fresh.querySelector("details.think")?.setAttribute("open", "");
    el.replaceWith(fresh); el = fresh; scrollDown();
  };

  try {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: history, stream: true,
        temperature: settings.temp, max_tokens: settings.maxTok,
        chat_template_kwargs: { enable_thinking: settings.think },
        timings_per_token: false,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message || `HTTP ${res.status}`);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const j = JSON.parse(line.slice(6));
        const d = j.choices?.[0]?.delta || {};
        if (d.reasoning_content) reply.reasoning += d.reasoning_content;
        if (d.content) reply.content += d.content;
        if (j.timings) timings = j.timings;
      }
      if (performance.now() - lastPaint > 60) { paint(false); lastPaint = performance.now(); }
    }
  } catch (e) {
    if (e.name !== "AbortError") reply.error = "Error: " + e.message;
  }
  if (timings) reply.stats = `${timings.predicted_n} tokens · ${timings.predicted_per_second.toFixed(1)} tok/s`;
  else reply.stats = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
  if (!reply.reasoning) delete reply.reasoning;
  controller = null; setBusy(false);
  save(); paint(true);
}

function setBusy(busy) {
  const b = $("send");
  b.textContent = busy ? "Stop" : "Send";
  b.classList.toggle("stop", busy);
  updateSend();
}
function updateSend() { $("send").disabled = !controller && !$("input").value.trim() && !pending.length; }

/* ---------- images ---------- */
function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const r = new FileReader();
    r.onload = () => { pending.push(r.result); renderAttachments(); };
    r.readAsDataURL(f);
  }
}
function renderAttachments() {
  const a = $("attachments"); a.innerHTML = "";
  pending.forEach((src, i) => {
    const d = document.createElement("div");
    d.innerHTML = `<img><button title="Remove">✕</button>`;
    d.querySelector("img").src = src;
    d.querySelector("button").onclick = () => { pending.splice(i, 1); renderAttachments(); };
    a.appendChild(d);
  });
  updateSend();
}

/* ---------- wiring ---------- */
function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; updateSend(); }
$("input").addEventListener("input", autosize);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
$("input").addEventListener("paste", (e) => addFiles([...e.clipboardData.files]));
$("send").onclick = () => controller ? controller.abort() : send();
$("newChat").onclick = () => { currentId = null; save(); renderAll(); $("input").focus(); $("side").classList.remove("open"); };
$("attach").onclick = () => $("file").click();
$("file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
$("menu").onclick = () => $("side").classList.toggle("open");
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

$("system").value = settings.system;
$("system").oninput = () => { settings.system = $("system").value; saveSettings(); };
$("temp").value = settings.temp; $("tempVal").textContent = settings.temp;
$("temp").oninput = () => { settings.temp = +$("temp").value; $("tempVal").textContent = settings.temp; saveSettings(); };
$("maxTok").value = settings.maxTok;
$("maxTok").onchange = () => { settings.maxTok = Math.max(64, +$("maxTok").value || 4096); saveSettings(); };
const thinkBtn = $("think");
thinkBtn.classList.toggle("on", settings.think);
thinkBtn.onclick = () => { settings.think = !settings.think; thinkBtn.classList.toggle("on", settings.think); saveSettings(); };

fetch("/health").then((r) => {
  $("status").textContent = r.ok ? "model ready" : "model loading…";
  $("status").className = r.ok ? "ok" : "bad";
}).catch(() => { $("status").textContent = "server offline"; $("status").className = "bad"; });

if (!current()) currentId = null;
renderAll();
$("input").focus();
