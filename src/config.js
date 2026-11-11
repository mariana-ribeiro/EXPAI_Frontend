/**
 * ═════════════════════════════════════════════════════════════════
 *  Retopo Tool — Configuração da Aplicação (PolyOptima XAI)
 * ═════════════════════════════════════════════════════════════════
 *  Obtém API_URL e API_KEY a partir de env.json ou .env (local).
 */

window.APP_CONFIG = window.APP_CONFIG || {
    API_URL: "",
    API_KEY: ""
};

/**
 * Parsing simples de ficheiro .env (KEY=VALUE)
 */
function parseEnv(text) {
    const env = {};
    if (!text) return env;

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const eqIdx = line.indexOf("=");
        if (eqIdx !== -1) {
            const key = line.slice(0, eqIdx).trim();
            let val = line.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (key) env[key] = val;
        }
    }
    return env;
}

/**
 * Carrega a configuração local e valida se API_URL e API_KEY estão presentes
 */
window.APP_CONFIG_READY = (async function () {
    const candidatePaths = ["../env.json", "../.env"];

    for (const path of candidatePaths) {
        try {
            const res = await fetch(path, { cache: "no-store" });
            if (res.ok) {
                const text = await res.text();
                let parsed = {};
                if (path.endsWith(".json")) {
                    try { parsed = JSON.parse(text); } catch (_) {}
                } else {
                    parsed = parseEnv(text);
                }

                if (parsed.API_URL) window.APP_CONFIG.API_URL = parsed.API_URL;
                if (parsed.API_KEY) window.APP_CONFIG.API_KEY = parsed.API_KEY;

                if (window.APP_CONFIG.API_URL && window.APP_CONFIG.API_KEY) {
                    break;
                }
            }
        } catch (_) {}
    }

    // Se faltar API_URL, API_KEY ou o ficheiro não existir, mostra o popup de erro
    const errors = [];
    if (!window.APP_CONFIG.API_URL) errors.push("API_URL não configurada");
    if (!window.APP_CONFIG.API_KEY) errors.push("API_KEY não configurada");

    if (errors.length > 0) {
        const trigger = () => {
            if (window.ErrorModal?.show) {
                window.ErrorModal.show({
                    title: "Erro de Configuração",
                    message: "Não foram encontradas as credenciais necessárias no ficheiro de configuração:",
                    errors: errors,
                    buttonText: "Fechar"
                });
            } else {
                setTimeout(trigger, 50);
            }
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", trigger);
        } else {
            trigger();
        }
    }

    return window.APP_CONFIG;
})();
