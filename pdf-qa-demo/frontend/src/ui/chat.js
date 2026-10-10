function esc(s) {
    return s
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}
export class ChatUI {
    onSend;
    onHL;
    feed;
    input;
    btn;
    constructor(id, onSend, onHL) {
        this.onSend = onSend;
        this.onHL = onHL;
        const root = document.getElementById(id);
        this.feed = root.querySelector(".chat-feed");
        this.input = root.querySelector(".chat-input");
        this.btn = root.querySelector(".chat-send");
        this.btn.addEventListener("click", () => this.submit());
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.submit();
            }
        });
    }
    async submit() {
        const q = this.input.value.trim();
        if (!q)
            return;
        this.input.value = "";
        this.addUser(q);
        this.setLoading(true);
        await this.onSend(q);
        this.setLoading(false);
    }
    addUser(text) {
        this.append(`
      <div class="msg msg--user">
        <div class="bubble">${esc(text)}</div>
      </div>`);
    }
    addAssistant(text, resp) {
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
            el.querySelectorAll(".chip").forEach((c) => {
                c.addEventListener("click", () => this.onHL(resp.sources));
            });
        }
    }
    addError(msg) {
        this.append(`<div class="chat-err">Error: ${esc(msg)}</div>`);
    }
    setLoading(on) {
        this.btn.disabled = this.input.disabled = on;
        if (on) {
            this.append(`
        <div class="msg msg--ai" id="typing">
          <div class="bubble">
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
        </div>`);
        }
        else {
            document.getElementById("typing")?.remove();
        }
    }
    append(html) {
        this.feed.querySelector(".chat-empty")?.remove();
        const div = document.createElement("div");
        div.innerHTML = html.trim();
        const node = div.firstElementChild;
        node.style.opacity = "0";
        this.feed.appendChild(node);
        requestAnimationFrame(() => {
            node.style.transition = "opacity 0.25s";
            node.style.opacity = "1";
        });
        this.feed.scrollTop = this.feed.scrollHeight;
        return node;
    }
    enable() {
        this.input.disabled = this.btn.disabled = false;
        this.input.placeholder = "Ask anything about this document…";
        this.input.focus();
    }
    disable() {
        this.input.disabled = this.btn.disabled = true;
        this.input.placeholder = "Upload a PDF first…";
    }
}
