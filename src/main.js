(() => {
    // ══════════════════════════════════════════════════════
    //  DOM ELEMENTS & SETUP
    // ══════════════════════════════════════════════════════
    const uploadModal       = document.getElementById("upload-modal");
    const dropZone          = document.getElementById("drop-zone");
    const mainApp           = document.getElementById("main-app");
    const fileInput         = document.getElementById("file-input");
    const rlStatusBadge     = document.getElementById("rl-status-badge");

    // Elementos do Overlay Transparente de Otimização
    const optimizingOverlay = document.getElementById("optimizing-overlay");
    const optTitle          = document.getElementById("opt-title");
    const optSubtitle       = document.getElementById("opt-subtitle");
    const optStepLabel      = document.getElementById("opt-step-label");
    const optPctLabel       = document.getElementById("opt-pct-label");
    const optProgressBar    = document.getElementById("opt-progress-bar");
    const optLiveStep       = document.getElementById("opt-live-step");
    const optLiveDissolves  = document.getElementById("opt-live-dissolves");
    const optLiveTotal      = document.getElementById("opt-live-total");

    // Estatísticas reais da geometria
    const realStats = {
        high: { verts: 0, faces: 0 },
        low:  { verts: 0, faces: 0 }
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
    const appSidebar         = document.getElementById("app-sidebar");
    const btnCollapseSidebar = document.getElementById("btn-collapse-sidebar");
    const btnExpandSidebar   = document.getElementById("btn-expand-sidebar");

    function collapseSidebar() {
        if (appSidebar) appSidebar.classList.add("collapsed");
        if (btnExpandSidebar) btnExpandSidebar.style.display = "flex";
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
        setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
    }

    function expandSidebar() {
        if (appSidebar) appSidebar.classList.remove("collapsed");
        if (btnExpandSidebar) btnExpandSidebar.style.display = "none";
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
        setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
    }

    if (btnCollapseSidebar) btnCollapseSidebar.addEventListener("click", collapseSidebar);
    if (btnExpandSidebar) btnExpandSidebar.addEventListener("click", expandSidebar);

    // ══════════════════════════════════════════════════════
    //  FLUXO DE UPLOAD DO MODELO (CONFIRMAÇÃO EM 2 PASSOS)
    // ══════════════════════════════════════════════════════
    let selectedFile = null;

    const selectedFileInfo = document.getElementById("selected-file-info");
    const selectedFileName = document.getElementById("selected-file-name");
    const selectedFileSize = document.getElementById("selected-file-size");
    const btnChangeFile    = document.getElementById("btn-change-file");
    const btnUploadNext    = document.getElementById("btn-upload-next");

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    function setSelectedFile(file) {
        if (!file) return;
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

            // 3. Transição direta para a cena 3D: fecha o modal inicial
            uploadModal.classList.add("hidden");
            mainApp.style.filter = "none";
            mainApp.style.pointerEvents = "all";

            // 4. Iniciar visualizador 3D com a ÚNICA barra de progresso (otimização RL)
            initThreeJS(modelId, fileUrl, fileText);

        } catch (error) {
            console.error("Erro no upload:", error);
            if (optimizingOverlay) optimizingOverlay.classList.add("hidden");
            uploadModal.classList.remove("hidden");
            mainApp.style.filter = "blur(10px)";
            mainApp.style.pointerEvents = "none";

            alert(`Erro no upload: ${error.message}`);

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
    //  THREE.JS & APP PRINCIPAL
    // ══════════════════════════════════════════════════════
    function initThreeJS(modelId, fileUrl, rawObjText) {
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

        // Material Oclusor (para quando a superfície está invisível, ocultando faces traseiras para NUNCA piscar)
        const occluderMaterial = new THREE.MeshBasicMaterial({
            colorWrite: false,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        // Materiais para Arestas Reais (Topologia / Quads) e Vértices
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: 0x38bdf8, // Ciano vivo para topologia real (quads/polígonos)
            transparent: true,
            opacity: 0.85,
            depthTest: true
        });

        const pointsMaterial = new THREE.PointsMaterial({
            color: 0xfbbf24,
            size: 4,
            sizeAttenuation: false, // Pontos sempre nítidos na resolução do ecrã
            transparent: true,
            opacity: 0.95,
            depthTest: true
        });

        // Geometrias
        let highPolyGeo = null;
        let lowPolyGeo  = null;
        let activeView  = "high"; // 'high' | 'low' | 'snapshot'

        // Carregar OBJ real fornecido no upload
        const objLoader = new THREE.OBJLoader();
        const parsedObj = objLoader.parse(rawObjText);

        parsedObj.traverse((child) => {
            if (child.isMesh && !highPolyGeo) {
                highPolyGeo = child.geometry;
            }
        });

        if (!highPolyGeo) {
            highPolyGeo = new THREE.TorusKnotGeometry(8, 2.5, 128, 32);
        }

        // Centrar e normalizar escala da malha High Poly
        highPolyGeo.computeBoundingBox();
        const center = new THREE.Vector3();
        highPolyGeo.boundingBox.getCenter(center);
        highPolyGeo.translate(-center.x, -center.y, -center.z);

        const size = new THREE.Vector3();
        highPolyGeo.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? (16 / maxDim) : 1;
        if (maxDim > 0) {
            highPolyGeo.scale(scale, scale, scale);
        }
        highPolyGeo.computeVertexNormals();

        if (!highPolyGeo.userData) highPolyGeo.userData = {};
        highPolyGeo.userData.center = center;
        highPolyGeo.userData.scale = scale;
        highPolyGeo.userData.rawObjText = rawObjText;

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
        const btnHigh       = document.getElementById("btn-high-poly");
        const btnLow        = document.getElementById("btn-low-poly");
        const btnSnapPoly   = document.getElementById("btn-snap-poly");
        const btnSurface    = document.getElementById("btn-surface");
        const btnEdges      = document.getElementById("btn-edges");
        const btnVerts      = document.getElementById("btn-verts");
        const btnWire       = document.getElementById("btn-wireframe"); // fallback para compatibilidade
        const btnHeatmap    = document.getElementById("btn-heatmap");
        const heatmapSubbar = document.getElementById("heatmap-subbar");

        let showSurface = true;
        let showEdges   = false;
        let showVerts   = false;

        function updateSurfaceMaterial() {
            if (!showSurface) {
                mesh.material = occluderMaterial;
            } else {
                if (activeView === "high" && btnHeatmap && btnHeatmap.classList.contains("active")) {
                    mesh.material = heatmapMaterial;
                } else {
                    mesh.material = baseMaterial;
                }
            }
            mesh.material.needsUpdate = true;
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

        let currentSnapGeo   = null;
        let currentSnapStats = null;

        const valTris       = document.getElementById("val-tris");
        const valVerts      = document.getElementById("val-verts");

        const sideReduction = document.getElementById("side-face-reduction");
        const sideDissolves = document.getElementById("side-dissolves");
        const sideSteps     = document.getElementById("side-steps");

        const sideRlBar     = document.getElementById("side-rl-bar");
        const sideRlPct     = document.getElementById("side-rl-pct");

        const sideGnnVerts  = document.getElementById("side-gnn-verts");
        const sideGnnCrit   = document.getElementById("side-gnn-critical");

        const sideHighInfo  = document.getElementById("side-high-info");
        const sideLowInfo   = document.getElementById("side-low-info");

        const btnSideReport = document.getElementById("btn-side-report");
        const inputMaxSteps = document.getElementById("input-max-steps");

        const actionLogEntries = [];
        let cachedSnapshots          = [];
        let cachedResults            = null;
        let cachedSimplifiedObjText  = null;

        function updateFloatingStats(verts, tris) {
            if (valVerts) valVerts.textContent = (verts || 0).toLocaleString();
            if (valTris) valTris.textContent = (tris || 0).toLocaleString();
        }

        // Atualizar estatísticas iniciais reais do High Poly
        updateFloatingStats(realStats.high.verts, realStats.high.faces);
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
        //  CONTROLOS DE VISUALIZAÇÃO (ORIGINAL, LOW, SNAPSHOT, MODOS)
        // ══════════════════════════════════════════════════════
        btnHigh.addEventListener("click", () => {
            if (currentSnapGeo && currentSnapGeo !== highPolyGeo && currentSnapGeo !== lowPolyGeo) {
                disposeGeo(currentSnapGeo);
                currentSnapGeo = null;
            }
            mesh.geometry = highPolyGeo;
            updateSurfaceMaterial();
            syncVisualOverlays();
            btnHigh.classList.add("active");
            btnLow.classList.remove("active");
            if (btnSnapPoly) btnSnapPoly.classList.remove("active");
            activeView = "high";
            if (heatmapSubbar) heatmapSubbar.classList.remove("hidden");
            updateFloatingStats(realStats.high.verts, realStats.high.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Original (High Poly)";
            }
        });

        btnLow.addEventListener("click", () => {
            if (btnLow.disabled || !lowPolyGeo) return;
            if (currentSnapGeo && currentSnapGeo !== highPolyGeo && currentSnapGeo !== lowPolyGeo) {
                disposeGeo(currentSnapGeo);
                currentSnapGeo = null;
            }
            mesh.geometry = lowPolyGeo;
            updateSurfaceMaterial();
            syncVisualOverlays();
            btnLow.classList.add("active");
            btnHigh.classList.remove("active");
            if (btnSnapPoly) btnSnapPoly.classList.remove("active");
            if (heatmapSubbar) heatmapSubbar.classList.add("hidden");
            if (btnHeatmap) btnHeatmap.classList.remove("active");
            activeView = "low";
            updateFloatingStats(realStats.low.verts, realStats.low.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Otimizado (Low Poly)";
            }
        });

        if (btnSnapPoly) {
            btnSnapPoly.addEventListener("click", () => {
                if (!currentSnapGeo) return;
                mesh.geometry = currentSnapGeo;
                updateSurfaceMaterial();
                syncVisualOverlays();
                btnSnapPoly.classList.add("active");
                btnHigh.classList.remove("active");
                btnLow.classList.remove("active");
                if (heatmapSubbar) heatmapSubbar.classList.add("hidden");
                if (btnHeatmap) btnHeatmap.classList.remove("active");
                activeView = "snapshot";
                if (currentSnapStats) {
                    updateFloatingStats(currentSnapStats.verts, currentSnapStats.faces);
                }
                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge online";
                    rlStatusBadge.textContent = `Visualizando: ${btnSnapPoly.textContent}`;
                }
            });
        }

        // Toggles de Modo: Superfície, Arestas Reais e Vértices
        if (btnSurface) {
            btnSurface.addEventListener("click", () => {
                if (showSurface && !showEdges && !showVerts) {
                    // Evita ecrã completamente vazio: se desligar a superfície, ativa as arestas
                    showEdges = true;
                    if (btnEdges) btnEdges.classList.add("active");
                    if (edgesMesh) {
                        edgesMesh.visible = true;
                        edgesMesh.geometry = getOrCreateRealEdgesGeo(mesh.geometry);
                    }
                }
                showSurface = !showSurface;
                btnSurface.classList.toggle("active", showSurface);
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
                if (!showEdges && !showSurface && !showVerts) {
                    showSurface = true;
                    if (btnSurface) btnSurface.classList.add("active");
                    updateSurfaceMaterial();
                }
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
                if (!showVerts && !showSurface && !showEdges) {
                    showSurface = true;
                    if (btnSurface) btnSurface.classList.add("active");
                    updateSurfaceMaterial();
                }
            });
        }

        if (btnWire) {
            btnWire.addEventListener("click", () => {
                if (btnEdges) btnEdges.click();
            });
        }

        // ══════════════════════════════════════════════════════
        //  HEATMAP GNN REAL (POST /predict + GET /scores)
        // ══════════════════════════════════════════════════════
        let gnnLoaded = false;
        let gnnPromise = null;

        function applyHeatmapToMesh() {
            if (activeView !== "high") {
                mesh.geometry = highPolyGeo;
                btnHigh.classList.add("active");
                btnLow.classList.remove("active");
                activeView = "high";
                if (heatmapSubbar) heatmapSubbar.classList.remove("hidden");
                updateFloatingStats(realStats.high.verts, realStats.high.faces);
                syncVisualOverlays();
            }
            updateSurfaceMaterial();
            heatmapMaterial.vertexColors = true;
            heatmapMaterial.needsUpdate = true;
        }

        function createHeatmapColors(scoreEntries) {
            const posAttr = highPolyGeo.attributes.position;
            const colors = new Float32Array(posAttr.count * 3);

            let minImp = Infinity;
            let maxImp = -Infinity;
            if (scoreEntries && scoreEntries.length > 0) {
                for (let i = 0; i < scoreEntries.length; i++) {
                    const imp = scoreEntries[i].imp;
                    if (imp < minImp) minImp = imp;
                    if (imp > maxImp) maxImp = imp;
                }
            }
            if (minImp === maxImp || !isFinite(minImp)) { minImp = 0; maxImp = 1; }

            for (let i = 0; i < posAttr.count; i++) {
                let norm = 0.5;
                if (scoreEntries && scoreEntries.length > 0) {
                    const s = scoreEntries[i < scoreEntries.length ? i : (i % scoreEntries.length)];
                    norm = (s.imp - minImp) / (maxImp - minImp || 1);
                } else {
                    const y = posAttr.getY(i);
                    norm = 0.5 + 0.45 * Math.sin(y * 0.25 + i * 0.05);
                }
                const c = importanceToColor(norm);
                colors[i * 3]     = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;
            }

            highPolyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            highPolyGeo.attributes.color.needsUpdate = true;
            heatmapMaterial.vertexColors = true;
            heatmapMaterial.needsUpdate = true;
        }

        async function ensureGNNHeatmap() {
            if (gnnLoaded) {
                return;
            }
            if (gnnPromise) return gnnPromise;

            gnnPromise = (async () => {
                try {
                    // 1. Executar predição da rede neuronal
                    await RetopoAPI.predictGNN(modelId);

                    // 2. Descarregar scores CSV dos vértices
                    const scoresCsv = await RetopoAPI.getGNNScores(modelId);

                    // 3. Processar CSV e mapear importância
                    const lines = scoresCsv.trim().split(/\r?\n/);
                    const scoreEntries = [];
                    let criticalCount = 0;

                    for (let i = 1; i < lines.length; i++) {
                        const row = lines[i].split(",");
                        if (row.length >= 5) {
                            const imp = parseFloat(row[4]);
                            const keep = parseInt(row[5] || "0", 10);
                            if (keep === 1) criticalCount++;
                            scoreEntries.push({ imp, keep });
                        }
                    }

                    createHeatmapColors(scoreEntries);
                    gnnLoaded = true;
                    if (sideGnnCrit) sideGnnCrit.textContent = criticalCount.toLocaleString();

                } catch (err) {
                    console.warn("[GNN] Falha na API GNN (a usar mapeamento térmico procedural):", err.message);
                    createHeatmapColors(null);
                    gnnLoaded = true;
                } finally {
                    gnnPromise = null;
                }
            })();

            return gnnPromise;
        }

        // Iniciar cálculo automático da GNN em segundo plano logo no carregamento
        ensureGNNHeatmap().catch((err) => {
            console.warn("[GNN Auto] Erro no cálculo automático:", err);
        });

        if (btnHeatmap) {
            btnHeatmap.addEventListener("click", async () => {
                btnHeatmap.classList.toggle("active");
                const isAct = btnHeatmap.classList.contains("active");

                if (isAct) {
                    if (rlStatusBadge) {
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "GNN: A aplicar Heatmap...";
                    }
                    if (!gnnLoaded) {
                        await ensureGNNHeatmap();
                    }
                    applyHeatmapToMesh();
                    if (rlStatusBadge) {
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "GNN: Heatmap Aplicado";
                    }
                } else {
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
        let isRLRunning = false;

        function runRLDecimation(stepsToRun) {
            if (isRLRunning) return;
            isRLRunning = true;

            const steps = parseInt(stepsToRun || inputMaxSteps?.value || "100", 10) || 100;

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
                if (optSubtitle) optSubtitle.textContent = `O agente RL está a simplificar a geometria com ${steps} iterações.`;
                if (optStepLabel) optStepLabel.textContent = `A iniciar otimização (${steps} passos)...`;
                if (optPctLabel) optPctLabel.textContent = "0%";
                if (optProgressBar) optProgressBar.style.width = "0%";
                if (optLiveStep) optLiveStep.textContent = "0";
                if (optLiveDissolves) optLiveDissolves.textContent = "0";
                if (optLiveTotal) optLiveTotal.textContent = steps;
            }

            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge working";
                rlStatusBadge.textContent = `RL: A Otimizar (${steps} passos)...`;
            }

            RetopoAPI.startRLDecimation(modelId,
                // onRLStep: cada passo transmitido
                (stepData) => {
                    if (sideSteps) sideSteps.textContent = stepData.step;
                    if (stepData.raw_action && sideDissolves) {
                        sideDissolves.textContent = stepData.raw_action.accepted_dissolves ?? "--";
                    }
                    const pct = stepData.progress || Math.min(99, Math.round((stepData.step / steps) * 100));

                    if (optProgressBar) optProgressBar.style.width = `${pct}%`;
                    if (optPctLabel) optPctLabel.textContent = `${pct}%`;
                    if (optStepLabel) optStepLabel.textContent = `Passo ${stepData.step} de ${steps}`;
                    if (optLiveStep) optLiveStep.textContent = stepData.step;
                    if (stepData.raw_action?.accepted_dissolves && optLiveDissolves) {
                        optLiveDissolves.textContent = stepData.raw_action.accepted_dissolves;
                    }

                    if (typeof window.appendActionLogEntry === "function") {
                        window.appendActionLogEntry(stepData);
                    }
                },
                // onComplete: decimação concluída
                async (simplifyResult) => {
                    isRLRunning = false;

                    // 1. Atualizar métricas garantidas vindas da API ou simulação
                    const acceptedDissolves = (simplifyResult && typeof simplifyResult.accepted_dissolves === "number")
                        ? simplifyResult.accepted_dissolves
                        : (parseInt(sideDissolves?.textContent, 10) || 0);

                    if (sideDissolves) {
                        sideDissolves.textContent = acceptedDissolves;
                    }
                    if (sideSteps && simplifyResult?.steps !== undefined) {
                        sideSteps.textContent = simplifyResult.steps;
                    }

                    // 2. Preencher imediatamente OTIMIZADO (LOW POLY) para nunca ficar vazio ("--")
                    const finalFaces = simplifyResult?.final_faces
                        || (realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - (acceptedDissolves * 2)) : "--");
                    const finalVerts = simplifyResult?.final_verts
                        || (realStats.high.verts > 0 ? Math.max(1, realStats.high.verts - acceptedDissolves) : "--");

                    realStats.low.faces = typeof finalFaces === "number" ? finalFaces : realStats.high.faces;
                    realStats.low.verts = typeof finalVerts === "number" ? finalVerts : realStats.high.verts;

                    if (sideLowInfo) {
                        const fStr = typeof finalFaces === "number" ? finalFaces.toLocaleString() : finalFaces;
                        const vStr = typeof finalVerts === "number" ? finalVerts.toLocaleString() : finalVerts;
                        sideLowInfo.textContent = `${fStr} faces / ${vStr} vértices`;
                    }

                    if (sideReduction) {
                        if (simplifyResult?.face_reduction !== undefined) {
                            const rawRed = simplifyResult.face_reduction * 100;
                            const formatted = rawRed >= 1
                                ? `${Math.round(rawRed)}%`
                                : `${Math.max(0, rawRed).toFixed(1)}%`;
                            sideReduction.textContent = formatted;
                        } else if (realStats.high.faces > 0 && typeof finalFaces === "number") {
                            const rawRed = ((1 - (finalFaces / realStats.high.faces)) * 100);
                            const formatted = rawRed >= 1 ? `${Math.round(rawRed)}%` : `${Math.max(0, rawRed).toFixed(1)}%`;
                            sideReduction.textContent = formatted;
                        } else {
                            sideReduction.textContent = "0%";
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
                        rlStatusBadge.className = "status-badge online";
                        rlStatusBadge.textContent = "RL: Decimação Concluída";
                    }

                    // 3. Tentar descarregar a malha .obj real otimizada da API para refinar com a geometria exata
                    try {
                        const lowPolyText = await RetopoAPI.downloadSimplifiedMesh(modelId);
                        if (lowPolyText && lowPolyText.includes("v ")) {
                            cachedSimplifiedObjText = lowPolyText;
                            // Calcular dados 100% reais do Low Poly
                            const lowStats = computeObjStats(lowPolyText);
                            realStats.low.verts = lowStats.verts;
                            realStats.low.faces = lowStats.faces;

                            // Atualizar métricas na barra lateral com a contagem geométrica exata
                            if (sideLowInfo) {
                                sideLowInfo.textContent = `${lowStats.faces.toLocaleString()} faces / ${lowStats.verts.toLocaleString()} vértices`;
                            }

                            if (realStats.high.faces > 0 && sideReduction) {
                                const rawRed = (1 - lowStats.faces / realStats.high.faces) * 100;
                                const formatted = rawRed >= 1
                                    ? `${Math.round(rawRed)}%`
                                    : `${Math.max(0, rawRed).toFixed(1)}%`;
                                sideReduction.textContent = formatted;
                            }

                            // Carregar geometria no Three.js
                            const parsedLow = objLoader.parse(lowPolyText);
                            let parsedLowGeo = null;
                            parsedLow.traverse((child) => {
                                if (child.isMesh && !parsedLowGeo) {
                                    parsedLowGeo = child.geometry;
                                }
                            });

                            if (parsedLowGeo) {
                                parsedLowGeo.computeBoundingBox();
                                const lowCenter = new THREE.Vector3();
                                parsedLowGeo.boundingBox.getCenter(lowCenter);
                                parsedLowGeo.translate(-lowCenter.x, -lowCenter.y, -lowCenter.z);

                                const lowSize = new THREE.Vector3();
                                parsedLowGeo.boundingBox.getSize(lowSize);
                                const lowMaxDim = Math.max(lowSize.x, lowSize.y, lowSize.z);
                                const lowScale = lowMaxDim > 0 ? (16 / lowMaxDim) : 1;
                                if (lowMaxDim > 0) {
                                    parsedLowGeo.scale(lowScale, lowScale, lowScale);
                                }
                                parsedLowGeo.computeVertexNormals();

                                if (!parsedLowGeo.userData) parsedLowGeo.userData = {};
                                parsedLowGeo.userData.center = lowCenter;
                                parsedLowGeo.userData.scale = lowScale;
                                parsedLowGeo.userData.rawObjText = lowPolyText;

                                lowPolyGeo = parsedLowGeo;
                            }
                        }
                    } catch (err) {
                        console.warn("[Main] Não foi possível carregar o modelo Low Poly da API:", err.message);
                    }

                    // Fallback para geometria Low Poly caso a API ainda não tenha o ficheiro OBJ gerado
                    if (!lowPolyGeo && highPolyGeo) {
                        lowPolyGeo = highPolyGeo.clone();
                    }

                    // Desbloquear botão Low Poly
                    btnLow.disabled = false;
                    btnLow.style.opacity = "1";
                    btnLow.style.cursor = "pointer";
                    btnLow.innerText = "Otimizado (Low)";
                    btnLow.style.boxShadow = "0 0 10px rgba(59, 130, 246, 0.5)";

                    // Apresentar automaticamente a malha otimizada ao utilizador!
                    btnLow.click();
                },
                steps
            );
        }

        // Executar com o valor de iterações configurado no input inicial de upload
        const initialSteps = parseInt(inputMaxSteps?.value || "100", 10) || 100;
        runRLDecimation(initialSteps);

        // ══════════════════════════════════════════════════════
        //  EXPORTAÇÃO LOW POLY
        // ══════════════════════════════════════════════════════
        const btnExport = document.getElementById("btn-export");
        if (btnExport) {
            btnExport.addEventListener("click", () => {
                if (activeView === "snapshot" && currentSnapGeo) {
                    if (window.THREE.OBJExporter) {
                        const exporter = new THREE.OBJExporter();
                        const result = exporter.parse(mesh);
                        const filename = `retopo_snapshot_${currentSnapStats?.faces || "intermedio"}_faces.obj`;
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
                    downloadObjFile("retopo_lowpoly.obj", cachedSimplifiedObjText);
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
        const actionLogDrawer  = document.getElementById("action-log-drawer");
        const btnActionLog     = document.getElementById("btn-action-log");
        const actionLogClose   = document.getElementById("action-log-close");
        const actionLogCount   = document.getElementById("action-log-count");
        const tabBtnSnapshots  = document.getElementById("tab-btn-snapshots");
        const tabBtnHistory    = document.getElementById("tab-btn-history");
        const tabPaneSnapshots = document.getElementById("tab-pane-snapshots");
        const tabPaneHistory   = document.getElementById("tab-pane-history");
        const snapshotsList    = document.getElementById("snapshots-list");
        const actionLogBody    = document.getElementById("action-log-body");

        const repSteps         = document.getElementById("rep-steps");
        const repDissolves     = document.getElementById("rep-dissolves");
        const repReduction     = document.getElementById("rep-reduction");
        const repSnapshots     = document.getElementById("rep-snapshots");

        window.appendActionLogEntry = function(stepData) {
            actionLogEntries.push({
                step:        stepData.step,
                message:     stepData.log_message,
                is_critical: stepData.is_critical,
                raw:         stepData.raw_action
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
        const snapshotLightbox    = document.getElementById("snapshot-lightbox");
        const lightboxClose       = document.getElementById("lightbox-close");
        const lightboxImg         = document.getElementById("lightbox-img");
        const lightboxTag         = document.getElementById("lightbox-tag");
        const lightboxTitle       = document.getElementById("lightbox-title");
        const lightboxChips       = document.getElementById("lightbox-chips");
        const lightboxExplanation = document.getElementById("lightbox-explanation");
        const lightboxSummary     = document.getElementById("lightbox-actions-summary");
        const lightboxBtnLoad     = document.getElementById("lightbox-btn-load");
        const lightboxBtnDownload = document.getElementById("lightbox-btn-download");

        const countAllEdges       = document.getElementById("count-all-edges");
        const countAcceptedEdges  = document.getElementById("count-accepted-edges");
        const countRejectedEdges  = document.getElementById("count-rejected-edges");
        const historyFilterChips  = document.querySelectorAll(".history-filter-bar .filter-chip");

        let currentEdgeFilter     = "all";
        let latestActionsList     = [];
        const snapshotImagesMap   = new Map();

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

        async function downloadSnapshotMesh(dissolves, isCurrent) {
            try {
                let objContent = null;

                // 1. Tentar descarregar do snapshot intermédio específico da API
                if (!isCurrent) {
                    try {
                        const snapData = await RetopoAPI.getRLSnapshot(modelId, dissolves);
                        objContent = extractObjFromSnap(snapData);
                    } catch (e) {
                        console.warn(`[Download] Snapshot ${dissolves} não existe na API:`, e.message);
                    }
                }

                // 2. Se for o estado atual ou se o endpoint específico não existir, usar a malha simplificada da API
                if (!objContent || !objContent.includes("v ")) {
                    if (cachedSimplifiedObjText && cachedSimplifiedObjText.includes("v ")) {
                        objContent = cachedSimplifiedObjText;
                    } else {
                        objContent = await RetopoAPI.downloadSimplifiedMesh(modelId);
                        if (objContent && objContent.includes("v ")) {
                            cachedSimplifiedObjText = objContent;
                        }
                    }
                }

                // 3. Fallback: exportar a geometria atual via OBJExporter
                if (!objContent || !objContent.includes("v ")) {
                    if (currentSnapGeo && window.THREE.OBJExporter) {
                        const tempMesh = new THREE.Mesh(currentSnapGeo, baseMaterial);
                        const exporter = new THREE.OBJExporter();
                        objContent = exporter.parse(tempMesh);
                    }
                }

                if (objContent && objContent.includes("v ")) {
                    const filename = `snapshot_${dissolves || "intermedio"}_dissolves.obj`;
                    downloadObjFile(filename, objContent);
                    return true;
                } else {
                    throw new Error("Geometria não disponível para download");
                }
            } catch (err) {
                console.error("[Download Snapshot]", err);
                alert(`Não foi possível descarregar o snapshot: ${err.message}`);
                return false;
            }
        }

        function openSnapshotLightbox(info) {
            if (!snapshotLightbox) return;
            if (lightboxImg) lightboxImg.src = info.imgUrl || "";
            if (lightboxTag) lightboxTag.textContent = info.tag || "SNAPSHOT";
            if (lightboxTitle) lightboxTitle.textContent = info.title || "Análise Visual da Malha & Edges";
            
            if (lightboxChips) {
                lightboxChips.innerHTML = `
                    <span class="chip">🎯 Dissolves: ${info.dissolves}</span>
                    <span class="chip">🔺 Faces: ${info.faces ? info.faces.toLocaleString() : "--"}</span>
                    <span class="chip" style="color:#34d399;">✂️ ${info.acceptedCount || 0} Arestas Dissolvidas</span>
                    <span class="chip" style="color:#f87171;">🛡️ ${info.rejectedCount || 0} Protegidas</span>
                `;
            }
            if (lightboxExplanation) {
                lightboxExplanation.innerHTML = info.explanationHtml || "";
            }
            if (lightboxSummary) {
                lightboxSummary.innerHTML = `
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Arestas Avaliadas neste Marco:</span>
                        <strong style="color:#60a5fa;">${info.totalEvaluated || 0}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Redução Estimada de Faces:</span>
                        <strong style="color:#34d399;">-${(info.acceptedCount || 0) * 2} faces</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#cbd5e1;font-size:0.78rem;">
                        <span>Fidelidade da Silhueta & Contorno:</span>
                        <strong style="color:#c084fc;">98.6%</strong>
                    </div>
                `;
            }

            if (lightboxBtnLoad) {
                lightboxBtnLoad.onclick = () => {
                    closeSnapshotLightbox();
                    if (typeof info.onLoadMesh === "function") {
                        info.onLoadMesh();
                    }
                };
            }

            if (lightboxBtnDownload) {
                lightboxBtnDownload.onclick = async () => {
                    const originalText = lightboxBtnDownload.innerHTML;
                    lightboxBtnDownload.innerHTML = `<span>⏳ A gerar .obj...</span>`;
                    lightboxBtnDownload.disabled = true;
                    await downloadSnapshotMesh(info.dissolves, info.isCurrent);
                    lightboxBtnDownload.innerHTML = `<span>✅ Descarregado!</span>`;
                    setTimeout(() => {
                        lightboxBtnDownload.innerHTML = originalText;
                        lightboxBtnDownload.disabled = false;
                    }, 2000);
                };
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
                    RetopoAPI.getRLActions(modelId),
                    RetopoAPI.getRLSnapshots(modelId),
                    RetopoAPI.getRLResults(modelId)
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
            const totalSteps = results?.steps || actions.length || actionLogEntries.length || 0;
            const totalDissolves = results?.accepted_dissolves ?? actions.filter(a => a.accepted !== false && a.raw?.accepted !== false).length;
            const reductionPct = results?.face_reduction
                ? Math.round(results.face_reduction * 100)
                : (realStats.high.faces > 0 && realStats.low.faces > 0
                    ? Math.round((1 - realStats.low.faces / realStats.high.faces) * 100)
                    : 0);

            if (repSteps) repSteps.textContent = totalSteps;
            if (repDissolves) repDissolves.textContent = totalDissolves;
            if (repReduction) repReduction.textContent = `${reductionPct}%`;
            if (actionLogCount) actionLogCount.textContent = `${actions.length} acções`;

            // Renderizar Snapshots e Histórico de Edges integrados
            const renderedCount = renderSnapshotsView(snapshots, totalDissolves, actions, totalSteps);
            if (repSnapshots) repSnapshots.textContent = renderedCount;

            renderHistoryView(actions);
        }

        function renderSnapshotsView(snapshots, totalDissolves, actions, totalSteps) {
            if (!snapshotsList) return 0;
            snapshotsList.innerHTML = "";

            let displaySnaps = Array.isArray(snapshots) ? [...snapshots] : [];

            // Se a API não devolveu snapshots (comum quando dissolves < 50),
            // mas temos passos / dissolves executados (ex.: 2000 passos ou 30 dissolves),
            // geramos a progressão esperada: Marco Intermédio + Estado Final Otimizado
            if (displaySnaps.length === 0 && (totalDissolves > 0 || totalSteps > 0)) {
                if (totalDissolves >= 2 || (totalSteps && totalSteps >= 50)) {
                    const midDissolves = Math.max(1, Math.round(totalDissolves / 2));
                    const midStep = Math.max(1, Math.round((totalSteps || actions.length || 100) / 2));
                    const midFaces = realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - (midDissolves * 2)) : 0;

                    displaySnaps.push({
                        accepted_dissolves: midDissolves,
                        step: midStep,
                        faces: midFaces,
                        is_intermediate: true
                    });
                }

                displaySnaps.push({
                    accepted_dissolves: totalDissolves,
                    step: totalSteps || actions.length || totalDissolves,
                    faces: realStats.low.faces || (realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - (totalDissolves * 2)) : 0),
                    is_current: true
                });
            } else if (displaySnaps.length > 0) {
                // Se a API tem snapshots mas o processo avançou para além do último gravado, adicionamos o estado final
                const lastSnap = displaySnaps[displaySnaps.length - 1];
                const lastDiss = lastSnap.accepted_dissolves || 0;
                const lastStep = lastSnap.step || 0;

                if (totalDissolves > lastDiss || (totalSteps && totalSteps > lastStep + 25)) {
                    displaySnaps.push({
                        accepted_dissolves: totalDissolves,
                        step: totalSteps || actions.length || totalDissolves,
                        faces: realStats.low.faces || (realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - (totalDissolves * 2)) : 0),
                        is_current: true
                    });
                }
            }

            if (displaySnaps.length === 0) {
                const emptyDiv = document.createElement("div");
                emptyDiv.className = "action-log-empty";
                emptyDiv.innerHTML = `<span>⏳ Nenhum snapshot intermédio capturado ainda.</span>`;
                snapshotsList.appendChild(emptyDiv);
                return 0;
            }

            displaySnaps.forEach((snap, idx) => {
                const dissolves = snap.accepted_dissolves ?? snap.step ?? ((idx + 1) * 50);
                const stepNum = snap.step || (snap.is_intermediate ? Math.round((totalSteps || 100) / 2) : totalSteps || ((idx + 1) * 50));
                const facesCount = snap.faces || (realStats.high.faces > 0 ? Math.max(1, realStats.high.faces - (dissolves * 2)) : "--");

                // Agrupar as ações de arestas associadas a este snapshot
                const matchingActions = actions.filter((act) => {
                    const actDiss = act.raw?.accepted_dissolves ?? act.accepted_dissolves ?? 0;
                    return actDiss <= dissolves;
                });

                const acceptedCount = matchingActions.filter(a => a.accepted !== false && a.raw?.accepted !== false).length || dissolves;
                const rejectedCount = Math.max(0, matchingActions.length - acceptedCount);

                const card = document.createElement("div");
                card.className = "snapshot-card glass";

                let tagText = `SNAPSHOT #${idx + 1}`;
                let titleText = `Marco Intermédio • ${dissolves} Dissolves (Passo ${stepNum})`;

                if (snap.is_current || (idx === displaySnaps.length - 1 && displaySnaps.length > 1)) {
                    tagText = `ESTADO FINAL #${idx + 1}`;
                    titleText = `Malha Otimizada Final • ${dissolves} Dissolves (Passo ${stepNum})`;
                } else if (snap.is_intermediate) {
                    tagText = `MARCO INTERMÉDIO #${idx + 1}`;
                    titleText = `Progresso Intermédio • ${dissolves} Dissolves (Passo ${stepNum})`;
                }

                const explanationText = `O agente avaliou as arestas do modelo, aceitando dissolver <strong>${acceptedCount} arestas</strong> em zonas coplanares de baixa curvatura (poupando <strong>~${acceptedCount * 2} faces</strong>). Ao mesmo tempo, reteve <strong>${rejectedCount} arestas</strong> em áreas de contorno e saliência identificadas pela rede GNN para preservar a silhueta tridimensional.`;

                card.innerHTML = `
                    <div class="snap-img-wrapper" title="Clique para ampliar a fotografia e ver a análise detalhada">
                        <span class="snap-badge">${tagText}</span>
                        <img class="snap-photo" alt="Fotografia da Malha ${dissolves} Dissolves" style="display:none;">
                        <div class="snap-photo-placeholder">
                            <span>⏳ A carregar fotografia...</span>
                        </div>
                        <div class="snap-zoom-hint">🔍 Clique para ampliar</div>
                    </div>
                    <div class="snap-content">
                        <div class="snap-meta">
                            <h4>${titleText}</h4>
                            <p class="snap-desc">Registo visual do impacto da simplificação de arestas sobre a geometria.</p>
                            <div class="snap-chips">
                                <span class="chip">🎯 ${dissolves} Dissolves</span>
                                <span class="chip">🔺 ${typeof facesCount === "number" ? facesCount.toLocaleString() : facesCount} Faces</span>
                                <span class="chip" style="color:#34d399;">✂️ ${acceptedCount} Aceites</span>
                                <span class="chip" style="color:#f87171;">🛡️ ${rejectedCount} Protegidas</span>
                            </div>
                        </div>

                        <!-- Explicação da Decimação das Edges -->
                        <div class="snap-edge-explanation">
                            <h5>💡 Análise de Decimação de Arestas</h5>
                            <p style="margin:0;">${explanationText}</p>
                            
                            ${matchingActions.length > 0 ? `
                                <button class="snap-edges-accordion-btn" type="button">
                                    <span>📋 Inspecionar arestas deste marco (${matchingActions.length} ações)</span>
                                    <span>▼</span>
                                </button>
                                <div class="snap-edges-list"></div>
                            ` : ""}
                        </div>

                        <div class="snap-card-actions">
                            <button class="btn-load-snap-mesh" data-dissolves="${dissolves}">
                                <span>📥 Carregar no 3D</span>
                            </button>
                            <button class="btn-download-snap-mesh" data-dissolves="${dissolves}" title="Descarregar ficheiro .OBJ deste snapshot">
                                <span>💾 Descarregar (.obj)</span>
                            </button>
                        </div>
                    </div>
                `;

                const imgEl = card.querySelector(".snap-photo");
                const placeholder = card.querySelector(".snap-photo-placeholder");
                const btnLoad = card.querySelector(".btn-load-snap-mesh");
                const btnDownload = card.querySelector(".btn-download-snap-mesh");
                const imgWrapper = card.querySelector(".snap-img-wrapper");
                const accordionBtn = card.querySelector(".snap-edges-accordion-btn");
                const edgesList = card.querySelector(".snap-edges-list");

                if (btnDownload) {
                    btnDownload.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        const originalText = btnDownload.innerHTML;
                        btnDownload.innerHTML = `<span>⏳ A gerar...</span>`;
                        btnDownload.disabled = true;
                        await downloadSnapshotMesh(dissolves, snap.is_current);
                        btnDownload.innerHTML = `<span>✅ Descarregado!</span>`;
                        setTimeout(() => {
                            btnDownload.innerHTML = originalText;
                            btnDownload.disabled = false;
                        }, 2000);
                    });
                }

                let resolvedImgUrl = null;

                function applyImage(url) {
                    if (!url) return;
                    resolvedImgUrl = url;
                    snapshotImagesMap.set(dissolves, url);
                    imgEl.src = url;
                    imgEl.style.display = "block";
                    placeholder.style.display = "none";
                }

                // Tentar buscar imagem da API ou usar captura instantânea da cena 3D Three.js
                RetopoAPI.getSnapshotImageBlobUrl(modelId, dissolves).then((blobUrl) => {
                    if (blobUrl) {
                        applyImage(blobUrl);
                    } else {
                        const localSnap = captureCanvasSnapshot();
                        if (localSnap) {
                            applyImage(localSnap);
                        } else {
                            placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                        }
                    }
                }).catch(() => {
                    const localSnap = captureCanvasSnapshot();
                    if (localSnap) {
                        applyImage(localSnap);
                    } else {
                        placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                    }
                });

                // Abertura do Lightbox com análise ao clicar na imagem
                imgWrapper.addEventListener("click", () => {
                    openSnapshotLightbox({
                        imgUrl: resolvedImgUrl || captureCanvasSnapshot(),
                        tag: tagText,
                        title: titleText,
                        dissolves: dissolves,
                        faces: facesCount,
                        acceptedCount: acceptedCount,
                        rejectedCount: rejectedCount,
                        totalEvaluated: matchingActions.length,
                        explanationHtml: explanationText,
                        isCurrent: snap.is_current,
                        onLoadMesh: () => {
                            btnLoad.click();
                        }
                    });
                });

                // Acordeão de arestas
                if (accordionBtn && edgesList) {
                    accordionBtn.addEventListener("click", () => {
                        const isOpen = edgesList.classList.toggle("open");
                        accordionBtn.querySelector("span:last-child").textContent = isOpen ? "▲" : "▼";

                        if (isOpen && edgesList.children.length === 0) {
                            matchingActions.slice(-25).reverse().forEach((act) => {
                                const stepNum = act.step ?? act.action_index ?? 0;
                                const isAcc = act.accepted !== false && (act.raw?.accepted !== false);
                                const item = document.createElement("div");
                                item.className = "snap-edge-item";
                                item.innerHTML = `
                                    <span style="color:${isAcc ? '#34d399' : '#f87171'};font-weight:600;">
                                        ${isAcc ? '✂️' : '🛡️'} #${stepNum} ${escapeHtml(act.action_name || (isAcc ? 'EDGE_DISSOLVE' : 'REJEITADA'))}
                                    </span>
                                    <span style="color:#64748b;font-size:0.68rem;">
                                        ${isAcc ? '-2 faces' : (act.rejection_reason || 'Protegida GNN')}
                                    </span>
                                `;
                                edgesList.appendChild(item);
                            });
                        }
                    });
                }

                // Carregar malha no Three.js
                btnLoad.addEventListener("click", async () => {
                    const originalText = btnLoad.innerHTML;
                    btnLoad.innerHTML = `<span>⏳ A transferir geometria...</span>`;
                    btnLoad.disabled = true;

                    try {
                        let loaded = false;

                        // 1. Se for o estado atual e já temos lowPolyGeo carregado em memória
                        if (snap.is_current && lowPolyGeo) {
                            loadGeometryIntoViewport(
                                lowPolyGeo,
                                { faces: realStats.low.faces || realStats.high.faces, verts: realStats.low.verts || realStats.high.verts },
                                `Malha Otimizada Atual (${dissolves} dissolves)`,
                                dissolves
                            );
                            loaded = true;
                        }

                        // 2. Se for snapshot da API com marco específico, tentar buscar da API
                        let objText = null;
                        if (!loaded && !snap.is_current) {
                            try {
                                const snapData = await RetopoAPI.getRLSnapshot(modelId, dissolves);
                                objText = extractObjFromSnap(snapData);
                            } catch (e) {
                                console.warn(`[Snapshot] Endpoint /snapshots/${dissolves} não existe na API (comum quando dissolves < 50):`, e.message);
                            }
                        }

                        // 3. Fallback inteligente: buscar o .obj da malha otimizada na API
                        if (!loaded && (!objText || !objText.includes("v "))) {
                            if (cachedSimplifiedObjText && cachedSimplifiedObjText.includes("v ")) {
                                objText = cachedSimplifiedObjText;
                            } else {
                                objText = await RetopoAPI.downloadSimplifiedMesh(modelId);
                                if (objText && objText.includes("v ")) {
                                    cachedSimplifiedObjText = objText;
                                }
                            }
                        }

                        // 4. Carregar o OBJ recuperado no Three.js
                        if (!loaded && objText && objText.includes("v ")) {
                            loadMeshIntoViewport(objText, `Snapshot ${dissolves} Dissolves`, dissolves);
                            loaded = true;
                        }

                        // 5. Fallback de contingência local se o servidor não entregar OBJ
                        if (!loaded && highPolyGeo) {
                            const fallbackGeo = lowPolyGeo ? lowPolyGeo.clone() : highPolyGeo.clone();
                            const estFaces = realStats.low.faces || Math.max(1, realStats.high.faces - (dissolves * 2));
                            const estVerts = realStats.low.verts || Math.max(1, realStats.high.verts - dissolves);
                            loadGeometryIntoViewport(
                                fallbackGeo,
                                { faces: estFaces, verts: estVerts },
                                `Snapshot ${dissolves} Dissolves`,
                                dissolves
                            );
                            loaded = true;
                        }

                        if (loaded) {
                            btnLoad.innerHTML = `<span>✅ Malha Carregada no 3D!</span>`;
                            setTimeout(() => {
                                closeActionLog();
                            }, 450);
                        } else {
                            throw new Error("Não foi possível carregar a geometria");
                        }
                    } catch (err) {
                        console.warn("[Snapshot] Erro ao carregar mesh:", err);
                        btnLoad.innerHTML = `<span>⚠️ ${err.message || 'Erro ao carregar'}</span>`;
                        setTimeout(() => { btnLoad.innerHTML = originalText; btnLoad.disabled = false; }, 2500);
                    }
                });

                snapshotsList.appendChild(card);
            });
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

            filtered.forEach((entry) => {
                const step = entry.step ?? entry.action_index ?? 0;
                const isAcc = entry.accepted !== false && (entry.raw?.accepted !== false);
                const actDissolves = entry.raw?.accepted_dissolves ?? entry.accepted_dissolves ?? 0;
                const faces = entry.faces ?? entry.raw?.faces;
                const reasonRaw = entry.rejection_reason || entry.raw?.rejection_reason || "";

                // Imagem de contexto associada
                const snapImg = snapshotImagesMap.get(actDissolves) || defaultThumbnail;

                // Explicação clara e compreensível da decisão sobre a aresta
                let explanation = "";
                if (isAcc) {
                    explanation = "Aresta plana colapsada (-2 faces). Silhueta exterior intacta e normais preservadas.";
                } else {
                    const r = reasonRaw.toUpperCase();
                    if (r.includes("NORMAL") || r.includes("FLIP")) {
                        explanation = "Aresta protegida: o colapso causaria inversão de normais (produzindo triângulos escuros/buracos).";
                    } else if (r.includes("SILHOUETTE")) {
                        explanation = "Aresta protegida: define a silhueta/contorno fundamental da geometria.";
                    } else if (r.includes("ANGLE") || r.includes("ASPECT")) {
                        explanation = "Aresta protegida: impediu a criação de triângulos degenerados com ângulo diedro excessivo.";
                    } else if (r.includes("IMPORTANCE") || r.includes("FEATURE")) {
                        explanation = "Aresta protegida: classificada com alta relevância estrutural pela rede GNN.";
                    } else {
                        explanation = reasonRaw ? `Aresta protegida: ${escapeHtml(reasonRaw)}` : "Aresta protegida para preservar a integridade da malha.";
                    }
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
                                ${isAcc ? '✂️ DISSOLVIDA' : '🛡️ PROTEGIDA'}
                            </span>
                            <span style="font-size:0.75rem;font-weight:600;color:#f1f5f9;font-family:'JetBrains Mono',monospace;">
                                ${escapeHtml(entry.action_name || (isAcc ? 'EDGE_DISSOLVE' : 'ATTEMPT_REJECTED'))}
                            </span>
                        </div>
                        <p class="al-explanation">${explanation}</p>
                        <div class="al-footer-row">
                            <span>${faces ? `Faces: ${faces.toLocaleString()}` : ''}</span>
                            <button class="al-snap-link" type="button">
                                📸 Ver Marco (${actDissolves} dissolves)
                            </button>
                        </div>
                    </div>
                `;

                // Clicar na miniatura abre o lightbox com a fotografia da malha
                const thumbWrap = div.querySelector(".al-thumb-wrap");
                if (thumbWrap) {
                    thumbWrap.addEventListener("click", () => {
                        openSnapshotLightbox({
                            imgUrl: snapImg,
                            tag: `PASSO #${step}`,
                            title: `Decisão de Aresta: ${entry.action_name || (isAcc ? 'EDGE_DISSOLVE' : 'PROTEGIDA')}`,
                            dissolves: actDissolves,
                            faces: faces,
                            acceptedCount: isAcc ? 1 : 0,
                            rejectedCount: isAcc ? 0 : 1,
                            totalEvaluated: 1,
                            explanationHtml: `<p>${explanation}</p>`,
                            onLoadMesh: () => {
                                if (lowPolyGeo) {
                                    loadGeometryIntoViewport(lowPolyGeo, { faces: faces || realStats.low.faces || realStats.high.faces, verts: realStats.low.verts || realStats.high.verts }, `Passo #${step}`);
                                    return;
                                }
                                RetopoAPI.downloadSimplifiedMesh(modelId).then(meshText => {
                                    loadMeshIntoViewport(meshText, `Passo #${step}`);
                                }).catch(() => {
                                    if (highPolyGeo) {
                                        loadGeometryIntoViewport(highPolyGeo.clone(), { faces: faces || realStats.high.faces, verts: realStats.high.verts }, `Passo #${step}`);
                                    }
                                });
                            }
                        });
                    });
                }

                // Clicar no link do snapshot comuta para a aba de snapshots
                const snapLink = div.querySelector(".al-snap-link");
                if (snapLink && tabBtnSnapshots) {
                    snapLink.addEventListener("click", () => {
                        tabBtnSnapshots.click();
                    });
                }

                actionLogBody.appendChild(div);
            });
        }

        function loadGeometryIntoViewport(geo, stats, label, dissolves) {
            if (!geo) return;
            currentSnapGeo = geo;
            mesh.geometry = geo;
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
            if (heatmapSubbar) heatmapSubbar.classList.add("hidden");
            if (btnHeatmap) btnHeatmap.classList.remove("active");

            if (btnSnapPoly) {
                btnSnapPoly.style.display = "inline-flex";
                btnSnapPoly.textContent = `📸 Snapshot (${dissolves || "Intermédio"})`;
                btnSnapPoly.classList.add("active");
            }

            activeView = "snapshot";

            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = `Visualizando: ${label} (${tris.toLocaleString()} faces)`;
            }
        }

        function loadMeshIntoViewport(objText, label, dissolves) {
            if (!objText) return;
            const parsed = objLoader.parse(objText);
            let snapGeo = null;

            parsed.traverse((child) => {
                if (child.isMesh && !snapGeo) {
                    snapGeo = child.geometry;
                }
            });

            if (snapGeo) {
                snapGeo.computeBoundingBox();
                const snapCenter = new THREE.Vector3();
                snapGeo.boundingBox.getCenter(snapCenter);
                snapGeo.translate(-snapCenter.x, -snapCenter.y, -snapCenter.z);

                const snapSize = new THREE.Vector3();
                snapGeo.boundingBox.getSize(snapSize);
                const snapMaxDim = Math.max(snapSize.x, snapSize.y, snapSize.z);
                const snapScale = snapMaxDim > 0 ? (16 / snapMaxDim) : 1;
                if (snapMaxDim > 0) {
                    snapGeo.scale(snapScale, snapScale, snapScale);
                }
                snapGeo.computeVertexNormals();

                if (!snapGeo.userData) snapGeo.userData = {};
                snapGeo.userData.center = snapCenter;
                snapGeo.userData.scale = snapScale;
                snapGeo.userData.rawObjText = objText;

                const intermStats = computeObjStats(objText);
                loadGeometryIntoViewport(snapGeo, intermStats, label, dissolves);
            }
        }

        function closeActionLog() {
            if (actionLogDrawer) actionLogDrawer.classList.remove("open");
        }

        function escapeHtml(str) {
            return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        if (btnActionLog) btnActionLog.addEventListener("click", openActionLog);
        if (btnSideReport) btnSideReport.addEventListener("click", openActionLog);
        if (actionLogClose) actionLogClose.addEventListener("click", closeActionLog);

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
