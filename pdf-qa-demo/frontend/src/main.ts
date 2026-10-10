import { BackgroundScene } from "./three/scene";
import { PDFViewer } from "./ui/pdfViewer";
import { ChatUI } from "./ui/chat";
import { downloadDocument, getDocumentInsight, getWorkspace, listDocuments, syncWorkspace, uploadPDF, queryDoc } from "./api/client";
import type { AppState, DocumentRecord } from "./types";
import "./style.css";

// ── State ─────────────────────────────────────────────────────────────────────
const state: AppState = {
  docId: null, filename: null,
  isUploading: false, isQuerying: false,
  currentPage: 1, totalPages: 0,
  pdfDoc: null, pendingHighlights: [], documents: [], compareMode: false,
};
const importantIds = new Set<string>();
const reviewedIds = new Set<string>();
let activeView = "home";
type UserAccount = { email: string; name: string; passwordHash: string };
let registerMode = false;

type WorkspaceSettings = { name: string; answerStyle: "strict" | "detailed" };

function getWorkspaceSettings(): WorkspaceSettings {
  const email = localStorage.getItem("docmind:session");
  if (!email) return { name: "My workspace", answerStyle: "strict" };
  try {
    return JSON.parse(localStorage.getItem(`docmind:settings:${email}`) ?? "{\"name\":\"My workspace\",\"answerStyle\":\"strict\"}") as WorkspaceSettings;
  } catch {
    return { name: "My workspace", answerStyle: "strict" };
  }
}

