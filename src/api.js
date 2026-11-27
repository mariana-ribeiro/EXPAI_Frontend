/**
 * API Service para o Retopo Tool (PolyOptima XAI)
 * Comunicação direta com a API Retopology em Python (FastAPI).
 *
 * Fluxo da API (ver frontend-api.md):
 *   upload → (GNN opcional) → RL → quad final (automático) → imagem → DSS
 *                                 └→ quad de um snapshot (a pedido) → DSS do snapshot
 * RL, quad e DSS são jobs: o POST responde 202 e o estado consulta-se até
 * `done` ou `failed`.
 */

/** Aguarda o carregamento das variáveis de ambiente a partir do .env */
async function ensureConfigReady() {
    if (window.APP_CONFIG_READY && typeof window.APP_CONFIG_READY.then === "function") {
        try {
            await window.APP_CONFIG_READY;
        } catch (_) { }
    }
}

/** Obtém a URL base da API dinamicamente a partir de window.APP_CONFIG */
function getApiBaseUrl() {
    return (window.APP_CONFIG?.API_URL || window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
}

/** Obtém a API Key dinamicamente a partir de window.APP_CONFIG */
function getApiKey() {
    return window.APP_CONFIG?.API_KEY || "";
}

/** Devolve os headers base (autenticação + json accept) */
function baseHeaders(extra = {}) {
    const h = { "Accept": "application/json", ...extra };
    const key = getApiKey();
    if (key) h["X-API-Key"] = key;
    return h;
}

// Compatibilidade retroativa para acesso no window
if (typeof window !== "undefined") {
    try {
        Object.defineProperty(window, "API_BASE_URL", {
            get: getApiBaseUrl,
            configurable: true
        });
        Object.defineProperty(window, "API_KEY", {
            get: getApiKey,
            configurable: true
        });
    } catch (_) { }
}

/* ─── Erros ───────────────────────────────────────────────────────────────
 * A API responde sempre a erros com { "error": "<nome>", "message": "<motivo>" }.
 */
class ApiError extends Error {
    constructor(status, error, message) {
        super(message || error || `Erro HTTP ${status}`);
        this.name = "ApiError";
        this.status = status;   // código HTTP (0 = sem ligação)
        this.error = error;     // ex.: "Conflict", "Not Found"
    }
}
window.ApiError = ApiError;

/**
 * Texto em português para um erro da API, por código HTTP.
 * `detail` é sempre a `message` da API (em inglês), mostrada como pormenor.
 * @returns {{title: string, message: string, hint: string, short: string, detail: string}}
 */
function describeApiError(err) {
    const status = err?.status;
    const code = err?.error;
    const detail = err?.message || String(err ?? "");
    const d = (title, message, hint, short) => ({ title, message, hint, short, detail });

    if (code === "Config") {
        return d("Configuração em Falta", detail, "Preencha API_URL e API_KEY no .env (ou env.json).", "Configuração em falta");
    }
    if (code === "UploadRejected") {
        return d("Upload Recusado", "A API recusou o ficheiro.",
            "Confirme o tamanho do ficheiro e tente de novo.", "Upload recusado");
    }
    if (code === "Network" || status === 0 && code !== "Timeout" && code !== "JobFailed") {
        return d("Sem Ligação à API", "Não foi possível contactar o servidor.",
            "Confirme que a API está a correr e que o API_URL no .env está certo.", "Sem ligação à API");
    }
    if (code === "Timeout") {
        return d("Tempo Limite Excedido", "O servidor demorou demasiado a responder.",
            "Tente de novo daqui a pouco.", "Tempo limite excedido");
    }
    if (code === "JobFailed") {
        return d("A Operação Falhou no Servidor", "O servidor não conseguiu concluir esta operação.",
            "Tente de novo; se voltar a falhar, experimente outra malha.", "Falhou no servidor");
    }
    switch (status) {
        case 401: return d("Chave de API Inválida", "A API recusou a chave de acesso.",
            "Verifique a API_KEY no .env.", "Chave de API inválida");
        case 404: return d("Não Encontrado", "A malha ou o resultado já não existe no servidor.",
            "Os resultados expiram ao fim de algum tempo; volte a carregar o modelo.", "Não encontrado no servidor");
        case 409: return d("Operação em Curso", "Já há uma operação a correr para esta malha, ou falta um passo anterior.",
            "Espere que termine e tente de novo.", "Malha ocupada");
        case 413: return d("Ficheiro Demasiado Grande", "O ficheiro excede o tamanho máximo aceite pela API.",
            "Reduza a malha antes de a enviar.", "Ficheiro demasiado grande");
        case 415: return d("Formato Não Suportado", "A API não aceita este tipo de ficheiro.",
            "Envie um ficheiro .obj.", "Formato não suportado");
        case 422: return d("Parâmetro Inválido", "A API rejeitou um dos parâmetros do pedido.",
            "O pormenor abaixo diz qual e porquê.", "Parâmetro inválido");
        case 429: return d("Demasiadas Tentativas", "O servidor está a limitar os pedidos.",
            "Espere um pouco e tente de novo.", "Demasiadas tentativas");
        case 503: return d("Serviço Ocupado", "O servidor está ocupado neste momento.",
            "Tente de novo daqui a pouco.", "Serviço ocupado");
        case 507: return d("Sem Espaço no Servidor", "O servidor ficou sem espaço em disco.",
            "Contacte quem gere a API.", "Sem espaço no servidor");
    }
    if (status >= 500) {
        return d("Erro no Servidor", "O servidor encontrou um erro inesperado.",
            "Tente de novo; se persistir, contacte quem gere a API.", "Erro no servidor");
    }
    return d("Erro", detail || "Ocorreu um erro inesperado.", "", detail || "Erro");
}
window.describeApiError = describeApiError;

/**
 * Causa provável de um upload que falhou sem resposta legível (ver uploadModel).
 * @returns {Promise<ApiError>}
 */
async function diagnoseUploadFailure() {
    if (!(await RetopoAPI.checkHealth())) {
        return new ApiError(0, "Network", "Erro de rede ao carregar ficheiro para a API.");
    }
    try {
        // Pedido autenticado barato: 401 = chave errada; 404 = chave aceite
        await apiRequest("/v1/rl/simplify/00000000-0000-0000-0000-000000000000/status");
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            return new ApiError(401, err.error || "Unauthorized", err.message || "Invalid API key.");
        }
    }
    return new ApiError(0, "UploadRejected",
        "A API está a responder e aceita a chave, mas recusou o upload sem dizer porquê (por exemplo, ficheiro acima do limite de tamanho).");
}

