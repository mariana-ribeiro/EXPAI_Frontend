/**
 * Mock API Service para o PolyOptima XAI Dashboard
 * Este ficheiro simula a comunicação com o teu futuro backend em Python.
 * 
 * Estrutura JSON esperada por cada passo do Agente RL:
 * {
 *    "step": 12,
 *    "log_message": "Edge Collapse: vertex 412 removed.",
 *    "is_critical": false,
 *    "rewards": {
 *        "silhouette": 80.5,
 *        "triangle_reduction": 15.0,
 *        "uv_distortion": 2.1
 *    }
 * }
 */

const API_BASE_URL = (
    window.APP_CONFIG?.API_BASE_URL || ""
).replace(/\/+$/, "");

window.RetopoAPI = {
    /**
     * Simula o upload inicial do modelo High Poly para a Cloud.
     * @param {File} file - Ficheiro de input nativo (.obj, .fbx, etc)
     * @param {function} onProgress - Callback(percentagem 0 a 100)
     * @returns {Promise<string>} Resolve com um modelId
     */
    uploadModel: async function(file, onProgress) {
        const token = sessionStorage.getItem("dev_upload_token");

        if (!token) {
            throw new Error("JWT de teste não configurado.");
        }

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
            `${API_BASE_URL}/api/v1/mesh/upload`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            }
        );

        if (!response.ok) {
            let message = `Erro HTTP ${response.status}`;

            try {
                const errorData = await response.json();
                if (typeof errorData.detail === "string") {
                    message = errorData.detail;
                }
            } catch {
                // Manter a mensagem HTTP original
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
     * Simula a stream em tempo real (WebSocket) do Agente RL a decimar a malha.
     * @param {string} modelId - ID recebido do upload
     * @param {function} onRLStep - Callback chamado com o JSON a cada "passo"
     * @param {function} onComplete - Callback quando o backend atinge step 100
     */
    startRLDecimation: function(modelId, onRLStep, onComplete) {
        let currentStep = 0;
        const actions = ["Edge Collapse", "Vertex Merge", "Planar Decimation", "Feature Preserved"];
        
        const interval = setInterval(() => {
            currentStep += Math.floor(Math.random() * 5) + 2;
            if(currentStep >= 100) currentStep = 100;

            // === CRIAÇÃO DO JSON EXATAMENTE IGUAL AO QUE O BACKEND DEVE ENVIAR ===
            const action = actions[Math.floor(Math.random() * actions.length)];
            const rewardVal = (Math.random() * 0.5).toFixed(2);
            
            const stepData = {
                step: currentStep,
                log_message: `[Step ${currentStep}] ${action}: Reward = +${rewardVal}`,
                is_critical: (currentStep > 50 && currentStep < 55), // Exemplo de marco crítico
                rewards: {
                    silhouette: Math.max(20, 95 - (currentStep * 0.5)),
                    triangle_reduction: Math.min(80, 10 + (currentStep * 0.7)),
                    uv_distortion: Math.min(30, currentStep * 0.3)
                }
            };
            
            // Envia o JSON para o frontend (main.js) processar
            onRLStep(stepData);

            if(currentStep >= 100) {
                clearInterval(interval);
                onComplete();
            }
        }, 200); // 200ms entre ações simuladas
    },

    /**
     * Retorna a URL do modelo final otimizado.
     * @param {string} modelId 
     * @returns {Promise<string>}
     */
    getOptimizedModel: function(modelId) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve("url_falsa_para_modelo_lowpoly.obj");
            }, 1000);
        });
    }
};
