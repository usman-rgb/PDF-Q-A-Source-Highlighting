import axios from "axios";
const http = axios.create({
    // In development, Vite proxies /api to the backend so the browser uses one origin.
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
    headers: { "X-API-Key": import.meta.env.VITE_API_KEY },
    timeout: 45_000,
});
http.interceptors.request.use((config) => {
    const email = localStorage.getItem("docmind:session");
    if (email)
        config.headers.set("X-User-Email", email);
    return config;
});
export async function uploadPDF(file) {
    const form = new FormData();
    form.append("file", file);
    const { data } = await http.post("/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
}
export async function queryDoc(docId, question, topK = 3, docIds = []) {
    const { data } = await http.post("/query", {
        doc_id: docId,
        doc_ids: docIds,
        question,
        top_k: topK,
    });
    return data;
}
export async function getDocumentInsight(docId, mode, docIds = []) {
    const { data } = await http.post("/insights", {
        doc_id: docId,
        doc_ids: docIds,
        mode,
        top_k: 5,
    });
    return data;
}
export async function listDocuments() {
    const { data } = await http.get("/documents");
    return data;
}
export async function downloadDocument(docId, filename) {
    const { data } = await http.get(`/documents/${encodeURIComponent(docId)}/file`, {
        responseType: "blob",
    });
    return new File([data], filename, { type: "application/pdf" });
}
export async function syncWorkspace(name, answerStyle) {
    const email = localStorage.getItem("docmind:session");
    if (!email)
        return;
    await http.put("/workspace", { email, name, answer_style: answerStyle });
}
export async function getWorkspace() {
    const { data } = await http.get("/workspace");
    return data;
}