function saveWorkspaceSettings(settings: WorkspaceSettings): void {
  const email = localStorage.getItem("docmind:session");
  if (!email) return;
  localStorage.setItem(`docmind:settings:${email}`, JSON.stringify(settings));
  document.getElementById("workspace-name")!.textContent = settings.name;
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getAccounts(): UserAccount[] {
  try { return JSON.parse(localStorage.getItem("docmind:accounts") ?? "[]") as UserAccount[]; }
  catch { return []; }
}

function setAuthMessage(message: string, error = true): void {
  const element = document.getElementById("auth-message");
  if (element) { element.textContent = message; element.className = `auth-message ${error ? "is-error" : "is-success"}`; }
}

function setAuthMode(register: boolean): void {
  document.getElementById("auth-title")!.textContent = register ? "Create your workspace" : "Welcome back!";
  document.getElementById("auth-subtitle")!.textContent = register ? "Start building your private knowledge base." : "Sign in to continue to your workspace.";
  document.getElementById("auth-name-field")!.hidden = !register;
  (document.getElementById("auth-name") as HTMLInputElement).required = register;
  document.getElementById("auth-submit")!.innerHTML = register ? "Create account <span>→</span>" : "Login <span>→</span>";
  document.getElementById("auth-switch-copy")!.textContent = register ? "Already have an account?" : "Don't have an account?";
  document.getElementById("auth-switch")!.textContent = register ? "Login" : "Create account";
  document.getElementById("forgot-password")!.hidden = register;
  document.getElementById("auth-form")!.dataset.mode = register ? "register" : "login";
  setAuthMessage("");
}

function enterWorkspace(account: UserAccount): void {
  const firstName = account.name.split(" ")[0] || account.email.split("@")[0];
  localStorage.setItem("docmind:session", account.email);
  const settings = getWorkspaceSettings();
  document.getElementById("workspace-name")!.textContent = settings.name === "My workspace" ? `${firstName}'s workspace` : settings.name;
  document.getElementById("workspace-email")!.textContent = account.email;
  document.querySelectorAll(".avatar, .top-avatar").forEach((element) => element.textContent = firstName[0].toUpperCase());
  document.getElementById("auth-screen")!.style.display = "none";
  document.getElementById("app")!.style.display = "flex";
  void restoreWorkspace(firstName);
  void restoreDocuments();
}

async function restoreWorkspace(firstName: string): Promise<void> {
  try {
    const remote = await getWorkspace();
    const settings = { name: remote.name || `${firstName}'s workspace`, answerStyle: remote.answer_style };
    localStorage.setItem(`docmind:settings:${accountEmail()}`, JSON.stringify(settings));
    document.getElementById("workspace-name")!.textContent = settings.name;
  } catch {
    // Local settings remain available when the backend is temporarily offline.
  }
}

function accountEmail(): string {
  return localStorage.getItem("docmind:session") ?? "";
}

async function restoreDocuments(): Promise<void> {
  try {
    const stored = await listDocuments();
    const restored = await Promise.all(stored.map(async (document) => ({
      ...document,
      file: await downloadDocument(document.doc_id, document.filename),
    })));
    state.documents = restored;
    renderWorkspaceFiles();
    renderShelfWorkspace();
  } catch {
    // A fresh workspace or an unavailable local API should not block login.
  }
}

function leaveWorkspace(): void {
  registerMode = false;
  localStorage.removeItem("docmind:session");
  document.getElementById("app")!.style.display = "none";
  document.getElementById("auth-screen")!.style.display = "grid";
  setAuthMode(false);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderWorkspaceFiles(): void {
  const list = document.getElementById("file-list");
  const count = document.getElementById("file-count");
  if (!list) return;
  const documents = state.documents.filter((document) =>
    activeView === "important" ? importantIds.has(document.doc_id)
      : activeView === "reviewed" ? reviewedIds.has(document.doc_id)
      : true,
  );
  if (count) count.textContent = `${documents.length} document${documents.length === 1 ? "" : "s"}`;
  list.innerHTML = documents.length ? documents.map((document) => `
    <div class="file-row" data-doc-id="${document.doc_id}">
      <button class="file-name file-open" data-doc-id="${document.doc_id}" title="Open document">
        <span class="file-icon">PDF</span><span>${escapeHtml(document.filename)}<small>${document.chunks} indexed passages</small></span>
      </button>
      <span class="file-status">Ready</span><span class="file-date">Just now</span>
      <span class="file-size">${formatBytes(document.file.size)}</span>
      <button class="file-more" data-menu-id="${document.doc_id}" aria-label="Document actions">···</button>
    </div>
  `).join("") : `<div class="file-empty">${activeView === "important" || activeView === "reviewed"
    ? "No tagged documents yet. Use the ··· menu on a document to add a tag."
    : "Your uploaded documents will appear here."}</div>`;
  list.querySelectorAll<HTMLButtonElement>(".file-open").forEach((button) =>
    button.addEventListener("click", () => openDocument(button.dataset.docId)));
  list.querySelectorAll<HTMLButtonElement>(".file-more").forEach((button) =>
    button.addEventListener("click", () => showDocumentMenu(button.dataset.menuId, button)));
}

function openDocument(docId?: string): void {
  const selected = state.documents.find((document) => document.doc_id === docId);
  if (!selected) return;
  state.docId = selected.doc_id;
  state.filename = selected.filename;
  state.pendingHighlights = [];
  void viewer.load(selected.file).then(() => {
    document.getElementById("pdf-name")!.textContent = selected.filename;
    document.getElementById("upload")!.style.display = "none";
    document.getElementById("main")!.style.display = "grid";
    pageInfo();
    renderShelfWorkspace();
  });
}

function renderShelfWorkspace(): void {
  const shelf = document.getElementById("doc-shelf");
  if (!shelf) return;
  shelf.innerHTML = state.documents.map((document) => `
    <button class="doc-pill ${document.doc_id === state.docId ? "is-selected" : ""}" data-doc-id="${document.doc_id}">
      <span class="doc-pill-icon">PDF</span><span class="doc-pill-name">${escapeHtml(document.filename)}</span>
      <span class="doc-pill-meta">${document.pages}p</span>
    </button>`).join("");
  shelf.querySelectorAll<HTMLButtonElement>(".doc-pill").forEach((button) =>
    button.addEventListener("click", () => openDocument(button.dataset.docId)));
}

function showDocumentMenu(docId: string | undefined, anchor: HTMLElement): void {
  if (!docId) return;
  const documentRecord = state.documents.find((document) => document.doc_id === docId);
  if (!documentRecord) return;
  const menu = document.createElement("div");
  menu.className = "document-menu";
  menu.innerHTML = `<button data-action="open">Open in viewer</button>
    <button data-action="important">${importantIds.has(docId) ? "Remove Important" : "Mark Important"}</button>
    <button data-action="reviewed">${reviewedIds.has(docId) ? "Remove Reviewed" : "Mark Reviewed"}</button>`;
  anchor.parentElement?.appendChild(menu);
  menu.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).dataset.action;
    if (action === "open") openDocument(docId);
    if (action === "important") importantIds.has(docId) ? importantIds.delete(docId) : importantIds.add(docId);
    if (action === "reviewed") reviewedIds.has(docId) ? reviewedIds.delete(docId) : reviewedIds.add(docId);
    renderWorkspaceFiles();
    menu.remove();
  });
  const close = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) { menu.remove(); document.removeEventListener("click", close); }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

