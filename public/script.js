/**
 * PWS AI Chat Assistant - Frontend Client
 * Praktikum Pemrograman Web Service (PWS) - Pertemuan 10
 * Fitur: Chat UI, SSE Streaming Reader, Markdown + Code Highlighting, Stop/Abort Controller, Local Storage Persistence.
 */

document.addEventListener("DOMContentLoaded", () => {
    // --- DOM Elements ---
    const chatForm = document.getElementById("chat-form");
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");
    const stopBtn = document.getElementById("stop-btn");
    const clearBtn = document.getElementById("clear-btn");
    const messagesViewport = document.getElementById("messages-viewport");
    const messagesList = document.getElementById("messages-list");
    const welcomeScreen = document.getElementById("welcome-screen");
    const scrollBottomBtn = document.getElementById("scroll-bottom-btn");
    const statusIndicator = document.getElementById("status-indicator");
    const connectionStatus = document.getElementById("connection-status");
    const charCounter = document.getElementById("char-counter");
    const toastContainer = document.getElementById("toast-container");
    const promptChips = document.querySelectorAll(".prompt-chip");

    // --- State Variables ---
    const STORAGE_KEY = "pws_chat_conversation_v1";
    let conversation = [];
    let isStreaming = false;
    let abortController = null;
    let currentBotMessageElement = null;

    // --- Configure Marked.js (if loaded) ---
    function setupMarked() {
        if (typeof marked !== "undefined") {
            const renderer = new marked.Renderer();

            // Override code renderer for custom header & copy button
            renderer.code = function (codeArg, langArg) {
                let codeText = typeof codeArg === "object" ? (codeArg.text || "") : (codeArg || "");
                let lang = typeof codeArg === "object" ? (codeArg.lang || "plaintext") : (langArg || "plaintext");

                let highlighted = escapeHtml(codeText);
                if (typeof hljs !== "undefined") {
                    try {
                        if (hljs.getLanguage(lang)) {
                            highlighted = hljs.highlight(codeText, { language: lang }).value;
                        } else {
                            highlighted = hljs.highlightAuto(codeText).value;
                        }
                    } catch (e) {
                        highlighted = escapeHtml(codeText);
                    }
                }

                return `
                <div class="code-block-wrapper">
                    <div class="code-header">
                        <span class="code-lang-tag">${escapeHtml(lang)}</span>
                        <button type="button" class="copy-code-btn" onclick="window.copySnippet(this)">
                            <i class="fa-regular fa-copy"></i>
                            <span>Salin</span>
                        </button>
                    </div>
                    <pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>
                </div>`;
            };

            marked.use({
                renderer: renderer,
                gfm: true,
                breaks: true
            });
        }
    }
    setupMarked();

    // Global copy handler for code snippets
    window.copySnippet = function (btnElement) {
        const preCode = btnElement.closest(".code-block-wrapper")?.querySelector("pre code");
        if (!preCode) return;

        const codeToCopy = preCode.innerText || preCode.textContent;
        navigator.clipboard.writeText(codeToCopy).then(() => {
            const originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i> <span>Tersalin!</span>`;
            setTimeout(() => {
                btnElement.innerHTML = originalHtml;
            }, 2000);
            showToast("Kode berhasil disalin ke clipboard!", "success");
        }).catch(() => {
            showToast("Gagal menyalin kode", "error");
        });
    };

    // Global copy handler for whole message
    window.copyMessageText = function (btnElement) {
        const bubble = btnElement.closest(".message-bubble-wrapper")?.querySelector(".message-bubble");
        if (!bubble) return;

        const textToCopy = bubble.innerText || bubble.textContent;
        navigator.clipboard.writeText(textToCopy.trim()).then(() => {
            const originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i> Tersalin`;
            setTimeout(() => {
                btnElement.innerHTML = originalHtml;
            }, 2000);
            showToast("Pesan disalin ke clipboard!", "success");
        }).catch(() => {
            showToast("Gagal menyalin pesan", "error");
        });
    };

    // --- Helper Functions ---
    function escapeHtml(str) {
        if (!str) return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatTime(date) {
        const d = date ? new Date(date) : new Date();
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function parseMarkdown(text) {
        if (!text) return "";
        if (typeof marked !== "undefined" && typeof marked.parse === "function") {
            try {
                return marked.parse(text);
            } catch (err) {
                console.error("Marked error:", err);
            }
        }
        // Fallback simple parser
        return escapeHtml(text).replace(/\n/g, "<br>");
    }

    function showToast(message, type = "info") {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        
        let icon = "fa-info-circle";
        if (type === "success") icon = "fa-circle-check";
        if (type === "error") icon = "fa-circle-exclamation";

        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3200);
    }

    function updateCharCounter() {
        const len = userInput.value.length;
        charCounter.textContent = `${len} karakter`;
    }

    function adjustTextareaHeight() {
        userInput.style.height = "24px";
        const newHeight = Math.min(userInput.scrollHeight, 180);
        userInput.style.height = `${newHeight}px`;
    }

    function isNearBottom() {
        const threshold = 120;
        return messagesViewport.scrollHeight - messagesViewport.scrollTop - messagesViewport.clientHeight <= threshold;
    }

    function scrollToBottom(force = false) {
        if (force || isNearBottom()) {
            messagesViewport.scrollTo({
                top: messagesViewport.scrollHeight,
                behavior: force ? "smooth" : "auto"
            });
        }
    }

    function updateScrollBottomBtn() {
        if (isNearBottom()) {
            scrollBottomBtn.classList.add("hidden");
        } else {
            scrollBottomBtn.classList.remove("hidden");
        }
    }

    function setStreamingState(streaming) {
        isStreaming = streaming;
        if (streaming) {
            statusIndicator.classList.add("streaming");
            statusIndicator.classList.remove("error");
            connectionStatus.innerHTML = `<span style="color: #f59e0b;"><i class="fa-solid fa-spinner fa-spin"></i> Sedang menghasilkan jawaban...</span>`;
            sendBtn.classList.add("hidden");
            stopBtn.classList.remove("hidden");
            userInput.setAttribute("disabled", "true");
        } else {
            statusIndicator.classList.remove("streaming");
            connectionStatus.innerHTML = `Praktikum PWS Pertemuan ke-10 &bull; Streaming SSE Ready`;
            sendBtn.classList.remove("hidden");
            stopBtn.classList.add("hidden");
            userInput.removeAttribute("disabled");
            userInput.focus();
            abortController = null;
        }
    }

    function saveConversation() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
        } catch (e) {
            console.warn("Gagal menyimpan ke localStorage:", e);
        }
    }

    function loadConversation() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    conversation = parsed;
                    renderAllMessages();
                    return;
                }
            }
        } catch (e) {
            console.warn("Gagal memuat dari localStorage:", e);
        }
        checkWelcomeScreen();
    }

    function checkWelcomeScreen() {
        if (conversation.length === 0) {
            welcomeScreen.style.display = "block";
            messagesList.style.display = "none";
        } else {
            welcomeScreen.style.display = "none";
            messagesList.style.display = "flex";
        }
    }

    function renderAllMessages() {
        messagesList.innerHTML = "";
        checkWelcomeScreen();

        conversation.forEach((msg) => {
            appendMessageToDOM(msg.role, msg.content, msg.timestamp, false);
        });
        scrollToBottom(true);
    }

    // --- Message DOM Construction ---
    function appendMessageToDOM(role, content, timestamp, isTemporary = false) {
        checkWelcomeScreen();

        const item = document.createElement("div");
        item.className = `message-item ${role === "user" ? "user" : "bot"}`;

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.innerHTML = role === "user" ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

        const wrapper = document.createElement("div");
        wrapper.className = "message-bubble-wrapper";

        const infoBar = document.createElement("div");
        infoBar.className = "message-info-bar";
        infoBar.innerHTML = `
            <span class="sender-name">${role === "user" ? "Anda" : "AI Assistant"}</span>
            <span class="message-time">${formatTime(timestamp)}</span>
        `;

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        if (role === "assistant" && isTemporary) {
            bubble.innerHTML = `<span class="typing-indicator"><span></span><span></span><span></span></span>`;
        } else {
            bubble.innerHTML = parseMarkdown(content);
        }

        const actions = document.createElement("div");
        actions.className = "message-actions";
        actions.innerHTML = `
            <button type="button" class="action-icon-btn" onclick="window.copyMessageText(this)" title="Salin Pesan">
                <i class="fa-regular fa-copy"></i>
                <span>Salin</span>
            </button>
        `;

        wrapper.appendChild(infoBar);
        wrapper.appendChild(bubble);
        wrapper.appendChild(actions);

        item.appendChild(avatar);
        item.appendChild(wrapper);

        messagesList.appendChild(item);
        scrollToBottom(true);

        return { item, bubble };
    }

    // --- Chat Submission & Streaming Handler ---
    async function handleChatSubmit(e) {
        if (e) e.preventDefault();

        const text = userInput.value.trim();
        if (!text || isStreaming) return;

        // Clear input & reset height
        userInput.value = "";
        adjustTextareaHeight();
        updateCharCounter();

        // 1. Add User Message
        const userMsg = {
            role: "user",
            content: text,
            timestamp: new Date().toISOString()
        };
        conversation.push(userMsg);
        appendMessageToDOM(userMsg.role, userMsg.content, userMsg.timestamp);
        saveConversation();

        // 2. Prepare Placeholder for Bot Message
        const botMsg = {
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString()
        };
        const { item: botItem, bubble: botBubble } = appendMessageToDOM(botMsg.role, "", botMsg.timestamp, true);
        currentBotMessageElement = botBubble;

        // 3. Initiate SSE Streaming Request
        setStreamingState(true);
        abortController = new AbortController();

        // Build messages payload for API (only role & content)
        const apiPayload = conversation.map(m => ({
            role: m.role,
            content: m.content
        }));

        let accumulatedContent = "";

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ messages: apiPayload }),
                signal: abortController.signal
            });

            if (!response.ok) {
                let errorDetails = `Status: ${response.status} ${response.statusText}`;
                try {
                    const errData = await response.json();
                    if (errData && errData.error) {
                        let raw = errData.error;
                        if (typeof raw === "string") {
                            try {
                                const inner = JSON.parse(raw);
                                raw = inner.error?.message || inner.message || raw;
                            } catch (_) {}
                        } else if (typeof raw === "object") {
                            raw = raw.message || JSON.stringify(raw);
                        }
                        errorDetails = raw;
                    }
                } catch (_) {
                    try {
                        const errText = await response.text();
                        if (errText) errorDetails = errText;
                    } catch (__) {}
                }
                throw new Error(errorDetails);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop(); // Keep uncompleted line in buffer

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;
                    if (!trimmedLine.startsWith("data:")) continue;

                    const data = trimmedLine.slice(5).trim();
                    if (data === "[DONE]") {
                        continue;
                    }

                    let token = "";
                    try {
                        token = JSON.parse(data);
                    } catch (e) {
                        token = data;
                    }

                    if (token) {
                        // Check if backend returned known error string
                        if (token === "Terjadi kesalahan pada server" && !accumulatedContent) {
                            throw new Error("Terjadi kesalahan pada server (OpenRouter/Backend)");
                        }
                        accumulatedContent += token;
                        botBubble.innerHTML = parseMarkdown(accumulatedContent) + `<span class="cursor-blink"></span>`;
                        scrollToBottom();
                    }
                }
            }

            // Stream completed successfully
            botBubble.innerHTML = parseMarkdown(accumulatedContent || "*(Tidak ada respons dari model)*");
            botMsg.content = accumulatedContent;
            conversation.push(botMsg);
            saveConversation();
            scrollToBottom();

        } catch (error) {
            console.error("Chat streaming error:", error);

            if (error.name === "AbortError") {
                // User clicked STOP
                if (accumulatedContent) {
                    botBubble.innerHTML = parseMarkdown(accumulatedContent) + `<p style="font-size: 0.8rem; color: #f59e0b; margin-top: 8px;"><em>[Respons dihentikan oleh pengguna]</em></p>`;
                    botMsg.content = accumulatedContent + "\n\n*[Respons dihentikan oleh pengguna]*";
                    conversation.push(botMsg);
                    saveConversation();
                } else {
                    botBubble.innerHTML = `<p style="font-size: 0.85rem; color: #f59e0b;"><em>Respons dibatalkan.</em></p>`;
                }
                showToast("Generasi respons dihentikan", "info");
            } else {
                // Server or Network Error
                statusIndicator.classList.add("error");
                botBubble.classList.add("error-bubble");
                botBubble.innerHTML = `
                    <div class="error-title">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>Terjadi Kesalahan Komunikasi dengan Server</span>
                    </div>
                    <p style="margin-bottom: 6px;">${escapeHtml(error.message || "Gagal mendapatkan respons dari server.")}</p>
                    <small style="color: #cbd5e1; display: block;">Pastikan backend Express berjalan dan kunci API OpenRouter terkonfigurasi dengan benar.</small>
                `;
                showToast("Gagal memproses pesan", "error");
            }
        } finally {
            setStreamingState(false);
            currentBotMessageElement = null;
        }
    }

    // --- Event Listeners ---

    // Form submission
    chatForm.addEventListener("submit", handleChatSubmit);

    // Textarea input & keyboard handlers
    userInput.addEventListener("input", () => {
        adjustTextareaHeight();
        updateCharCounter();
    });

    userInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit();
        }
    });

    // Stop button
    stopBtn.addEventListener("click", () => {
        if (abortController) {
            abortController.abort();
        }
    });

    // Clear Chat
    clearBtn.addEventListener("click", () => {
        if (conversation.length === 0) {
            showToast("Chat sudah kosong", "info");
            return;
        }

        if (confirm("Apakah Anda yakin ingin menghapus semua riwayat percakapan?")) {
            if (isStreaming && abortController) {
                abortController.abort();
            }
            conversation = [];
            localStorage.removeItem(STORAGE_KEY);
            messagesList.innerHTML = "";
            checkWelcomeScreen();
            showToast("Riwayat chat berhasil dibersihkan", "success");
            userInput.focus();
        }
    });

    // Prompt Chips (Suggested prompts)
    promptChips.forEach(chip => {
        chip.addEventListener("click", () => {
            const promptText = chip.getAttribute("data-prompt");
            if (promptText) {
                userInput.value = promptText;
                adjustTextareaHeight();
                updateCharCounter();
                handleChatSubmit();
            }
        });
    });

    // Scroll viewport monitoring
    messagesViewport.addEventListener("scroll", () => {
        updateScrollBottomBtn();
    });

    scrollBottomBtn.addEventListener("click", () => {
        scrollToBottom(true);
    });

    // Initialize application
    loadConversation();
    adjustTextareaHeight();
    updateCharCounter();
});
