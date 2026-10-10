import type { QueryResponse, SourceChunk } from "../types";

export type OnSend = (q: string) => Promise<void>;
export type OnHighlight = (sources: SourceChunk[]) => void;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}

export class ChatUI {
  private feed: HTMLElement;
  private input: HTMLInputElement;
  private btn: HTMLButtonElement;

  constructor(id: string, private onSend: OnSend, private onHL: OnHighlight) {
    const root = document.getElementById(id)!;
    this.feed  = root.querySelector<HTMLElement>(".chat-feed")!;
    this.input = root.querySelector<HTMLInputElement>(".chat-input")!;
    this.btn   = root.querySelector<HTMLButtonElement>(".chat-send")!;
    this.btn.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.submit(); }
    });
  }

  private async submit() {
    const q = this.input.value.trim();
    if (!q) return;
    this.input.value = "";
    this.addUser(q);
    this.setLoading(true);
    await this.onSend(q);
    this.setLoading(false);
  }

  addUser(text: string): void {
    this.append(`
      <div class="msg msg--user">
        <div class="bubble">${esc(text)}</div>
      </div>`);
  }

  addAssistant(text: string, resp?: QueryResponse): void {
    const chips = (resp?.sources ?? []).map((s, i) => `
      <button class="chip chip--${i}" data-idx="${i}">
        S${i + 1} · ${esc(s.filename)} · p.${s.page_label}
      </button>`).join("");

    const el = this.append(`
      <div class="msg msg--ai">
        <div class="bubble">
          <p>${esc(text)}</p>
          ${chips ? `<div class="chips">${chips}</div>` : ""}
        </div>
      </div>`);

    if (resp) {
      el.querySelectorAll<HTMLButtonElement>(".chip").forEach((c) => {
        c.addEventListener("click", () => this.onHL(resp.sources));
      });
    }
  }

  addError(msg: string): void {
    this.append(`<div class="chat-err">Error: ${esc(msg)}</div>`);
  }

  private setLoading(on: boolean): void {
    this.btn.disabled = this.input.disabled = on;
    if (on) {
      this.append(`
        <div class="msg msg--ai" id="typing">
          <div class="bubble">
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
        </div>`);
    } else {
      document.getElementById("typing")?.remove();
    }
  }

  private append(html: string): HTMLElement {
    this.feed.querySelector(".chat-empty")?.remove();
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    const node = div.firstElementChild as HTMLElement;
    node.style.opacity = "0";
    this.feed.appendChild(node);
    requestAnimationFrame(() => {
      node.style.transition = "opacity 0.25s";
      node.style.opacity = "1";
    });
    this.feed.scrollTop = this.feed.scrollHeight;
    return node;
  }

  enable(): void {
    this.input.disabled = this.btn.disabled = false;
    this.input.placeholder = "Ask anything about this document…";
    this.input.focus();
  }

  disable(): void {
    this.input.disabled = this.btn.disabled = true;
    this.input.placeholder = "Upload a PDF first…";
  }
}
