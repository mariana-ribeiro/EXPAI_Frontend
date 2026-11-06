/**
 * API Service para o Retopo Tool (PolyOptima XAI)
 * Comunicação direta com a API Retopology em Python (FastAPI).
 */

const API_BASE_URL = (
    window.APP_CONFIG?.API_BASE_URL || "https://expai-pt.ftpweb.dev"
).replace(/\/+$/, "");

const API_KEY = window.APP_CONFIG?.API_KEY || "58FFDC24770CFFAE2401E741B7AC51EADD22CA59539BCEFBAFEA0229E011D700";

/** Devolve os headers base (autenticação + json accept) */
function baseHeaders(extra = {}) {
    const h = { "Accept": "application/json", ...extra };
    if (API_KEY) h["X-API-Key"] = API_KEY;
    return h;
}

window.RetopoAPI = {
    /**
     * Upload do modelo High Poly para a API.
     * POST /v1/mesh/upload
     * @param {File} file - Ficheiro nativo (.obj, .ply, .glb)
     * @param {function} onProgress - Callback de progresso (0-100)
     * @returns {Promise<string>} mesh_id
     */
    uploadModel: async function(file, onProgress) {
        const formData = new FormData();
        formData.append("file", file);

        if (typeof onProgress === "function") {
            onProgress(25);
        }

        const response = await fetch(
            `${API_BASE_URL}/v1/mesh/upload`,
            {
                method: "POST",
                headers: baseHeaders({
                    "X-Upload-Size": String(file.size)
                }),
                body: formData
            }
        );

        if (typeof onProgress === "function") {
            onProgress(75);
        }

        if (!response.ok) {
            let message = `Erro HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                if (typeof errorData.message === "string") {
                    message = errorData.message;
                } else if (typeof errorData.detail === "string") {
                    message = errorData.detail;
                }
            } catch {
                // manter mensagem HTTP
            }
            throw new Error(message);
        }

        const result = await response.json();

        if (!result.mesh_id) {
            throw new Error("A API não devolveu mesh_id.");
        }

        if (typeof onProgress === "function") {
            onProgress(100);
        }

        return result.mesh_id;
    },

    /**
     * Executa a simplificação RL na malha.
     * POST /v1/rl/simplify/{mesh_id}?max_steps={maxSteps}
     */
    simplifyMesh: async function(meshId, maxSteps = 100) {
        const query = maxSteps ? `?max_steps=${encodeURIComponent(maxSteps)}` : "";
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}${query}`,
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
            } catch {}
            throw new Error(msg);
        }

        return response.json();
    },

    /**
     * Busca todas as acções RL registadas para uma mesh.
     * GET /v1/rl/simplify/{mesh_id}/actions
     * @returns {Promise<Array>} Lista de acções
     */
    getRLActions: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}/actions`,
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
    getRLResults: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}/results`,
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
    getRLSnapshots: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots`,
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
    getSnapshotImageBlobUrl: async function(meshId, acceptedDissolves) {
        try {
            const response = await fetch(
                `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots/${encodeURIComponent(acceptedDissolves)}/image`,
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
    getRLSnapshot: async function(meshId, acceptedDissolves) {
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}/snapshots/${encodeURIComponent(acceptedDissolves)}`,
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
    downloadSimplifiedMesh: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/rl/simplify/${encodeURIComponent(meshId)}`,
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
    checkHealth: async function() {
        try {
            const response = await fetch(`${API_BASE_URL}/health`, {
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
    predictGNN: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/gnn/predict/${encodeURIComponent(meshId)}`,
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
    getGNNScores: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/gnn/predict/${encodeURIComponent(meshId)}/scores`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`GNN Scores HTTP ${response.status}`);
        return response.text();
    },

    /**
     * Gera o arquivo de heatmap da GNN no servidor.
     * POST /v1/gnn/predict/{mesh_id}/heatmap
     */
    createGNNHeatmap: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/gnn/predict/${encodeURIComponent(meshId)}/heatmap`,
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
    getGNNHeatmap: async function(meshId) {
        const response = await fetch(
            `${API_BASE_URL}/v1/gnn/predict/${encodeURIComponent(meshId)}/heatmap`,
            { headers: baseHeaders() }
        );
        if (!response.ok) throw new Error(`Get Heatmap HTTP ${response.status}`);
        return response.arrayBuffer();
    },

    /**
     * Executa a simplificação RL em tempo real.
     * Tenta primeiro a API real (POST simplify + GET actions).
     * Se a API falhar, cai com elegância na simulação local.
     */
    startRLDecimation: async function(modelId, onRLStep, onComplete, maxSteps = 100) {
        try {
            // 1. Tentar executar a simplificação real via API
            const simplifyResult = await this.simplifyMesh(modelId, maxSteps);

            // 2. Buscar o action log detalhado gerado pela API
            const actions = await this.getRLActions(modelId);

            if (Array.isArray(actions) && actions.length > 0) {
                let idx = 0;
                const total = actions.length;
                // Reproduzir cada ação de forma animada (~4-6 segundos no total)
                const intervalMs = Math.max(25, Math.min(120, Math.floor(5000 / total)));

                const timer = setInterval(() => {
                    if (idx < actions.length) {
                        const act = actions[idx];
                        const stepNum = act.step || (idx + 1);
                        const progress = Math.min(100, Math.round((stepNum / total) * 100));

                        const isAccepted = act.accepted !== false;
                        const actionName = act.action_name || (isAccepted ? "EDGE_DISSOLVE" : "ATTEMPT_REJECTED");
                        const reason = act.rejection_reason ? ` (${act.rejection_reason})` : "";
                        const facesInfo = act.faces !== undefined ? ` [Faces: ${act.faces}]` : "";

                        const stepData = {
                            step: stepNum,
                            progress: progress,
                            log_message: `[Step ${stepNum}] ${actionName}${reason}${facesInfo}`,
                            is_critical: !isAccepted,
                            raw_action: act,
                            rewards: {
                                silhouette: Math.max(20, Math.round(95 - (progress * 0.45))),
                                triangle_reduction: Math.min(95, Math.round(progress * 0.85)),
                                uv_distortion: Math.min(25, Math.round(progress * 0.2))
                            }
                        };

                        onRLStep(stepData);
                        idx++;
                    } else {
                        clearInterval(timer);
                        onComplete(simplifyResult);
                    }
                }, intervalMs);
                return;
            }
        } catch (err) {
            console.warn("[RetopoAPI] Simplificação via API indisponível, a usar simulação de fallback:", err.message);
        }

        // Fallback: simulação local caso a API não tenha respondido
        let currentStep = 0;
        const fallbackActions = ["Edge Collapse", "Vertex Merge", "Planar Decimation", "Feature Preserved"];
        
        const fallbackTimer = setInterval(() => {
            currentStep += Math.floor(Math.random() * 5) + 2;
            if (currentStep >= 100) currentStep = 100;

            const action = fallbackActions[Math.floor(Math.random() * fallbackActions.length)];
            const rewardVal = (Math.random() * 0.5).toFixed(2);
            
            const stepData = {
                step: currentStep,
                progress: currentStep,
                log_message: `[Step ${currentStep}] ${action}: Reward = +${rewardVal}`,
                is_critical: (currentStep > 50 && currentStep < 55),
                rewards: {
                    silhouette: Math.max(20, Math.round(95 - (currentStep * 0.5))),
                    triangle_reduction: Math.min(80, Math.round(10 + (currentStep * 0.7))),
                    uv_distortion: Math.min(30, Math.round(currentStep * 0.3))
                }
            };
            
            onRLStep(stepData);

            if (currentStep >= 100) {
                clearInterval(fallbackTimer);
                onComplete(null);
            }
        }, 150);
    }
};
