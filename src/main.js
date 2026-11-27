(() => {
    // ══════════════════════════════════════════════════════
    //  DOM ELEMENTS & SETUP
    // ══════════════════════════════════════════════════════
    const uploadModal = document.getElementById("upload-modal");
    const dropZone = document.getElementById("drop-zone");
    const mainApp = document.getElementById("main-app");
    const fileInput = document.getElementById("file-input");
    const rlStatusBadge = document.getElementById("rl-status-badge");

    // Elementos do Overlay Transparente de Otimização
    const optimizingOverlay = document.getElementById("optimizing-overlay");
    const optTitle = document.getElementById("opt-title");
    const optSubtitle = document.getElementById("opt-subtitle");
    const optStepLabel = document.getElementById("opt-step-label");
    const optPctLabel = document.getElementById("opt-pct-label");
    const optProgressBar = document.getElementById("opt-progress-bar");
    const optLiveStep = document.getElementById("opt-live-step");
    const optLiveDissolves = document.getElementById("opt-live-dissolves");
    const optLiveTotal = document.getElementById("opt-live-total");

    // Estatísticas reais da geometria
    const realStats = {
        high: { verts: 0, faces: 0 },
        low: { verts: 0, faces: 0 }
    };

    /**
     * Calcula o número exato de vértices e faces a partir do texto do arquivo .obj
     */
    function computeObjStats(objText) {
        if (!objText) return { verts: 0, faces: 0 };
        let verts = 0;
        let faces = 0;
        const lines = objText.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("v ")) verts++;
            else if (line.startsWith("f ")) faces++;
        }
        return { verts, faces };
    }

    /**
     * Converte o score de importância da GNN (0.0 a 1.0) numa cor térmica (Azul -> Verde/Amarelo -> Vermelho)
     */
    function importanceToColor(t) {
        const clamped = Math.max(0, Math.min(1, t));
        const color = new THREE.Color();
        if (clamped < 0.5) {
            const f = clamped / 0.5;
            color.setRGB(0.1 + f * 0.1, 0.35 + f * 0.5, 0.95 - f * 0.65);
        } else {
            const f = (clamped - 0.5) / 0.5;
            color.setRGB(0.2 + f * 0.78, 0.85 - f * 0.7, 0.3 - f * 0.15);
        }
        return color;
    }

    // ══════════════════════════════════════════════════════
    //  VERIFICAÇÃO DE SAÚDE DA API
    // ══════════════════════════════════════════════════════
    async function checkAPIHealth() {
        if (!rlStatusBadge) return;
        const isOnline = await RetopoAPI.checkHealth();
        if (isOnline) {
            rlStatusBadge.className = "status-badge online";
            rlStatusBadge.textContent = "API: Online";
        } else {
            rlStatusBadge.className = "status-badge offline";
            rlStatusBadge.textContent = "API: Offline";
        }
    }
    // Verificar saúde ao carregar
    checkAPIHealth();
    setInterval(checkAPIHealth, 20000);

    // ══════════════════════════════════════════════════════
    //  CONTROLO DO PAINEL LATERAL (COLLAPSE / EXPAND)
    // ══════════════════════════════════════════════════════
    const appSidebar = document.getElementById("app-sidebar");
    const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
    const btnCollapseSidebar = document.getElementById("btn-collapse-sidebar");
    const btnExpandSidebar = document.getElementById("btn-expand-sidebar");

    function collapseSidebar() {
        if (appSidebar) appSidebar.classList.add("collapsed");
        if (btnToggleSidebar) {
            btnToggleSidebar.classList.remove("active");
            const icon = btnToggleSidebar.querySelector(".sidebar-toggle-icon");
            if (icon) icon.textContent = "◧";
        }
        if (btnExpandSidebar) btnExpandSidebar.style.display = "flex";
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
        setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
    }

    function expandSidebar() {
        if (appSidebar) appSidebar.classList.remove("collapsed");
        if (btnToggleSidebar) {
            btnToggleSidebar.classList.add("active");
            const icon = btnToggleSidebar.querySelector(".sidebar-toggle-icon");
            if (icon) icon.textContent = "◨";
        }
        if (btnExpandSidebar) btnExpandSidebar.style.display = "none";
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
        setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
    }

    function toggleSidebar() {
        if (!appSidebar) return;
        if (appSidebar.classList.contains("collapsed")) {
            expandSidebar();
        } else {
            collapseSidebar();
        }
    }

    if (btnToggleSidebar) btnToggleSidebar.addEventListener("click", toggleSidebar);
    if (btnCollapseSidebar) btnCollapseSidebar.addEventListener("click", collapseSidebar);
    if (btnExpandSidebar) btnExpandSidebar.addEventListener("click", expandSidebar);

    // ══════════════════════════════════════════════════════
    //  ALTERNADOR DE TEMA (MODO ESCURO / MODO CLARO)
    // ══════════════════════════════════════════════════════
    const btnThemeToggle = document.getElementById("btn-theme-toggle");
    const themeToggleIcon = document.getElementById("theme-toggle-icon");
    const themeToggleText = document.getElementById("theme-toggle-text");

    function applyTheme(theme) {
        const isLight = theme === "light";
        if (isLight) {
            document.body.classList.add("light-mode");
            if (themeToggleIcon) themeToggleIcon.textContent = "☀️";
            if (themeToggleText) themeToggleText.textContent = "Claro";
            if (btnThemeToggle) {
                btnThemeToggle.setAttribute("title", "Mudar para Modo Escuro");
                btnThemeToggle.classList.add("active");
            }
        } else {
            document.body.classList.remove("light-mode");
            if (themeToggleIcon) themeToggleIcon.textContent = "🌙";
            if (themeToggleText) themeToggleText.textContent = "Escuro";
            if (btnThemeToggle) {
                btnThemeToggle.setAttribute("title", "Mudar para Modo Claro");
                btnThemeToggle.classList.remove("active");
            }
        }
        try {
            localStorage.setItem("retopo_theme", isLight ? "light" : "dark");
        } catch { }

        // Sincronizar cores da malha 3D (Arestas e Vértices) para contraste ótimo
        if (window.RetopoViewer) {
            const viewer = window.RetopoViewer;
            if (viewer.edgesMaterial) {
                viewer.edgesMaterial.color.setHex(isLight ? 0x0284c7 : 0x38bdf8);
                viewer.edgesMaterial.needsUpdate = true;
            }
            if (viewer.pointsMaterial) {
                viewer.pointsMaterial.color.setHex(isLight ? 0xb45309 : 0xfbbf24);
                viewer.pointsMaterial.needsUpdate = true;
            }
        }
    }

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener("click", () => {
            const isCurrentlyLight = document.body.classList.contains("light-mode");
            applyTheme(isCurrentlyLight ? "dark" : "light");
        });
    }

    // Carregar preferência inicial do utilizador
    try {
        const savedTheme = localStorage.getItem("retopo_theme") || "dark";
        applyTheme(savedTheme);
    } catch {
        applyTheme("dark");
    }

    // ══════════════════════════════════════════════════════
    //  FLUXO DE UPLOAD DO MODELO (CONFIRMAÇÃO EM 2 PASSOS)
    // ══════════════════════════════════════════════════════
    let selectedFile = null;

    const selectedFileInfo = document.getElementById("selected-file-info");
    const selectedFileName = document.getElementById("selected-file-name");
    const selectedFileSize = document.getElementById("selected-file-size");
    const btnChangeFile = document.getElementById("btn-change-file");
    const btnUploadNext = document.getElementById("btn-upload-next");

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    async function setSelectedFile(file) {
        if (!file) return;

        // Suporte estrito ao formato .OBJ
        if (!file.name.toLowerCase().endsWith(".obj")) {
            if (window.ErrorModal?.show) {
                window.ErrorModal.show({
                    title: "Formato Não Suportado",
                    message: `O ficheiro "${file.name}" não está no formato .OBJ.`,
                    errors: [
                        "O pipeline de retopologia atualmente apenas suporta malhas no formato .OBJ."
                    ],
                    buttonText: "Entendido"
                });
            } else {
                alert("Apenas ficheiros no formato .OBJ são suportados.");
            }
            selectedFile = null;
            if (fileInput) fileInput.value = "";
            return;
        }

        selectedFile = file;

        if (selectedFileName) selectedFileName.textContent = file.name;
        if (selectedFileSize) selectedFileSize.textContent = formatBytes(file.size);

        if (dropZone) dropZone.style.display = "none";
        if (selectedFileInfo) selectedFileInfo.style.display = "flex";

        if (btnUploadNext) {
            btnUploadNext.disabled = false;
            btnUploadNext.style.opacity = "1";
            btnUploadNext.style.cursor = "pointer";
        }
    }

    if (btnChangeFile) {
        btnChangeFile.addEventListener("click", () => {
            fileInput.value = "";
            fileInput.click();
        });
    }

    if (btnUploadNext) {
        btnUploadNext.addEventListener("click", () => {
            if (!selectedFile) return;
            startUploadFlow(selectedFile);
        });
    }

    async function startUploadFlow(fileObj) {
        if (!fileObj) return;

        // Feedback imediato no botão da janela inicial enquanto envia o ficheiro
        if (btnUploadNext) {
            btnUploadNext.disabled = true;
            btnUploadNext.innerHTML = `<span>⏳ A transferir ficheiro...</span>`;
            btnUploadNext.style.opacity = "0.75";
        }

        const fileUrl = URL.createObjectURL(fileObj);

        try {
            // 1. Ler o texto do ficheiro OBJ para extrair métricas 100% REAIS
            const fileText = await fileObj.text();
            const extracted = computeObjStats(fileText);

            realStats.high.verts = extracted.verts;
            realStats.high.faces = extracted.faces;

            // 2. Upload para a API com X-Upload-Size e X-API-Key (rápido, sem abrir overlay prematuro)
            const modelId = await RetopoAPI.uploadModel(fileObj);

            if (!modelId) {
                throw new Error("A API não devolveu mesh_id.");
            }

            window.currentActiveModelId = modelId;
            window.currentUploadedObjText = fileText;

            // A auditoria DSS da malha original (snapshot=0) arranca depois do POST do RL
            // (ver runRLDecimation): um novo RL apaga as análises desta malha.

            // 3. Transição direta para a cena 3D: fecha o modal inicial
            uploadModal.classList.add("hidden");
            mainApp.style.filter = "none";
            mainApp.style.pointerEvents = "all";

            // 4. Limpar campos de upload para ficar pronto para nova utilização
            selectedFile = null;
            if (fileInput) fileInput.value = "";
            if (selectedFileInfo) selectedFileInfo.style.display = "none";
            if (dropZone) dropZone.style.display = "block";
            if (btnUploadNext) {
                btnUploadNext.innerHTML = `<span>Seguinte</span> <span>➔</span>`;
                btnUploadNext.disabled = true;
                btnUploadNext.style.opacity = "0.45";
                btnUploadNext.style.cursor = "not-allowed";
            }

            // 5. Iniciar ou reiniciar o estúdio 3D com a nova malha (limpando relatórios e análises anteriores)
            initThreeJS(modelId, fileUrl, fileText);

        } catch (error) {
            console.error("Erro no upload:", error);
            if (optimizingOverlay) optimizingOverlay.classList.add("hidden");
            uploadModal.classList.remove("hidden");
            mainApp.style.filter = "blur(10px)";
            mainApp.style.pointerEvents = "none";

            // Erros da API (401, 413, 415, 507...) com texto por código; erros locais com título genérico
            window.showApiError(error, error instanceof window.ApiError
                ? { hint: error.status === 409 ? "Tente de novo daqui a pouco." : undefined }
                : { title: "Erro no Upload" });

            if (selectedFileInfo) selectedFileInfo.style.display = "flex";
            if (btnUploadNext) {
                btnUploadNext.innerHTML = `<span>Seguinte</span> <span>➔</span>`;
                btnUploadNext.disabled = false;
                btnUploadNext.style.opacity = "1";
            }

            URL.revokeObjectURL(fileUrl);
            fileInput.value = "";
        }
    }

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
        }
    });

    window.addEventListener("dragenter", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }, false);
    window.addEventListener("dragover", (e) => { e.preventDefault(); }, false);
    window.addEventListener("dragleave", (e) => {
        e.preventDefault();
        if (e.clientX === 0 || e.clientY === 0) dropZone.classList.remove("dragover");
    }, false);
    window.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setSelectedFile(e.dataTransfer.files[0]);
        }
    }, false);

    // ══════════════════════════════════════════════════════
    //  TOPBAR LOGO & MODAIS (UPLOAD / GNN EXPLAINER)
    // ══════════════════════════════════════════════════════
    const topbarLogo = document.getElementById("topbar-logo");
    const btnCloseUploadModal = document.getElementById("btn-close-upload-modal");
    const gnnExplainerModal = document.getElementById("gnn-explainer-modal");
    const btnGnnExplainer = document.getElementById("btn-gnn-explainer");
    const btnCloseGnnExpl = document.getElementById("btn-close-gnn-explainer");
    const btnOkGnnExpl = document.getElementById("btn-ok-gnn-explainer");

    function showUploadModal() {
        if (uploadModal) {
            uploadModal.classList.remove("hidden");
            if (btnCloseUploadModal && window.RetopoViewer && window.RetopoViewer.mesh) {
                btnCloseUploadModal.style.display = "flex";
            }
            if (mainApp) {
                mainApp.style.filter = "blur(10px)";
                mainApp.style.pointerEvents = "none";
            }
        }
    }

    function hideUploadModal() {
        // Só permite fechar sem upload se já houver uma cena 3D carregada
        if (uploadModal && window.RetopoViewer && window.RetopoViewer.mesh) {
            uploadModal.classList.add("hidden");
            if (mainApp) {
                mainApp.style.filter = "none";
                mainApp.style.pointerEvents = "all";
            }
        }
    }

    if (topbarLogo) topbarLogo.addEventListener("click", showUploadModal);
    if (btnCloseUploadModal) btnCloseUploadModal.addEventListener("click", hideUploadModal);

    function openGnnExplainer() {
        if (gnnExplainerModal) gnnExplainerModal.classList.remove("hidden");
    }
    function closeGnnExplainer() {
        if (gnnExplainerModal) gnnExplainerModal.classList.add("hidden");
    }

    if (btnGnnExplainer) btnGnnExplainer.addEventListener("click", openGnnExplainer);
    if (btnCloseGnnExpl) btnCloseGnnExpl.addEventListener("click", closeGnnExplainer);
    if (btnOkGnnExpl) btnOkGnnExpl.addEventListener("click", closeGnnExplainer);

    if (gnnExplainerModal) {
        gnnExplainerModal.addEventListener("click", (e) => {
            if (e.target === gnnExplainerModal) closeGnnExplainer();
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (gnnExplainerModal && !gnnExplainerModal.classList.contains("hidden")) {
                closeGnnExplainer();
            } else if (uploadModal && !uploadModal.classList.contains("hidden") && window.RetopoViewer?.mesh) {
                hideUploadModal();
            }
        }
    });

    // ══════════════════════════════════════════════════════
    //  THREE.JS & APP PRINCIPAL
    // ══════════════════════════════════════════════════════
    window.initRetopoStudio = function (modelId, fileUrl, rawObjText) {
        return initThreeJS(modelId, fileUrl, rawObjText);
    };
    window.initRetopoViewer = window.initRetopoStudio;

    function initThreeJS(modelId, fileUrl, rawObjText) {
        if (window.RetopoViewer && typeof window.RetopoViewer.resetAndLoadModel === "function") {
            window.RetopoViewer.resetAndLoadModel(modelId, fileUrl, rawObjText);
            return;
        }

        let currentModelId = modelId;
        const canvas = document.getElementById("canvas3d");
        const container = canvas.parentElement;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 0, 40);

        const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        window.addEventListener("resize", () => {
            if (container.clientWidth === 0) return;
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        });

        // Luzes
        scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
        dirLight1.position.set(10, 20, 20);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0x3b82f6, 0.55);
        dirLight2.position.set(-10, -20, -20);
        scene.add(dirLight2);

        // Materiais
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            roughness: 0.4,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        let heatmapMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });
        heatmapMaterial.color.setHex(0xffffff);

        // Material Oclusor (para quando a superfície está invisível, ocultando faces traseiras para NUNCA piscar)
        const occluderMaterial = new THREE.MeshBasicMaterial({
            colorWrite: false,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        // Materiais para Arestas Reais (Topologia / Quads) e Vértices
        const isCurrentLight = document.body.classList.contains("light-mode");
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: isCurrentLight ? 0x0284c7 : 0x38bdf8,
            transparent: true,
            opacity: 0.9,
            depthTest: true
        });

        const pointsMaterial = new THREE.PointsMaterial({
            color: isCurrentLight ? 0xb45309 : 0xfbbf24,
            size: 4,
            sizeAttenuation: false, // Pontos sempre nítidos na resolução do ecrã
            transparent: true,
            opacity: 0.95,
            depthTest: true
        });

        // Geometrias
        let highPolyGeo = null;
        let lowPolyGeo = null;
        let activeView = "high"; // 'high' | 'low' | 'snapshot'

        const objLoader = new THREE.OBJLoader();

        function buildCustomOBJGeometry(objText) {
            if (!objText || !objText.includes("v ")) return null;

            const lines = objText.split(/\r?\n/);
            const rawVerts = [];
            const polygonFaces = [];

            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith("v ")) {
                    const parts = line.split(/\s+/).slice(1).map(Number);
                    const vx = parts[0], vy = parts[1], vz = parts[2];
                    if (!isNaN(vx) && !isNaN(vy) && !isNaN(vz)) {
                        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
                        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
                        if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
                        rawVerts.push([vx, vy, vz]);
                    }
                } else if (line.startsWith("f ")) {
                    const tokens = line.split(/\s+/).slice(1);
                    const vIdxs = [];
                    for (let t = 0; t < tokens.length; t++) {
                        if (!tokens[t]) continue;
                        const p = tokens[t].split("/")[0];
                        const idx = parseInt(p, 10);
                        if (!isNaN(idx)) {
                            vIdxs.push(idx > 0 ? idx - 1 : rawVerts.length + idx);
                        }
                    }
                    if (vIdxs.length >= 3) {
                        polygonFaces.push(vIdxs);
                    }
                }
            }

            if (rawVerts.length === 0 || polygonFaces.length === 0) return null;

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const cz = (minZ + maxZ) / 2;
            const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
            const scale = maxDim > 0 ? (16 / maxDim) : 1;

            const positions = [];
            const vertexIndices = [];
            const triangleToFace = [];
            // Faces que não são um polígono simples (auto-intersetadas, com área
            // nula ou vértices em falta): desenham-se tal como estão no ficheiro,
            // para o utilizador ver que estão estragadas.
            const invalidFaces = [];

            for (let f = 0; f < polygonFaces.length; f++) {
                const poly = polygonFaces[f];
                const { triangles, valid } = triangulateFace(poly, rawVerts);
                if (!valid) invalidFaces.push(f);
                for (const [v0, v1, v2] of triangles) {
                    const p0 = rawVerts[v0];
                    const p1 = rawVerts[v1];
                    const p2 = rawVerts[v2];

                    positions.push(
                        (p0[0] - cx) * scale, (p0[1] - cy) * scale, (p0[2] - cz) * scale,
                        (p1[0] - cx) * scale, (p1[1] - cy) * scale, (p1[2] - cz) * scale,
                        (p2[0] - cx) * scale, (p2[1] - cy) * scale, (p2[2] - cz) * scale
                    );
                    vertexIndices.push(v0, v1, v2);
                    triangleToFace.push(f);
                }
            }
            if (invalidFaces.length > 0) {
                console.warn(`[Mesh] ${invalidFaces.length} face(s) inválida(s) (auto-intersetadas ou degeneradas), desenhadas como estão no OBJ:`, invalidFaces.slice(0, 20));
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
            geo.computeVertexNormals();

            const initCols = new Float32Array(positions.length);
            initCols.fill(1.0);
            geo.setAttribute("color", new THREE.BufferAttribute(initCols, 3));

            if (!geo.userData) geo.userData = {};
            geo.userData.center = new THREE.Vector3(cx, cy, cz);
            geo.userData.scale = scale;
            geo.userData.rawObjText = objText;
            geo.userData.vertexIndices = vertexIndices;
            geo.userData.triangleToFace = triangleToFace;
            geo.userData.polygonFaces = polygonFaces;
            geo.userData.rawVerts = rawVerts;
            geo.userData.invalidFaces = invalidFaces;

            return geo;
        }

        /**
         * Triângulos de uma face do OBJ (índices de vértices), sem inventar geometria.
         *
         * Um leque a partir do primeiro vértice só está certo em faces convexas: numa
         * face côncava (ex.: um L) cria triângulos fora da face. Aqui a face é
         * projetada no seu plano (normal de Newell) e triangulada com o earcut do
         * three.js, que respeita o contorno. Os triângulos ficam com a orientação
         * da face (normais iguais às do ficheiro).
         *
         * Uma face que não é um polígono simples (contorno que se cruza, área nula,
         * vértices repetidos ou em falta) não tem uma triangulação "certa": desenha-se
         * em leque, como no ficheiro, e devolve valid=false.
         */
        function triangulateFace(poly, rawVerts) {
            const n = poly.length;
            const points = poly.map((v) => rawVerts[v]);
            const fan = () => {
                const out = [];
                for (let j = 1; j < n - 1; j++) {
                    if (points[0] && points[j] && points[j + 1]) out.push([poly[0], poly[j], poly[j + 1]]);
                }
                return out;
            };
            if (points.some((p) => !p) || new Set(poly).size !== n) {
                return { triangles: fan(), valid: false };
            }

            // Normal de Newell: robusta para polígonos côncavos e ligeiramente não planos.
            let nx = 0, ny = 0, nz = 0;
            for (let i = 0; i < n; i++) {
                const a = points[i], b = points[(i + 1) % n];
                nx += (a[1] - b[1]) * (a[2] + b[2]);
                ny += (a[2] - b[2]) * (a[0] + b[0]);
                nz += (a[0] - b[0]) * (a[1] + b[1]);
            }
            const length = Math.hypot(nx, ny, nz);
            if (!(length > 0)) return { triangles: fan(), valid: false };
            if (n === 3) return { triangles: [[poly[0], poly[1], poly[2]]], valid: true };

            // Base (u, w) do plano da face; projeção 2D com a mesma orientação da face.
            const normal = new THREE.Vector3(nx / length, ny / length, nz / length);
            const helper = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            const u = new THREE.Vector3().crossVectors(helper, normal).normalize();
            const w = new THREE.Vector3().crossVectors(normal, u);
            const contour = points.map((p) => new THREE.Vector2(
                p[0] * u.x + p[1] * u.y + p[2] * u.z,
                p[0] * w.x + p[1] * w.y + p[2] * w.z
            ));
            if (contourSelfIntersects(contour)) return { triangles: fan(), valid: false };

            // O earcut ignora vértices colineares (triângulos de área nula), por
            // isso confirma-se pela área: os triângulos cobrem a face toda.
            const triangles = THREE.ShapeUtils.triangulateShape(contour.slice(), []);
            const area = Math.abs(THREE.ShapeUtils.area(contour));
            const covered = triangles.reduce((sum, [a, b, c]) =>
                sum + Math.abs(THREE.ShapeUtils.area([contour[a], contour[b], contour[c]])), 0);
            if (!(area > 0) || Math.abs(covered - area) > 1e-6 * area) {
                return { triangles: fan(), valid: false };
            }

            // O contorno projetado é anti-horário (a normal aponta para nós); cada
            // triângulo fica também anti-horário, como a face.
            return {
                triangles: triangles.map(([a, b, c]) => {
                    const A = contour[a], B = contour[b], C = contour[c];
                    const ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
                    return ccw ? [poly[a], poly[b], poly[c]] : [poly[a], poly[c], poly[b]];
                }),
                valid: true,
            };
        }

        /** True se duas arestas não vizinhas do contorno se cruzam ou tocam. */
        function contourSelfIntersects(contour) {
            const n = contour.length;
            const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
            const onSegment = (a, b, p) =>
                Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
                Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
            for (let i = 0; i < n; i++) {
                const a = contour[i], b = contour[(i + 1) % n];
                for (let j = i + 2; j < n; j++) {
                    if (i === 0 && j === n - 1) continue; // vizinhas pelo fecho
                    const c = contour[j], d = contour[(j + 1) % n];
                    const o1 = orient(a, b, c), o2 = orient(a, b, d);
                    const o3 = orient(c, d, a), o4 = orient(c, d, b);
                    if (o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4) return true;
                    if ((o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d)) ||
                        (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b))) return true;
                }
            }
            return false;
        }

        function buildHighPolyGeo(objText) {
            let geo = buildCustomOBJGeometry(objText);
            if (!geo && objText) {
                try {
                    const parsedObj = objLoader.parse(objText);
                    parsedObj.traverse((child) => {
                        if (child.isMesh && !geo) {
                            geo = child.geometry;
                        }
                    });
                    if (geo) {
                        geo.computeBoundingBox();
                        const center = new THREE.Vector3();
                        geo.boundingBox.getCenter(center);
                        geo.translate(-center.x, -center.y, -center.z);
                        const size = new THREE.Vector3();
                        geo.boundingBox.getSize(size);
                        const maxDim = Math.max(size.x, size.y, size.z);
                        const scale = maxDim > 0 ? (16 / maxDim) : 1;
                        if (maxDim > 0) geo.scale(scale, scale, scale);
                        geo.computeVertexNormals();
                    }
                } catch (err) {
                    console.warn("[Init] Erro ao parsear OBJ inicial:", err);
                }
            }
            if (!geo) {
                geo = new THREE.TorusKnotGeometry(8, 2.5, 128, 32);
                geo.computeVertexNormals();
            }
            const posAttr = geo.attributes.position;
            if (posAttr && !geo.attributes.color) {
                const initCols = new Float32Array(posAttr.count * 3);
                initCols.fill(1.0);
                geo.setAttribute("color", new THREE.BufferAttribute(initCols, 3));
            }
            if (!geo.userData) geo.userData = {};
            geo.userData.rawObjText = objText;
            return geo;
        }

        highPolyGeo = buildHighPolyGeo(rawObjText);

        const mesh = new THREE.Mesh(highPolyGeo, baseMaterial);
        scene.add(mesh);

        /**
         * Extrai e constrói as arestas reais dos polígonos (quads, n-gons) a partir do ficheiro OBJ,
         * sem qualquer corte diagonal de triangulação artificial!
         */
        function parseObjToRealEdgesGeometry(objText, centerVec, scaleVal) {
            if (!objText || !objText.includes("f ")) return null;
            const lines = objText.split(/\r?\n/);
            const rawVerts = [];
            const edgeSet = new Set();
            const linePositions = [];

            const cx = centerVec ? centerVec.x : 0;
            const cy = centerVec ? centerVec.y : 0;
            const cz = centerVec ? centerVec.z : 0;
            const sc = scaleVal || 1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith("v ")) {
                    const parts = line.split(/\s+/).slice(1);
                    const x = (parseFloat(parts[0]) - cx) * sc;
                    const y = (parseFloat(parts[1]) - cy) * sc;
                    const z = (parseFloat(parts[2]) - cz) * sc;
                    rawVerts.push([x, y, z]);
                } else if (line.startsWith("f ")) {
                    const tokens = line.split(/\s+/).slice(1);
                    const vIdxs = [];
                    for (let t = 0; t < tokens.length; t++) {
                        const p = tokens[t].split("/")[0];
                        const idx = parseInt(p, 10);
                        if (!isNaN(idx)) {
                            vIdxs.push(idx > 0 ? idx - 1 : rawVerts.length + idx);
                        }
                    }
                    const count = vIdxs.length;
                    for (let j = 0; j < count; j++) {
                        const a = vIdxs[j];
                        const b = vIdxs[(j + 1) % count];
                        const key = a < b ? (a + "_" + b) : (b + "_" + a);
                        if (!edgeSet.has(key)) {
                            edgeSet.add(key);
                            const vA = rawVerts[a];
                            const vB = rawVerts[b];
                            if (vA && vB) {
                                linePositions.push(vA[0], vA[1], vA[2], vB[0], vB[1], vB[2]);
                            }
                        }
                    }
                }
            }

            if (linePositions.length === 0) return null;
            const edgeGeo = new THREE.BufferGeometry();
            edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
            return edgeGeo;
        }

        function getOrCreateRealEdgesGeo(geo) {
            if (!geo) return null;
            if (!geo.userData) geo.userData = {};
            if (!geo.userData._realEdgesGeo) {
                let realGeo = null;
                if (geo.userData.rawObjText) {
                    try {
                        realGeo = parseObjToRealEdgesGeometry(
                            geo.userData.rawObjText,
                            geo.userData.center,
                            geo.userData.scale
                        );
                    } catch (e) {
                        console.warn("[Edges] Erro ao extrair arestas reais do OBJ:", e.message);
                    }
                }
                // Fallback automático com EdgesGeometry (15 graus) para suprimir diagonais coplanares de quads
                if (!realGeo) {
                    realGeo = new THREE.EdgesGeometry(geo, 15);
                }
                geo.userData._realEdgesGeo = realGeo;
            }
            return geo.userData._realEdgesGeo;
        }

        // Overlays: Arestas Reais (Topologia / Quads) e Vértices
        const edgesMesh = new THREE.LineSegments(getOrCreateRealEdgesGeo(highPolyGeo), edgesMaterial);
        edgesMesh.visible = false;
        scene.add(edgesMesh);

        const pointsMesh = new THREE.Points(highPolyGeo, pointsMaterial);
        pointsMesh.visible = false;
        scene.add(pointsMesh);

        // ══════════════════════════════════════════════════════
        //  CONTROLOS INTERATIVOS DE CÂMARA (ROTAÇÃO LIVRE COM O RATO)
        // ══════════════════════════════════════════════════════
        let controls = null;
        if (window.THREE && window.THREE.OrbitControls) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.06;
            controls.rotateSpeed = 0.85;
            controls.zoomSpeed = 1.0;
            controls.panSpeed = 0.8;
            controls.enablePan = true;
            controls.autoRotate = false; // Desativa a rotação automática contínua!
        } else {
            // Controlo manual nativo de rotação com o rato caso o script CDN não esteja pronto
            setupNativeMouseDrag(canvas, mesh);
        }

        function setupNativeMouseDrag(domElement, targetMesh) {
            let isDragging = false;
            let prevMouseX = 0;
            let prevMouseY = 0;

            domElement.addEventListener("mousedown", (e) => {
                if (e.button === 0) { // Botão esquerdo
                    isDragging = true;
                    prevMouseX = e.clientX;
                    prevMouseY = e.clientY;
                }
            });

            window.addEventListener("mousemove", (e) => {
                if (!isDragging || !targetMesh) return;
                const deltaX = e.clientX - prevMouseX;
                const deltaY = e.clientY - prevMouseY;
                prevMouseX = e.clientX;
                prevMouseY = e.clientY;

                targetMesh.rotation.y += deltaX * 0.008;
                targetMesh.rotation.x += deltaY * 0.008;
                if (edgesMesh) edgesMesh.rotation.copy(targetMesh.rotation);
                if (pointsMesh) pointsMesh.rotation.copy(targetMesh.rotation);
            });

            window.addEventListener("mouseup", () => {
                isDragging = false;
            });

            domElement.addEventListener("wheel", (e) => {
                e.preventDefault();
                camera.position.z = Math.max(5, Math.min(150, camera.position.z + e.deltaY * 0.05));
            }, { passive: false });
        }

        // Loop de Renderização Interativo
        function animate() {
            requestAnimationFrame(animate);
            if (controls) {
                controls.update();
            }
            renderer.render(scene, camera);
        }
        animate();

        // ══════════════════════════════════════════════════════
        //  ELEMENTOS DE UI & CONTROLO
        // ══════════════════════════════════════════════════════
        const btnHigh = document.getElementById("btn-high-poly");
        const btnLow = document.getElementById("btn-low-poly");
        const btnSnapPoly = document.getElementById("btn-snap-poly");
        const btnSurface = document.getElementById("btn-surface");
        const btnEdges = document.getElementById("btn-edges");
        const btnVerts = document.getElementById("btn-verts");
        const btnWire = document.getElementById("btn-wireframe"); // fallback para compatibilidade
        const sideBtnHeatmap = document.getElementById("side-btn-heatmap");

        let isGNNHeatmapActive = false;
        let isDSSHeatmapActive = false;

        function setDSSHeatmapActive(isActive) {
            isDSSHeatmapActive = !!isActive;
            if (isDSSHeatmapActive) isGNNHeatmapActive = false;
            updateSurfaceMaterial();
        }

        function setGNNHeatmapActive(isActive) {
            isGNNHeatmapActive = !!isActive;
            if (isGNNHeatmapActive) isDSSHeatmapActive = false;
            const qaLegend = document.getElementById("qa-heatmap-legend");
            const qaLegendTitle = document.getElementById("qa-legend-title");
            const qaLegendMin = document.getElementById("qa-legend-min");
            const qaLegendMax = document.getElementById("qa-legend-max");

            if (sideBtnHeatmap) {
                if (isGNNHeatmapActive) {
                    sideBtnHeatmap.classList.remove("btn-outline");
                    sideBtnHeatmap.classList.add("btn-primary");
                    sideBtnHeatmap.innerHTML = "<span>🔥 Desativar Heatmap</span>";
                    sideBtnHeatmap.style.boxShadow = "0 0 12px rgba(56, 189, 248, 0.4)";
                } else {
                    sideBtnHeatmap.classList.remove("btn-primary");
                    sideBtnHeatmap.classList.add("btn-outline");
                    sideBtnHeatmap.innerHTML = "<span>🔥 Ativar Heatmap GNN</span>";
                    sideBtnHeatmap.style.boxShadow = "none";
                }
            }

            if (isGNNHeatmapActive && activeView === "high") {
                if (qaLegend && qaLegendMin && qaLegendMax) {
                    if (qaLegendTitle) {
                        qaLegendTitle.style.display = "block";
                        qaLegendTitle.textContent = "GNN Feature Saliency";
                    }
                    qaLegendMin.textContent = "0.0 (Baixa / Dispensável)";
                    qaLegendMax.textContent = "1.0 (Alta / Crítico)";
                    const grad = document.getElementById("qa-legend-gradient");
                    if (grad) grad.style.background = "linear-gradient(90deg, #3b82f6 0%, #eab308 50%, #ef4444 100%)";
                    qaLegend.style.display = "flex";
                }
            } else if (!isDSSHeatmapActive && qaLegend) {
                qaLegend.style.display = "none";
            }

            updateSurfaceMaterial();
        }

        function syncHeatmapUI(isActive) {
            setGNNHeatmapActive(isActive);
        }

        let showSurface = true;
        let showEdges = false;
        let showVerts = false;

        function updateSurfaceMaterial() {
            const isHeatmapActive = isGNNHeatmapActive || isDSSHeatmapActive;

            showSurface = true;
            if (btnSurface) btnSurface.classList.add("active");

            if (isHeatmapActive) {
                mesh.material = heatmapMaterial;
                heatmapMaterial.vertexColors = true;
                heatmapMaterial.color.setHex(0xffffff);
                heatmapMaterial.needsUpdate = true;
            } else {
                mesh.material = baseMaterial;
            }
            mesh.material.needsUpdate = true;

            // Quando o heatmap está ativo, oculta os pontos amarelos e suaviza as arestas para não degradar a visualização térmica
            if (isDSSHeatmapActive) {
                // Mapa do DSS: as faces sem problemas ficam cinzentas e as arestas
                // à vista (tipo wireframe); só os problemas têm cor.
                if (pointsMesh) pointsMesh.visible = false;
                if (edgesMesh) {
                    edgesMesh.visible = true;
                    edgesMaterial.color.setHex(0xcbd5e1);
                    edgesMaterial.opacity = 0.55;
                }
            } else if (isHeatmapActive) {
                if (pointsMesh) pointsMesh.visible = false;
                if (edgesMesh && showEdges) {
                    edgesMaterial.color.setHex(0x0f172a);
                    edgesMaterial.opacity = 0.35;
                }
            } else {
                if (pointsMesh) pointsMesh.visible = showVerts;
                if (edgesMesh) {
                    edgesMesh.visible = showEdges;
                    edgesMaterial.color.setHex(0x38bdf8);
                    edgesMaterial.opacity = 0.85;
                }
            }
        }

        function disposeGeo(geo) {
            if (!geo) return;
            if (geo.userData && geo.userData._realEdgesGeo) {
                geo.userData._realEdgesGeo.dispose();
                geo.userData._realEdgesGeo = null;
            }
            geo.dispose();
        }

        function syncVisualOverlays() {
            const activeGeo = mesh.geometry;
            if (edgesMesh) {
                edgesMesh.geometry = getOrCreateRealEdgesGeo(activeGeo);
            }
            if (pointsMesh) {
                pointsMesh.geometry = activeGeo;
            }
        }

        function resetCamera() {
            camera.position.set(0, 0, 40);
            if (controls) {
                controls.target.set(0, 0, 0);
                controls.update();
            }
        }

        let currentSnapGeo = null;
        let currentSnapStats = null;
        let currentSnapDissolves = null;
        let currentSnapIndex = null;
        let currentSnapStep = null;
        let currentSnapEfficiency = null;

        window.getActiveView = () => activeView;
        window.getCurrentSnapDissolves = () => currentSnapDissolves;
        window.getCurrentSnapStats = () => currentSnapStats;
        window.getCurrentSnapObjText = () => currentSnapGeo?.userData?.rawObjText || null;

        const valTris = document.getElementById("val-tris");
        const valVerts = document.getElementById("val-verts");

        const sideReduction = document.getElementById("side-face-reduction");
        const sideDissolves = document.getElementById("side-dissolves");
        const sideSteps = document.getElementById("side-steps");

        const sideRlBar = document.getElementById("side-rl-bar");
        const sideRlPct = document.getElementById("side-rl-pct");

        const sideGnnVerts = document.getElementById("side-gnn-verts");
        const sideGnnAvgScore = document.getElementById("side-gnn-avg-score");
        const sideGnnCrit = document.getElementById("side-gnn-critical");
        const sideGnnCritPct = document.getElementById("side-gnn-crit-pct");
        const sideGnnDisp = document.getElementById("side-gnn-dispensable");
        const sideGnnDispPct = document.getElementById("side-gnn-disp-pct");
        const sideGnnDistHigh = document.getElementById("side-gnn-dist-high");
        const sideGnnDistMid = document.getElementById("side-gnn-dist-mid");
        const sideGnnDistLow = document.getElementById("side-gnn-dist-low");
        const sideGnnBarHigh = document.getElementById("side-gnn-bar-high");
        const sideGnnBarMid = document.getElementById("side-gnn-bar-mid");
        const sideGnnBarLow = document.getElementById("side-gnn-bar-low");
        const sideGnnBadge = document.getElementById("side-gnn-badge");

        // Elementos Expandidos do Painel Lateral
        const origFacesVal = document.getElementById("orig-faces-val");
        const origVertsVal = document.getElementById("orig-verts-val");
        const origEdgesVal = document.getElementById("orig-edges-val");
        const origWatertightVal = document.getElementById("orig-watertight-val");
        const origManifoldVal = document.getElementById("orig-manifold-val");
        const origBoundaryVal = document.getElementById("orig-boundary-val");
        const sideOrigStepsVal = document.getElementById("side-orig-steps-val");

        const sideCompFacesBefore = document.getElementById("side-comp-faces-before");
        const sideCompFacesAfter = document.getElementById("side-comp-faces-after");
        const sideRLEfficiency = document.getElementById("side-rl-efficiency");

        const sideHighInfo = document.getElementById("side-high-info");
        const sideLowInfo = document.getElementById("side-low-info");

        const btnSideReport = document.getElementById("btn-side-report");

        const actionLogEntries = [];
        let cachedSnapshots = [];
        let cachedResults = null;
        // OBJ da malha final mostrada: os quads do quad final (GET /v1/quad/{id}/download)
        // ou, se o quad falhou, os triângulos do RL (GET /v1/rl/simplify/{id}).
        let cachedSimplifiedObjText = null;
        let finalMeshIsQuad = false;
        let finalQuadFailed = false;

        async function fetchFinalMeshObj() {
            if (cachedSimplifiedObjText && cachedSimplifiedObjText.includes("v ")) {
                return cachedSimplifiedObjText;
            }
            const modelId = currentModelId;
            let text = null;
            let isQuad = false;
            if (!finalQuadFailed) {
                try {
                    text = await RetopoAPI.downloadQuadMesh(modelId);
                    isQuad = true;
                } catch (err) {
                    console.warn("[Main] Malha final em quads indisponível; a usar os triângulos do RL:", err.message);
                }
            }
            if (!text || !text.includes("v ")) {
                text = await RetopoAPI.downloadSimplifiedMesh(modelId);
                isQuad = false;
            }
            if (modelId !== currentModelId) return null; // entretanto foi carregado outro modelo
            if (text && text.includes("v ")) {
                cachedSimplifiedObjText = text;
                finalMeshIsQuad = isQuad;
            }
            return text;
        }
        window.fetchFinalMeshObj = fetchFinalMeshObj;
        window.getFinalMeshObjText = () => cachedSimplifiedObjText;

        // ─── Estado dos snapshots ────────────────────────────────────────────
        // A API gera cada snapshot em segundo plano depois de o RL acabar, um de
        // cada vez. GET /v1/rl/simplify/{id}/snapshots diz o estado de cada um
        // (status: generating | ready | failed), por isso só se consulta essa
        // lista, a cada SNAPSHOT_POLL_MS, enquanto algum estiver a ser gerado.
        const SNAPSHOT_POLL_MS = 3000;
        const snapshotCardUpdaters = new Map(); // accepted_dissolves → atualiza o cartão
        let snapshotPollTimer = null;
        let snapshotPollModel = null;

        function stopSnapshotPolling() {
            clearTimeout(snapshotPollTimer);
            snapshotPollTimer = null;
            snapshotPollModel = null;
        }

        /** Aplica a lista aos cartões e continua a consultar enquanto houver snapshots a gerar. */
        function applySnapshotStatuses(list) {
            if (!Array.isArray(list)) return false;
            cachedSnapshots = list;
            let generating = false;
            for (const item of list) {
                if (!item) continue;
                if (item.status === "generating") generating = true;
                snapshotCardUpdaters.get(item.accepted_dissolves)?.(item);
            }
            return generating;
        }

        function startSnapshotPolling() {
            const modelId = currentModelId;
            if (!modelId || snapshotPollModel === modelId) return;
            stopSnapshotPolling();
            snapshotPollModel = modelId;
            const tick = async () => {
                if (snapshotPollModel !== modelId || currentModelId !== modelId) return;
                let generating = true;
                try {
                    generating = applySnapshotStatuses(await RetopoAPI.getRLSnapshots(modelId));
                } catch (err) {
                    console.warn("[Snapshots] Erro ao consultar o estado:", err.message);
                }
                if (snapshotPollModel !== modelId) return;
                if (generating) snapshotPollTimer = setTimeout(tick, SNAPSHOT_POLL_MS);
                else stopSnapshotPolling();
            };
            snapshotPollTimer = setTimeout(tick, SNAPSHOT_POLL_MS);
        }

        /** OBJ de um snapshot: os quads se já existirem, senão os triângulos do RL. */
        async function fetchSnapshotObj(dissolves) {
            try {
                const text = await RetopoAPI.downloadQuadMesh(currentModelId, dissolves);
                if (text && text.includes("v ")) return { text, isQuad: true };
            } catch (err) {
                if (err?.status !== 404 && err?.status !== 409) {
                    console.warn(`[Snapshot] Quads do snapshot ${dissolves} indisponíveis:`, err.message);
                }
            }
            const snapData = await RetopoAPI.getRLSnapshot(currentModelId, dissolves);
            return { text: extractObjFromSnap(snapData), isQuad: false };
        }

        window.getCurrentSnapIsQuad = () => Boolean(currentSnapGeo?.userData?.isQuad);

        let currentEdgeFilter = "all";
        let latestActionsList = [];
        const snapshotImagesMap = new Map();
        let gnnLoaded = false;
        let gnnPromise = null;
        let gnnColorsArray = null;
        let gnnLastError = null;

        // ─── Malha limpa (High) ─────────────────────────────────────────────
        // A API limpa o upload uma vez (funde vértices, remove faces duplicadas e
        // degeneradas) e usa só essa malha: o vértice i da malha limpa é a linha i
        // do CSV da GNN, o vértice i do heatmap, do RL e do DSS da original.
        // A vista High passa a mostrar essa malha para tudo ficar alinhado.
        let highPolyIsClean = false;
        let cleanMeshObjText = null;
        let cleanHighPromise = null;

        function ensureCleanHighPoly() {
            if (highPolyIsClean) return Promise.resolve(true);
            if (cleanHighPromise) return cleanHighPromise;
            const modelId = currentModelId;
            const download = RetopoAPI.downloadCleanMesh(modelId); // entra já na fila da malha
            cleanHighPromise = (async () => {
                try {
                    const text = await download;
                    if (modelId !== currentModelId || !text || !text.includes("v ")) return false;
                    const geo = buildCustomOBJGeometry(text);
                    if (!geo) return false;
                    geo.userData.isCleanMesh = true;

                    const oldGeo = highPolyGeo;
                    highPolyGeo = geo;
                    highPolyIsClean = true;
                    cleanMeshObjText = text;

                    const stats = computeObjStats(text);
                    realStats.high.verts = stats.verts;
                    realStats.high.faces = stats.faces;
                    if (origFacesVal) origFacesVal.textContent = stats.faces.toLocaleString();
                    if (origVertsVal) origVertsVal.textContent = stats.verts.toLocaleString();
                    if (origEdgesVal) origEdgesVal.textContent = Math.round(stats.faces * 1.5).toLocaleString();

                    if (mesh.geometry === oldGeo) {
                        mesh.geometry = highPolyGeo;
                        syncVisualOverlays();
                        updateFloatingStats(stats.verts, stats.faces);
                    }
                    if (activeView === "high" && typeof updateSidebarContext === "function") {
                        updateSidebarContext("high");
                    }
                    if (oldGeo && oldGeo !== lowPolyGeo && oldGeo !== currentSnapGeo) {
                        disposeGeo(oldGeo);
                    }
                    return true;
                } catch (err) {
                    console.warn("[High] Malha limpa indisponível; a manter o ficheiro enviado:", err.message);
                    return false;
                } finally {
                    cleanHighPromise = null;
                }
            })();
            return cleanHighPromise;
        }
        window.getCleanMeshObjText = () => cleanMeshObjText;
        let gnnScores = null;
        let isRLRunning = false;
        let previousSidebarContext = "low";
        let activeSidebarContext = "high";

        /** A malha final (quads) tem outro número de faces do que a saída do RL:
         *  mostra-o à parte, com a redução total, para bater com o DSS. */
        function showFinalFaces(faces, before) {
            const row = document.getElementById("side-final-faces-row");
            const value = document.getElementById("side-final-faces");
            const label = document.getElementById("side-comp-faces-label");
            const isSnap = faces === null || faces === undefined;
            if (label) label.textContent = isSnap ? "Faces (Antes ➔ Depois):" : "Faces do RL (Antes ➔ Depois):";
            if (!row || !value) return;
            faces = Number(faces);
            before = Number(before);
            if (isSnap || !(faces > 0)) {
                row.style.display = "none";
                return;
            }
            const total = before > 0 ? (1 - faces / before) * 100 : null;
            value.textContent = `${faces.toLocaleString()} faces${total === null ? "" : ` (−${total.toFixed(1)}%)`}`;
            row.style.display = "flex";
        }

        function updateFloatingStats(verts, tris) {
            if (valVerts) valVerts.textContent = (verts || 0).toLocaleString();
            if (valTris) valTris.textContent = (tris || 0).toLocaleString();
        }

        function resetSidebarAndReports(newObjText) {
            const extracted = computeObjStats(newObjText);
            realStats.high.verts = extracted.verts;
            realStats.high.faces = extracted.faces;
            realStats.low.verts = 0;
            realStats.low.faces = 0;

            updateFloatingStats(realStats.high.verts, realStats.high.faces);

            // Estatísticas da Malha Original
            if (origFacesVal) origFacesVal.textContent = realStats.high.faces.toLocaleString();
            if (origVertsVal) origVertsVal.textContent = realStats.high.verts.toLocaleString();
            if (origEdgesVal) origEdgesVal.textContent = Math.round(realStats.high.faces * 1.5).toLocaleString();
            if (origWatertightVal) origWatertightVal.textContent = "--";
            if (origManifoldVal) origManifoldVal.textContent = "--";
            if (origBoundaryVal) origBoundaryVal.textContent = "--";
            if (sideOrigStepsVal) sideOrigStepsVal.textContent = "--"; // definido pelo modelo RL (progress.total)

            // Comparativos RL
            if (sideCompFacesBefore) sideCompFacesBefore.textContent = realStats.high.faces.toLocaleString();
            if (sideCompFacesAfter) sideCompFacesAfter.textContent = "⏳ A otimizar...";
            if (sideRLEfficiency) sideRLEfficiency.textContent = "--%";

            if (sideHighInfo) {
                sideHighInfo.textContent = `${realStats.high.faces.toLocaleString()} faces / ${realStats.high.verts.toLocaleString()} vértices`;
            }
            if (sideLowInfo) {
                sideLowInfo.textContent = "⏳ A otimizar...";
            }
            if (sideReduction) {
                sideReduction.textContent = "A calcular...";
            }
            if (sideDissolves) {
                sideDissolves.textContent = "0";
            }
            if (sideSteps) {
                sideSteps.textContent = "0";
            }
            if (sideRlBar) {
                sideRlBar.style.width = "0%";
            }
            if (sideRlPct) {
                sideRlPct.textContent = "0%";
            }
            if (sideGnnVerts) {
                sideGnnVerts.textContent = realStats.high.verts.toLocaleString();
            }
            if (sideGnnAvgScore) {
                sideGnnAvgScore.textContent = "--";
            }
            if (sideGnnCrit) {
                sideGnnCrit.textContent = "--";
            }
            if (sideGnnCritPct) {
                sideGnnCritPct.textContent = "--%";
            }
            if (sideGnnDisp) {
                sideGnnDisp.textContent = "--";
            }
            if (sideGnnDispPct) {
                sideGnnDispPct.textContent = "--%";
            }
            if (sideGnnDistHigh) {
                sideGnnDistHigh.textContent = "--";
            }
            if (sideGnnDistMid) {
                sideGnnDistMid.textContent = "--";
            }
            if (sideGnnDistLow) {
                sideGnnDistLow.textContent = "--";
            }
            if (sideGnnBarHigh) {
                sideGnnBarHigh.style.width = "33%";
            }
            if (sideGnnBarMid) {
                sideGnnBarMid.style.width = "34%";
            }
            if (sideGnnBarLow) {
                sideGnnBarLow.style.width = "33%";
            }
            if (sideGnnBadge) {
                sideGnnBadge.textContent = "IA / EGNN";
            }
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge working";
                rlStatusBadge.textContent = "A iniciar novo modelo...";
            }

            // Repor Botões de Seleção de Malha e Modos Visuais
            btnHigh.classList.add("active");
            btnLow.classList.remove("active");
            btnLow.disabled = true;
            btnLow.style.opacity = "0.45";
            btnLow.style.cursor = "not-allowed";
            btnLow.innerText = "🔒 A Otimizar...";
            btnLow.style.boxShadow = "none";

            if (btnSnapPoly) {
                btnSnapPoly.classList.remove("active");
                btnSnapPoly.style.display = "none";
            }

            setGNNHeatmapActive(false);

            if (btnSurface) btnSurface.classList.add("active");
            if (btnEdges) btnEdges.classList.remove("active");
            if (btnVerts) btnVerts.classList.remove("active");
            showSurface = true;
            showEdges = false;
            showVerts = false;
            if (edgesMesh) edgesMesh.visible = false;
            if (pointsMesh) pointsMesh.visible = false;

            // Esvaziar arrays de dados e caches de Relatório
            actionLogEntries.length = 0;
            cachedSnapshots = [];
            stopSnapshotPolling();
            snapshotCardUpdaters.clear();
            cachedResults = null;
            cachedSimplifiedObjText = null;
            finalMeshIsQuad = false;
            finalQuadFailed = false;
            if (typeof snapshotImagesMap !== "undefined" && snapshotImagesMap?.clear) {
                snapshotImagesMap.clear();
            }
            latestActionsList = [];
            currentEdgeFilter = "all";
            gnnLoaded = false;
            gnnScores = null;
            gnnPromise = null;
            gnnColorsArray = null;
            gnnLastError = null;
            highPolyIsClean = false;
            cleanMeshObjText = null;
            cleanHighPromise = null;
            isRLRunning = false;

            // Fechar Gavetas se Abertas
            const actionLogDrawer = document.getElementById("action-log-drawer");
            if (actionLogDrawer) actionLogDrawer.classList.remove("open");
            if (typeof closeSnapshotLightbox === "function") closeSnapshotLightbox();

            // Reset completo do Drawer de Relatório RL
            const repSteps = document.getElementById("rep-steps");
            const repDissolves = document.getElementById("rep-dissolves");
            const repReduction = document.getElementById("rep-reduction");
            const repSnapshots = document.getElementById("rep-snapshots");
            const actionLogCount = document.getElementById("action-log-count");
            const snapshotsList = document.getElementById("snapshots-list");
            const actionLogBody = document.getElementById("action-log-body");

            if (repSteps) repSteps.textContent = "0";
            if (repDissolves) repDissolves.textContent = "0";
            if (repReduction) repReduction.textContent = "0%";
            if (repSnapshots) repSnapshots.textContent = "0";
            if (actionLogCount) actionLogCount.textContent = "0 acções";

            const countAllEdges = document.getElementById("filter-all-edges-count");
            const countAcceptedEdges = document.getElementById("filter-accepted-edges-count");
            const countRejectedEdges = document.getElementById("filter-rejected-edges-count");
            if (countAllEdges) countAllEdges.textContent = "0";
            if (countAcceptedEdges) countAcceptedEdges.textContent = "0";
            if (countRejectedEdges) countRejectedEdges.textContent = "0";

            if (snapshotsList) {
                snapshotsList.innerHTML = `<div class="action-log-empty"><span>⏳ A aguardar decimação RL para gerar snapshots...</span></div>`;
            }
            if (actionLogBody) {
                actionLogBody.innerHTML = `<div class="action-log-empty"><span>⏳ Aguarda o início da simulação RL...</span></div>`;
            }

            // Reset completo do DSS
            if (window.MeshQA && typeof window.MeshQA.resetAll === "function") {
                window.MeshQA.resetAll();
            }

            // Adaptar contexto do menu lateral para a malha Original (High)
            updateSidebarContext("high");
        }

        function resetAndLoadModel(newModelId, newFileUrl, newRawObjText) {
            currentModelId = newModelId;
            window.currentActiveModelId = newModelId;
            window.currentUploadedObjText = newRawObjText;

            // 1. Descartar geometrias antigas e carregar a nova malha no 3D
            disposeGeo(highPolyGeo);
            disposeGeo(lowPolyGeo);
            disposeGeo(currentSnapGeo);

            highPolyGeo = buildHighPolyGeo(newRawObjText);
            lowPolyGeo = null;
            currentSnapGeo = null;
            currentSnapStats = null;
            currentSnapDissolves = null;
            currentSnapStep = null;
            currentSnapEfficiency = null;
            realStats.low.faces = 0;
            realStats.low.verts = 0;
            realStats.low.dissolves = 0;
            realStats.low.steps = 0;
            realStats.low.efficiencyText = "--%";
            realStats.low.reduction = "0%";
            realStats.low.rlFacesBefore = null;
            realStats.low.rlFacesAfter = null;
            realStats.low.isQuad = false;
            if (btnSnapPoly) {
                btnSnapPoly.style.display = "none";
                btnSnapPoly.classList.remove("active");
            }
            activeView = "high";

            mesh.geometry = highPolyGeo;
            mesh.material = baseMaterial;
            mesh.material.needsUpdate = true;
            mesh.visible = true;

            syncVisualOverlays();
            resetCamera();

            // 2. Zerar completamente estados, relatórios, sidebar e DSS
            resetSidebarAndReports(newRawObjText);

            // 3. Iniciar cálculo GNN em background e decimação RL para o novo modelo
            ensureGNNHeatmap().catch(err => console.warn("[GNN Auto] Erro no cálculo automático:", err));
            runRLDecimation();
        }

        window.RetopoViewer = {
            scene: scene,
            camera: camera,
            controls: controls,
            renderer: renderer,
            mesh: mesh,
            edgesMesh: edgesMesh,
            pointsMesh: pointsMesh,
            edgesMaterial: edgesMaterial,
            pointsMaterial: pointsMaterial,
            baseMaterial: baseMaterial,
            heatmapMaterial: heatmapMaterial,
            occluderMaterial: occluderMaterial,
            setDSSHeatmapActive: setDSSHeatmapActive,
            isDSSHeatmapActive: () => isDSSHeatmapActive,
            updateSurfaceMaterial: updateSurfaceMaterial,
            getHighPolyGeo: () => highPolyGeo,
            getLowPolyGeo: () => lowPolyGeo,
            setLowPolyGeo: (geo) => { lowPolyGeo = geo; },
            syncVisualOverlays: syncVisualOverlays,
            updateFloatingStats: updateFloatingStats,
            loadMeshIntoViewport: loadMeshIntoViewport,
            loadGeometryIntoViewport: loadGeometryIntoViewport,
            resetCamera: resetCamera,
            resetAndLoadModel: resetAndLoadModel,
            resetSidebarAndReports: resetSidebarAndReports
        };

        // Inicializar Raycaster interativo de inspeção topológica do DSS
        if (window.MeshQA && typeof window.MeshQA.setupRaycaster === "function") {
            window.MeshQA.setupRaycaster();
        }

        // Atualizar estatísticas iniciais reais do High Poly e preencher painel lateral
        updateFloatingStats(realStats.high.verts, realStats.high.faces);
        if (origFacesVal) origFacesVal.textContent = realStats.high.faces.toLocaleString();
        if (origVertsVal) origVertsVal.textContent = realStats.high.verts.toLocaleString();
        if (origEdgesVal) origEdgesVal.textContent = Math.round(realStats.high.faces * 1.5).toLocaleString();
        if (origWatertightVal) origWatertightVal.textContent = "--";
        if (origManifoldVal) origManifoldVal.textContent = "--";
        if (origBoundaryVal) origBoundaryVal.textContent = "--";
        if (sideOrigStepsVal) sideOrigStepsVal.textContent = "--"; // definido pelo modelo RL (progress.total)
        if (sideCompFacesBefore) sideCompFacesBefore.textContent = realStats.high.faces.toLocaleString();
        if (sideCompFacesAfter) sideCompFacesAfter.textContent = "⏳ A otimizar...";
        if (sideRLEfficiency) sideRLEfficiency.textContent = "--%";

        if (sideHighInfo) {
            sideHighInfo.textContent = `${realStats.high.faces.toLocaleString()} faces / ${realStats.high.verts.toLocaleString()} vértices`;
        }
        if (sideGnnVerts) {
            sideGnnVerts.textContent = realStats.high.verts.toLocaleString();
        }
        if (sideLowInfo) {
            sideLowInfo.textContent = "⏳ A otimizar...";
        }

        // Inicialmente o Low Poly está em processamento
        btnLow.disabled = true;
        btnLow.style.opacity = "0.45";
        btnLow.style.cursor = "not-allowed";
        btnLow.innerText = "🔒 A Otimizar...";

        // ══════════════════════════════════════════════════════
        //  CONTROLOS DE VISUALIZAÇÃO (ORIGINAL, LOW, SNAPSHOT, DSS)
        // ══════════════════════════════════════════════════════
        function updateSidebarContext(viewMode) {
            const contextHigh = document.getElementById("sidebar-context-high");
            const contextLow = document.getElementById("sidebar-context-low");
            const contextDss = document.getElementById("sidebar-context-dss");

            if (viewMode !== "dss") {
                previousSidebarContext = viewMode;
            }
            activeSidebarContext = viewMode;

            if (viewMode === "high") {
                if (btnHigh) btnHigh.classList.add("active");
                if (btnLow) btnLow.classList.remove("active");
                if (btnSnapPoly) btnSnapPoly.classList.remove("active");
                if (contextHigh) contextHigh.style.setProperty("display", "flex", "important");
                if (contextLow) contextLow.style.setProperty("display", "none", "important");
                if (contextDss) contextDss.style.setProperty("display", "none", "important");
            } else if (viewMode === "low") {
                if (btnLow) btnLow.classList.add("active");
                if (btnHigh) btnHigh.classList.remove("active");
                if (btnSnapPoly) btnSnapPoly.classList.remove("active");
                if (contextHigh) contextHigh.style.setProperty("display", "none", "important");
                if (contextLow) contextLow.style.setProperty("display", "flex", "important");
                if (contextDss) contextDss.style.setProperty("display", "none", "important");

                // Banner
                const optTitle = document.getElementById("side-opt-title");
                const optSub = document.getElementById("side-opt-subtitle");
                const optTag = document.getElementById("side-opt-tag");
                const optIcon = document.getElementById("side-opt-icon");
                if (optTitle) optTitle.textContent = "Otimizado (Low Poly)";
                if (optSub) optSub.textContent = "Topologia Simplificada por Reinforcement Learning";
                if (optTag) { optTag.textContent = "OTIMIZADO"; optTag.className = "badge-tag green"; }
                if (optIcon) optIcon.textContent = "⚡";

                // Módulo A: Performance RL
                if (sideReduction) {
                    sideReduction.textContent = realStats.low.reduction || (realStats.high.faces > 0 && realStats.low.faces > 0
                        ? `${Math.max(0, (1 - (realStats.low.faces / realStats.high.faces)) * 100).toFixed(1)}%`
                        : "--");
                    sideReduction.className = "cell-val text-green";
                }
                if (sideDissolves) {
                    sideDissolves.textContent = realStats.low.dissolves ?? "--";
                }
                if (sideSteps) {
                    sideSteps.textContent = realStats.low.steps ?? "--";
                }
                if (sideCompFacesBefore) {
                    const before = realStats.low.rlFacesBefore ?? realStats.high.faces;
                    sideCompFacesBefore.textContent = before > 0 ? before.toLocaleString() : "--";
                }
                if (sideCompFacesAfter) {
                    const after = realStats.low.rlFacesAfter ?? realStats.low.faces;
                    sideCompFacesAfter.textContent = after > 0 ? after.toLocaleString() : "--";
                    sideCompFacesAfter.style.color = "#34d399";
                }
                showFinalFaces(realStats.low.isQuad ? realStats.low.faces : null, realStats.high.faces);
                if (sideRLEfficiency) {
                    sideRLEfficiency.textContent = realStats.low.efficiencyText || "--%";
                }

                // Módulo B: Auditoria DSS
                const qaTitle = document.getElementById("qa-target-title");
                if (qaTitle) {
                    qaTitle.textContent = "Malha Otimizada";
                    qaTitle.style.color = "#38bdf8";
                }
                const dssDrawerTitle = document.getElementById("dss-drawer-target-title");
                if (dssDrawerTitle) dssDrawerTitle.textContent = "Malha Otimizada Final";
                if (window.MeshQA && typeof window.MeshQA.syncTargetMesh === "function") {
                    window.MeshQA.syncTargetMesh(null);
                }

                // Módulo C: Exportação
                const sideLowLabel = document.getElementById("side-low-info-label");
                if (sideLowLabel) sideLowLabel.textContent = "OTIMIZADO (LOW):";
                if (sideHighInfo) {
                    sideHighInfo.textContent = `${realStats.high.faces.toLocaleString()} faces / ${realStats.high.verts.toLocaleString()} v`;
                }
                if (sideLowInfo) {
                    sideLowInfo.textContent = realStats.low.faces > 0
                        ? `${realStats.low.faces.toLocaleString()} ${realStats.low.isQuad ? "faces (quads)" : "faces"} / ${realStats.low.verts.toLocaleString()} vértices`
                        : "--";
                    sideLowInfo.style.color = "#34d399";
                }
                const expBtn = document.getElementById("btn-export");
                if (expBtn) expBtn.innerHTML = "<span>💾 Exportar Low Poly (.obj)</span>";

            } else if (viewMode === "snapshot") {
                if (btnSnapPoly) btnSnapPoly.classList.add("active");
                if (btnHigh) btnHigh.classList.remove("active");
                if (btnLow) btnLow.classList.remove("active");
                if (contextHigh) contextHigh.style.setProperty("display", "none", "important");
                if (contextLow) contextLow.style.setProperty("display", "flex", "important");
                if (contextDss) contextDss.style.setProperty("display", "none", "important");

                const snapFaces = currentSnapStats?.faces || (currentSnapGeo?.attributes?.position ? Math.round(currentSnapGeo.attributes.position.count / 3) : 0);
                const snapVerts = currentSnapStats?.verts || (currentSnapGeo?.attributes?.position ? currentSnapGeo.attributes.position.count : 0);
                const snapDiss = (currentSnapDissolves !== null && currentSnapDissolves !== undefined) ? currentSnapDissolves : "--";
                const snapNumDisplay = currentSnapIndex ? `Snapshot #${currentSnapIndex}` : `Snapshot #${snapDiss}`;

                // Banner
                const optTitle = document.getElementById("side-opt-title");
                const optSub = document.getElementById("side-opt-subtitle");
                const optTag = document.getElementById("side-opt-tag");
                const optIcon = document.getElementById("side-opt-icon");
                if (optTitle) optTitle.textContent = `${snapNumDisplay} (${snapDiss} junções)`;
                if (optSub) optSub.textContent = `Marco Intermédio da Execução RL • ${snapFaces ? snapFaces.toLocaleString() : "--"} Faces`;
                if (optTag) { optTag.textContent = currentSnapIndex ? `SNAPSHOT #${currentSnapIndex}` : "SNAPSHOT"; optTag.className = "badge-tag purple"; }
                if (optIcon) optIcon.textContent = "📸";

                // Módulo A: Performance RL
                if (sideReduction) {
                    if (realStats.high.faces > 0 && snapFaces > 0) {
                        const rawRed = ((1 - (snapFaces / realStats.high.faces)) * 100);
                        sideReduction.textContent = rawRed >= 1 ? `${Math.round(rawRed)}%` : `${Math.max(0, rawRed).toFixed(1)}%`;
                    } else {
                        sideReduction.textContent = "--%";
                    }
                    sideReduction.className = "cell-val text-purple";
                }
                if (sideDissolves) {
                    sideDissolves.textContent = snapDiss;
                }
                if (sideSteps) {
                    sideSteps.textContent = currentSnapStep || snapDiss || "--";
                }
                if (sideCompFacesBefore) {
                    sideCompFacesBefore.textContent = realStats.high.faces > 0 ? realStats.high.faces.toLocaleString() : "--";
                }
                if (sideCompFacesAfter) {
                    sideCompFacesAfter.textContent = snapFaces > 0 ? snapFaces.toLocaleString() : "--";
                    sideCompFacesAfter.style.color = "#c084fc";
                }
                showFinalFaces(null);
                if (sideRLEfficiency) {
                    if (currentSnapEfficiency) {
                        sideRLEfficiency.textContent = currentSnapEfficiency;
                    } else if (currentSnapStep && currentSnapDissolves) {
                        const eff = Math.min(100, Math.round((currentSnapDissolves / currentSnapStep) * 100));
                        sideRLEfficiency.textContent = `${eff}% aceites`;
                    } else {
                        sideRLEfficiency.textContent = "Intermédio";
                    }
                }

                // Módulo B: Auditoria DSS
                const qaTitle = document.getElementById("qa-target-title");
                if (qaTitle) {
                    qaTitle.textContent = snapNumDisplay;
                    qaTitle.style.color = "#c084fc";
                }
                const dssDrawerTitle = document.getElementById("dss-drawer-target-title");
                if (dssDrawerTitle) dssDrawerTitle.textContent = `${snapNumDisplay} (${snapDiss} junções)`;
                if (window.MeshQA && typeof window.MeshQA.syncTargetMesh === "function") {
                    window.MeshQA.syncTargetMesh(currentSnapDissolves);
                }

                // Módulo C: Exportação
                const sideLowLabel = document.getElementById("side-low-info-label");
                if (sideLowLabel) sideLowLabel.textContent = currentSnapIndex ? `SNAPSHOT (#${currentSnapIndex}):` : `SNAPSHOT (#${snapDiss}):`;
                if (sideHighInfo) {
                    sideHighInfo.textContent = `${realStats.high.faces.toLocaleString()} faces / ${realStats.high.verts.toLocaleString()} v`;
                }
                if (sideLowInfo) {
                    sideLowInfo.textContent = snapFaces > 0
                        ? `${snapFaces.toLocaleString()} faces / ${snapVerts.toLocaleString()} vértices`
                        : "--";
                    sideLowInfo.style.color = "#c084fc";
                }
                const expBtn = document.getElementById("btn-export");
                if (expBtn) expBtn.innerHTML = `<span>💾 Descarregar ${snapNumDisplay} (.obj)</span>`;

            } else if (viewMode === "dss") {
                if (contextHigh) contextHigh.style.setProperty("display", "none", "important");
                if (contextLow) contextLow.style.setProperty("display", "none", "important");
                if (contextDss) contextDss.style.setProperty("display", "flex", "important");
            }
        }

        window.updateSidebarContext = updateSidebarContext;
        window.getPreviousSidebarContext = () => previousSidebarContext;

        function renderDssSnapshotTimeline() { }
        window.renderDssSnapshotTimeline = renderDssSnapshotTimeline;

        btnHigh.addEventListener("click", () => {
            try {
                mesh.geometry = highPolyGeo;
                setDSSHeatmapActive(false);
                if (window.MeshQA && typeof window.MeshQA.resetViewMode === "function") {
                    window.MeshQA.resetViewMode();
                }
                updateSurfaceMaterial();
                syncVisualOverlays();
            } catch (err) {
                console.warn("[btnHigh] Erro Three.js:", err);
            }

            activeView = "high";
            updateSidebarContext("high");
            updateFloatingStats(realStats.high.verts, realStats.high.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Original (High Poly)";
            }
        });

        btnLow.addEventListener("click", () => {
            if (btnLow.disabled || !lowPolyGeo) {
                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge working";
                    rlStatusBadge.textContent = "⏳ RL a decorrer... A malha otimizada estará disponível em instantes";
                }
                return;
            }

            try {
                mesh.geometry = lowPolyGeo;

                // O low poly aparece automaticamente com Superfície + Arestas + Vértices
                showSurface = true;
                showEdges = true;
                showVerts = true;
                if (btnSurface) btnSurface.classList.add("active");
                if (btnEdges) btnEdges.classList.add("active");
                if (btnVerts) btnVerts.classList.add("active");
                if (edgesMesh) edgesMesh.visible = true;
                if (pointsMesh) pointsMesh.visible = true;

                // O low poly NÃO pode aparecer automaticamente com o DSS (apenas se ativado expressamente)
                setDSSHeatmapActive(false);
                if (window.MeshQA && typeof window.MeshQA.resetViewMode === "function") {
                    window.MeshQA.resetViewMode();
                }

                updateSurfaceMaterial();
                syncVisualOverlays();
            } catch (err) {
                console.warn("[btnLow] Erro Three.js:", err);
            }

            activeView = "low";
            updateSidebarContext("low");
            updateFloatingStats(realStats.low.verts, realStats.low.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Otimizado (Low Poly)";
            }
        });

        if (btnSnapPoly) {
            btnSnapPoly.addEventListener("click", () => {
                if (!currentSnapGeo) return;
                try {
                    mesh.geometry = currentSnapGeo;

                    // Snapshot intermédio também com Superfície + Arestas + Vértices
                    showSurface = true;
                    showEdges = true;
                    showVerts = true;
                    if (btnSurface) btnSurface.classList.add("active");
                    if (btnEdges) btnEdges.classList.add("active");
                    if (btnVerts) btnVerts.classList.add("active");
                    if (edgesMesh) {
                        edgesMesh.visible = true;
                        edgesMesh.geometry = getOrCreateRealEdgesGeo(currentSnapGeo);
                    }
                    if (pointsMesh) {
                        pointsMesh.visible = true;
                        pointsMesh.geometry = currentSnapGeo;
                    }

                    setDSSHeatmapActive(false);
                    if (window.MeshQA && typeof window.MeshQA.resetViewMode === "function") {
                        window.MeshQA.resetViewMode();
                    }

                    updateSurfaceMaterial();
                    syncVisualOverlays();
                } catch (err) {
                    console.warn("[btnSnapPoly] Erro Three.js:", err);
                }

                activeView = "snapshot";
                updateSidebarContext("snapshot");
                if (currentSnapStats) {
                    updateFloatingStats(currentSnapStats.verts, currentSnapStats.faces);
                }
                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge online";
                    rlStatusBadge.textContent = `Visualizando: ${btnSnapPoly.textContent}`;
                }
            });
        }

        // Toggles de Modo: Superfície (Base Contínua), Arestas Reais e Vértices como Overlays
        if (btnSurface) {
            btnSurface.addEventListener("click", () => {
                showSurface = true;
                btnSurface.classList.add("active");
                // Se algum heatmap estiver ativo, volta à superfície padrão limpa
                if (isGNNHeatmapActive) setGNNHeatmapActive(false);
                if (isDSSHeatmapActive) setDSSHeatmapActive(false);
                updateSurfaceMaterial();
            });
        }

        if (btnEdges) {
            btnEdges.addEventListener("click", () => {
                showEdges = !showEdges;
                btnEdges.classList.toggle("active", showEdges);
                if (edgesMesh) {
                    edgesMesh.visible = showEdges;
                    if (showEdges) {
                        edgesMesh.geometry = getOrCreateRealEdgesGeo(mesh.geometry);
                    }
                }
                updateSurfaceMaterial();
            });
        }

        if (btnVerts) {
            btnVerts.addEventListener("click", () => {
                showVerts = !showVerts;
                btnVerts.classList.toggle("active", showVerts);
                if (pointsMesh) {
                    pointsMesh.visible = showVerts;
                    if (showVerts) {
                        pointsMesh.geometry = mesh.geometry;
                    }
                }
                updateSurfaceMaterial();
            });
        }

        if (btnWire) {
            btnWire.addEventListener("click", () => {
                if (btnEdges) btnEdges.click();
            });
        }


        const btnResetCam = document.getElementById("btn-reset-cam");
        if (btnResetCam) {
            btnResetCam.addEventListener("click", () => {
                resetCamera();
            });
        }

        // ══════════════════════════════════════════════════════
        //  HEATMAP GNN REAL (POST /predict + GET /scores)
        // ══════════════════════════════════════════════════════
        // Estado GNN declarado no escopo de topo do initThreeJS

        function applyHeatmapToMesh() {
            if (!highPolyGeo) return;

            // 1. Mudar vista visual para High Poly se necessário
            if (activeView !== "high") {
                mesh.geometry = highPolyGeo;
                btnHigh.classList.add("active");
                btnLow.classList.remove("active");
                if (btnSnapPoly) btnSnapPoly.classList.remove("active");
                activeView = "high";
                updateSidebarContext("high");
                updateFloatingStats(realStats.high.verts, realStats.high.faces);
                syncVisualOverlays();
            } else {
                mesh.geometry = highPolyGeo;
            }

            // 2. Aplicar as cores térmicas calculadas ao buffer de cor da geometria
            if (gnnColorsArray) {
                if (highPolyGeo.attributes.color && highPolyGeo.attributes.color.array.length === gnnColorsArray.length) {
                    highPolyGeo.attributes.color.array.set(gnnColorsArray);
                    highPolyGeo.attributes.color.needsUpdate = true;
                } else {
                    highPolyGeo.setAttribute("color", new THREE.BufferAttribute(gnnColorsArray, 3));
                    highPolyGeo.attributes.color.needsUpdate = true;
                }
            }

            // 3. Forçar superfície ativa e material térmico com vertexColors
            showSurface = true;
            if (btnSurface) btnSurface.classList.add("active");
            mesh.visible = true;
            mesh.material = heatmapMaterial;
            heatmapMaterial.vertexColors = true;
            heatmapMaterial.color.setHex(0xffffff);
            heatmapMaterial.needsUpdate = true;
            mesh.material.needsUpdate = true;
        }

        function createHeatmapColors(scoreEntries) {
            if (!highPolyGeo || !scoreEntries || scoreEntries.length === 0) return;
            const posAttr = highPolyGeo.attributes.position;
            const vertexIndices = highPolyGeo.userData ? highPolyGeo.userData.vertexIndices : null;
            const rawVerts = highPolyGeo.userData ? highPolyGeo.userData.rawVerts : null;
            const center = highPolyGeo.userData ? highPolyGeo.userData.center : null;
            const scale = highPolyGeo.userData ? highPolyGeo.userData.scale : 1;
            const colors = new Float32Array(posAttr.count * 3);

            let minImp = Infinity;
            let maxImp = -Infinity;
            for (let i = 0; i < scoreEntries.length; i++) {
                const imp = scoreEntries[i].imp;
                if (imp < minImp) minImp = imp;
                if (imp > maxImp) maxImp = imp;
            }
            if (minImp === maxImp || !isFinite(minImp)) { minImp = 0; maxImp = 1; }

            // a) Malha limpa da API: a linha i do CSV é o vértice i → emparelhar por índice
            const byIndex = Boolean(highPolyGeo.userData?.isCleanMesh && rawVerts && vertexIndices);
            const scoreById = new Map();
            if (byIndex) {
                for (const s of scoreEntries) scoreById.set(s.id, s);
            }

            // b) Alternativa (malha enviada, não limpa): emparelhar por posição (x, y, z),
            //    com uma grelha proporcional ao tamanho do modelo
            let bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
            for (const s of scoreEntries) {
                bbMin = [Math.min(bbMin[0], s.x), Math.min(bbMin[1], s.y), Math.min(bbMin[2], s.z)];
                bbMax = [Math.max(bbMax[0], s.x), Math.max(bbMax[1], s.y), Math.max(bbMax[2], s.z)];
            }
            const diag = Math.hypot(bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2]);
            const cellSize = diag > 0 && isFinite(diag) ? diag / 200 : 0.05;
            const grid = new Map();
            for (let s of scoreEntries) {
                const gx = Math.floor(s.x / cellSize);
                const gy = Math.floor(s.y / cellSize);
                const gz = Math.floor(s.z / cellSize);
                const k = `${gx}_${gy}_${gz}`;
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(s);
            }

            function getScoreForPosition(vx, vy, vz) {
                const gx = Math.floor(vx / cellSize);
                const gy = Math.floor(vy / cellSize);
                const gz = Math.floor(vz / cellSize);
                let bestDistSq = (cellSize * 1.5) ** 2; // Raio máximo de proximidade
                let bestScore = null;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const bucket = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
                            if (bucket) {
                                for (let s of bucket) {
                                    const dSq = (s.x - vx) ** 2 + (s.y - vy) ** 2 + (s.z - vz) ** 2;
                                    if (dSq < bestDistSq) {
                                        bestDistSq = dSq;
                                        bestScore = s;
                                    }
                                }
                            }
                        }
                    }
                }
                return bestScore; // Devolve null se não encontrar vértice em proximidade espacial
            }

            for (let i = 0; i < posAttr.count; i++) {
                let vx = 0, vy = 0, vz = 0;
                const origV = vertexIndices ? vertexIndices[i] : i;
                if (rawVerts && origV !== undefined && rawVerts[origV]) {
                    vx = rawVerts[origV][0];
                    vy = rawVerts[origV][1];
                    vz = rawVerts[origV][2];
                } else if (center) {
                    vx = posAttr.getX(i) / scale + center.x;
                    vy = posAttr.getY(i) / scale + center.y;
                    vz = posAttr.getZ(i) / scale + center.z;
                } else {
                    vx = posAttr.getX(i);
                    vy = posAttr.getY(i);
                    vz = posAttr.getZ(i);
                }

                const s = byIndex ? scoreById.get(origV) : getScoreForPosition(vx, vy, vz);
                if (!s || s.imp === undefined || s.imp === null) {
                    // Sem correspondência segura próxima: vértice a cinzento neutro
                    colors[i * 3] = 0.55;
                    colors[i * 3 + 1] = 0.58;
                    colors[i * 3 + 2] = 0.64;
                } else {
                    // Escala absoluta de 0 a 1 em vez de min-max relativo
                    const absImp = Math.max(0, Math.min(1, s.imp));
                    const c = importanceToColor(absImp);
                    colors[i * 3] = c.r;
                    colors[i * 3 + 1] = c.g;
                    colors[i * 3 + 2] = c.b;
                }
            }

            gnnColorsArray = colors;

            if (highPolyGeo.attributes.color && highPolyGeo.attributes.color.array.length === colors.length) {
                highPolyGeo.attributes.color.array.set(colors);
                highPolyGeo.attributes.color.needsUpdate = true;
            } else {
                highPolyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
                highPolyGeo.attributes.color.needsUpdate = true;
            }

            heatmapMaterial.vertexColors = true;
            heatmapMaterial.color.setHex(0xffffff);
            heatmapMaterial.needsUpdate = true;

            if (isGNNHeatmapActive && activeView === "high") {
                applyHeatmapToMesh();
            }
        }

        async function ensureGNNHeatmap() {
            if (gnnLoaded && gnnColorsArray) {
                return;
            }
            if (gnnPromise) return gnnPromise;

            gnnPromise = (async () => {
                try {
                    // 0. Malha limpa para a vista High (os scores seguem a ordem dos vértices dela)
                    const cleanReady = ensureCleanHighPoly();

                    // 1+2. Predição da rede neuronal e scores CSV dos vértices, numa só
                    // entrada da fila da malha (corre antes da simplificação RL)
                    const scoresCsv = await RetopoAPI.predictGNNWithScores(currentModelId);
                    await cleanReady;

                    // 3. Processar CSV e mapear importância
                    const lines = scoresCsv.trim().split(/\r?\n/);
                    const scoreEntries = [];
                    let criticalCount = 0;
                    let dispensableCount = 0;
                    let sumImp = 0;
                    let highCount = 0;
                    let midCount = 0;
                    let lowCount = 0;

                    const sep = (lines.length > 0 && lines[0].includes(";")) ? ";" : ((lines.length > 0 && lines[0].includes("\t")) ? "\t" : ",");

                    for (let i = 1; i < lines.length; i++) {
                        const row = lines[i].split(sep);
                        if (row.length >= 5) {
                            const id = parseInt(row[0], 10);
                            const x = parseFloat(row[1]) || 0;
                            const y = parseFloat(row[2]) || 0;
                            const z = parseFloat(row[3]) || 0;
                            const imp = parseFloat(row[4]) || 0;
                            const keep = parseInt(row[5] || "0", 10);
                            if (keep === 1) criticalCount++;
                            else dispensableCount++;

                            sumImp += imp;
                            if (imp >= 0.70) highCount++;
                            else if (imp >= 0.30) midCount++;
                            else lowCount++;

                            scoreEntries.push({ id: Number.isFinite(id) ? id : scoreEntries.length, x, y, z, imp, keep });
                        }
                    }

                    if (scoreEntries.length === 0) {
                        throw new Error("CSV de scores sem entradas válidas");
                    }

                    const totalParsed = scoreEntries.length || 1;
                    const avgScore = (sumImp / totalParsed).toFixed(3);
                    const critPct = ((criticalCount / totalParsed) * 100).toFixed(1);
                    const dispPct = ((dispensableCount / totalParsed) * 100).toFixed(1);
                    const highPct = Math.max(2, Math.round((highCount / totalParsed) * 100));
                    const midPct = Math.max(2, Math.round((midCount / totalParsed) * 100));
                    const lowPct = Math.max(2, 100 - highPct - midPct);

                    createHeatmapColors(scoreEntries);
                    gnnLoaded = true;

                    if (sideGnnVerts) sideGnnVerts.textContent = totalParsed.toLocaleString();
                    if (sideGnnAvgScore) sideGnnAvgScore.textContent = avgScore;
                    if (sideGnnCrit) sideGnnCrit.textContent = criticalCount.toLocaleString();
                    if (sideGnnCritPct) sideGnnCritPct.textContent = `${critPct}%`;
                    if (sideGnnDisp) sideGnnDisp.textContent = dispensableCount.toLocaleString();
                    if (sideGnnDispPct) sideGnnDispPct.textContent = `${dispPct}%`;
                    if (sideGnnDistHigh) sideGnnDistHigh.textContent = `${highCount.toLocaleString()} (${((highCount / totalParsed) * 100).toFixed(0)}%)`;
                    if (sideGnnDistMid) sideGnnDistMid.textContent = `${midCount.toLocaleString()} (${((midCount / totalParsed) * 100).toFixed(0)}%)`;
                    if (sideGnnDistLow) sideGnnDistLow.textContent = `${lowCount.toLocaleString()} (${((lowCount / totalParsed) * 100).toFixed(0)}%)`;
                    if (sideGnnBarHigh) sideGnnBarHigh.style.width = `${highPct}%`;
                    if (sideGnnBarMid) sideGnnBarMid.style.width = `${midPct}%`;
                    if (sideGnnBarLow) sideGnnBarLow.style.width = `${lowPct}%`;
                    if (sideGnnBadge) sideGnnBadge.textContent = "EGNN • Concluído";

                } catch (err) {
                    console.warn("[GNN] Falha na API GNN:", err.message);
                    gnnLastError = err;
                    gnnLoaded = false;
                    gnnColorsArray = null;
                    if (sideGnnBadge) sideGnnBadge.textContent = "GNN • Indisponível";
                } finally {
                    gnnPromise = null;
                }
            })();

            return gnnPromise;
        }

        // Iniciar cálculo automático da GNN em segundo plano logo no carregamento
        if (currentModelId) {
            ensureGNNHeatmap().catch((err) => {
                console.warn("[GNN Auto] Erro no cálculo automático:", err);
            });
        }

        if (sideBtnHeatmap) {
            sideBtnHeatmap.addEventListener("click", async () => {
                if (activeView !== "high" && btnHigh) {
                    btnHigh.click();
                }

                const willBeActive = !isGNNHeatmapActive;

                if (willBeActive) {
                    if (rlStatusBadge) {
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "GNN: A aplicar Heatmap...";
                    }
                    if (!gnnLoaded || !gnnColorsArray) {
                        await ensureGNNHeatmap();
                    }
                    if (!gnnColorsArray) {
                        const why = gnnLastError ? window.describeApiError(gnnLastError) : null;
                        if (window.ErrorModal?.show) {
                            window.ErrorModal.show({
                                title: "Heatmap GNN Indisponível",
                                message: "Não foi possível carregar as pontuações da rede GNN para esta malha.",
                                errors: why ? [`${why.short}: ${why.detail}`] : [],
                                hint: why?.hint || undefined,
                                buttonText: "Entendido"
                            });
                        } else {
                            alert("Heatmap GNN indisponível.");
                        }
                        return;
                    }
                    setGNNHeatmapActive(true);
                    applyHeatmapToMesh();
                    if (rlStatusBadge) {
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "GNN: Heatmap Aplicado";
                    }
                } else {
                    setGNNHeatmapActive(false);
                    mesh.material = baseMaterial;
                    mesh.material.needsUpdate = true;
                    updateSurfaceMaterial();
                    if (rlStatusBadge) {
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "Visualizando: Original (High Poly)";
                    }
                }
            });
        }

        // ══════════════════════════════════════════════════════
        //  EXECUÇÃO REAL DO AGENTE RL (POST /v1/rl/simplify)
        // ══════════════════════════════════════════════════════
        // isRLRunning declarado no escopo de topo do initThreeJS
        window.isRLRunning = () => isRLRunning;

        // O número de passos é definido no servidor (modelo RL ou RL_MAX_STEPS).
        function runRLDecimation() {
            if (isRLRunning) return;
            isRLRunning = true;

            // Um novo RL apaga quads e análises desta malha na API
            if (window.MeshQA && typeof window.MeshQA.invalidateMesh === "function") {
                window.MeshQA.invalidateMesh(currentModelId);
            }
            if (window.MeshQA && typeof window.MeshQA.setWaitingRL === "function") {
                window.MeshQA.setWaitingRL();
            }

            if (sideLowInfo) {
                sideLowInfo.textContent = "⏳ A otimizar...";
            }
            if (sideReduction) {
                sideReduction.textContent = "A calcular...";
            }

            btnLow.disabled = true;
            btnLow.style.opacity = "0.45";
            btnLow.style.cursor = "not-allowed";
            btnLow.innerText = "🔒 A Otimizar...";

            // Ativar o overlay transparente com a barra de progresso única sobre a cena 3D
            if (optimizingOverlay) {
                optimizingOverlay.classList.remove("hidden");
                if (optTitle) optTitle.textContent = "A Otimizar Malha...";
                if (optSubtitle) optSubtitle.textContent = "O agente RL está a simplificar a geometria preservando a silhueta.";
                if (optStepLabel) optStepLabel.textContent = "A iniciar agente RL...";
                if (optPctLabel) optPctLabel.textContent = "0%";
                if (optProgressBar) optProgressBar.style.width = "0%";
            }

            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge working";
                rlStatusBadge.textContent = "RL: A Otimizar...";
            }

            // Progresso real do job RL (GET /v1/rl/simplify/{id}/status):
            //   stage "simplifying" → 0–90 % da barra; stage "quad" → 90–100 %.
            let currentPct = 0;
            const setOptProgress = (pct, label) => {
                currentPct = Math.max(currentPct, Math.min(100, pct)); // nunca recua
                const rounded = Math.round(currentPct);
                if (optProgressBar) optProgressBar.style.width = `${rounded}%`;
                if (optPctLabel) optPctLabel.textContent = `${rounded}%`;
                if (label && optStepLabel) optStepLabel.textContent = label;
            };

            const onRLProgress = (job) => {
                if (!isRLRunning || !job) return;
                const p = job.progress;
                if (job.status === "queued" || !p) {
                    setOptProgress(0, job.status === "queued" ? "Em fila no servidor..." : "A iniciar agente RL...");
                    return;
                }
                const percent = typeof p.percent === "number" ? p.percent : 0;
                if (p.stage === "simplifying") {
                    setOptProgress(
                        percent * 0.9,
                        `A simplificar: passo ${Number(p.current || 0).toLocaleString()} de ${Number(p.total || 0).toLocaleString()}`
                    );
                    if (sideSteps) sideSteps.textContent = p.current ?? "--";
                    if (sideOrigStepsVal && p.total) sideOrigStepsVal.textContent = `${Number(p.total).toLocaleString()} iterações`;
                } else if (p.stage === "quad") {
                    setOptProgress(90 + percent * 0.1, "A converter o resultado em quads...");
                }
            };

            RetopoAPI.startRLDecimation(currentModelId,
                // onRLStep: cada passo transmitido
                (stepData) => {
                    if (sideSteps) sideSteps.textContent = stepData.step;
                    if (stepData.raw_action && sideDissolves) {
                        sideDissolves.textContent = stepData.raw_action.accepted_dissolves ?? "--";
                    }
                    if (typeof window.appendActionLogEntry === "function") {
                        window.appendActionLogEntry(stepData);
                    }
                },
                // onComplete: decimação concluída
                async (simplifyResult) => {
                    isRLRunning = false;

                    // 1. Atualizar métricas garantidas vindas da API
                    const acceptedDissolves = (simplifyResult && typeof simplifyResult.accepted_dissolves === "number")
                        ? simplifyResult.accepted_dissolves
                        : (parseInt(sideDissolves?.textContent, 10) || 0);

                    setOptProgress(100, "A carregar a malha otimizada...");

                    // O quad final falhou: o RL fica "done" na mesma; mostra-se o resultado do RL e avisa-se.
                    const quadError = simplifyResult?.quad?.status === "failed" || simplifyResult?.quad?.error
                        ? (simplifyResult.quad.error || "Erro desconhecido na conversão em quads.")
                        : null;

                    if (sideDissolves) {
                        sideDissolves.textContent = acceptedDissolves;
                    }
                    if (sideSteps && simplifyResult?.steps !== undefined) {
                        sideSteps.textContent = simplifyResult.steps;
                    }

                    // 2. Descarregar a malha final da API (única fonte de verdade): os quads do
                    //    quad final, ou os triângulos do RL se o quad falhou.
                    let lowStats = null;
                    cachedSimplifiedObjText = null;
                    finalQuadFailed = Boolean(quadError);
                    try {
                        const lowPolyText = await fetchFinalMeshObj();
                        if (lowPolyText && lowPolyText.includes("v ")) {
                            lowStats = computeObjStats(lowPolyText);
                            realStats.low.verts = lowStats.verts;
                            realStats.low.faces = lowStats.faces;

                            const parsedLowGeo = buildCustomOBJGeometry(lowPolyText);
                            if (parsedLowGeo) {
                                if (lowPolyGeo && lowPolyGeo !== highPolyGeo && lowPolyGeo !== currentSnapGeo) {
                                    disposeGeo(lowPolyGeo);
                                }
                                lowPolyGeo = parsedLowGeo;
                                getOrCreateRealEdgesGeo(lowPolyGeo);
                            }
                        }
                    } catch (err) {
                        console.warn("[Main] Não foi possível carregar o modelo Low Poly da API:", err.message);
                    }

                    // Malha mostrada (quads, ou triângulos do RL se o quad falhou)
                    const finalFaces = lowStats?.faces ?? simplifyResult?.final_faces ?? null;
                    const finalVerts = lowStats?.verts ?? simplifyResult?.final_verts ?? null;
                    // Métricas do RL (triângulos antes → depois da simplificação)
                    const rlFacesBefore = typeof simplifyResult?.initial_faces === "number" ? simplifyResult.initial_faces : realStats.high.faces;
                    const rlFacesAfter = typeof simplifyResult?.final_faces === "number" ? simplifyResult.final_faces : finalFaces;

                    realStats.low.faces = typeof finalFaces === "number" ? finalFaces : (lowStats?.faces || "--");
                    realStats.low.verts = typeof finalVerts === "number" ? finalVerts : (lowStats?.verts || "--");
                    realStats.low.dissolves = acceptedDissolves;
                    realStats.low.steps = simplifyResult?.steps || 0;
                    realStats.low.rlFacesBefore = typeof rlFacesBefore === "number" ? rlFacesBefore : null;
                    realStats.low.rlFacesAfter = typeof rlFacesAfter === "number" ? rlFacesAfter : null;
                    realStats.low.isQuad = finalMeshIsQuad;

                    if (sideCompFacesBefore) sideCompFacesBefore.textContent = Number(rlFacesBefore || 0).toLocaleString();
                    showFinalFaces(finalMeshIsQuad ? finalFaces : null, rlFacesBefore);
                    if (sideCompFacesAfter) {
                        sideCompFacesAfter.textContent = typeof rlFacesAfter === "number" ? rlFacesAfter.toLocaleString() : "--";
                    }
                    if (sideRLEfficiency) {
                        const totalSteps = simplifyResult?.steps || 0;
                        const eff = totalSteps ? Math.min(100, Math.round(((acceptedDissolves || 0) / totalSteps) * 100)) : 0;
                        sideRLEfficiency.textContent = `${eff}% aceites`;
                        realStats.low.efficiencyText = `${eff}% aceites`;
                    }

                    if (sideLowInfo) {
                        if (typeof finalFaces === "number" && typeof finalVerts === "number") {
                            sideLowInfo.textContent = `${finalFaces.toLocaleString()} ${finalMeshIsQuad ? "faces (quads)" : "faces (triângulos)"} / ${finalVerts.toLocaleString()} vértices`;
                        } else {
                            sideLowInfo.textContent = "Geometria otimizada não disponível";
                        }
                    }

                    if (sideReduction) {
                        if (typeof simplifyResult?.face_reduction === "number") {
                            const rawRed = simplifyResult.face_reduction * 100;
                            const formatted = rawRed >= 1 ? `${Math.round(rawRed)}%` : `${Math.max(0, rawRed).toFixed(1)}%`;
                            sideReduction.textContent = formatted;
                            realStats.low.reduction = formatted;
                        } else if (rlFacesBefore > 0 && typeof rlFacesAfter === "number") {
                            const rawRed = ((1 - (rlFacesAfter / rlFacesBefore)) * 100);
                            const formatted = rawRed >= 1 ? `${Math.round(rawRed)}%` : `${Math.max(0, rawRed).toFixed(1)}%`;
                            sideReduction.textContent = formatted;
                            realStats.low.reduction = formatted;
                        } else {
                            sideReduction.textContent = "--%";
                            realStats.low.reduction = "--%";
                        }
                    }

                    if (optProgressBar) optProgressBar.style.width = "100%";
                    if (optPctLabel) optPctLabel.textContent = "100%";
                    if (optTitle) optTitle.textContent = "Otimização Concluída!";
                    if (optStepLabel) optStepLabel.textContent = "Malha otimizada pronta";

                    // Suavemente recolhe o overlay transparente para revelar a malha 3D
                    setTimeout(() => {
                        if (optimizingOverlay) optimizingOverlay.classList.add("hidden");
                    }, 550);

                    if (rlStatusBadge) {
                        rlStatusBadge.className = quadError ? "status-badge working" : "status-badge online";
                        rlStatusBadge.textContent = quadError ? "RL: Concluído (quad falhou)" : "RL: Decimação Concluída";
                    }

                    if (quadError && window.ErrorModal?.show) {
                        window.ErrorModal.show({
                            title: "Conversão em Quads Falhou",
                            message: "A simplificação RL terminou, mas a conversão do resultado em quads falhou. É apresentado o resultado do RL em triângulos.",
                            errors: [quadError],
                            buttonText: "Entendido"
                        });
                    }

                    if (!lowPolyGeo) {
                        btnLow.disabled = true;
                        btnLow.style.opacity = "0.45";
                        btnLow.style.cursor = "not-allowed";
                        btnLow.innerText = "⚠️ Otimizado Indisponível";
                        if (sideLowInfo) sideLowInfo.textContent = "Geometria otimizada não disponível";
                    } else {
                        btnLow.disabled = false;
                        btnLow.style.opacity = "1";
                        btnLow.style.cursor = "pointer";
                        btnLow.innerText = "⚡ Otimizado (Low)";
                        btnLow.style.boxShadow = "";

                        // Apresentar automaticamente a malha otimizada ao utilizador!
                        btnLow.click();
                    }
                },
                (err) => {
                    isRLRunning = false;
                    if (optimizingOverlay) optimizingOverlay.classList.add("hidden");
                    btnLow.disabled = false;
                    btnLow.style.opacity = "1";
                    btnLow.style.cursor = "pointer";
                    btnLow.innerText = "⚡ Otimizado (Low)";
                    if (sideLowInfo) sideLowInfo.textContent = "Otimização não concluída";
                    if (sideReduction) sideReduction.textContent = "--%";

                    // 409: há um quad, uma análise DSS ou outro RL a correr para esta malha.
                    // JobFailed: o job RL terminou em "failed" (err.message traz o erro do servidor).
                    const status = err?.status;
                    const isConflict = status === 409;
                    const isJobFailed = err?.error === "JobFailed";

                    const info = window.describeApiError(err);
                    if (rlStatusBadge) {
                        rlStatusBadge.className = isConflict ? "status-badge working" : "status-badge offline";
                        rlStatusBadge.textContent = isConflict ? "RL: Malha ocupada" : `RL: ${isJobFailed ? "Falhou" : info.short}`;
                    }

                    // 409 e JobFailed têm texto próprio do RL; os restantes códigos usam o mapa geral
                    if (isConflict) {
                        window.showApiError(err, {
                            title: "Não é Possível Otimizar Agora",
                            message: "Há outra operação a correr para esta malha (RL, conversão em quads ou análise DSS)."
                        });
                    } else if (isJobFailed) {
                        window.showApiError(err, {
                            title: "A Simplificação RL Falhou",
                            message: "O servidor não conseguiu concluir a simplificação desta malha."
                        });
                    } else {
                        window.showApiError(err, { title: `Erro na Simplificação RL — ${info.title}` });
                    }
                },
                onRLProgress
            );
        }

        // Executar com o valor de iterações configurado no input inicial de upload
        if (currentModelId) {
            runRLDecimation();
            updateSidebarContext("high");
        }

        // ══════════════════════════════════════════════════════
        //  EXPORTAÇÃO LOW POLY
        // ══════════════════════════════════════════════════════
        const btnExport = document.getElementById("btn-export");
        if (btnExport) {
            btnExport.addEventListener("click", () => {
                if (activeView === "snapshot" && currentSnapGeo) {
                    const snapDiss = (currentSnapDissolves !== null && currentSnapDissolves !== undefined) ? currentSnapDissolves : (currentSnapStats?.faces || "snap");
                    if (currentSnapGeo.userData && currentSnapGeo.userData.rawObjText) {
                        const quadSuffix = currentSnapGeo.userData.isQuad ? "_quads" : "";
                        downloadObjFile(`retopo_snapshot_${snapDiss}dissolves${quadSuffix}.obj`, currentSnapGeo.userData.rawObjText);
                        return;
                    }
                    if (window.THREE.OBJExporter) {
                        const exporter = new THREE.OBJExporter();
                        const result = exporter.parse(mesh);
                        const filename = `retopo_snapshot_${snapDiss}dissolves.obj`;
                        downloadObjFile(filename, result);
                        return;
                    }
                }
                if (activeView === "high" && rawObjText) {
                    downloadObjFile("retopo_highpoly.obj", rawObjText);
                    return;
                }
                // Descarregar o ficheiro OBJ original retornado pela API sem passar pelo conversor Three.js
                if (cachedSimplifiedObjText && cachedSimplifiedObjText.includes("v ")) {
                    downloadObjFile(finalMeshIsQuad ? "retopo_lowpoly_quads.obj" : "retopo_lowpoly.obj", cachedSimplifiedObjText);
                    return;
                }
                if (!window.THREE.OBJExporter) return;
                const exporter = new THREE.OBJExporter();
                const result = exporter.parse(mesh);
                downloadObjFile("retopo_lowpoly.obj", result);
            });
        }

        // ══════════════════════════════════════════════════════
        //  RELATÓRIO LATERAL (DRAWER) & SNAPSHOTS INTERMÉDIOS
        // ══════════════════════════════════════════════════════
        const actionLogDrawer = document.getElementById("action-log-drawer");
        const btnActionLog = document.getElementById("btn-action-log");
        const actionLogClose = document.getElementById("action-log-close");
        const actionLogCount = document.getElementById("action-log-count");
        const tabBtnSnapshots = document.getElementById("tab-btn-snapshots");
        const tabBtnHistory = document.getElementById("tab-btn-history");
        const tabPaneSnapshots = document.getElementById("tab-pane-snapshots");
        const tabPaneHistory = document.getElementById("tab-pane-history");
        const snapshotsList = document.getElementById("snapshots-list");
        const actionLogBody = document.getElementById("action-log-body");

        const repSteps = document.getElementById("rep-steps");
        const repDissolves = document.getElementById("rep-dissolves");
        const repReduction = document.getElementById("rep-reduction");
        const repSnapshots = document.getElementById("rep-snapshots");

        window.appendActionLogEntry = function (stepData) {
            actionLogEntries.push({
                step: stepData.step,
                message: stepData.log_message,
                is_critical: stepData.is_critical,
                raw: stepData.raw_action
            });
        };

        if (tabBtnSnapshots && tabBtnHistory) {
            tabBtnSnapshots.addEventListener("click", () => {
                tabBtnSnapshots.classList.add("active");
                tabBtnHistory.classList.remove("active");
                tabPaneSnapshots.classList.add("active");
                tabPaneHistory.classList.remove("active");
            });

            tabBtnHistory.addEventListener("click", () => {
                tabBtnHistory.classList.add("active");
                tabBtnSnapshots.classList.remove("active");
                tabPaneHistory.classList.add("active");
                tabPaneSnapshots.classList.remove("active");
            });
        }

        // ══════════════════════════════════════════════════════
        //  LIGHTBOX & SNAPSHOT VISUAL CAPTURE
        // ══════════════════════════════════════════════════════
        const snapshotLightbox = document.getElementById("snapshot-lightbox");
        const lightboxClose = document.getElementById("lightbox-close");
        const lightboxImg = document.getElementById("lightbox-img");
        const lightboxTag = document.getElementById("lightbox-tag");
        const lightboxTitle = document.getElementById("lightbox-title");
        const lightboxChips = document.getElementById("lightbox-chips");
        const lightboxExplanation = document.getElementById("lightbox-explanation");
        const lightboxSummary = document.getElementById("lightbox-actions-summary");
        const lightboxBtnLoad = document.getElementById("lightbox-btn-load");
        const lightboxBtnDownload = document.getElementById("lightbox-btn-download");

        const countAllEdges = document.getElementById("count-all-edges");
        const countAcceptedEdges = document.getElementById("count-accepted-edges");
        const countRejectedEdges = document.getElementById("count-rejected-edges");
        const historyFilterChips = document.querySelectorAll(".history-filter-bar .filter-chip");

        // currentEdgeFilter, latestActionsList, snapshotImagesMap declarados no topo do initThreeJS

        function captureCanvasSnapshot() {
            try {
                if (!renderer || !scene || !camera) return null;
                renderer.render(scene, camera);
                return canvas.toDataURL("image/jpeg", 0.88);
            } catch {
                return null;
            }
        }

        function downloadObjFile(filename, content) {
            const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        }

        function openSnapshotLightbox(info) {
            if (!snapshotLightbox) return;
            if (lightboxImg) lightboxImg.src = info.imgUrl || "";
            if (lightboxTag) lightboxTag.textContent = info.tag || "SNAPSHOT";
            if (lightboxTitle) lightboxTitle.textContent = info.title || "Análise Visual da Malha";

            if (lightboxChips) {
                lightboxChips.innerHTML = `
                    <span class="chip">🎯 Dissolves: ${info.dissolves}</span>
                    <span class="chip">🔺 Faces: ${info.faces ? info.faces.toLocaleString() : "--"}</span>
                    <span class="chip" style="color:#34d399;">✂️ ${info.acceptedCount || 0} Aceites</span>
                    <span class="chip" style="color:#f87171;">⚠️ ${info.rejectedCount || 0} Rejeitadas</span>
                `;
            }
            if (lightboxExplanation) {
                lightboxExplanation.innerHTML = info.explanationHtml || "";
            }
            if (lightboxSummary) {
                lightboxSummary.innerHTML = `
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Passos avaliados:</span>
                        <strong style="color:#60a5fa;">${info.totalEvaluated || 0}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Redução de Faces:</span>
                        <strong style="color:#34d399;">${info.facesRemoved == null ? "--" : `-${info.facesRemoved.toLocaleString()} ${info.facesRemoved === 1 ? "face" : "faces"}`}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Rejeitados pela validação:</span>
                        <strong style="color:#f87171;">${info.rejectedCount || 0}</strong>
                    </div>
                `;
            }

            if (lightboxBtnLoad) {
                if (typeof info.onLoadMesh !== "function") {
                    lightboxBtnLoad.style.display = "none";
                } else {
                    lightboxBtnLoad.style.display = "flex";
                    if (info.isCurrent) {
                        lightboxBtnLoad.innerHTML = `<span>⚡ Malha Otimizada Final (Já Descarregada no 3D)</span>`;
                        lightboxBtnLoad.style.background = "transparent";
                        lightboxBtnLoad.style.border = "1px dashed rgba(52,211,153,0.4)";
                        lightboxBtnLoad.style.color = "#34d399";
                        lightboxBtnLoad.style.boxShadow = "none";
                    } else {
                        const labelText = info.snapNum ? `Snapshot #${info.snapNum}` : `no 3D`;
                        lightboxBtnLoad.innerHTML = `<span>📥 Carregar ${labelText} no 3D</span>`;
                        lightboxBtnLoad.style.background = "";
                        lightboxBtnLoad.style.border = "";
                        lightboxBtnLoad.style.color = "";
                        lightboxBtnLoad.style.boxShadow = "";
                    }
                    lightboxBtnLoad.onclick = () => {
                        closeSnapshotLightbox();
                        info.onLoadMesh();
                    };
                }
            }

            snapshotLightbox.classList.add("open");
        }

        function closeSnapshotLightbox() {
            if (snapshotLightbox) snapshotLightbox.classList.remove("open");
        }

        if (lightboxClose) lightboxClose.addEventListener("click", closeSnapshotLightbox);
        if (snapshotLightbox) {
            snapshotLightbox.addEventListener("click", (e) => {
                if (e.target === snapshotLightbox) closeSnapshotLightbox();
            });
        }

        if (historyFilterChips && historyFilterChips.length) {
            historyFilterChips.forEach((chip) => {
                chip.addEventListener("click", () => {
                    historyFilterChips.forEach((c) => c.classList.remove("active"));
                    chip.classList.add("active");
                    currentEdgeFilter = chip.dataset.filter || "all";
                    renderHistoryView(latestActionsList);
                });
            });
        }

        async function openActionLog() {
            if (!actionLogDrawer) return;
            actionLogDrawer.classList.add("open");

            let actions = actionLogEntries;
            let snapshots = cachedSnapshots;
            let results = cachedResults;

            try {
                const [actRes, snapRes, resultRes] = await Promise.allSettled([
                    RetopoAPI.getRLActions(currentModelId),
                    RetopoAPI.getRLSnapshots(currentModelId),
                    RetopoAPI.getRLResults(currentModelId)
                ]);

                if (actRes.status === "fulfilled" && Array.isArray(actRes.value) && actRes.value.length) {
                    actions = actRes.value;
                }
                if (snapRes.status === "fulfilled" && Array.isArray(snapRes.value)) {
                    snapshots = snapRes.value;
                    cachedSnapshots = snapshots;
                }
                if (resultRes.status === "fulfilled" && resultRes.value) {
                    results = resultRes.value;
                    cachedResults = results;
                }
            } catch (e) {
                console.warn("[ActionLog] Erro ao carregar dados remotos:", e.message);
            }

            latestActionsList = actions;

            // Atualizar métricas do relatório
            const totalSteps = results?.steps ?? (actions.length || actionLogEntries.length || realStats.low.steps || 0);
            const totalDissolves = results?.accepted_dissolves ?? (actions.length ? actions.filter(a => a.accepted !== false && a.raw?.accepted !== false).length : (realStats.low.dissolves || 0));
            const reductionPct = results?.face_reduction
                ? Math.round(results.face_reduction * 100)
                : (realStats.high.faces > 0 && realStats.low.faces > 0
                    ? Math.round((1 - realStats.low.faces / realStats.high.faces) * 100)
                    : (realStats.low.reduction ? parseInt(realStats.low.reduction, 10) : 0));

            if (repSteps) repSteps.textContent = totalSteps;
            if (repDissolves) repDissolves.textContent = totalDissolves;
            if (repReduction) repReduction.textContent = `${reductionPct}%`;
            if (actionLogCount) actionLogCount.textContent = `${actions.length} acções`;

            // Renderizar Snapshots e Histórico de Edges integrados
            const renderedCount = renderSnapshotsView(snapshots, totalDissolves, actions, totalSteps);
            if (repSnapshots) repSnapshots.textContent = renderedCount;
            if (Array.isArray(snapshots) && snapshots.some((s) => s && s.status === "generating")) {
                startSnapshotPolling();
            }

            renderHistoryView(actions);
        }

        function renderSnapshotsView(snapshots, totalDissolves, actions, totalSteps) {
            if (!snapshotsList) return 0;
            snapshotsList.innerHTML = "";
            snapshotCardUpdaters.clear();

            let displaySnaps = Array.isArray(snapshots) ? [...snapshots] : [];

            // Os snapshots da API são intermédios; a malha final (quads do RL) entra como último cartão.
            if (lowPolyGeo && !displaySnaps.some((s) => s && s.is_current)) {
                displaySnaps.push({
                    is_current: true,
                    accepted_dissolves: totalDissolves,
                    step: totalSteps,
                    faces: realStats.low.faces || undefined
                });
            }

            if (displaySnaps.length === 0) {
                const emptyDiv = document.createElement("div");
                emptyDiv.className = "action-log-empty";
                emptyDiv.innerHTML = `<span>⏳ Nenhum snapshot intermédio capturado pela API para esta execução.</span>`;
                snapshotsList.appendChild(emptyDiv);
                return 0;
            }

            displaySnaps.forEach((snap, idx) => {
                const rawDiss = typeof snap === "number" ? snap : (snap.accepted_dissolves ?? snap.dissolves ?? snap.step);
                const dissolves = rawDiss ?? 0;
                const stepNum = typeof snap === "number" ? snap : (snap.step || totalSteps || dissolves);
                const facesCount = (typeof snap === "object" && snap.faces) ? snap.faces : (realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - dissolves) : "--");

                // Ações do RL até este snapshot
                const matchingActions = actions.filter((act) => {
                    const actDiss = act.raw?.accepted_dissolves ?? act.accepted_dissolves ?? 0;
                    return actDiss <= dissolves;
                });

                const acceptedCount = matchingActions.filter(a => a.accepted !== false && a.raw?.accepted !== false).length || dissolves;
                const rejectedCount = Math.max(0, matchingActions.length - acceptedCount);

                const card = document.createElement("div");
                card.className = "snapshot-card glass";

                const snapNum = idx + 1;
                const isFinalMesh = Boolean(snap && snap.is_current);
                let tagText = `SNAPSHOT #${snapNum}`;
                let titleText = `Snapshot #${snapNum} • ${dissolves} Dissolves (Passo ${stepNum})`;

                if (isFinalMesh) {
                    tagText = `ESTADO FINAL OTIMIZADO`;
                    titleText = `Malha Otimizada Final • ${dissolves} Dissolves (Passo ${stepNum})`;
                } else if (snap.is_intermediate) {
                    tagText = `SNAPSHOT #${snapNum} (INTERMÉDIO)`;
                    titleText = `Snapshot #${snapNum} • Progresso Intermédio (${dissolves} Dissolves)`;
                }

                const initialFaces = cachedResults?.initial_faces ?? (realStats.high.faces || null);
                const facesRemoved = (typeof facesCount === "number" && initialFaces) ? Math.max(0, initialFaces - facesCount) : null;
                const explanationText = `Até aqui, o agente fez <strong>${acceptedCount} junções</strong> de faces coplanares`
                    + (facesRemoved !== null ? `, que removeram <strong>${facesRemoved.toLocaleString()} faces</strong>` : "")
                    + `. Rejeitou <strong>${rejectedCount} tentativas</strong> que não passavam na validação geométrica e topológica, para preservar os contornos e a silhueta da peça.`;

                card.innerHTML = `
                    <div class="snap-img-wrapper" title="Clique para ampliar a fotografia e ver a análise detalhada">
                        <span class="snap-badge">${tagText}</span>
                        <img class="snap-photo" alt="Fotografia do Snapshot #${snapNum} (${dissolves} Dissolves)" style="display:none;">
                        <div class="snap-photo-placeholder">
                            <span>⏳ A carregar fotografia...</span>
                        </div>
                        <div class="snap-zoom-hint">🔍 Clique para ampliar</div>
                    </div>
                    <div class="snap-content">
                        <div class="snap-meta">
                            <h4>${titleText}</h4>
                            <p class="snap-desc">Registo visual da simplificação até este ponto.</p>
                            <div class="snap-chips">
                                ${isFinalMesh ? `
                                    <span class="chip" style="font-weight:700;color:#34d399;background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.35);">⚡ Malha Final Otimizada</span>
                                ` : `
                                    <span class="chip" style="font-weight:700;color:#c084fc;background:rgba(192,132,252,0.15);border-color:rgba(192,132,252,0.35);">📸 Snapshot #${snapNum}</span>
                                `}
                                <span class="chip">🎯 ${dissolves} Dissolves</span>
                                <span class="chip">🔺 ${typeof facesCount === "number" ? facesCount.toLocaleString() : facesCount} Faces</span>
                                <span class="chip" style="color:#34d399;">✂️ ${acceptedCount} Aceites</span>
                                <span class="chip" style="color:#f87171;">⚠️ ${rejectedCount} Rejeitadas</span>
                            </div>
                        </div>

                        <!-- Explicação da Decimação das Edges -->
                        <div class="snap-edge-explanation">
                            <h5>💡 O que o agente fez até aqui</h5>
                            <p style="margin:0;">${explanationText}</p>
                        </div>

                        <div class="snap-card-actions">
                            ${isFinalMesh ? `
                                <button type="button" class="btn-load-snap-mesh btn-snap-transparent" data-dissolves="${dissolves}" style="width:100%;background:transparent;border:1px dashed rgba(52,211,153,0.4);color:#34d399;box-shadow:none;font-weight:500;padding:0.55rem 0.8rem;cursor:pointer;">
                                    <span>⚡ Malha Otimizada Final (Já Descarregada no 3D)</span>
                                </button>
                            ` : `
                                <button class="btn-load-snap-mesh" data-dissolves="${dissolves}">
                                    <span>📥 Carregar Snapshot #${snapNum} no 3D</span>
                                </button>
                                <button type="button" class="btn-load-snap-mesh btn-gen-snap-quads" data-dissolves="${dissolves}" style="display:none;background:transparent;border:1px dashed rgba(192,132,252,0.5);color:#c084fc;box-shadow:none;">
                                    <span>🔁 Tentar de novo</span>
                                </button>
                            `}
                        </div>
                    </div>
                `;

                const imgEl = card.querySelector(".snap-photo");
                const placeholder = card.querySelector(".snap-photo-placeholder");
                const btnLoad = card.querySelector(".btn-load-snap-mesh");
                const imgWrapper = card.querySelector(".snap-img-wrapper");

                let resolvedImgUrl = null;

                function applyImage(url) {
                    if (!url) return;
                    resolvedImgUrl = url;
                    snapshotImagesMap.set(dissolves, url);
                    imgEl.src = url;
                    imgEl.style.display = "block";
                    placeholder.style.display = "none";
                }

                const btnRetry = card.querySelector(".btn-gen-snap-quads");
                let shownStatus = null;

                /** Mostra o estado do snapshot (status da lista da API): a gerar, pronto ou falhou. */
                function showSnapshotStatus(item) {
                    const status = item?.status || "generating";
                    if (status === shownStatus) return;
                    const becameReady = status === "ready" && shownStatus !== null;
                    shownStatus = status;
                    if (btnRetry) btnRetry.style.display = status === "failed" ? "" : "none";
                    if (status === "ready") {
                        RetopoAPI.getQuadImageBlobUrl(currentModelId, dissolves).then((blobUrl) => {
                            if (blobUrl) applyImage(blobUrl);
                            else if (!resolvedImgUrl) placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                        }).catch(() => {
                            if (!resolvedImgUrl) placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                        });
                        // Se este snapshot já está aberto no 3D, trocar para a versão final dele
                        if (becameReady && activeView === "snapshot" && currentSnapDissolves === dissolves) {
                            fetchSnapshotObj(dissolves).then(({ text, isQuad }) => {
                                if (text && isQuad) {
                                    const effTxtNow = `${Math.min(100, Math.round((dissolves / (stepNum || 1)) * 100))}% aceites`;
                                    loadMeshIntoViewport(text, `Snapshot #${snapNum} (${dissolves} Dissolves)`, dissolves, stepNum, effTxtNow, snapNum, true);
                                }
                            }).catch((err) => console.warn(`[Snapshot] ${dissolves}:`, err.message));
                        }
                    } else if (status === "failed") {
                        if (!resolvedImgUrl) {
                            placeholder.innerHTML = "<span>⚠️ Não foi possível gerar este snapshot</span>";
                        }
                        if (btnRetry) btnRetry.title = item?.error || "";
                    } else if (!resolvedImgUrl) {
                        placeholder.innerHTML = "<span>⏳ A gerar snapshot…</span>";
                    }
                }

                if (btnRetry) {
                    btnRetry.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        btnRetry.disabled = true;
                        try {
                            await RetopoAPI.startQuad(currentModelId, dissolves);
                            showSnapshotStatus({ status: "generating" });
                            startSnapshotPolling();
                        } catch (err) {
                            console.warn(`[Snapshot] Tentar de novo ${dissolves}:`, err.message);
                            btnRetry.innerHTML = `<span>⚠️ ${escapeHtml(window.describeApiError(err).short)}</span>`;
                            setTimeout(() => { btnRetry.innerHTML = "<span>🔁 Tentar de novo</span>"; }, 4000);
                        } finally {
                            btnRetry.disabled = false;
                        }
                    });
                }

                if (isFinalMesh) {
                    // Imagem dos quads da malha final (feita pela API no fim do RL)
                    RetopoAPI.getQuadImageBlobUrl(currentModelId).then((blobUrl) => {
                        if (blobUrl) {
                            applyImage(blobUrl);
                        } else {
                            const localSnap = captureCanvasSnapshot();
                            if (localSnap) applyImage(localSnap);
                            else placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                        }
                    });
                } else {
                    snapshotCardUpdaters.set(dissolves, showSnapshotStatus);
                    showSnapshotStatus(snap);
                }

                // Abertura do Lightbox com análise ao clicar na imagem
                imgWrapper.addEventListener("click", () => {
                    openSnapshotLightbox({
                        imgUrl: resolvedImgUrl || captureCanvasSnapshot(),
                        tag: tagText,
                        title: titleText,
                        snapNum: snapNum,
                        dissolves: dissolves,
                        faces: facesCount,
                        acceptedCount: acceptedCount,
                        rejectedCount: rejectedCount,
                        totalEvaluated: matchingActions.length,
                        facesRemoved: facesRemoved,
                        explanationHtml: explanationText,
                        isCurrent: isFinalMesh,
                        onLoadMesh: () => {
                            btnLoad.click();
                        }
                    });
                });

                // Carregar malha no Three.js
                btnLoad.addEventListener("click", async () => {
                    const originalText = btnLoad.innerHTML;
                    btnLoad.innerHTML = `<span>⏳ A transferir Snapshot #${snapNum}...</span>`;
                    btnLoad.disabled = true;

                    try {
                        let loaded = false;
                        const effTxt = `${Math.min(100, Math.round((dissolves / (stepNum || 1)) * 100))}% aceites`;

                        // 1. Se for a malha final otimizada já descarregada
                        if (isFinalMesh && lowPolyGeo) {
                            if (activeView !== "low") {
                                btnLow.click();
                            }
                            btnLoad.innerHTML = `<span>⚡ Malha Final Ativa no 3D!</span>`;
                            setTimeout(() => { closeActionLog(); }, 400);
                            return;
                        }

                        // 2. Snapshot intermédio: quads se já foram gerados, senão os triângulos do RL
                        let objText = null;
                        let objIsQuad = false;
                        if (!loaded && !snap.is_current) {
                            try {
                                const snapObj = await fetchSnapshotObj(dissolves);
                                objText = snapObj.text;
                                objIsQuad = snapObj.isQuad;
                            } catch (e) {
                                console.warn(`[Snapshot] Snapshot ${dissolves} indisponível na API:`, e.message);
                            }
                        }

                        // 3. Se for o estado atual final e ainda não temos o OBJ
                        if (!loaded && isFinalMesh && (!objText || !objText.includes("v "))) {
                            objText = await fetchFinalMeshObj();
                            objIsQuad = finalMeshIsQuad;
                        }

                        // 4. Carregar o OBJ recuperado no Three.js
                        if (objText && objText.includes("v ")) {
                            const label = `Snapshot #${snapNum} (${dissolves} Dissolves${objIsQuad ? ", quads" : ""})`;
                            loadMeshIntoViewport(objText, label, dissolves, stepNum, effTxt, snapNum, objIsQuad);
                            loaded = true;
                        }

                        if (loaded) {
                            btnLoad.innerHTML = `<span>✅ Snapshot #${snapNum} Carregado no 3D!</span>`;
                            setTimeout(() => {
                                closeActionLog();
                            }, 450);
                        } else {
                            throw new Error("O ficheiro 3D (.obj) deste snapshot não está disponível no servidor.");
                        }
                    } catch (err) {
                        console.warn("[Snapshot] Erro ao carregar mesh:", err);
                        const msg = err instanceof window.ApiError ? window.describeApiError(err).short : (err.message || "Erro ao carregar");
                        btnLoad.innerHTML = `<span>⚠️ ${escapeHtml(msg)}</span>`;
                        setTimeout(() => { btnLoad.innerHTML = originalText; btnLoad.disabled = false; }, 2500);
                    }
                });

                snapshotsList.appendChild(card);
            });

            // Número de snapshots intermédios (o cartão da malha final não conta)
            return displaySnaps.filter((s) => !(s && s.is_current)).length;
        }

        function extractObjFromSnap(data) {
            if (!data) return "";
            if (typeof data === "string" && data.includes("v ")) return data;
            if (typeof data === "object") {
                for (const key of ["obj_data", "obj", "mesh", "mesh_data", "obj_content", "content", "file_content", "data", "geometry"]) {
                    if (typeof data[key] === "string" && data[key].includes("v ")) {
                        return data[key];
                    }
                }
            }
            return "";
        }

        // Textos em português do action log, pelo código que a API devolve
        // (action_name_code, rejection_reason_code). A API manda também um texto
        // em inglês (action_name, rejection_reason), usado se o código for novo.
        // Registos antigos (antes destes campos) traziam o código no action_name
        // e no rejection_reason, por isso procura-se também por esses.
        const ACTION_LABELS_PT = {
            PLANAR_PATCH: "Juntar faces coplanares",
            INVALID_PATCH: "Junção rejeitada",
            STOP: "Parar",
        };
        const REASON_BOUNDARY_PT = "As faces escolhidas não têm um contorno único e fechado.";
        const REASON_CROSSING_PT = "O contorno da face resultante cruzava-se ou voltava para trás.";
        const REASON_TOPOLOGY_PT = "Juntar estas faces mudaria a topologia da malha.";
        const REASON_NONPLANAR_PT = "As faces escolhidas não estão no mesmo plano (fora da tolerância).";
        const REASON_DEGENERATE_PT = "A face resultante seria degenerada (área ou aresta nula).";
        const REASON_NUMERIC_PT = "As coordenadas estão fora do intervalo suportado.";
        const REJECTION_REASONS_PT = {
            STOP: "O agente decidiu parar.",
            region_too_small: "A região escolhida tinha só uma face; não havia nada para juntar.",
            holes_or_multiple_contours: "A região escolhida tem um buraco ou partes separadas, por isso não pode ser uma só face.",
            non_simple_boundary: REASON_BOUNDARY_PT,
            open_boundary: REASON_BOUNDARY_PT,
            no_boundary: REASON_BOUNDARY_PT,
            inconsistent_internal_boundary: REASON_BOUNDARY_PT,
            contour_budget: "A face resultante teria vértices a mais.",
            no_cost_reduction: "Juntar não removia nenhum vértice nem aresta.",
            patch_not_disk: REASON_TOPOLOGY_PT,
            nonmanifold_edge: REASON_TOPOLOGY_PT,
            nonmanifold_vertex: REASON_TOPOLOGY_PT,
            interior_vertex_shared_outside_patch: REASON_TOPOLOGY_PT,
            self_intersecting_boundary: REASON_CROSSING_PT,
            backtracking_boundary: REASON_CROSSING_PT,
            repeated_vertex: REASON_CROSSING_PT,
            nonplanar_patch_interior: REASON_NONPLANAR_PT,
            nonplanar_face: REASON_NONPLANAR_PT,
            flipped_patch: "A face resultante ficaria virada ao contrário.",
            area_mismatch: "A face resultante não cobria a mesma área que as faces originais.",
            zero_area: REASON_DEGENERATE_PT,
            zero_length_edge: REASON_DEGENERATE_PT,
            unsupported_numeric_range: REASON_NUMERIC_PT,
            "Invalid polygon boundary": REASON_BOUNDARY_PT,
            "Invalid polygon coordinates": REASON_NUMERIC_PT,
            "Degenerate polygon": REASON_DEGENERATE_PT,
            "Degenerate final triangle": REASON_DEGENERATE_PT,
            "Nonplanar polygon": REASON_NONPLANAR_PT,
            "Cannot triangulate polygon: invalid or degenerate boundary": REASON_CROSSING_PT,
            INVALID_PATCH: "Não foi possível juntar as faces escolhidas.",
        };

        /** Nome da ação para mostrar (texto já escapado). */
        function getActionLabel(entry) {
            const code = entry?.action_name_code || entry?.raw?.action_name_code || entry?.action_name || entry?.raw?.action_name;
            const text = ACTION_LABELS_PT[code] || entry?.action_name || entry?.raw?.action_name || "Ação";
            return escapeHtml(text);
        }

        /** Porque é que um passo foi rejeitado (texto já escapado). */
        function getRejectionExplanation(entry) {
            const code = entry?.rejection_reason_code || entry?.raw?.rejection_reason_code
                || entry?.rejection_reason || entry?.raw?.rejection_reason;
            const apiText = entry?.rejection_reason || entry?.raw?.rejection_reason;
            if (code && REJECTION_REASONS_PT[code]) return REJECTION_REASONS_PT[code];
            if (apiText) return escapeHtml(apiText);
            return "Ação rejeitada pela validação para preservar a integridade da malha.";
        }

        let historyCurrentPage = 1;

        function renderHistoryView(actions) {
            if (!actionLogBody) return;
            actionLogBody.innerHTML = "";

            if (!actions || actions.length === 0) {
                actionLogBody.innerHTML = `<div class="action-log-empty"><span>⏳ Aguarda o início da simulação RL...</span></div>`;
                return;
            }

            // Atualizar contadores nos chips de filtro
            const acceptedList = actions.filter(a => a.accepted !== false && (a.raw?.accepted !== false));
            const rejectedList = actions.filter(a => a.accepted === false || (a.raw?.accepted === false));

            if (countAllEdges) countAllEdges.textContent = actions.length;
            if (countAcceptedEdges) countAcceptedEdges.textContent = acceptedList.length;
            if (countRejectedEdges) countRejectedEdges.textContent = rejectedList.length;

            let filtered = actions;
            if (currentEdgeFilter === "accepted") filtered = acceptedList;
            if (currentEdgeFilter === "rejected") filtered = rejectedList;

            // Thumbnail geral capturado para ilustrar ações onde a API não tem foto granular
            const defaultThumbnail = snapshotImagesMap.values().next().value || captureCanvasSnapshot();

            const pageSize = 20;
            const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
            if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
            if (historyCurrentPage < 1) historyCurrentPage = 1;

            const startIndex = (historyCurrentPage - 1) * pageSize;
            const pageEntries = filtered.slice(startIndex, startIndex + pageSize);

            // Barra de paginação
            const nav = document.createElement("div");
            nav.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:0.45rem 0.75rem;margin-bottom:0.75rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;font-size:0.78rem;color:#94a3b8;";
            nav.innerHTML = `
                <span>A mostrar ${startIndex + 1}–${Math.min(filtered.length, startIndex + pageSize)} de ${filtered.length} ações</span>
                <div style="display:flex;gap:0.45rem;align-items:center;">
                    <button type="button" class="btn-page-prev" style="padding:0.22rem 0.55rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#f8fafc;cursor:${historyCurrentPage > 1 ? 'pointer' : 'not-allowed'};opacity:${historyCurrentPage > 1 ? '1' : '0.4'};" ${historyCurrentPage > 1 ? '' : 'disabled'}>◀ Anterior</button>
                    <span style="font-family:'JetBrains Mono',monospace;color:#60a5fa;font-weight:600;">Pág ${historyCurrentPage} / ${totalPages}</span>
                    <button type="button" class="btn-page-next" style="padding:0.22rem 0.55rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#f8fafc;cursor:${historyCurrentPage < totalPages ? 'pointer' : 'not-allowed'};opacity:${historyCurrentPage < totalPages ? '1' : '0.4'};" ${historyCurrentPage < totalPages ? '' : 'disabled'}>Seguinte ▶</button>
                </div>
            `;
            actionLogBody.appendChild(nav);

            nav.querySelector(".btn-page-prev")?.addEventListener("click", () => {
                if (historyCurrentPage > 1) {
                    historyCurrentPage--;
                    renderHistoryView(actions);
                }
            });
            nav.querySelector(".btn-page-next")?.addEventListener("click", () => {
                if (historyCurrentPage < totalPages) {
                    historyCurrentPage++;
                    renderHistoryView(actions);
                }
            });

            pageEntries.forEach((entry) => {
                const step = entry.step ?? entry.action_index ?? 0;
                const isAcc = entry.accepted !== false && (entry.raw?.accepted !== false);
                const actDissolves = entry.raw?.accepted_dissolves ?? entry.accepted_dissolves ?? 0;
                const faces = entry.faces ?? entry.raw?.faces;
                const patchFaces = entry.patch_faces ?? entry.raw?.patch_faces;
                const actionLabel = getActionLabel(entry);

                // Imagem de contexto associada
                const snapImg = snapshotImagesMap.get(actDissolves) || defaultThumbnail;

                // Explicação da decisão deste passo
                let explanation = "";
                if (isAcc) {
                    explanation = patchFaces > 1
                        ? `Juntou ${patchFaces.toLocaleString()} faces coplanares numa só (-${(patchFaces - 1).toLocaleString()} faces).`
                        : "Juntou faces coplanares numa só.";
                } else {
                    explanation = getRejectionExplanation(entry);
                }

                const div = document.createElement("div");
                div.className = "al-entry" + (isAcc ? "" : " critical");

                div.innerHTML = `
                    <div class="al-thumb-wrap" title="Clique para ampliar fotografia do modelo neste marco">
                        <img class="al-thumb" src="${snapImg || ''}" alt="Foto da Malha">
                    </div>
                    <div class="al-content">
                        <div class="al-header-row">
                            <span class="al-step-badge">#${step}</span>
                            <span class="al-status-badge ${isAcc ? 'accepted' : 'rejected'}">
                                ${isAcc ? '✂️ ACEITE' : '⚠️ REJEITADA'}
                            </span>
                            <span style="font-size:0.75rem;font-weight:600;color:#f1f5f9;font-family:'JetBrains Mono',monospace;">
                                ${actionLabel}
                            </span>
                        </div>
                        <p class="al-explanation">${explanation}</p>
                        <div class="al-footer-row">
                            <span>${faces ? `Faces: ${faces.toLocaleString()}` : ''}</span>
                            <span style="font-size:0.72rem;color:#94a3b8;font-family:'JetBrains Mono',monospace;">
                                Dissolves acumulados: ${actDissolves}
                            </span>
                        </div>
                    </div>
                `;

                // Clicar na miniatura abre o lightbox apenas com informação real, sem carregar mesh falsa
                const thumbWrap = div.querySelector(".al-thumb-wrap");
                if (thumbWrap) {
                    thumbWrap.addEventListener("click", () => {
                        openSnapshotLightbox({
                            imgUrl: snapImg,
                            tag: `PASSO #${step}`,
                            title: `Passo #${step}: ${actionLabel}`,
                            dissolves: actDissolves,
                            faces: faces,
                            acceptedCount: isAcc ? 1 : 0,
                            rejectedCount: isAcc ? 0 : 1,
                            totalEvaluated: 1,
                            facesRemoved: isAcc && patchFaces > 1 ? patchFaces - 1 : 0,
                            explanationHtml: `<p>${explanation}</p>`
                            // Sem onLoadMesh enganador para cada passo unitário
                        });
                    });
                }

                actionLogBody.appendChild(div);
            });
        }

        function loadGeometryIntoViewport(geo, stats, label, dissolves, step, efficiency, snapIndex) {
            if (!geo) return;

            // Mantém no máximo 3 malhas em memória (High, Low e o Snapshot ativo atual).
            // Liberta o snapshot anterior se estivermos a carregar um novo snapshot diferente.
            if (currentSnapGeo && currentSnapGeo !== highPolyGeo && currentSnapGeo !== lowPolyGeo && currentSnapGeo !== geo) {
                disposeGeo(currentSnapGeo);
            }
            currentSnapGeo = geo;
            currentSnapDissolves = dissolves;
            currentSnapIndex = (snapIndex !== undefined && snapIndex !== null) ? snapIndex : (currentSnapIndex || (dissolves ? 1 : null));
            currentSnapStep = step || null;
            currentSnapEfficiency = efficiency || null;
            // Pré-computa arestas na primeira carga para garantir troca instantânea (0ms)
            getOrCreateRealEdgesGeo(geo);
            mesh.geometry = geo;

            // Ativa Superfície + Arestas + Vértices ao carregar a malha
            showSurface = true;
            showEdges = true;
            showVerts = true;
            if (btnSurface) btnSurface.classList.add("active");
            if (btnEdges) btnEdges.classList.add("active");
            if (btnVerts) btnVerts.classList.add("active");
            if (edgesMesh) {
                edgesMesh.visible = true;
                edgesMesh.geometry = getOrCreateRealEdgesGeo(geo);
            }
            if (pointsMesh) {
                pointsMesh.visible = true;
                pointsMesh.geometry = geo;
            }

            setDSSHeatmapActive(false);
            if (window.MeshQA && typeof window.MeshQA.resetViewMode === "function") {
                window.MeshQA.resetViewMode();
            }

            updateSurfaceMaterial();
            syncVisualOverlays();

            // Flash ciano para confirmação visual evidente
            baseMaterial.color.setHex(0x38bdf8);
            setTimeout(() => { baseMaterial.color.setHex(0x94a3b8); }, 500);

            const tris = stats?.faces || 0;
            const verts = stats?.verts || 0;
            currentSnapStats = { faces: tris, verts: verts };
            updateFloatingStats(verts, tris);

            btnHigh.classList.remove("active");
            btnLow.classList.remove("active");
            setGNNHeatmapActive(false);

            if (btnSnapPoly) {
                btnSnapPoly.style.display = "inline-flex";
                const snapName = currentSnapIndex ? `📸 Snapshot #${currentSnapIndex}` : `📸 Snapshot`;
                btnSnapPoly.textContent = `${snapName} (${dissolves || "Intermédio"})`;
                btnSnapPoly.classList.add("active");
            }

            activeView = "snapshot";
            updateSidebarContext("snapshot");

            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = `Visualizando: ${label} (${tris.toLocaleString()} faces)`;
            }
        }

        function loadMeshIntoViewport(objText, label, dissolves, step, efficiency, snapIndex, isQuad = false) {
            if (!objText) return;
            const snapGeo = buildCustomOBJGeometry(objText);
            if (snapGeo) {
                snapGeo.userData = snapGeo.userData || {};
                snapGeo.userData.isQuad = Boolean(isQuad);
                const intermStats = computeObjStats(objText);
                loadGeometryIntoViewport(snapGeo, intermStats, label, dissolves, step, efficiency, snapIndex);
            }
        }

        function closeActionLog() {
            const drawer = actionLogDrawer || document.getElementById("action-log-drawer");
            if (drawer) drawer.classList.remove("open");
        }

        function escapeHtml(str) {
            return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        if (btnActionLog) btnActionLog.addEventListener("click", openActionLog);
        if (btnSideReport) btnSideReport.addEventListener("click", openActionLog);
        if (actionLogClose) {
            actionLogClose.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeActionLog();
            });
        }

        document.addEventListener("click", (e) => {
            if (e.target && (e.target.id === "action-log-close" || e.target.closest("#action-log-close"))) {
                e.preventDefault();
                e.stopPropagation();
                closeActionLog();
            }
        });

        if (actionLogDrawer) {
            actionLogDrawer.addEventListener("click", (e) => {
                if (e.target === actionLogDrawer) closeActionLog();
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (snapshotLightbox && snapshotLightbox.classList.contains("open")) {
                    closeSnapshotLightbox();
                    return;
                }
                if (actionLogDrawer && actionLogDrawer.classList.contains("open")) {
                    closeActionLog();
                }
            }
        });

    } // Fim do initThreeJS
})();
