(() => {
    // ══════════════════════════════════════════════════════
    //  DOM ELEMENTS & SETUP
    // ══════════════════════════════════════════════════════
    const uploadModal    = document.getElementById("upload-modal");
    const dropZone       = document.getElementById("drop-zone");
    const uploadProgress = document.getElementById("upload-progress");
    const progressBar    = document.getElementById("progress-bar");
    const mainApp        = document.getElementById("main-app");
    const fileInput      = document.getElementById("file-input");
    const loadingStatus  = document.getElementById("loading-status");
    const rlStatusBadge  = document.getElementById("rl-status-badge");

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
    //  FLUXO DE UPLOAD DO MODELO
    // ══════════════════════════════════════════════════════
    async function startUploadFlow(fileObj) {
        if (!fileObj) return;

        dropZone.style.display = "none";
        uploadProgress.style.display = "block";
        progressBar.style.width = "0%";
        loadingStatus.innerText = `A carregar ${fileObj.name}...`;

        const fileUrl = URL.createObjectURL(fileObj);

        try {
            // 1. Ler o texto do ficheiro OBJ para extrair métricas 100% REAIS
            const fileText = await fileObj.text();
            const extracted = computeObjStats(fileText);
            realStats.high.verts = extracted.verts;
            realStats.high.faces = extracted.faces;

            // 2. Upload para a API com X-Upload-Size e X-API-Key
            const modelId = await RetopoAPI.uploadModel(fileObj, (progress) => {
                progressBar.style.width = `${Math.min(progress, 100)}%`;
            });

            if (!modelId) {
                throw new Error("A API não devolveu mesh_id.");
            }

            loadingStatus.innerText = "Upload concluído com sucesso!";

            // 3. Exibir aplicação
            uploadModal.classList.add("hidden");
            mainApp.style.filter = "none";
            mainApp.style.pointerEvents = "all";

            // 4. Iniciar visualizador 3D com dados reais
            initThreeJS(modelId, fileUrl, fileText);

        } catch (error) {
            console.error("Erro no upload:", error);
            loadingStatus.innerText = `Erro: ${error.message}`;

            dropZone.style.display = "block";
            uploadProgress.style.display = "none";
            progressBar.style.width = "0%";

            URL.revokeObjectURL(fileUrl);
            fileInput.value = "";
        }
    }

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            startUploadFlow(e.target.files[0]);
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
            startUploadFlow(e.dataTransfer.files[0]);
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

        const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
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
            wireframe: false
        });

        let heatmapMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.1,
            wireframe: false
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
        if (maxDim > 0) {
            const scale = 16 / maxDim;
            highPolyGeo.scale(scale, scale, scale);
        }
        highPolyGeo.computeVertexNormals();

        const mesh = new THREE.Mesh(highPolyGeo, baseMaterial);
        scene.add(mesh);

        // Loop de Renderização
        function animate() {
            requestAnimationFrame(animate);
            mesh.rotation.y += 0.004;
            mesh.rotation.x += 0.0015;
            renderer.render(scene, camera);
        }
        animate();

        // ══════════════════════════════════════════════════════
        //  ELEMENTOS DE UI & CONTROLO
        // ══════════════════════════════════════════════════════
        const btnHigh       = document.getElementById("btn-high-poly");
        const btnLow        = document.getElementById("btn-low-poly");
        const btnWire       = document.getElementById("btn-wireframe");
        const btnHeatmap    = document.getElementById("btn-heatmap");

        const appSidebar         = document.getElementById("app-sidebar");
        const btnCollapseSidebar = document.getElementById("btn-collapse-sidebar");
        const btnExpandSidebar   = document.getElementById("btn-expand-sidebar");

        const valTris       = document.getElementById("val-tris");
        const valVerts      = document.getElementById("val-verts");

        const sideRlStatus  = document.getElementById("side-rl-status");
        const sideReduction = document.getElementById("side-face-reduction");
        const sideDissolves = document.getElementById("side-dissolves");
        const sideSteps     = document.getElementById("side-steps");

        const sideGnnStatus = document.getElementById("side-gnn-status");
        const sideGnnVerts  = document.getElementById("side-gnn-verts");
        const sideGnnCrit   = document.getElementById("side-gnn-critical");

        const sideHighInfo  = document.getElementById("side-high-info");
        const sideLowInfo   = document.getElementById("side-low-info");

        const btnSideReport = document.getElementById("btn-side-report");
        const btnSideGnn    = document.getElementById("btn-side-gnn");

        // Controlo de Colapso/Expansão do Painel Lateral
        if (btnCollapseSidebar && appSidebar) {
            btnCollapseSidebar.addEventListener("click", () => {
                appSidebar.classList.add("collapsed");
                if (btnExpandSidebar) btnExpandSidebar.style.display = "flex";
                setTimeout(() => window.dispatchEvent(new Event("resize")), 360);
            });
        }

        if (btnExpandSidebar && appSidebar) {
            btnExpandSidebar.addEventListener("click", () => {
                appSidebar.classList.remove("collapsed");
                btnExpandSidebar.style.display = "none";
                setTimeout(() => window.dispatchEvent(new Event("resize")), 360);
            });
        }

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

        // Inicialmente o Low Poly está em processamento
        btnLow.disabled = true;
        btnLow.style.opacity = "0.45";
        btnLow.style.cursor = "not-allowed";
        btnLow.innerText = "🔒 A Otimizar...";

        // ══════════════════════════════════════════════════════
        //  CONTROLOS DE VISUALIZAÇÃO (ORIGINAL, LOW, WIREFRAME, HEATMAP)
        // ══════════════════════════════════════════════════════
        btnHigh.addEventListener("click", () => {
            mesh.geometry = highPolyGeo;
            mesh.material = (btnHeatmap && btnHeatmap.classList.contains("active")) ? heatmapMaterial : baseMaterial;
            btnHigh.classList.add("active");
            btnLow.classList.remove("active");
            activeView = "high";
            updateFloatingStats(realStats.high.verts, realStats.high.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Original (High Poly)";
            }
        });

        btnLow.addEventListener("click", () => {
            if (btnLow.disabled || !lowPolyGeo) return;
            mesh.geometry = lowPolyGeo;
            mesh.material = baseMaterial; // Heatmap GNN aplica-se ao High Poly
            btnLow.classList.add("active");
            btnHigh.classList.remove("active");
            if (btnHeatmap) btnHeatmap.classList.remove("active");
            activeView = "low";
            updateFloatingStats(realStats.low.verts, realStats.low.faces);
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge online";
                rlStatusBadge.textContent = "Visualizando: Otimizado (Low Poly)";
            }
        });

        btnWire.addEventListener("click", () => {
            btnWire.classList.toggle("active");
            const isWire = btnWire.classList.contains("active");
            baseMaterial.wireframe = isWire;
            heatmapMaterial.wireframe = isWire;
        });

        // ══════════════════════════════════════════════════════
        //  HEATMAP GNN REAL (POST /predict + GET /scores)
        // ══════════════════════════════════════════════════════
        let gnnLoaded = false;
        let isGnnComputing = false;

        async function ensureGNNHeatmap() {
            if (gnnLoaded) {
                mesh.material = heatmapMaterial;
                return;
            }
            if (isGnnComputing) return;
            isGnnComputing = true;

            if (sideGnnStatus) sideGnnStatus.textContent = "Calculando...";
            if (rlStatusBadge) {
                rlStatusBadge.className = "status-badge working";
                rlStatusBadge.textContent = "GNN: A calcular scores...";
            }

            try {
                // 1. Executar predição da rede neuronal
                await RetopoAPI.predictGNN(modelId);

                // 2. Descarregar scores CSV dos vértices
                const scoresCsv = await RetopoAPI.getGNNScores(modelId);

                // 3. Processar CSV e mapear importância
                const lines = scoresCsv.trim().split(/\r?\n/);
                const scoreEntries = [];
                let criticalCount = 0;
                let minImp = Infinity;
                let maxImp = -Infinity;

                for (let i = 1; i < lines.length; i++) {
                    const row = lines[i].split(",");
                    if (row.length >= 5) {
                        const x = parseFloat(row[1]);
                        const y = parseFloat(row[2]);
                        const z = parseFloat(row[3]);
                        const imp = parseFloat(row[4]);
                        const keep = parseInt(row[5] || "0", 10);

                        if (keep === 1) criticalCount++;
                        if (imp < minImp) minImp = imp;
                        if (imp > maxImp) maxImp = imp;

                        scoreEntries.push({ x, y, z, imp, keep });
                    }
                }

                if (minImp === maxImp) { minImp = 0; maxImp = 1; }

                // 4. Mapear cores para os vértices do Three.js BufferGeometry
                const posAttr = highPolyGeo.attributes.position;
                const colors = new Float32Array(posAttr.count * 3);

                for (let i = 0; i < posAttr.count; i++) {
                    let bestScore = 0.5;
                    if (i < scoreEntries.length) {
                        bestScore = scoreEntries[i].imp;
                    } else if (scoreEntries.length > 0) {
                        bestScore = scoreEntries[i % scoreEntries.length].imp;
                    }

                    const norm = (bestScore - minImp) / (maxImp - minImp || 1);
                    const c = importanceToColor(norm);

                    colors[i * 3]     = c.r;
                    colors[i * 3 + 1] = c.g;
                    colors[i * 3 + 2] = c.b;
                }

                highPolyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
                heatmapMaterial.vertexColors = true;
                heatmapMaterial.needsUpdate = true;

                // 5. Atualizar interface com dados reais
                gnnLoaded = true;
                if (sideGnnStatus) sideGnnStatus.textContent = "Heatmap Ativo";
                if (sideGnnCrit) sideGnnCrit.textContent = criticalCount.toLocaleString();

                // Aplicar à malha
                mesh.material = heatmapMaterial;

                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge online";
                    rlStatusBadge.textContent = "GNN: Heatmap Aplicado";
                }

            } catch (err) {
                console.warn("[GNN] Falha na API GNN:", err.message);
                if (sideGnnStatus) sideGnnStatus.textContent = "Erro na API";
                if (btnHeatmap) btnHeatmap.classList.remove("active");
            } finally {
                isGnnComputing = false;
            }
        }

        if (btnHeatmap) {
            btnHeatmap.addEventListener("click", async () => {
                btnHeatmap.classList.toggle("active");
                const isAct = btnHeatmap.classList.contains("active");
                if (isAct) {
                    if (activeView === "low") {
                        btnHigh.click();
                    }
                    await ensureGNNHeatmap();
                } else {
                    mesh.material = baseMaterial;
                    if (sideGnnStatus && gnnLoaded) sideGnnStatus.textContent = "Pronto";
                }
            });
        }

        if (btnSideGnn) {
            btnSideGnn.addEventListener("click", async () => {
                if (btnHeatmap) btnHeatmap.classList.add("active");
                btnHigh.click();
                await ensureGNNHeatmap();
            });
        }

        // ══════════════════════════════════════════════════════
        //  EXECUÇÃO REAL DO AGENTE RL (POST /v1/rl/simplify)
        // ══════════════════════════════════════════════════════
        if (sideRlStatus) sideRlStatus.textContent = "Otimizando...";
        if (rlStatusBadge) {
            rlStatusBadge.className = "status-badge working";
            rlStatusBadge.textContent = "RL: A Otimizar...";
        }

        RetopoAPI.startRLDecimation(modelId,
            // onRLStep: cada passo transmitido
            (stepData) => {
                if (sideSteps) sideSteps.textContent = stepData.step;
                if (stepData.raw_action) {
                    if (sideDissolves) {
                        sideDissolves.textContent = stepData.raw_action.accepted_dissolves ?? "--";
                    }
                }
                if (typeof window.appendActionLogEntry === "function") {
                    window.appendActionLogEntry(stepData);
                }
            },
            // onComplete: decimação concluída
            async (simplifyResult) => {
                if (sideRlStatus) sideRlStatus.textContent = "Concluído";
                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge online";
                    rlStatusBadge.textContent = "RL: Decimação Concluída";
                }

                // Descarregar a malha .obj real otimizada da API
                try {
                    const lowPolyText = await RetopoAPI.downloadSimplifiedMesh(modelId);
                    if (lowPolyText && lowPolyText.includes("v ")) {
                        // Calcular dados 100% reais do Low Poly
                        const lowStats = computeObjStats(lowPolyText);
                        realStats.low.verts = lowStats.verts;
                        realStats.low.faces = lowStats.faces;

                        // Atualizar métricas na barra lateral
                        if (sideLowInfo) {
                            sideLowInfo.textContent = `${lowStats.faces.toLocaleString()} faces / ${lowStats.verts.toLocaleString()} vértices`;
                        }

                        if (realStats.high.faces > 0) {
                            const redPct = Math.round((1 - lowStats.faces / realStats.high.faces) * 100);
                            if (sideReduction) sideReduction.textContent = `${Math.max(0, redPct)}%`;
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
                            if (lowMaxDim > 0) {
                                parsedLowGeo.scale(16 / lowMaxDim, 16 / lowMaxDim, 16 / lowMaxDim);
                            }
                            parsedLowGeo.computeVertexNormals();

                            lowPolyGeo = parsedLowGeo;
                        }
                    }
                } catch (err) {
                    console.warn("[Main] Não foi possível carregar o modelo Low Poly da API:", err.message);
                }

                // Desbloquear botão Low Poly
                btnLow.disabled = false;
                btnLow.style.opacity = "1";
                btnLow.style.cursor = "pointer";
                btnLow.innerText = "Otimizado (Low)";
                btnLow.style.boxShadow = "0 0 10px rgba(59, 130, 246, 0.5)";

                // Apresentar automaticamente a malha otimizada ao utilizador!
                btnLow.click();
            }
        );

        // ══════════════════════════════════════════════════════
        //  EXPORTAÇÃO LOW POLY
        // ══════════════════════════════════════════════════════
        const btnExport = document.getElementById("btn-export");
        if (btnExport) {
            btnExport.addEventListener("click", () => {
                if (!window.THREE.OBJExporter) return;
                const exporter = new THREE.OBJExporter();
                const result = exporter.parse(mesh);
                const blob = new Blob([result], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "retopo_lowpoly.obj";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
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

        const actionLogEntries = [];
        let cachedSnapshots    = [];
        let cachedResults      = null;

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

            // Atualizar métricas do relatório
            const totalSteps = results?.steps || actions.length || actionLogEntries.length || 0;
            const totalDissolves = results?.accepted_dissolves ?? actions.filter(a => a.accepted !== false).length;
            const reductionPct = results?.face_reduction
                ? Math.round(results.face_reduction * 100)
                : (realStats.high.faces > 0 && realStats.low.faces > 0
                    ? Math.round((1 - realStats.low.faces / realStats.high.faces) * 100)
                    : 0);

            if (repSteps) repSteps.textContent = totalSteps;
            if (repDissolves) repDissolves.textContent = totalDissolves;
            if (repReduction) repReduction.textContent = `${reductionPct}%`;
            if (repSnapshots) repSnapshots.textContent = snapshots.length;
            if (actionLogCount) actionLogCount.textContent = `${actions.length} acções`;

            // Renderizar Snapshots e Histórico
            renderSnapshotsView(snapshots, totalDissolves);
            renderHistoryView(actions);
        }

        function renderSnapshotsView(snapshots, totalDissolves) {
            if (!snapshotsList) return;
            snapshotsList.innerHTML = "";

            if (!snapshots || snapshots.length === 0) {
                const emptyDiv = document.createElement("div");
                emptyDiv.className = "action-log-empty";

                if (totalDissolves > 0) {
                    emptyDiv.innerHTML = `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:0.8rem;">
                            <span style="color:#60a5fa;font-size:1.1rem;font-weight:600;">⚡ ${totalDissolves} Dissolves Realizados</span>
                            <p style="color:#94a3b8;font-size:0.82rem;max-width:320px;line-height:1.4;">
                                Os snapshots são registados pela API a cada <strong>50 dissolves aceites</strong>.
                            </p>
                            <button class="btn btn-outline" id="btn-load-current-interm" style="font-size:0.8rem;padding:0.4rem 0.8rem;">
                                📥 Inspecionar Malha Otimizada Atual
                            </button>
                        </div>
                    `;
                    snapshotsList.appendChild(emptyDiv);

                    const btnInspect = emptyDiv.querySelector("#btn-load-current-interm");
                    if (btnInspect) {
                        btnInspect.addEventListener("click", async () => {
                            btnInspect.textContent = "⏳ A carregar malha...";
                            try {
                                const objText = await RetopoAPI.downloadSimplifiedMesh(modelId);
                                loadMeshIntoViewport(objText, `Estado Atual (${totalDissolves} dissolves)`);
                                btnInspect.textContent = "✅ Malha Carregada no 3D!";
                            } catch {
                                btnInspect.textContent = "⚠️ Não disponível";
                            }
                        });
                    }
                } else {
                    emptyDiv.innerHTML = `<span>⏳ Nenhum snapshot capturado ainda.</span>`;
                    snapshotsList.appendChild(emptyDiv);
                }
                return;
            }

            snapshots.forEach((snap, idx) => {
                const dissolves = snap.accepted_dissolves ?? snap.step ?? ((idx + 1) * 50);
                const card = document.createElement("div");
                card.className = "snapshot-card glass";
                card.innerHTML = `
                    <div class="snap-img-wrapper">
                        <span class="snap-badge">SNAPSHOT #${idx + 1}</span>
                        <img class="snap-photo" alt="Fotografia Snapshot ${dissolves}" style="display:none;">
                        <div class="snap-photo-placeholder">
                            <span>⏳ A carregar fotografia...</span>
                        </div>
                    </div>
                    <div class="snap-content">
                        <div class="snap-meta">
                            <h4>Estado Intermédio • ${dissolves} Dissolves</h4>
                            <p class="snap-desc">Marco gerado pelo agente durante o processo de simplificação.</p>
                            <div class="snap-chips">
                                <span class="chip">🎯 Dissolves: ${dissolves}</span>
                                ${snap.faces ? `<span class="chip">🔺 Faces: ${snap.faces.toLocaleString()}</span>` : ""}
                            </div>
                        </div>
                        <button class="btn-load-snap-mesh" data-dissolves="${dissolves}">
                            <span>📥 Carregar Mesh Intermédia no 3D</span>
                        </button>
                    </div>
                `;

                const imgEl = card.querySelector(".snap-photo");
                const placeholder = card.querySelector(".snap-photo-placeholder");
                const btnLoad = card.querySelector(".btn-load-snap-mesh");

                // Carregar foto com chave de autenticação
                RetopoAPI.getSnapshotImageBlobUrl(modelId, dissolves).then((blobUrl) => {
                    if (blobUrl) {
                        imgEl.src = blobUrl;
                        imgEl.style.display = "block";
                        placeholder.style.display = "none";
                    } else {
                        placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                    }
                }).catch(() => {
                    placeholder.innerHTML = "<span>📷 Sem fotografia</span>";
                });

                // Carregar mesh intermédia no Three.js
                btnLoad.addEventListener("click", async () => {
                    const originalText = btnLoad.innerHTML;
                    btnLoad.innerHTML = `<span>⏳ A transferir geometria...</span>`;
                    btnLoad.disabled = true;

                    try {
                        const snapData = await RetopoAPI.getRLSnapshot(modelId, dissolves);
                        let objText = "";
                        if (typeof snapData === "string" && snapData.includes("v ")) {
                            objText = snapData;
                        } else if (snapData?.obj_data) {
                            objText = snapData.obj_data;
                        }

                        if (objText && objText.includes("v ")) {
                            loadMeshIntoViewport(objText, `Snapshot ${dissolves} Dissolves`);
                            btnLoad.innerHTML = `<span>✅ Malha Carregada no 3D!</span>`;
                        } else {
                            throw new Error("Formato inválido");
                        }
                    } catch (err) {
                        btnLoad.innerHTML = `<span>⚠️ Erro ao carregar</span>`;
                        setTimeout(() => { btnLoad.innerHTML = originalText; btnLoad.disabled = false; }, 2500);
                    }
                });

                snapshotsList.appendChild(card);
            });
        }

        function renderHistoryView(actions) {
            if (!actionLogBody) return;
            actionLogBody.innerHTML = "";

            if (!actions || actions.length === 0) {
                actionLogBody.innerHTML = `<div class="action-log-empty"><span>⏳ Aguarda o início da simulação RL...</span></div>`;
                return;
            }

            actions.forEach((entry) => {
                const step = entry.step ?? entry.action_index ?? 0;
                let msg = entry.log_message || entry.message;
                if (!msg && entry.action_name) {
                    const isAcc = entry.accepted !== false;
                    const status = isAcc ? "ACEITE" : "REJEITADO";
                    const reason = entry.rejection_reason ? ` (${entry.rejection_reason})` : "";
                    const faces = entry.faces !== undefined ? ` • Faces: ${entry.faces}` : "";
                    msg = `${entry.action_name} [${status}]${reason}${faces}`;
                } else if (!msg) {
                    msg = JSON.stringify(entry);
                }

                const critical = entry.is_critical ?? (entry.accepted === false);
                const div = document.createElement("div");
                div.className = "al-entry" + (critical ? " critical" : "");
                div.innerHTML = `
                    <span class="al-step-badge">#${step}</span>
                    <span class="al-msg">${escapeHtml(msg)}</span>
                `;
                actionLogBody.appendChild(div);
            });

            actionLogBody.scrollTop = actionLogBody.scrollHeight;
        }

        function loadMeshIntoViewport(objText, label) {
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
                if (snapMaxDim > 0) {
                    snapGeo.scale(16 / snapMaxDim, 16 / snapMaxDim, 16 / snapMaxDim);
                }
                snapGeo.computeVertexNormals();

                mesh.geometry = snapGeo;
                mesh.material = baseMaterial;

                const intermStats = computeObjStats(objText);
                updateFloatingStats(intermStats.verts, intermStats.faces);

                btnHigh.classList.remove("active");
                btnLow.classList.remove("active");
                activeView = "snapshot";

                if (rlStatusBadge) {
                    rlStatusBadge.className = "status-badge online";
                    rlStatusBadge.textContent = `A visualizar: ${label}`;
                }
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
            if (e.key === "Escape" && actionLogDrawer && actionLogDrawer.classList.contains("open")) {
                closeActionLog();
            }
        });

    } // Fim do initThreeJS
})();