function showModal(title: string, body: string): void {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true">
    <div class="modal-header"><h2>${title}</h2><button class="modal-close" aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div></section></div>`;
  root.hidden = false;
  root.querySelector(".modal-close")?.addEventListener("click", () => { root.hidden = true; });
  root.querySelector(".modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) root.hidden = true;
  });
}

// ── Three.js background ───────────────────────────────────────────────────────
const bg = new BackgroundScene(document.getElementById("bg") as HTMLCanvasElement);

// ── PDF Viewer ────────────────────────────────────────────────────────────────
const viewer = new PDFViewer("pdf-wrap");

// ── Chat ──────────────────────────────────────────────────────────────────────
const chat = new ChatUI(
  "chat",
  async (question) => {
    if (!state.docId) return;
    state.isQuerying = true;
    bg.pulseQuery(true);
    try {
      const ids = state.compareMode
        ? state.documents.map((document) => document.doc_id)
        : [state.docId];
      const resp = await queryDoc(state.docId, question, 3, ids);
      chat.addAssistant(resp.answer, resp);
      state.pendingHighlights = resp.sources;
      viewer.highlight(resp.sources);
      pageInfo();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? "Something went wrong.";
      chat.addError(msg.includes("AI service") || msg.includes("Embedding service")
        ? "AI service is temporarily unavailable. Please check your Gemini configuration and try again."
        : msg);
    } finally {
      state.isQuerying = false;
      bg.pulseQuery(false);
    }
  },
  (sources) => {
    viewer.highlight(sources);
    pageInfo();
  },
);
chat.disable();

// ── Upload ────────────────────────────────────────────────────────────────────
const zone   = document.getElementById("zone")!;
const fileIn = document.getElementById("file-in") as HTMLInputElement;
const status = document.getElementById("status")!;
document.getElementById("upload-cta")?.addEventListener("click", () => fileIn.click());

zone.addEventListener("click", () => fileIn.click());
zone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileIn.click();
  }
});
zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
zone.addEventListener("dragleave", () => zone.classList.remove("over"));
zone.addEventListener("drop", (e) => {
  e.preventDefault(); zone.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) handle(f);
});
fileIn.addEventListener("change", () => {
  if (fileIn.files?.length) void handleFiles(Array.from(fileIn.files));
  fileIn.value = "";
});

async function handleFiles(files: File[]): Promise<void> {
  for (const file of files) await handle(file);
}

async function handle(file: File): Promise<void> {
  if (state.isUploading) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) { setStatus("Only PDF files work here.", "err"); return; }
  if (file.size > 20 * 1024 * 1024)             { setStatus("Max file size is 20 MB.", "err"); return; }

  state.isUploading = true;
  setStatus("Reading PDF…", "load");
  zone.classList.add("busy");

  try {
    const res = await uploadPDF(file);
    const record: DocumentRecord = { ...res, file };
    state.documents.push(record);
    state.docId = res.doc_id;
    state.filename = res.filename;
    state.totalPages = await viewer.load(file);

    document.getElementById("pdf-name")!.textContent = res.filename;
    setStatus(`${res.pages} pages · ${res.chunks} chunks indexed`, "ok");
    renderWorkspaceFiles();
    document.getElementById("main")!.style.display = "grid";
    document.getElementById("upload")!.style.display = "none";
    pageInfo();
    chat.enable();
    chat.addAssistant(
      `I've read ${res.filename} (${res.pages} pages). What would you like to know?`
    );
    renderShelf();
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } } })
      ?.response?.data?.detail ?? "Upload failed.";
    setStatus(msg, "err");
  } finally {
    state.isUploading = false;
    zone.classList.remove("busy");
  }

  function renderShelf(): void {
    const shelf = document.getElementById("doc-shelf");
    if (!shelf) return;
    shelf.innerHTML = state.documents.map((document) => `
      <button class="doc-pill ${document.doc_id === state.docId ? "is-selected" : ""}" data-doc-id="${document.doc_id}">
        <span class="doc-pill-icon">PDF</span>
        <span class="doc-pill-name">${escapeHtml(document.filename)}</span>
        <span class="doc-pill-meta">${document.pages}p</span>
      </button>
    `).join("");
    shelf.querySelectorAll<HTMLButtonElement>(".doc-pill").forEach((button) => {
      button.addEventListener("click", async () => {
        const selected = state.documents.find((document) => document.doc_id === button.dataset.docId);
        if (!selected) return;
        state.docId = selected.doc_id;
        state.filename = selected.filename;
        state.pendingHighlights = [];
        await viewer.load(selected.file);
        document.getElementById("pdf-name")!.textContent = selected.filename;
        renderShelf();
        pageInfo();
      });
    });
  }

}

