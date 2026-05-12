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

window.PolyOptimaAPI = {
    /**
     * Simula o upload inicial do modelo High Poly para a Cloud.
     * @param {File} file - Ficheiro de input nativo (.obj, .fbx, etc)
     * @param {function} onProgress - Callback(percentagem 0 a 100)
     * @returns {Promise<string>} Resolve com um modelId
     */
    uploadModel: function(file, onProgress) {
        return new Promise((resolve) => {
            let progress = 0;
            const interval = setInterval(() => {
                progress += Math.random() * 15 + 5; // Simulação de envio
                if(progress >= 100) {
                    progress = 100;
                    clearInterval(interval);
                    onProgress(100);
                    // Resolve enviando de volta um ID virtual do modelo gerado pelo backend
                    setTimeout(() => resolve("model_89A2b_test"), 300);
                } else {
                    onProgress(progress);
                }
            }, 150);
        });
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