/**
 * Mostra um erro da API no pop-up de erros. `overrides` pode trocar o título,
 * a mensagem ou a dica (ex.: texto específico do contexto).
 */
function showApiError(err, overrides = {}) {
    const info = describeApiError(err);
    const title = overrides.title || info.title;
    const message = overrides.message || info.message;
    const hint = overrides.hint ?? info.hint;
    const errors = info.detail && info.detail !== message ? [info.detail] : [];
    if (window.ErrorModal?.show) {
        window.ErrorModal.show({ title, message, errors, hint: hint || undefined, buttonText: "Entendido" });
    } else {
        alert(`${title}: ${message}${errors.length ? `\n\n${errors[0]}` : ""}`);
    }
}
window.showApiError = showApiError;

async function toApiError(response) {
    let error = response.statusText || "";
    let message = `Erro HTTP ${response.status}`;
    try {
        const data = await response.json();
        if (typeof data?.error === "string") error = data.error;
        if (typeof data?.message === "string") message = data.message;
    } catch (_) { }
    return new ApiError(response.status, error, message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

/** Query string a partir de um objeto, ignorando valores null/undefined. */
function qs(params = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== "") p.append(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : "";
}

/**
 * Pedido à API. Lança ApiError se a resposta não for 2xx.
 * @param {string} path  caminho começado por "/" (ex.: "/v1/rl/simplify/<id>/status")
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function apiRequest(path, init = {}) {
    await ensureConfigReady();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        throw new ApiError(0, "Config", "A variável API_URL não está configurada no .env. Impossível contactar o servidor.");
    }
    let response;
    try {
        response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: baseHeaders(init.headers || {})
        });
    } catch (err) {
        throw new ApiError(0, "Network", `Sem ligação à API (${err.message}).`);
    }
    if (!response.ok) throw await toApiError(response);
    return response;
}

const apiJson = async (path, init) => (await apiRequest(path, init)).json();
const apiText = async (path, init) => (await apiRequest(path, init)).text();

/** Object URL de uma imagem da API, ou null se não existir / ainda não estiver pronta. */
async function apiImageUrl(path) {
    try {
        const blob = await (await apiRequest(path)).blob();
        return URL.createObjectURL(blob);
    } catch {
        return null;
    }
}

/**
 * Consulta o estado de um job até `done` ou `failed`.
 * @param {() => Promise<object>} getStatus  devolve o estado atual do job
 * @param {object} opts
 * @param {number} [opts.intervalMs=2000]
 * @param {number} [opts.timeoutMs=0]  0 = sem limite
 * @param {(status: object) => void} [opts.onProgress]  chamado a cada consulta
 * @param {number} [opts.maxTransientErrors=5]  falhas seguidas toleradas (rede / 5xx)
 * @returns {Promise<object>} estado final (status "done" ou "failed")
 */
async function pollJob(getStatus, { intervalMs = 2000, timeoutMs = 0, onProgress, maxTransientErrors = 5 } = {}) {
    const start = Date.now();
    let transientErrors = 0;
    for (;;) {
        let status;
        try {
            status = await getStatus();
            transientErrors = 0;
        } catch (err) {
            // Falhas passageiras durante o polling (rede instável, API a reiniciar,
            // 5xx pontual). Tenta de novo na consulta seguinte.
            const transient = err instanceof ApiError && (err.error === "Network" || err.status >= 500);
            if (!transient || ++transientErrors > maxTransientErrors) throw err;
            await sleep(intervalMs);
            continue;
        }
        if (typeof onProgress === "function") {
            try { onProgress(status); } catch (_) { }
        }
        if (status?.status === "done" || status?.status === "failed") return status;
        if (timeoutMs && Date.now() - start >= timeoutMs) {
            throw new ApiError(0, "Timeout", "Tempo limite excedido à espera do job.");
        }
        await sleep(intervalMs);
    }
}

/* ─── Ordem de arranque por malha ─────────────────────────────────────────
 * Os pedidos à mesma malha correm em fila, pela ordem em que foram feitos.
 * A API já não bloqueia pedidos concorrentes, mas recusa (409) um RL se houver
 * quad ou DSS a correr, e um novo RL apaga as análises anteriores. A fila
 * garante uma ordem determinística (ex.: GNN → arranque do RL → DSS).
 * Como RL, quad e DSS respondem 202 logo, cada pedido ocupa a fila pouco tempo.
 * Não há repetição automática em 409: agora significa um conflito real de jobs.
 */
const meshQueues = new Map();

function enqueueMeshTask(meshId, task) {
    const key = String(meshId);
    const previous = meshQueues.get(key) || Promise.resolve();
    const run = previous.then(task);
    const tail = run.catch(() => { });
    meshQueues.set(key, tail);
    tail.then(() => {
        if (meshQueues.get(key) === tail) meshQueues.delete(key);
    });
    return run;
}

/** apiRequest posto na fila da malha. */
function meshRequest(meshId, path, init) {
    return enqueueMeshTask(meshId, () => apiRequest(path, init));
}
const meshJson = async (meshId, path, init) => (await meshRequest(meshId, path, init)).json();
const meshText = async (meshId, path, init) => (await meshRequest(meshId, path, init)).text();


window.RetopoAPI = {
    // ─── Utilitários expostos ───────────────────────────────────────────────
    ApiError,
    pollJob,

    /**
     * Verifica o estado de saúde da API.
     * GET /health
     * @returns {Promise<boolean>} true se online
     */
    checkHealth: async function () {
        try {
            await ensureConfigReady();
            const response = await fetch(`${getApiBaseUrl()}/health`, {
                headers: baseHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) return false;
            const data = await response.json();
            return data?.status === "ok";
        } catch {
            return false;
        }
    },

    // ─── Upload / malha limpa ───────────────────────────────────────────────

    /**
     * Upload do modelo High Poly para a API.
     * POST /v1/mesh/upload
     * @param {File} file - Ficheiro nativo (.obj, .ply, .glb)
     * @param {(loaded: number, total: number) => void} [onProgress] progresso do envio
     * @returns {Promise<string>} mesh_id
     */
    uploadModel: function (file, onProgress) {
        return new Promise(async (resolve, reject) => {
            await ensureConfigReady();
            const baseUrl = getApiBaseUrl();
            const apiKey = getApiKey();

            if (!baseUrl) {
                reject(new ApiError(0, "Config", "A variável API_URL não está configurada no .env. Impossível contactar o servidor."));
                return;
            }
            if (!apiKey) {
                reject(new ApiError(0, "Config", "A variável API_KEY não está configurada no .env."));
                return;
            }

            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${baseUrl}/v1/mesh/upload`);

            xhr.setRequestHeader("X-API-Key", apiKey);
            xhr.setRequestHeader("X-Upload-Size", String(file.size));

            if (typeof onProgress === "function") {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) onProgress(e.loaded, e.total);
                };
            }

            xhr.onload = () => {
                let data = null;
                try { data = JSON.parse(xhr.responseText); } catch (_) { }

                if (xhr.status >= 200 && xhr.status < 300) {
                    if (!data?.mesh_id) {
                        reject(new ApiError(xhr.status, "InvalidResponse", "A API não devolveu mesh_id."));
                        return;
                    }
                    resolve(data.mesh_id);
                } else {
                    reject(new ApiError(
                        xhr.status,
                        data?.error || "",
                        data?.message || `Erro HTTP ${xhr.status}`
                    ));
                }
            };

            // Upload sem resposta legível (rede, proxy, ligação cortada a meio):
            // dois pedidos pequenos dizem se a API está em baixo, se a chave é
            // recusada ou se foi o upload em si que falhou.
            xhr.onerror = async () => {
                reject(await diagnoseUploadFailure());
            };

            const formData = new FormData();
            formData.append("file", file);
            xhr.send(formData);
        });
    },

    /**
     * Descarrega a malha limpa (a que a GNN e o RL usam).
     * GET /v1/mesh/download/{mesh_id}
     * @returns {Promise<string>} Conteúdo OBJ
     */
    downloadCleanMesh: function (meshId) {
        return meshText(meshId, `/v1/mesh/download/${enc(meshId)}`);
    },

    // ─── GNN ────────────────────────────────────────────────────────────────

    /**
     * Executa a inferência GNN (síncrona: responde quando acaba).
     * POST /v1/gnn/predict/{mesh_id}
     * @returns {Promise<{num_vertices: number, scores_url: string}>}
     */
    predictGNN: function (meshId) {
        return meshJson(meshId, `/v1/gnn/predict/${enc(meshId)}`, { method: "POST" });
    },

    /**
     * Pontuações de importância dos vértices (CSV; a linha i é o i-ésimo vértice da malha limpa).
     * GET /v1/gnn/predict/{mesh_id}/scores
     * @returns {Promise<string>} CSV: vertex_id_clean,x,y,z,importance,predicted_keep
     */
    getGNNScores: function (meshId) {
        return meshText(meshId, `/v1/gnn/predict/${enc(meshId)}/scores`);
    },

    /**
     * Predição GNN + scores numa única entrada da fila, para que outro pedido
     * (ex.: o arranque do RL) não se meta entre os dois.
     * @returns {Promise<string>} CSV dos scores
     */
    predictGNNWithScores: function (meshId) {
        return enqueueMeshTask(meshId, async () => {
            await apiJson(`/v1/gnn/predict/${enc(meshId)}`, { method: "POST" });
            return apiText(`/v1/gnn/predict/${enc(meshId)}/scores`);
        });
    },

    /**
     * Gera o heatmap da GNN no servidor.
     * POST /v1/gnn/predict/{mesh_id}/heatmap
     */
    createGNNHeatmap: function (meshId) {
        return meshJson(meshId, `/v1/gnn/predict/${enc(meshId)}/heatmap`, { method: "POST" });
    },

    /**
     * Descarrega o PLY com cores do heatmap da GNN.
     * GET /v1/gnn/predict/{mesh_id}/heatmap
     * @returns {Promise<ArrayBuffer>}
     */
    getGNNHeatmap: async function (meshId) {
        return (await meshRequest(meshId, `/v1/gnn/predict/${enc(meshId)}/heatmap`)).arrayBuffer();
    },

    // ─── RL (job) ───────────────────────────────────────────────────────────

    /**
     * Arranca a simplificação RL (o quad final corre automaticamente no fim).
     * POST /v1/rl/simplify/{mesh_id} → 202
     * Sem parâmetros: o número de passos e os parâmetros do quad são definidos no servidor.
     * @returns {Promise<object>} estado inicial do job
     */
    startRL: function (meshId) {
        return meshJson(meshId, `/v1/rl/simplify/${enc(meshId)}`, { method: "POST" });
    },

    /**
     * Arranca o RL; se a API responder 409 (ex.: a análise DSS da malha original
     * ainda está a correr), espera e tenta de novo até `waitMs`.
     * Enquanto espera, chama onProgress({ status: "queued", waiting: message }).
     */
    startRLWhenFree: async function (meshId, onProgress, { waitMs = 90000, intervalMs = 2000 } = {}) {
        const start = Date.now();
        for (;;) {
            try {
                return await this.startRL(meshId);
            } catch (err) {
                if (!(err instanceof ApiError) || err.status !== 409 || Date.now() - start >= waitMs) throw err;
                if (typeof onProgress === "function") {
                    try { onProgress({ status: "queued", waiting: err.message }); } catch (_) { }
                }
                await sleep(intervalMs);
            }
        }
    },

    /**
     * Estado do job RL. Enquanto corre: progress = { stage: "simplifying"|"quad", current, total, percent }.
     * Quando done: links = { download, results, actions, snapshots, quad, image }; summary.quad.error se o quad falhou.
     * GET /v1/rl/simplify/{mesh_id}/status
     */
    getRLStatus: function (meshId) {
        return meshJson(meshId, `/v1/rl/simplify/${enc(meshId)}/status`);
    },

    /**
     * Espera pelo fim do RL (e do quad final).
     * @returns {Promise<object>} estado final (status "done" ou "failed")
     */
    waitForRL: function (meshId, onProgress, { intervalMs = 2000, timeoutMs = 0 } = {}) {
        return pollJob(() => this.getRLStatus(meshId), { intervalMs, timeoutMs, onProgress });
    },

    /**
     * Descarrega o OBJ do RL em triângulos (antes do quad).
     * GET /v1/rl/simplify/{mesh_id}
     */
    downloadSimplifiedMesh: function (meshId) {
        return meshText(meshId, `/v1/rl/simplify/${enc(meshId)}`);
    },

    /**
     * Resumo de resultados do RL.
     * GET /v1/rl/simplify/{mesh_id}/results
     */
    getRLResults: function (meshId) {
        return meshJson(meshId, `/v1/rl/simplify/${enc(meshId)}/results`);
    },

    /**
     * Registo de ações do RL.
     * GET /v1/rl/simplify/{mesh_id}/actions
     * @returns {Promise<Array>}
     */
    getRLActions: async function (meshId) {
        const data = await meshJson(meshId, `/v1/rl/simplify/${enc(meshId)}/actions`);
        return Array.isArray(data) ? data : (data.value || []);
    },

    /**
     * Lista de snapshots intermédios; cada item tem accepted_dissolves, faces, image_url e
     * status ("generating" | "ready" | "failed", com error). Consultar de novo enquanto
     * algum estiver "generating".
     * GET /v1/rl/simplify/{mesh_id}/snapshots
     * @returns {Promise<Array>}
     */
    getRLSnapshots: async function (meshId) {
        const data = await meshJson(meshId, `/v1/rl/simplify/${enc(meshId)}/snapshots`);
        return Array.isArray(data) ? data : (data.value || []);
    },

    /**
     * OBJ (triângulos) de um snapshot.
     * GET /v1/rl/simplify/{mesh_id}/snapshots/{accepted_dissolves}
     */
    getRLSnapshot: async function (meshId, acceptedDissolves) {
        const response = await meshRequest(
            meshId,
            `/v1/rl/simplify/${enc(meshId)}/snapshots/${enc(acceptedDissolves)}`
        );
        const contentType = response.headers.get("content-type") || "";
        return contentType.includes("application/json") ? response.json() : response.text();
    },

    /**
     * Compatibilidade com o main.js atual: arranca o RL, espera pelo fim e
     * reproduz o registo de ações através de onRLStep.
     * @param {(status: object) => void} [onProgress] estado do job a cada consulta (stage/percent)
     * @param {(job: object) => void} [onStarted] chamado quando a API aceita o RL (202)
     */
    startRLDecimation: async function (modelId, onRLStep, onComplete, onError, onProgress, onStarted) {
        try {
            const startedJob = await this.startRLWhenFree(modelId, onProgress);
            if (typeof onStarted === "function") {
                try { onStarted(startedJob); } catch (_) { }
            }
            const final = await this.waitForRL(modelId, onProgress);

            if (final.status === "failed") {
                throw new ApiError(500, "JobFailed", final.error || "A simplificação RL falhou.");
            }

            const simplifyResult = { ...(final.summary || {}), job: final };
            if (simplifyResult.quad?.error) {
                console.warn("[RetopoAPI] O quad final falhou:", simplifyResult.quad.error);
            }

            let actions = [];
            try {
                actions = await this.getRLActions(modelId);
            } catch (_) { }

            if (Array.isArray(actions) && actions.length > 0) {
                for (let i = 0; i < actions.length; i++) {
                    const act = actions[i];
                    const isAccepted = act.accepted !== false;
                    const actionName = act.action_name || (isAccepted ? "Accepted" : "Rejected");
                    const reason = act.rejection_reason ? ` (${act.rejection_reason})` : "";
                    const facesInfo = act.faces !== undefined ? ` [Faces: ${act.faces}]` : "";

                    if (typeof onRLStep === "function") {
                        onRLStep({
                            step: act.step || (i + 1),
                            progress: Math.min(100, Math.round(((i + 1) / actions.length) * 100)),
                            log_message: `[Step ${act.step || (i + 1)}] ${actionName}${reason}${facesInfo}`,
                            is_critical: !isAccepted,
                            raw_action: act,
                            reward: act.reward !== undefined ? act.reward : null
                        });
                    }
                }
            } else if (typeof onRLStep === "function") {
                onRLStep({
                    step: simplifyResult.steps || 0,
                    progress: 100,
                    log_message: `[Concluído] ${simplifyResult.accepted_dissolves || 0} dissolves aceites`,
                    is_critical: false,
                    raw_action: { accepted: true, accepted_dissolves: simplifyResult.accepted_dissolves || 0 }
                });
            }

            if (typeof onComplete === "function") {
                onComplete(simplifyResult);
            }
        } catch (err) {
            console.error("[RetopoAPI] Erro na simplificação via API:", err);
            if (typeof onError === "function") {
                onError(err);
            } else {
                throw err;
            }
        }
    },

    // ─── Quad (job) ─────────────────────────────────────────────────────────
    // snapshot = null → quad do resultado final (feito automaticamente no fim do RL)
    // snapshot = N    → quad do snapshot N (a pedido; ~1 min ou mais)

    /**
     * POST /v1/quad/{mesh_id}?snapshot=N → 202
     * Os parâmetros do quad (tolerância, método) são definidos no servidor.
     */
    startQuad: function (meshId, snapshot = null) {
        return meshJson(meshId, `/v1/quad/${enc(meshId)}${qs({ snapshot })}`, { method: "POST" });
    },

    /** GET /v1/quad/{mesh_id}?snapshot=N (404 se o quad nunca foi pedido) */
    getQuadStatus: function (meshId, snapshot = null) {
        return meshJson(meshId, `/v1/quad/${enc(meshId)}${qs({ snapshot })}`);
    },

    /** Espera pelo fim do quad. */
    waitForQuad: function (meshId, snapshot = null, onProgress, { intervalMs = 2000, timeoutMs = 0 } = {}) {
        return pollJob(() => this.getQuadStatus(meshId, snapshot), { intervalMs, timeoutMs, onProgress });
    },

    /** OBJ em quads. GET /v1/quad/{mesh_id}/download?snapshot=N (409 se não estiver done) */
    downloadQuadMesh: function (meshId, snapshot = null) {
        return meshText(meshId, `/v1/quad/${enc(meshId)}/download${qs({ snapshot })}`);
    },

    /**
     * PNG da malha em quads como Object URL, ou null se ainda não existir
     * (404 = nunca pedido, 409 = a correr ou falhou).
     * GET /v1/quad/{mesh_id}/image?snapshot=N
     */
    getQuadImageBlobUrl: function (meshId, snapshot = null) {
        return enqueueMeshTask(meshId, () => apiImageUrl(`/v1/quad/${enc(meshId)}/image${qs({ snapshot })}`));
    }
};


/* ═════════════════════════════════════════════════════════════════
 *  MESH QA / DSS API SERVICE
 *  Auditoria de qualidade dos quads (suporta snapshots)
 *   - snapshot = null → quads do resultado final
 *   - snapshot = N    → quads do snapshot N (fazer o quad primeiro)
 *   - snapshot = 0    → malha limpa original (antes/depois)
 * ═════════════════════════════════════════════════════════════════
 */
window.MeshQAAPI = {
    /**
     * Inicia uma análise DSS (job).
     * POST /v1/dss/{mesh_id}?snapshot={snapshot} → 202
     * 409 se o quad ainda não existir / estiver a correr (a message diz o que falta).
     */
    createAnalysis: function (meshId, options = {}, snapshot = null) {
        const body = {
            skip: Array.isArray(options.skip) ? options.skip : [],
            regular_valence: options.regular_valence !== undefined ? parseInt(options.regular_valence, 10) : 0,
            min_angle: options.min_angle !== undefined ? parseFloat(options.min_angle) : 20.0,
            max_angle: options.max_angle !== undefined ? parseFloat(options.max_angle) : 160.0
        };
        return meshJson(meshId, `/v1/dss/${enc(meshId)}${qs({ snapshot })}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    },

    /**
     * Estado de uma análise.
     * GET /v1/dss/{mesh_id}?snapshot={snapshot}
     */
    getAnalysisStatus: function (meshId, snapshot = null) {
        return meshJson(meshId, `/v1/dss/${enc(meshId)}${qs({ snapshot })}`);
    },

    /**
     * Resultado detalhado (schema 5: general_metrics, verifications com errors).
     * GET /v1/dss/{mesh_id}/download?snapshot={snapshot}
     * Sem geometria: a malha é o OBJ do quad.
     */
    downloadAnalysisResult: function (meshId, snapshot = null) {
        return meshJson(meshId, `/v1/dss/${enc(meshId)}/download${qs({ snapshot })}`);
    },

    /**
     * O que o visualizador 3D precisa (não é a análise): faces a pintar por
     * verificação, per_face, per_vertex e edge_flow.
     * GET /v1/dss/{mesh_id}/viewer?snapshot={snapshot}
     */
    getAnalysisViewer: function (meshId, snapshot = null) {
        return meshJson(meshId, `/v1/dss/${enc(meshId)}/viewer${qs({ snapshot })}`);
    },

    /**
     * O que quer dizer cada campo e como corrigir cada erro (igual para todas as malhas).
     * GET /v1/dss/dictionary
     */
    getDSSDictionary: function () {
        return apiJson("/v1/dss/dictionary");
    },

    /**
     * Cria a análise e espera até 'done' ou 'failed' (consulta de 2 em 2 s).
     */
    runFullAnalysis: async function (meshId, options = {}, snapshot = null, onStatusUpdate = null, timeoutMs = 120000) {
        await this.createAnalysis(meshId, options, snapshot);
        try {
            return await pollJob(() => this.getAnalysisStatus(meshId, snapshot), {
                intervalMs: 2000,
                timeoutMs,
                onProgress: onStatusUpdate
            });
        } catch (err) {
            if (err instanceof ApiError && err.error === "Timeout") {
                throw new ApiError(0, "Timeout", `Tempo limite de análise excedido (${Math.round(timeoutMs / 1000)} segundos).`);
            }
            throw err;
        }
    },

    /**
     * Carrega as fixtures de teste locais
     */
    loadLocalFixtures: async function () {
        const [statRes, resRes, objRes] = await Promise.all([
            fetch("fixtures/status.json"),
            fetch("fixtures/result.json"),
            fetch("fixtures/simplified.obj")
        ]);

        if (!statRes.ok || !resRes.ok || !objRes.ok) {
            throw new Error("Não foi possível carregar os ficheiros de fixture locais.");
        }

        const status = await statRes.json();
        const result = await resRes.json();
        const objText = await objRes.text();

        return { status, result, objText };
    }
};
