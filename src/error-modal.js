/**
 * ═════════════════════════════════════════════════════════════════
 *  Retopo Tool — Módulo Reutilizável de Pop-up / Modal de Erros
 * ═════════════════════════════════════════════════════════════════
 *  Permite apresentar alertas e mensagens de erro de forma
 *  consistente em qualquer parte da aplicação.
 *
 *  Uso:
 *    window.ErrorModal.show({
 *        title: "Título do Erro",
 *        message: "Descrição detalhada do problema",
 *        errors: ["Erro 1", "Erro 2"], // opcional
 *        hint: "Dica de como resolver", // opcional
 *        buttonText: "Entendido",       // opcional (default: 'Fechar')
 *        onClose: () => { ... }         // opcional
 *    });
 *
 *    window.ErrorModal.hide();
 */

(function () {
    "use strict";

    const MODAL_ID = "app-reusable-error-modal";
    let activeCloseCallback = null;

    function ensureModalInDOM() {
        let overlay = document.getElementById(MODAL_ID);
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = MODAL_ID;
        overlay.className = "modal-overlay hidden";
        overlay.style.zIndex = "99999";

        overlay.innerHTML = `
            <div class="upload-card glass" style="max-width: 520px; text-align: left; padding: 2rem; border-color: rgba(239, 68, 68, 0.4); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 20px rgba(239, 68, 68, 0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.8rem; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <span style="font-size: 1.4rem; line-height: 1;">⚠️</span>
                        <h2 id="${MODAL_ID}-title" style="font-size: 1.1rem; margin: 0; color: #f87171; font-weight: 600;">Erro</h2>
                    </div>
                    <button type="button" id="${MODAL_ID}-btn-x" class="btn-icon-sidebar" style="font-size: 1.1rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;" title="Fechar">✕</button>
                </div>

                <p id="${MODAL_ID}-message" style="font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; margin-bottom: 1rem;"></p>

                <div id="${MODAL_ID}-errors-container" style="display: none; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
                    <div id="${MODAL_ID}-errors-list" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.84rem; color: #fca5a5; display: flex; flex-direction: column; gap: 0.4rem;"></div>
                </div>

                <div id="${MODAL_ID}-hint-container" style="display: none; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.82rem; color: #94a3b8; margin-bottom: 1.2rem;">
                    <strong style="color: #60a5fa; display: block; margin-bottom: 0.2rem;">💡 Como Resolver:</strong>
                    <span id="${MODAL_ID}-hint-text"></span>
                </div>

                <button type="button" id="${MODAL_ID}-btn-ok" class="btn btn-primary" style="width: 100%; padding: 0.65rem; font-size: 0.9rem; background: linear-gradient(135deg, #dc2626, #b91c1c); border-color: #ef4444; font-weight: 500;">
                    Entendido
                </button>
            </div>
        `;

        const bindEvents = () => {
            const btnX = document.getElementById(`${MODAL_ID}-btn-x`);
            const btnOk = document.getElementById(`${MODAL_ID}-btn-ok`);

            if (btnX) btnX.addEventListener("click", () => window.ErrorModal.hide());
            if (btnOk) btnOk.addEventListener("click", () => window.ErrorModal.hide());

            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) {
                    window.ErrorModal.hide();
                }
            });

            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
                    window.ErrorModal.hide();
                }
            });
        };

        if (document.body) {
            document.body.appendChild(overlay);
            bindEvents();
        } else {
            document.addEventListener("DOMContentLoaded", () => {
                document.body.appendChild(overlay);
                bindEvents();
            });
        }

        return overlay;
    }

    window.ErrorModal = {
        /**
         * Apresenta o pop-up de erro com o conteúdo especificado.
         * @param {Object} options
         * @param {string} [options.title="Erro"]
         * @param {string} [options.message=""]
         * @param {string[]|string} [options.errors]
         * @param {string} [options.hint]
         * @param {string} [options.buttonText="Fechar"]
         * @param {Function} [options.onClose]
         */
        show: function (options = {}) {
            const overlay = ensureModalInDOM();
            if (!overlay) return;

            activeCloseCallback = typeof options.onClose === "function" ? options.onClose : null;

            const titleEl = document.getElementById(`${MODAL_ID}-title`);
            const msgEl = document.getElementById(`${MODAL_ID}-message`);
            const errorsContainer = document.getElementById(`${MODAL_ID}-errors-container`);
            const errorsList = document.getElementById(`${MODAL_ID}-errors-list`);
            const hintContainer = document.getElementById(`${MODAL_ID}-hint-container`);
            const hintText = document.getElementById(`${MODAL_ID}-hint-text`);
            const btnOk = document.getElementById(`${MODAL_ID}-btn-ok`);

            if (titleEl) titleEl.textContent = options.title || "Erro";
            if (msgEl) msgEl.innerHTML = options.message || "Ocorreu um erro no sistema.";

            // Lista de erros específicos
            const errors = Array.isArray(options.errors)
                ? options.errors
                : (options.errors ? [options.errors] : []);

            if (errors.length > 0 && errorsContainer && errorsList) {
                errorsList.innerHTML = errors.map(err => `
                    <div style="display: flex; align-items: flex-start; gap: 0.4rem;">
                        <span style="color: #f87171;">•</span>
                        <span>${String(err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
                    </div>
                `).join("");
                errorsContainer.style.display = "flex";
            } else if (errorsContainer) {
                errorsContainer.style.display = "none";
            }

            // Dica de resolução
            if (options.hint && hintContainer && hintText) {
                hintText.innerHTML = options.hint;
                hintContainer.style.display = "block";
            } else if (hintContainer) {
                hintContainer.style.display = "none";
            }

            if (btnOk) {
                btnOk.textContent = options.buttonText || "Fechar";
            }

            overlay.classList.remove("hidden");
        },

        /**
         * Oculta o pop-up de erro.
         */
        hide: function () {
            const overlay = document.getElementById(MODAL_ID);
            if (overlay) {
                overlay.classList.add("hidden");
            }
            if (activeCloseCallback) {
                const cb = activeCloseCallback;
                activeCloseCallback = null;
                try {
                    cb();
                } catch (e) {
                    console.error("[ErrorModal] Erro ao executar onClose:", e);
                }
            }
        }
    };
})();