function setStatus(msg: string, type: "load" | "ok" | "err"): void {
  status.textContent = msg;
  status.className = `status status--${type}`;
  status.hidden = false;
}

function pageInfo(): void {
  document.getElementById("page-info")!.textContent =
    `${viewer.currentPage} / ${viewer.total}`;
  const previous = document.getElementById("prev") as HTMLButtonElement | null;
  const next = document.getElementById("next") as HTMLButtonElement | null;
  if (previous) previous.disabled = viewer.currentPage <= 1;
  if (next) next.disabled = viewer.currentPage >= viewer.total;
}

document.getElementById("prev")?.addEventListener("click", () => {
  viewer.prev();
  if (state.pendingHighlights.length) viewer.highlight(state.pendingHighlights);
  pageInfo();
});
document.getElementById("next")?.addEventListener("click", () => {
  viewer.next();
  if (state.pendingHighlights.length) viewer.highlight(state.pendingHighlights);
  pageInfo();
});

document.getElementById("scope-current")?.addEventListener("click", () => {
  state.compareMode = false;
  updateScopeButtons();
});
document.getElementById("scope-all")?.addEventListener("click", () => {
  state.compareMode = state.documents.length > 1;
  updateScopeButtons();
});

async function requestInsight(mode: "summary" | "key_points"): Promise<void> {
  if (!state.docId || state.isQuerying) return;
  state.isQuerying = true;
  bg.pulseQuery(true);
  document.querySelectorAll<HTMLButtonElement>(".insight-btn").forEach((button) => { button.disabled = true; });
  try {
    const ids = state.compareMode ? state.documents.map((document) => document.doc_id) : [state.docId];
    const response = await getDocumentInsight(state.docId, mode, ids);
    chat.addAssistant(response.answer, {
      answer: response.answer,
      sources: response.sources,
      doc_id: response.doc_id,
      doc_ids: response.doc_ids,
      question: mode === "summary" ? "Document summary" : "Key points",
      timestamp: response.timestamp,
    });
    state.pendingHighlights = response.sources;
    viewer.highlight(response.sources);
    pageInfo();
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Insight generation failed.";
    chat.addError(msg);
  } finally {
    state.isQuerying = false;
    bg.pulseQuery(false);
    document.querySelectorAll<HTMLButtonElement>(".insight-btn").forEach((button) => { button.disabled = false; });
  }
}

document.getElementById("summary-btn")?.addEventListener("click", () => void requestInsight("summary"));
document.getElementById("key-points-btn")?.addEventListener("click", () => void requestInsight("key_points"));

function updateScopeButtons(): void {
  document.getElementById("scope-current")?.classList.toggle("is-active", !state.compareMode);
  document.getElementById("scope-all")?.classList.toggle("is-active", state.compareMode);
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view ?? "home";
    activeView = view;
    document.querySelectorAll("[data-view]").forEach((item) =>
      item.classList.toggle("is-active", (item as HTMLElement).dataset.view === view));
    if (view === "team") {
      showModal("Team workspace", `<p class="modal-muted">Invite teammates to collaborate on your knowledge base.</p>
        <div class="member-row"><span class="member-avatar">U</span><span><strong>You</strong><small>Owner · Active now</small></span><b>Owner</b></div>
        <div class="member-row"><span class="member-avatar">A</span><span><strong>Alex Morgan</strong><small>Editor · Active</small></span><b>Editor</b></div>
        <button class="primary-btn modal-action">＋ Invite member</button>`);
      return;
    }
    if (view === "settings") {
      const settings = getWorkspaceSettings();
      showModal("Workspace settings", `<label class="setting-row"><span>Workspace name</span><input id="workspace-name-input" value="${escapeHtml(settings.name)}" /></label>
        <label class="setting-row"><span>AI answer style</span><select id="answer-style"><option value="strict" ${settings.answerStyle === "strict" ? "selected" : ""}>Strict and cited</option><option value="detailed" ${settings.answerStyle === "detailed" ? "selected" : ""}>Detailed</option></select></label>
        <p class="modal-muted">Answers always use retrieved document context and page citations.</p>
        <button class="primary-btn modal-action" id="save-settings">Save changes</button>`);
      document.getElementById("save-settings")?.addEventListener("click", () => {
        const name = (document.getElementById("workspace-name-input") as HTMLInputElement).value.trim();
        const answerStyle = (document.getElementById("answer-style") as HTMLSelectElement).value as WorkspaceSettings["answerStyle"];
        if (!name) return;
        saveWorkspaceSettings({ name, answerStyle });
        void syncWorkspace(name, answerStyle).catch(() => {
          setStatus("Workspace saved locally; server sync will retry on next login.", "err");
        });
        document.getElementById("modal-root")!.hidden = true;
        setAuthMessage("");
      });
      return;
    }
    if (view === "components" || view === "research") {
      showModal(view === "components" ? "Components" : "Research", `<p class="modal-muted">This workspace section is ready for organizing ${view === "components" ? "reusable document components" : "research documents"}.</p>
        <button class="primary-btn modal-action" id="modal-upload">＋ Add PDF</button>`);
      document.getElementById("modal-upload")?.addEventListener("click", () => {
        document.getElementById("modal-root")!.hidden = true;
        fileIn.click();
      });
      return;
    }
    document.getElementById("modal-root")!.hidden = true;
    document.getElementById("upload")!.style.display = "block";
    if (state.docId && (view === "documents" || view === "home")) {
      document.getElementById("main")!.style.display = view === "documents" ? "grid" : "none";
    }
    renderWorkspaceFiles();
  });
});

