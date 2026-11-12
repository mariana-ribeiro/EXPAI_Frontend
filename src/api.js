/**
 * API Service para o Retopo Tool (PolyOptima XAI)
 * Comunicação direta com a API Retopology em Python (FastAPI).
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

window.RetopoAPI = {
    /**
     * Upload do modelo High Poly para a API.
     * POST /v1/mesh/upload
     * @param {File} file - Ficheiro nativo (.obj, .ply, .glb)
     * @returns {Promise<string>} mesh_id
     */
    uploadModel: function (file) {
        return new Promise(async (resolve, reject) => {
            await ensureConfigReady();
            const baseUrl = getApiBaseUrl();
            const apiKey = getApiKey();

            if (!baseUrl) {
                reject(new Error("A variável API_URL não está configurada no .env. Impossível contactar o servidor."));
                return;
            }
            if (!apiKey) {
                reject(new Error("A variável API_KEY não está configurada no .env."));
                return;
            }

            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${baseUrl}/v1/mesh/upload`);

            xhr.setRequestHeader("X-API-Key", apiKey);
            xhr.setRequestHeader("X-Upload-Size", String(file.size));

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const result = JSON.parse(xhr.responseText);
                        if (!result.mesh_id) {
                            reject(new Error("A API não devolveu mesh_id."));
                            return;
                        }
                        resolve(result.mesh_id);
                    } catch (err) {
                        reject(new Error("Resposta inválida da API ao carregar modelo."));
                    }
                } else {
                    let message = `Erro HTTP ${xhr.status}`;
                    try {
                        const errorData = JSON.parse(xhr.responseText);
                        if (typeof errorData.message === "string") {
                            message = errorData.message;
                        } else if (typeof errorData.detail === "string") {
                            message = errorData.detail;
                        }
                    } catch { }
                    reject(new Error(message));
                }
            };

            xhr.onerror = () => {
                reject(new Error("Erro de rede ao carregar ficheiro para a API."));
            };

            const formData = new FormData();
            formData.append("file", file);
            xhr.send(formData);
        });
    },

    /**
     * Executa a simplificação RL na malha.
     * POST /v1/rl/simplify/{mesh_id}?max_steps={maxSteps}
     */
    simplifyMesh: async function (meshId, maxSteps = 100) {
        await ensureConfigReady();
        const query = maxSteps ? `?max_steps=${encodeURIComponent(maxSteps)}` : "";
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}${query}`,
            {
                method: "POST",
                headers: baseHeaders()
            }
        );

        if (!response.ok) {
            let msg = `Erro HTTP ${response.status}`;
            try {
                const err = await response.json();
                msg = err.message || err.detail || msg;
            } catch { }
            throw new Error(msg);
        }

        return response.json();
    },

    /**
     * Busca todas as acções RL registadas para uma mesh.
     * GET /v1/rl/simplify/{mesh_id}/actions
     * @returns {Promise<Array>} Lista de acções
     */
    getRLActions: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}/actions`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Actions HTTP ${response.status}`);
        const data = await response.json();
        return Array.isArray(data) ? data : (data.value || []);
    },

    /**
     * Busca o resumo de resultados da simplificação RL.
     * GET /v1/rl/simplify/{mesh_id}/results
     */
    getRLResults: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}/results`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Results HTTP ${response.status}`);
        return response.json();
    },

    /**
     * Busca a lista de snapshots disponíveis para uma mesh.
     * GET /v1/rl/simplify/{mesh_id}/snapshots
     * @returns {Promise<Array>} Lista de snapshots
     */
    getRLSnapshots: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Snapshots HTTP ${response.status}`);
        const data = await response.json();
        return Array.isArray(data) ? data : (data.value || []);
    },

    /**
     * Carrega a imagem do snapshot usando autenticação (X-API-Key) e retorna um Object URL local.
     * GET /v1/rl/simplify/{mesh_id}/snapshots/{accepted_dissolves}/image
     * @returns {Promise<string|null>} Blob Object URL ou null
     */
    getSnapshotImageBlobUrl: async function (meshId, acceptedDissolves) {
        try {
            await ensureConfigReady();
            const response = await fetch(
                `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots/${encodeURIComponent(acceptedDissolves)}/image`,
                { headers: baseHeaders() }
            );
            if (!response.ok) return null;
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        } catch {
            return null;
        }
    },

    /**
     * Descarrega os dados ou geometria do snapshot.
     * GET /v1/rl/simplify/{mesh_id}/snapshots/{accepted_dissolves}
     */
    getRLSnapshot: async function (meshId, acceptedDissolves) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots/${encodeURIComponent(acceptedDissolves)}`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return response.json();
        }
        return response.text();
    },

    /**
     * Descarrega o modelo .obj final simplificado.
     * GET /v1/rl/simplify/{mesh_id}
     * @returns {Promise<string>} Conteúdo de texto .obj
     */
    downloadSimplifiedMesh: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/rl/simplify/${encodeURIComponent(meshId)}`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Download mesh HTTP ${response.status}`);
        return response.text();
    },

    // ─── GNN Predict & Heatmap Endpoints ─────────────────────────────────────

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

    /**
     * Executa a inferência GNN na malha original para calcular a importância dos vértices.
     * POST /v1/gnn/predict/{mesh_id}
     */
    predictGNN: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/gnn/predict/${encodeURIComponent(meshId)}`,
            {
                method: "POST",
                headers: baseHeaders()
            }
        );
        if (!response.ok) throw new Error(`GNN Predict HTTP ${response.status}`);
        return response.json();
    },

    /**
     * Obtém as pontuações de importância dos vértices calculadas pela GNN (formato CSV).
     * GET /v1/gnn/predict/{mesh_id}/scores
     * @returns {Promise<string>} Conteúdo CSV com colunas: vertex_id_clean,x,y,z,importance,predicted_keep
     */
    getGNNScores: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/gnn/predict/${encodeURIComponent(meshId)}/scores`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`GNN Scores HTTP ${response.status}`);
        return response.text();
    },

    /**
     * Gera o arquivo de heatmap da GNN no servidor.
     * POST /v1/gnn/predict/{mesh_id}/heatmap
     */
    createGNNHeatmap: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/gnn/predict/${encodeURIComponent(meshId)}/heatmap`,
            {
                method: "POST",
                headers: baseHeaders()
            }
        );
        if (!response.ok) throw new Error(`Create Heatmap HTTP ${response.status}`);
        return response.json();
    },

    /**
     * Descarrega o arquivo PLY do Heatmap gerado pela GNN.
     * GET /v1/gnn/predict/{mesh_id}/heatmap
     */
    getGNNHeatmap: async function (meshId) {
        await ensureConfigReady();
        const response = await fetch(
            `${getApiBaseUrl()}/v1/gnn/predict/${encodeURIComponent(meshId)}/heatmap`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Get Heatmap HTTP ${response.status}`);
        return response.arrayBuffer();
    },

    /**
     * Executa a simplificação RL em tempo real.
     * Envia o pedido à API, recolhe as ações e notifica o frontend.
     */
    startRLDecimation: async function (modelId, onRLStep, onComplete, maxSteps = 100, onError) {
        try {
            // 1. Executar a simplificação real via API (aguarda o cálculo das iterações pelo backend)
            const simplifyResult = await this.simplifyMesh(modelId, maxSteps);

            // 2. Buscar o action log detalhado gerado pela API
            let actions = [];
            try {
                actions = await this.getRLActions(modelId);
            } catch (_) { }

            if (Array.isArray(actions) && actions.length > 0) {
                for (let i = 0; i < actions.length; i++) {
                    const act = actions[i];
                    const isAccepted = act.accepted !== false;
                    const actionName = act.action_name || (isAccepted ? "EDGE_DISSOLVE" : "ATTEMPT_REJECTED");
                    const reason = act.rejection_reason ? ` (${act.rejection_reason})` : "";
                    const facesInfo = act.faces !== undefined ? ` [Faces: ${act.faces}]` : "";

                    const stepData = {
                        step: act.step || (i + 1),
                        progress: Math.min(100, Math.round(((i + 1) / actions.length) * 100)),
                        log_message: `[Step ${act.step || (i + 1)}] ${actionName}${reason}${facesInfo}`,
                        is_critical: !isAccepted,
                        raw_action: act,
                        reward: act.reward !== undefined ? act.reward : null
                    };

                    if (typeof onRLStep === "function") {
                        onRLStep(stepData);
                    }
                }
            } else if (simplifyResult) {
                if (typeof onRLStep === "function") {
                    onRLStep({
                        step: simplifyResult.steps || maxSteps,
                        progress: 100,
                        log_message: `[Concluído] ${simplifyResult.accepted_dissolves || 0} dissolves aceites`,
                        is_critical: false,
                        raw_action: { accepted: true, accepted_dissolves: simplifyResult.accepted_dissolves || 0 }
                    });
                }
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
    }
};


/* ═════════════════════════════════════════════════════════════════
 *  MESH QA / DSS API SERVICE
 *  Auditoria de integridade e qualidade de malhas 3D (suporta snapshots)
 * ═════════════════════════════════════════════════════════════════
 */
window.MeshQAAPI = {
    /**
     * Inicia uma nova análise assíncrona de QA para a mesh (ou snapshot específico).
     * POST /v1/analyses/{mesh_id}?snapshot={snapshot}
     */
    createAnalysis: async function (meshId, options = {}, snapshot = null) {
        await ensureConfigReady();
        const body = {
            skip: Array.isArray(options.skip) ? options.skip : [],
            regular_valence: options.regular_valence !== undefined ? parseInt(options.regular_valence, 10) : 0,
            min_angle: options.min_angle !== undefined ? parseFloat(options.min_angle) : 20.0,
            max_angle: options.max_angle !== undefined ? parseFloat(options.max_angle) : 160.0
        };

        const query = (snapshot !== null && snapshot !== undefined) ? `?snapshot=${encodeURIComponent(snapshot)}` : "";
        const response = await fetch(`${getApiBaseUrl()}/v1/analyses/${encodeURIComponent(meshId)}${query}`, {
            method: "POST",
            headers: baseHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body)
        });

        if (!response.ok && response.status !== 202) {
            let errorMsg = `Erro HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.detail || errorMsg;
            } catch (_) { }
            throw new Error(errorMsg);
        }

        return response.json();
    },

    /**
     * Consulta o estado de uma análise (ou de um snapshot).
     * GET /v1/analyses/{mesh_id}?snapshot={snapshot}
     */
    getAnalysisStatus: async function (meshId, snapshot = null) {
        await ensureConfigReady();
        const query = (snapshot !== null && snapshot !== undefined) ? `?snapshot=${encodeURIComponent(snapshot)}` : "";
        const response = await fetch(`${getApiBaseUrl()}/v1/analyses/${encodeURIComponent(meshId)}${query}`, {
            headers: baseHeaders()
        });

        if (!response.ok) {
            let errorMsg = `Erro HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.detail || errorMsg;
            } catch (_) { }
            throw new Error(errorMsg);
        }

        return response.json();
    },

    /**
     * Descarrega o resultado detalhado (result.json).
     * GET /v1/analyses/{mesh_id}/download?snapshot={snapshot}&geometry={boolean}
     */
    downloadAnalysisResult: async function (meshId, includeGeometry = false, snapshot = null) {
        await ensureConfigReady();
        const params = new URLSearchParams();
        if (snapshot !== null && snapshot !== undefined) params.append("snapshot", snapshot);
        if (includeGeometry) params.append("geometry", "true");
        const query = params.toString() ? `?${params.toString()}` : "";

        const response = await fetch(`${getApiBaseUrl()}/v1/analyses/${encodeURIComponent(meshId)}/download${query}`, {
            headers: baseHeaders()
        });

        if (!response.ok) {
            let errorMsg = `Erro HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.detail || errorMsg;
            } catch (_) { }
            throw new Error(errorMsg);
        }

        return response.json();
    },

    /**
     * Executa o fluxo completo com polling: cria a análise e aguarda até 'done' ou 'failed'.
     */
    runFullAnalysis: async function (meshId, options = {}, snapshot = null, onStatusUpdate = null, timeoutMs = 60000) {
        await this.createAnalysis(meshId, options, snapshot);

        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const statusData = await this.getAnalysisStatus(meshId, snapshot);
            if (onStatusUpdate) onStatusUpdate(statusData);

            if (statusData.status === "done" || statusData.status === "failed") {
                return statusData;
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        throw new Error("Tempo limite de análise excedido (timeout de 60 segundos).");
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