document.getElementById("search-btn")?.addEventListener("click", () => {
  showModal("Search documents", `<input id="document-search" class="modal-search" placeholder="Search by filename…" autofocus />
    <div id="search-results" class="search-results"></div>`);
  const input = document.getElementById("document-search") as HTMLInputElement | null;
  const results = document.getElementById("search-results");
  const renderResults = () => {
    const query = input?.value.toLowerCase() ?? "";
    const matches = state.documents.filter((document) => document.filename.toLowerCase().includes(query));
    if (results) results.innerHTML = matches.map((document) => `<button data-doc-id="${document.doc_id}">PDF · ${escapeHtml(document.filename)}</button>`).join("")
      || `<p class="modal-muted">No matching documents.</p>`;
    results?.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      document.getElementById("modal-root")!.hidden = true;
      openDocument((button as HTMLElement).dataset.docId);
    }));
  };
  input?.addEventListener("input", renderResults);
  renderResults();
});

document.getElementById("notifications-btn")?.addEventListener("click", () => {
  showModal("Notifications", `<div class="notification-item"><span class="live-dot"></span><span><strong>Workspace secured</strong><small>Your documents are stored locally for this session.</small></span></div>
    <div class="notification-item"><span class="live-dot"></span><span><strong>AI assistant ready</strong><small>Retrieval-first answers and source highlighting are enabled.</small></span></div>`);
});

const authForm = document.getElementById("auth-form") as HTMLFormElement;
document.getElementById("auth-switch")?.addEventListener("click", () => {
  registerMode = !registerMode;
  setAuthMode(registerMode);
});
document.getElementById("forgot-password")?.addEventListener("click", () => {
  setAuthMessage("Password recovery is not connected yet. Create a new account or contact your workspace owner.");
});
document.getElementById("logout-btn")?.addEventListener("click", leaveWorkspace);
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = (document.getElementById("auth-email") as HTMLInputElement).value.trim().toLowerCase();
  const password = (document.getElementById("auth-password") as HTMLInputElement).value;
  const name = (document.getElementById("auth-name") as HTMLInputElement).value.trim();
  const accounts = getAccounts();
  const existing = accounts.find((account) => account.email === email);
  const submit = document.getElementById("auth-submit") as HTMLButtonElement;
  submit.disabled = true;
  try {
    const passwordHash = await hashPassword(password);
    const isRegister = authForm.dataset.mode === "register";
    if (isRegister) {
      if (existing) { setAuthMessage("An account with this email already exists."); return; }
      const account = { email, name, passwordHash };
      localStorage.setItem("docmind:accounts", JSON.stringify([...accounts, account]));
      enterWorkspace(account);
    } else if (!existing || existing.passwordHash !== passwordHash) {
      setAuthMessage("Email or password is incorrect.");
    } else {
      enterWorkspace(existing);
    }
  } finally {
    submit.disabled = false;
  }
});

const savedEmail = localStorage.getItem("docmind:session");
const savedAccount = getAccounts().find((account) => account.email === savedEmail);
if (savedAccount) enterWorkspace(savedAccount);
else setAuthMode(false);
