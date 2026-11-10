/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MESH QA / DSS CONTROLLER (UNIFIED STUDIO)
 *  Auditoria e Controlo de Qualidade Topológico de Malhas 3D
 *  Integrado no Viewport 3D Único e Barra Lateral do Retopo Tool
 * ═══════════════════════════════════════════════════════════════════════
 */

(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════
    //  1. DICIONÁRIO DE EXPLICAÇÕES EM PORTUGUÊS (RIGOROSO E DIDÁTICO)
    // ═══════════════════════════════════════════════════════════════════
    const QA_EXPLANATIONS = {
        ngons: {
            title: "N-gons (Faces 5+ Vértices)",
            category: "Topologia",
            severity: "warning",
            color: "#3b82f6", // Azul
            priority: 9,
            what: "Faces compostas por 5 ou mais vértices.",
            why: function(faceData, hasCollinear) {
                let msg = "Importam em pipelines que exigem quads/tris (subdivisão, UVs e game engines), podendo causar deformações e artefactos de sombreamento.";
                if (hasCollinear || (faceData && faceData.max_angle && faceData.max_angle >= 170)) {
                    msg += " NOTA: O count é por vértices; um quad com vértices colineares (ângulo ~180°) conta como n-gon.";
                }
                return msg;
            },
            how: "Subdividir a face em quads ou triângulos usando a ferramenta Knife/Split ou dissolver os vértices colineares redundantes."
        },
        nonmanifold: {
            title: "Arestas Não-Manifold",
            category: "Integridade",
            severity: "critical",
            color: "#f97316", // Laranja vivo
            priority: 2,
            what: "Aresta partilhada por 3 ou mais faces, ou vértices com ligações não contíguas.",
            why: function() {
                return "Quebra operações booleanas, modificadores de subdivisão e impede a impressão 3D (a malha deixa de ser um sólido volumétrico 2-manifold válido).";
            },
            how: "Separar as faces adjacentes excedentes ou remover faces internas que partilham a mesma aresta."
        },
        open_edges: {
            title: "Arestas Abertas (Fronteira)",
            category: "Estanquicidade",
            severity: "warning",
            color: "#eab308", // Amarelo
            priority: 6,
            what: "Arestas de fronteira que pertencem a apenas uma face (aberturas na malha).",
            why: function(faceData, hasTJunction) {
                if (hasTJunction) {
                    return "Fenda decorrente de uma T-junction (onde um vértice vizinho está sobre a aresta mas não foi soldado à face contígua).";
                }
                return "Pode ser um buraco real na geometria OU uma fenda decorrente de uma T-junction (vértice sobre uma aresta que a face vizinha não tem).";
            },
            how: "Fechar o orifício (Fill / Cap Hole) ou fundir os vértices coincidentes por proximidade (Merge by Distance)."
        },
        degenerate: {
            title: "Faces Degeneradas",
            category: "Geometria",
            severity: "critical",
            color: "#ef4444", // Vermelho
            priority: 1,
            what: "Face com área aproximadamente nula ou com vértices repetidos/colapsados.",
            why: function() {
                return "Provoca artefactos graves de sombreamento, divisão por zero no cálculo de normais e instabilidade em simulações físicas.";
            },
            how: "Eliminar as faces degeneradas ou colapsar os vértices redundantes."
        },
        dup_faces: {
            title: "Faces Duplicadas",
            category: "Geometria",
            severity: "warning",
            color: "#d946ef", // Fúcsia
            priority: 7,
            what: "Faces duplicadas sobrepostas exatamente no mesmo espaço 3D.",
            why: function() {
                return "Provoca cintilação severa de renderização (Z-fighting) e aumenta desnecessariamente o peso do modelo.";
            },
            how: "Remover as faces duplicadas através da limpeza de geometria (Delete Duplicate Faces)."
        },
        bad_quads: {
            title: "Quads Deformados",
            category: "Qualidade",
            severity: "warning",
            color: "#06b6d4", // Ciano
            priority: 8,
            what: "Quads com ângulos internos extremos (< mín_ângulo ou > máx_ângulo configurados).",
            why: function() {
                return "Quads com grande distorção provocam estiramento de texturas UV e artefactos de iluminação durante a animação.";
            },
            how: "Suavizar a distribuição dos vértices (Relax / Smooth) ou ajustar o fluxo das arestas."
        },
        flipped: {
            title: "Normais Invertidas",
            category: "Orientação",
            severity: "critical",
            color: "#ec4899", // Rosa choque
            priority: 3,
            what: "Faces com normais invertidas (ordem de enrolamento dos vértices contrária à vizinhança).",
            why: function() {
                return "Faz com que a face pareça invisível ou receba iluminação do lado oposto devido ao backface culling.";
            },
            how: "Recalcular a orientação de todas as normais para o exterior (Recalculate Normals Outside)."
        },
        overlap: {
            title: "Sobreposição de Shells",
            category: "Topologia",
            severity: "warning",
            color: "#8b5cf6", // Púrpura
            priority: 4,
            what: "Uma casca geométrica (shell) contida dentro de outra.",
            why: function() {
                return "Geometria oculta desnecessária que consome memória e pode conflituar em booleanos. NOTA: Não deteta auto-interseção no mesmo shell (ver limitações).";
            },
            how: "Eliminar cascas internas redundantes ou unificar via união booleana limpa."
        },
        poles: {
            title: "Poles (Vértices Não-Regulares)",
            category: "Topologia",
            severity: "info",
            color: "#a855f7", // Lilás
            priority: 10,
            what: "Vértices interiores com valência diferente da regular (4 em quads, 6 em tris).",
            why: function() {
                return "Em malhas low-poly com cantos vivos ou extremidades, valência 3 é natural; em superfícies lisas com subdivisão, polos com valência 3 ou 5+ criam pontos de tensão (pinching).";
            },
            how: "Redirecionar os loopings de aresta (Edge Spin/Slide) para deslocar o polo para zonas planas ou de menor deformação."
        },
        collinear_vertices: {
            title: "Vértices Colineares",
            category: "Otimização",
            severity: "info",
            color: "#14b8a6", // Teal
            priority: 11,
            what: "Vértices de valência 2 com ângulo ~180° entre as arestas adjacentes.",
            why: function() {
                return "São vértices redundantes que aumentam a contagem sem contribuir para a curvatura ou silhueta da peça.";
            },
            how: "Dissolver os vértices colineares (Dissolve Vertices) sem alterar a forma do polígono."
        },
        t_junction: {
            title: "T-Junctions",
            category: "Estanquicidade",
            severity: "critical",
            color: "#f43f5e", // Rosa avermelhado
            priority: 5,
            what: "Vértice pousado sobre a aresta de uma face vizinha sem pertencer à topologia dessa face.",
            why: function() {
                return "Quebra a continuidade da superfície criando micro-fendas visíveis na renderização; a malha deixa de ser hermética (watertight).";
            },
            how: "Inserir um vértice na aresta vizinha e soldar os dois vértices (Snap & Merge), ou triangular a face adjacente para absorver a junção."
        }
    };

    function getCheckInfo(key) {
        if (QA_EXPLANATIONS[key]) {
            return QA_EXPLANATIONS[key];
        }
        return {
            title: key.replace(/_/g, " ").toUpperCase(),
            category: "Verificação",
            severity: "warning",
            color: "#64748b",
            priority: 99,
            what: `Verificação automatizada: ${key}.`,
            why: () => "Potencial anomalia geométrica ou topológica reportada pelo algoritmo.",
            how: "Inspecionar a malha e verificar a integridade dos polígonos afetados."
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. ESTADO GLOBAL DO MESH QA
    // ═══════════════════════════════════════════════════════════════════
    const QAState = {
        activeMeshId: null,
        activeSnapshot: null,
        activeMeshName: "Malha Otimizada Final",
        statusData: null,
        resultData: null,
        rawObjText: null,

        params: {
            min_angle: 20.0,
            max_angle: 160.0,
            regular_valence: 0,
            skip: []
        },

        enabledChecks: {},
        activeViewMode: "none", // 'errors' | 'min_angle' | 'max_angle' | 'valence' | 'none'
        showEdges: true,
        showPoles: true,
        showSurface: true,

        selectedFaceIdx: null,
        selectedVertIdx: null
    };

    // ═══════════════════════════════════════════════════════════════════
    //  3. ESTRUTURAS 3D DO DSS (ADICIONADAS À CENA PRINCIPAL)
    // ═══════════════════════════════════════════════════════════════════
    let dssMesh = null;
    let dssEdgesMesh = null;
    let dssPolesPoints = null;
    let dssSelectionLine = null;

    let qaParsedVertices = [];
    let qaPolygonFaces = [];
    let qaTriangleToFaceMap = [];
    let qaFaceToTrianglesMap = [];
    let qaTriangleVertexIndices = [];
    let qaRaycaster = null;
    let qaMouse = new THREE.Vector2();

    let setViewMode = null;
    let openDSSWindow = null;
    let closeDSSWindow = null;
    let cameraTweenId = null;
    const dssAnalysisCache = new Map(); // Cache por malha e snapshot: `${meshId}_${snapshot ?? 'final'}`
    const dssInFlight = new Map(); // Promessas ativas para evitar múltiplos pedidos simultâneos
    let lastSelectedDSSMode = "errors"; // Modo topológico preferido para o botão de toggle (Topologia por defeito)

    // Atualização global e síncrona da UI dos Botões de Mapas DSS (Sidebar & Drawer)
    function updateDSSMapUI() {
        const mode = QAState.activeViewMode;

        const sideBtnToggle = document.getElementById("side-btn-dss-toggle");
        const sideBtnAngle = document.getElementById("side-btn-dss-angle");
        const sideBtnValence = document.getElementById("side-btn-dss-valence");
        const sideBtnErrors = document.getElementById("side-btn-dss-errors");
        const sideMapBadge = document.getElementById("side-dss-map-badge");

        const drawerBtnToggle = document.getElementById("dss-drawer-btn-toggle");
        const drawerBtnAngle = document.getElementById("dss-drawer-btn-angle");
        const drawerBtnValence = document.getElementById("dss-drawer-btn-valence");
        const drawerBtnErrors = document.getElementById("dss-drawer-btn-errors");

        [sideBtnAngle, sideBtnValence, sideBtnErrors, drawerBtnAngle, drawerBtnValence, drawerBtnErrors].forEach(b => b?.classList.remove("active"));

        const isMapActive = (mode && mode !== "none");

        // Atualização dos botões gerais de Ativar / Desativar Mapa de Cores DSS
        [sideBtnToggle, drawerBtnToggle].forEach(btn => {
            if (!btn) return;
            if (isMapActive) {
                btn.classList.add("active");
                btn.classList.remove("btn-outline");
                btn.classList.add("btn-primary");
                btn.innerHTML = `<span>🎨 Desativar Mapa de Cores DSS</span>`;
                btn.style.background = "linear-gradient(135deg, #0284c7, #2563eb)";
                btn.style.borderColor = "#38bdf8";
                btn.style.boxShadow = "0 0 10px rgba(56, 189, 248, 0.4)";
                btn.style.color = "#ffffff";
            } else {
                btn.classList.remove("active");
                btn.classList.remove("btn-primary");
                btn.classList.add("btn-outline");
                btn.innerHTML = `<span>🎨 Ativar Mapa de Cores DSS</span>`;
                btn.style.background = "rgba(255, 255, 255, 0.03)";
                btn.style.borderColor = "rgba(56, 189, 248, 0.35)";
                btn.style.boxShadow = "none";
                btn.style.color = "#93c5fd";
            }
        });

        if (mode === "min_angle" || mode === "angles") {
            if (sideBtnAngle) sideBtnAngle.classList.add("active");
            if (drawerBtnAngle) drawerBtnAngle.classList.add("active");
            if (sideMapBadge) {
                sideMapBadge.textContent = "Ângulos";
                sideMapBadge.style.color = "#38bdf8";
                sideMapBadge.style.background = "rgba(56, 189, 248, 0.15)";
                sideMapBadge.style.borderColor = "rgba(56, 189, 248, 0.35)";
            }
        } else if (mode === "valence") {
            if (sideBtnValence) sideBtnValence.classList.add("active");
            if (drawerBtnValence) drawerBtnValence.classList.add("active");
            if (sideMapBadge) {
                sideMapBadge.textContent = "Valência";
                sideMapBadge.style.color = "#c084fc";
                sideMapBadge.style.background = "rgba(168, 85, 247, 0.15)";
                sideMapBadge.style.borderColor = "rgba(168, 85, 247, 0.35)";
            }
        } else if (mode === "errors") {
            if (sideBtnErrors) sideBtnErrors.classList.add("active");
            if (drawerBtnErrors) drawerBtnErrors.classList.add("active");
            if (sideMapBadge) {
                sideMapBadge.textContent = "Topologia";
                sideMapBadge.style.color = "#f87171";
                sideMapBadge.style.background = "rgba(239, 68, 68, 0.15)";
                sideMapBadge.style.borderColor = "rgba(239, 68, 68, 0.35)";
            }
        } else {
            if (sideMapBadge) {
                sideMapBadge.textContent = "Desativado";
                sideMapBadge.style.color = "#94a3b8";
                sideMapBadge.style.background = "rgba(255, 255, 255, 0.06)";
                sideMapBadge.style.borderColor = "rgba(255, 255, 255, 0.1)";
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. ESCALAS DE COR (HEATMAPS CONTÍNUOS)
    // ═══════════════════════════════════════════════════════════════════
    function interpolateColor(c1, c2, factor) {
        return [
            c1[0] + (c2[0] - c1[0]) * factor,
            c1[1] + (c2[1] - c1[1]) * factor,
            c1[2] + (c2[2] - c1[2]) * factor
        ];
    }

    function getHeatmapColor(value, minVal, maxVal) {
        if (value === null || value === undefined || isNaN(value)) {
            return [0.25, 0.28, 0.35]; // Cinzento escuro
        }
        const range = maxVal - minVal;
        const t = range > 0 ? Math.max(0, Math.min(1, (value - minVal) / range)) : 0.5;

        // Gradiente: Azul (frio) -> Verde -> Amarelo -> Vermelho (quente)
        if (t < 0.33) {
            return interpolateColor([0.23, 0.51, 0.96], [0.06, 0.72, 0.50], t / 0.33);
        } else if (t < 0.66) {
            return interpolateColor([0.06, 0.72, 0.50], [0.95, 0.70, 0.03], (t - 0.33) / 0.33);
        } else {
            return interpolateColor([0.95, 0.70, 0.03], [0.93, 0.26, 0.26], (t - 0.66) / 0.34);
        }
    }

    function getValenceColor(val) {
        if (val === null || val === undefined || isNaN(val)) return [0.25, 0.28, 0.35];
        if (val === 4) return [0.06, 0.72, 0.50]; // Regular quad: Verde esmeralda (#10b981)
        if (val === 3) return [0.23, 0.51, 0.96]; // Pólo 3: Azul (#3b82f6)
        if (val === 5) return [0.95, 0.70, 0.03]; // Pólo 5: Âmbar/Amarelo (#f59e0b)
        if (val === 2) return [0.06, 0.71, 0.83]; // Valência 2: Ciano (#06b6d4)
        if (val >= 6) return [0.93, 0.26, 0.26]; // Valência 6+: Vermelho (#ef4444)
        return [0.7, 0.7, 0.7];
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. EXTRAÇÃO DE POLÍGONOS E CONSTRUÇÃO 3D
    // ═══════════════════════════════════════════════════════════════════
    function extractPolygonsAndVertices(objText, geometryObj) {
        let vertices = [];
        let faces = [];

        if (geometryObj && Array.isArray(geometryObj.vertices) && Array.isArray(geometryObj.faces)) {
            const flat = geometryObj.vertices;
            for (let i = 0; i < flat.length; i += 3) {
                vertices.push([flat[i], flat[i + 1], flat[i + 2]]);
            }
            faces = geometryObj.faces.map(f => Array.isArray(f) ? [...f] : []);
        } else if (objText) {
            const lines = objText.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith("v ")) {
                    const parts = line.split(/\s+/).slice(1).map(Number);
                    vertices.push([parts[0], parts[1], parts[2]]);
                } else if (line.startsWith("f ")) {
                    const tokens = line.split(/\s+/).slice(1);
                    const vIdxs = tokens.map(t => {
                        const idx = parseInt(t.split("/")[0], 10);
                        return idx > 0 ? idx - 1 : vertices.length + idx;
                    });
                    if (vIdxs.length >= 3) {
                        faces.push(vIdxs);
                    }
                }
            }
        }

        return { vertices, faces };
    }

    function getViewer() {
        if (!window.RetopoViewer && typeof window.initRetopoViewer === "function") {
            window.initRetopoViewer();
        }
        return window.RetopoViewer || null;
    }

    /**
     * Constrói a geometria 3D do DSS preservando os polígonos originais
     */
    function buildDSSGeometry(vertices, polygonFaces) {
        const viewer = getViewer();
        if (!viewer || !vertices || vertices.length === 0 || !polygonFaces || polygonFaces.length === 0) {
            return false;
        }

        const scene = viewer.scene;
        qaParsedVertices = vertices;
        qaPolygonFaces = polygonFaces;

        // 1. Normalizar escala e centrar
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
        }

        const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        const dimX = maxX - minX, dimY = maxY - minY, dimZ = maxZ - minZ;
        const maxDim = Math.max(dimX, dimY, dimZ);
        const scale = maxDim > 0 ? (16 / maxDim) : 1;

        const norm = (v) => [
            (v[0] - center.x) * scale,
            (v[1] - center.y) * scale,
            (v[2] - center.z) * scale
        ];

        // 2. Triangular polígonos apenas para renderização na GPU
        // Mantém mapa estrito de cada triângulo para a face original
        const triPositions = [];
        const triColors = [];
        qaTriangleToFaceMap = [];
        qaFaceToTrianglesMap = [];
        qaTriangleVertexIndices = [];

        for (let f = 0; f < polygonFaces.length; f++) {
            qaFaceToTrianglesMap[f] = [];
            const fVerts = polygonFaces[f];
            const k = fVerts.length;

            for (let j = 1; j < k - 1; j++) {
                const i0 = fVerts[0];
                const i1 = fVerts[j];
                const i2 = fVerts[j + 1];

                const p0 = norm(vertices[i0]);
                const p1 = norm(vertices[i1]);
                const p2 = norm(vertices[i2]);

                triPositions.push(...p0, ...p1, ...p2);
                triColors.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5);

                const currentTriIdx = qaTriangleToFaceMap.length;
                qaTriangleToFaceMap.push(f);
                qaTriangleVertexIndices.push(i0, i1, i2);
                qaFaceToTrianglesMap[f].push(currentTriIdx);
            }
        }

        // Limpar malhas DSS anteriores da cena
        if (dssMesh) { scene.remove(dssMesh); dssMesh.geometry.dispose(); dssMesh = null; }
        if (dssEdgesMesh) { scene.remove(dssEdgesMesh); dssEdgesMesh.geometry.dispose(); dssEdgesMesh = null; }
        if (dssPolesPoints) { scene.remove(dssPolesPoints); dssPolesPoints.geometry.dispose(); dssPolesPoints = null; }
        if (dssSelectionLine) { scene.remove(dssSelectionLine); dssSelectionLine.geometry.dispose(); dssSelectionLine = null; }

        // Garantir que a malha principal RL e os seus overlays permanecem 100% visíveis e ativos
        if (viewer.mesh) viewer.mesh.visible = true;

        return true;
    }

    function buildDSSPolesPoints(normFn) {
        const viewer = getViewer();
        if (!viewer || !QAState.resultData) return;
        const res = QAState.resultData;
        const poles = res.poles;
        if (!poles || !Array.isArray(poles.vertices) || poles.vertices.length === 0) return;

        const ptsPositions = [];
        for (let i = 0; i < poles.vertices.length; i++) {
            const vIdx = poles.vertices[i];
            if (qaParsedVertices[vIdx]) {
                const p = normFn(qaParsedVertices[vIdx]);
                ptsPositions.push(...p);
            }
        }

        if (ptsPositions.length > 0) {
            const ptsGeo = new THREE.BufferGeometry();
            ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ptsPositions), 3));

            const ptsMat = new THREE.PointsMaterial({
                color: 0xec4899, // Rosa choque
                size: 6,
                sizeAttenuation: false,
                transparent: true,
                opacity: 0.95,
                depthTest: true
            });

            dssPolesPoints = new THREE.Points(ptsGeo, ptsMat);
            dssPolesPoints.visible = QAState.showPoles;
            viewer.scene.add(dssPolesPoints);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. COLORIZAÇÃO E MODOS VISUAIS (OVERLAYS & HEATMAPS)
    // ═══════════════════════════════════════════════════════════════════
    function updateDSSColors() {
        const viewer = getViewer();
        if (!viewer || !viewer.mesh || !viewer.mesh.geometry) return;
        const geo = viewer.mesh.geometry;
        const posAttr = geo.attributes.position;
        if (!posAttr) return;

        const mode = QAState.activeViewMode;

        // Atualizar visibilidade da legenda
        const legendEl = document.getElementById("qa-heatmap-legend");
        const legendTitle = document.getElementById("qa-legend-title");
        const legendMin = document.getElementById("qa-legend-min");
        const legendMax = document.getElementById("qa-legend-max");

        if (mode === "none") {
            if (legendEl) legendEl.style.display = "none";
            if (typeof viewer.setDSSHeatmapActive === "function") {
                viewer.setDSSHeatmapActive(false);
            }
            if (geo.attributes.color) {
                geo.attributes.color.array.fill(1.0);
                geo.attributes.color.needsUpdate = true;
            }
            return;
        }

        const res = QAState.resultData;
        if (!res) {
            if (legendEl) legendEl.style.display = "none";
            if (typeof viewer.setDSSHeatmapActive === "function") {
                viewer.setDSSHeatmapActive(false);
            }
            if (geo.attributes.color) {
                geo.attributes.color.array.fill(1.0);
                geo.attributes.color.needsUpdate = true;
            }
            return;
        }

        let colorAttr = geo.attributes.color;
        if (!colorAttr || colorAttr.count !== posAttr.count) {
            colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
            geo.setAttribute("color", colorAttr);
        }
        const colors = colorAttr.array;

        // Metadados estritos de polígonos e mapeamento da malha ativa
        const triangleToFace = geo.userData?.triangleToFace || qaTriangleToFaceMap;
        const vertexIndices  = geo.userData?.vertexIndices  || qaTriangleVertexIndices;
        const polygonFaces   = geo.userData?.polygonFaces   || qaPolygonFaces;

        const numFaces = polygonFaces ? polygonFaces.length : (qaPolygonFaces ? qaPolygonFaces.length : 1);
        const maxTris = Math.min(triangleToFace ? triangleToFace.length : qaTriangleToFaceMap.length, Math.floor(posAttr.count / 3));

        if (legendEl) legendEl.style.display = "flex";
        if (typeof viewer.setDSSHeatmapActive === "function") {
            viewer.setDSSHeatmapActive(true);
        }

        // MODO 1: OVERLAYS DE ERRO E CONFORMIDADE TOPOLÓGICA (QUADS, TRIS, N-GONS)
        if (mode === "errors") {
            if (legendTitle) legendTitle.textContent = "DSS: Conformidade Topológica";
            if (legendMin) legendMin.textContent = "Quads (Verde) / Tris (Azul)";
            if (legendMax) legendMax.textContent = "N-gons / Anomalias (Vermelho)";

            const faceErrorMap = new Array(numFaces).fill(null);
            const priorityOrder = ["degenerate", "nonmanifold", "flipped", "overlap", "t_junction", "open_edges", "bad_quads", "dup_faces", "ngons"];

            if (res && res.checks) {
                for (const checkKey of priorityOrder) {
                    if (QAState.enabledChecks[checkKey] === false) continue;
                    const checkData = res.checks[checkKey];
                    if (checkData && Array.isArray(checkData.faces)) {
                        const checkColorHex = QA_EXPLANATIONS[checkKey]?.color || "#ef4444";
                        const c = new THREE.Color(checkColorHex);
                        const rgb = [c.r, c.g, c.b];
                        for (const fIdx of checkData.faces) {
                            if (fIdx < numFaces && faceErrorMap[fIdx] === null) {
                                faceErrorMap[fIdx] = rgb;
                            }
                        }
                    }
                }
            }

            for (let triIdx = 0; triIdx < maxTris; triIdx++) {
                const f = triangleToFace ? triangleToFace[triIdx] : (qaTriangleToFaceMap[triIdx] ?? 0);
                const poly = polygonFaces ? polygonFaces[f] : (qaPolygonFaces ? qaPolygonFaces[f] : null);
                const numVerts = poly ? poly.length : 4;

                let col = (f < faceErrorMap.length) ? faceErrorMap[f] : null;
                if (!col) {
                    if (numVerts === 4) {
                        col = [0.06, 0.72, 0.50]; // Quads ideais: Verde esmeralda (#10b981)
                    } else if (numVerts === 3) {
                        col = [0.23, 0.51, 0.96]; // Triângulos: Azul (#3b82f6)
                    } else {
                        col = [0.93, 0.26, 0.26]; // N-gons: Vermelho (#ef4444)
                    }
                }

                const offset = triIdx * 9;
                for (let v = 0; v < 3; v++) {
                    colors[offset + v * 3]     = col[0];
                    colors[offset + v * 3 + 1] = col[1];
                    colors[offset + v * 3 + 2] = col[2];
                }
            }
        }

        // MODO 2: HEATMAP DE ÂNGULO MÍNIMO
        else if (mode === "min_angle" || mode === "angles") {
            const angles = res?.per_face?.min_angle || [];
            let minVal = 0, maxVal = 180;
            if (angles.length > 0) {
                let actualMin = Infinity, actualMax = -Infinity;
                for (let a of angles) {
                    if (a !== null && !isNaN(a)) {
                        if (a < actualMin) actualMin = a;
                        if (a > actualMax) actualMax = a;
                    }
                }
                if (actualMin < Infinity && actualMax > actualMin) {
                    minVal = Math.floor(actualMin);
                    maxVal = Math.ceil(actualMax);
                }
            }
            if (legendTitle) legendTitle.textContent = "DSS: Ângulo Mínimo por Face";
            if (legendMin) legendMin.textContent = `${minVal}° (Crítico)`;
            if (legendMax) legendMax.textContent = `${maxVal}° (Ortogonal ~90°)`;

            for (let triIdx = 0; triIdx < maxTris; triIdx++) {
                const f = triangleToFace ? triangleToFace[triIdx] : (qaTriangleToFaceMap[triIdx] ?? 0);
                const val = (f < angles.length) ? angles[f] : 90;
                const col = getHeatmapColor(val, minVal, maxVal);
                const offset = triIdx * 9;
                for (let v = 0; v < 3; v++) {
                    colors[offset + v * 3]     = col[0];
                    colors[offset + v * 3 + 1] = col[1];
                    colors[offset + v * 3 + 2] = col[2];
                }
            }
        }

        // MODO 3: HEATMAP DE ÂNGULO MÁXIMO
        else if (mode === "max_angle") {
            const angles = res?.per_face?.max_angle || [];
            let minVal = 0, maxVal = 180;
            if (angles.length > 0) {
                let actualMin = Infinity, actualMax = -Infinity;
                for (let a of angles) {
                    if (a !== null && !isNaN(a)) {
                        if (a < actualMin) actualMin = a;
                        if (a > actualMax) actualMax = a;
                    }
                }
                if (actualMin < Infinity && actualMax > actualMin) {
                    minVal = Math.floor(actualMin);
                    maxVal = Math.ceil(actualMax);
                }
            }
            if (legendTitle) legendTitle.textContent = "DSS: Ângulo Máximo por Face";
            if (legendMin) legendMin.textContent = `${minVal}° (Ortogonal ~90°)`;
            if (legendMax) legendMax.textContent = `${maxVal}° (Colinear ~180°)`;

            for (let triIdx = 0; triIdx < maxTris; triIdx++) {
                const f = triangleToFace ? triangleToFace[triIdx] : (qaTriangleToFaceMap[triIdx] ?? 0);
                const val = (f < angles.length) ? angles[f] : 90;
                const col = getHeatmapColor(val, minVal, maxVal);
                const offset = triIdx * 9;
                for (let v = 0; v < 3; v++) {
                    colors[offset + v * 3]     = col[0];
                    colors[offset + v * 3 + 1] = col[1];
                    colors[offset + v * 3 + 2] = col[2];
                }
            }
        }

        // MODO 4: HEATMAP DE VALÊNCIA POR VÉRTICE (COM PÓLOS)
        else if (mode === "valence") {
            const valences = res?.per_vertex?.valence || [];
            let minVal = Infinity, maxVal = -Infinity;
            for (let v of valences) {
                if (v !== null && !isNaN(v)) {
                    if (v < minVal) minVal = v;
                    if (v > maxVal) maxVal = v;
                }
            }
            if (minVal === Infinity) { minVal = 2; maxVal = 8; }

            if (legendTitle) legendTitle.textContent = "DSS: Valência dos Vértices & Pólos";
            if (legendMin) legendMin.textContent = `Val 3 (Pólo Azul) / Val 4 (Verde)`;
            if (legendMax) legendMax.textContent = `Val 5 (Amarelo) / ≥6 (Vermelho)`;

            for (let triIdx = 0; triIdx < maxTris; triIdx++) {
                for (let v = 0; v < 3; v++) {
                    const vertIdx = (triIdx * 3) + v;
                    const origV = vertexIndices ? vertexIndices[vertIdx] : (qaTriangleVertexIndices[vertIdx] ?? vertIdx);
                    const val = (origV < valences.length) ? valences[origV] : 4;
                    const c = getValenceColor(val);
                    colors[vertIdx * 3 + 0] = c[0];
                    colors[vertIdx * 3 + 1] = c[1];
                    colors[vertIdx * 3 + 2] = c[2];
                }
            }
        }

        colorAttr.needsUpdate = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  7. RAYCASTING UNIFICADO (INSPEÇÃO DE FACE AO CLICAR)
    // ═══════════════════════════════════════════════════════════════════
    let isRaycasterBound = false;

    function setupUnifiedRaycaster() {
        const canvas = document.getElementById("canvas3d");
        if (!canvas || isRaycasterBound) return;
        isRaycasterBound = true;

        qaRaycaster = new THREE.Raycaster();
        let isDragging = false;
        let pointerDownPos = { x: 0, y: 0 };

        canvas.addEventListener("pointerdown", (e) => {
            isDragging = false;
            pointerDownPos = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener("pointermove", (e) => {
            const dx = Math.abs(e.clientX - pointerDownPos.x);
            const dy = Math.abs(e.clientY - pointerDownPos.y);
            if (dx > 4 || dy > 4) isDragging = true;
        });

        canvas.addEventListener("pointerup", (e) => {
            if (isDragging) return;
            const viewer = getViewer();
            if (!viewer || !viewer.mesh || QAState.activeViewMode === "none") return;

            const rect = canvas.getBoundingClientRect();
            qaMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            qaMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            qaRaycaster.setFromCamera(qaMouse, viewer.camera);
            const intersects = qaRaycaster.intersectObject(viewer.mesh, false);

            if (intersects.length > 0) {
                const hit = intersects[0];
                const triIdx = hit.faceIndex;
                const polygonFaceIdx = qaTriangleToFaceMap[triIdx];
                if (polygonFaceIdx !== undefined) {
                    selectFaceInQA(polygonFaceIdx);
                }
            }
        });
    }

    function selectFaceInQA(faceIdx) {
        const viewer = getViewer();
        if (!viewer || !viewer.mesh || !viewer.mesh.geometry || faceIdx === null || faceIdx >= qaPolygonFaces.length) return;

        QAState.selectedFaceIdx = faceIdx;
        const fVerts = qaPolygonFaces[faceIdx];
        const res = QAState.resultData;

        // Desenhar contorno de destaque amarelo vivo sobre a face
        if (dssSelectionLine) {
            viewer.scene.remove(dssSelectionLine);
            dssSelectionLine.geometry.dispose();
            dssSelectionLine = null;
        }

        const triIndices = qaFaceToTrianglesMap[faceIdx] || [];
        const posAttr = viewer.mesh.geometry.attributes.position;
        if (!posAttr) return;
        const linePositions = [];

        // Contorno do perímetro poligonal
        for (let j = 0; j < fVerts.length; j++) {
            const a = fVerts[j];
            const b = fVerts[(j + 1) % fVerts.length];
            const pA = posAttr.array; // usar vértices normalizados da geometria
        }

        // Construir linha sobre os triângulos da face
        for (const tIdx of triIndices) {
            const off = tIdx * 9;
            const x0 = posAttr.array[off], y0 = posAttr.array[off+1], z0 = posAttr.array[off+2];
            const x1 = posAttr.array[off+3], y1 = posAttr.array[off+4], z1 = posAttr.array[off+5];
            const x2 = posAttr.array[off+6], y2 = posAttr.array[off+7], z2 = posAttr.array[off+8];
            linePositions.push(x0, y0, z0, x1, y1, z1);
            linePositions.push(x1, y1, z1, x2, y2, z2);
            linePositions.push(x2, y2, z2, x0, y0, z0);
        }

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2, depthTest: false });
        dssSelectionLine = new THREE.LineSegments(lineGeo, lineMat);
        dssSelectionLine.renderOrder = 999;
        viewer.scene.add(dssSelectionLine);

        // Preencher Painel Flutuante
        const panel = document.getElementById("qa-detail-panel");
        const titleEl = document.getElementById("qa-detail-title");
        const typeEl = document.getElementById("qa-detail-type");
        const minAEl = document.getElementById("qa-detail-min-angle");
        const maxAEl = document.getElementById("qa-detail-max-angle");
        const errorsBox = document.getElementById("qa-detail-errors");
        const vertsBox = document.getElementById("qa-detail-verts");

        if (titleEl) titleEl.textContent = `Face #${faceIdx}`;
        if (typeEl) {
            const k = fVerts.length;
            typeEl.textContent = k === 3 ? "Triângulo (3 vértices)" : (k === 4 ? "Quad (4 vértices)" : `N-gon (${k} vértices)`);
        }

        const minAngle = res?.per_face?.min_angle?.[faceIdx];
        const maxAngle = res?.per_face?.max_angle?.[faceIdx];
        if (minAEl) minAEl.textContent = (minAngle !== null && minAngle !== undefined) ? `${minAngle.toFixed(1)}°` : "--";
        if (maxAEl) maxAEl.textContent = (maxAngle !== null && maxAngle !== undefined) ? `${maxAngle.toFixed(1)}°` : "--";

        // Erros detetados nesta face
        if (errorsBox) {
            errorsBox.innerHTML = "";
            const issues = [];
            if (res && res.checks) {
                for (const [key, check] of Object.entries(res.checks)) {
                    if (Array.isArray(check.faces) && check.faces.includes(faceIdx)) {
                        issues.push(key);
                    }
                }
            }
            if (issues.length > 0) {
                issues.forEach(iss => {
                    const tag = document.createElement("span");
                    tag.className = "qa-badge critical";
                    tag.textContent = iss;
                    errorsBox.appendChild(tag);
                });
            } else {
                errorsBox.innerHTML = `<span class="qa-badge ok">Sem problemas detetados</span>`;
            }
        }

        // Valência dos vértices
        if (vertsBox) {
            vertsBox.innerHTML = "";
            const valences = res?.per_vertex?.valence || [];
            fVerts.forEach(vIdx => {
                const val = valences[vIdx] ?? "--";
                const chip = document.createElement("span");
                chip.className = "qa-vert-chip";
                chip.textContent = `V#${vIdx}: Val ${val}`;
                vertsBox.appendChild(chip);
            });
        }

        if (panel) panel.style.display = "block";
    }

    function closeQADetailPanel() {
        const panel = document.getElementById("qa-detail-panel");
        if (panel) panel.style.display = "none";
        const viewer = getViewer();
        if (viewer && dssSelectionLine) {
            viewer.scene.remove(dssSelectionLine);
            dssSelectionLine.geometry.dispose();
            dssSelectionLine = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  8. RENDERIZAÇÃO DA BARRA LATERAL (MÉTRICAS & CHECKS)
    // ═══════════════════════════════════════════════════════════════════
    function deriveQAVerdict(summary) {
        if (!summary) return "Estado desconhecido";
        const checks = summary.checks || {};
        let critCount = 0;
        let warnCount = 0;

        const criticalTypes = ["degenerate", "nonmanifold", "flipped", "t_junction"];

        for (const [key, check] of Object.entries(checks)) {
            const c = check.count || 0;
            if (c > 0) {
                if (criticalTypes.includes(key)) critCount += c;
                else if (key !== "poles" && key !== "collinear_vertices") warnCount += c;
            }
        }

        const watertight = summary.topology?.is_watertight;
        const parts = [];
        if (critCount > 0) parts.push(`⚠️ ${critCount} erro(s) crítico(s)`);
        if (warnCount > 0) parts.push(`${warnCount} aviso(s) topológico(s)`);
        if (watertight === false) parts.push("Não estanque");

        if (parts.length === 0) return "✅ Sem erros críticos • Malha aprovada";
        return parts.join(" • ");
    }

    function renderDSSUI() {
        const stat = QAState.statusData;
        const summary = stat?.summary;
        const res = QAState.resultData;

        if (!summary) return;

        // Cabeçalho do DSS
        const titleEl = document.getElementById("qa-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const durationEl = document.getElementById("qa-header-duration");
        const verdictEl = document.getElementById("qa-header-verdict");
        const topChip = document.getElementById("top-active-mesh-chip");
        const drawerTitle = document.getElementById("dss-drawer-target-title");
        const drawerStatus = document.getElementById("dss-drawer-status");
        const drawerVerdict = document.getElementById("dss-drawer-verdict");

        const targetName = QAState.activeMeshName || "Malha Analisada";
        if (titleEl) titleEl.textContent = targetName;
        if (topChip) topChip.textContent = targetName;
        if (drawerTitle) drawerTitle.textContent = targetName;
        
        const statusClass = `status-badge ${stat.status === 'done' ? 'online' : (stat.status === 'failed' ? 'error' : 'working')}`;
        const statusTxt = stat.status === 'done' ? 'Concluído' : (stat.status === 'failed' ? 'Falhou' : 'A Processar');
        if (statusEl) {
            statusEl.className = statusClass;
            statusEl.textContent = statusTxt;
        }
        if (drawerStatus) {
            drawerStatus.className = statusClass;
            drawerStatus.textContent = statusTxt;
        }

        if (durationEl && stat.created_at && stat.finished_at) {
            const start = new Date(stat.created_at).getTime();
            const end = new Date(stat.finished_at).getTime();
            const diffMs = Math.max(0, end - start);
            durationEl.textContent = diffMs > 1000 ? `${(diffMs / 1000).toFixed(2)}s` : `${diffMs}ms`;
        }

        const verdictTxt = deriveQAVerdict(summary);
        if (verdictEl) {
            verdictEl.textContent = verdictTxt;
        }
        if (drawerVerdict) {
            drawerVerdict.textContent = verdictTxt;
        }

        // Atualizar Crachá de Erros na Aba
        const badge = document.getElementById("side-dss-badge");
        if (badge) {
            const issues = summary.issue_faces || 0;
            badge.style.display = "inline-flex";
            badge.textContent = issues > 0 ? issues : "OK";
            badge.style.background = issues > 0 ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)";
            badge.style.color = issues > 0 ? "#f87171" : "#34d399";
            badge.style.borderColor = issues > 0 ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)";
        }

        // Métricas e Topologia
        renderTopologyInfo(summary.topology, summary.angles_deg, summary.valence_histogram);

        // Checklist Dinâmica
        renderChecksList(summary.checks, res?.checks);

        // Limitações e Avisos
        renderLimitations(summary.limitations, summary.warnings);
    }

    function renderTopologyInfo(topo, angles, valenceHist) {
        if (!topo) return;

        const wtEl = document.getElementById("qa-topo-watertight");
        if (wtEl) {
            wtEl.innerHTML = topo.is_watertight
                ? `<span class="qa-badge ok">Sim</span>`
                : `<span class="qa-badge critical">Não</span>`;
        }

        const mfEl = document.getElementById("qa-topo-manifold");
        if (mfEl) {
            mfEl.innerHTML = topo.is_manifold
                ? `<span class="qa-badge ok">Sim</span>`
                : `<span class="qa-badge critical">Não</span>`;
        }

        const eulerEl = document.getElementById("qa-topo-euler");
        if (eulerEl) eulerEl.textContent = topo.euler_characteristic ?? "--";

        const shellsEl = document.getElementById("qa-topo-shells");
        if (shellsEl) shellsEl.textContent = topo.shells ?? "--";

        const boundEl = document.getElementById("qa-topo-boundary-edges");
        if (boundEl) boundEl.textContent = (topo.boundary_edges || 0).toLocaleString();

        const nonManEl = document.getElementById("qa-topo-nonman-edges");
        if (nonManEl) nonManEl.textContent = (topo.nonmanifold_edges || 0).toLocaleString();

        // Distribuição de Faces
        const totalFaces = topo.faces || 1;
        const tris = topo.tris || 0;
        const quads = topo.quads || 0;
        const ngons = topo.raw_ngons !== undefined ? topo.raw_ngons : (topo.ngons || 0);

        const trisPct = ((tris / totalFaces) * 100).toFixed(1);
        const quadsPct = ((quads / totalFaces) * 100).toFixed(1);
        const ngonsPct = ((ngons / totalFaces) * 100).toFixed(1);

        const facesSummaryEl = document.getElementById("qa-faces-summary");
        if (facesSummaryEl) {
            facesSummaryEl.textContent = `${totalFaces.toLocaleString()} Faces (${topo.vertices || 0} Vértices)`;
        }

        const barTris = document.getElementById("qa-bar-tris");
        const barQuads = document.getElementById("qa-bar-quads");
        const barNgons = document.getElementById("qa-bar-ngons");

        if (barTris) barTris.style.width = `${trisPct}%`;
        if (barQuads) barQuads.style.width = `${quadsPct}%`;
        if (barNgons) barNgons.style.width = `${ngonsPct}%`;

        const cntTris = document.getElementById("qa-count-tris");
        const cntQuads = document.getElementById("qa-count-quads");
        const cntNgons = document.getElementById("qa-count-ngons");

        if (cntTris) cntTris.textContent = `${tris} (${trisPct}%)`;
        if (cntQuads) cntQuads.textContent = `${quads} (${quadsPct}%)`;
        if (cntNgons) cntNgons.textContent = `${ngons} (${ngonsPct}%)`;

        // Atualizar também os cartões no menu lateral unificado
        const sideQuadsEl = document.getElementById("side-dss-quads");
        const sideTrisEl = document.getElementById("side-dss-tris");
        const sideNgonsEl = document.getElementById("side-dss-ngons");
        const sideBarQuads = document.getElementById("side-bar-quads");
        const sideBarTris = document.getElementById("side-bar-tris");
        const sideBarNgons = document.getElementById("side-bar-ngons");

        if (sideQuadsEl) sideQuadsEl.textContent = `${quadsPct}%`;
        if (sideTrisEl) sideTrisEl.textContent = `${trisPct}%`;
        if (sideNgonsEl) sideNgonsEl.textContent = `${ngonsPct}%`;
        if (sideBarQuads) sideBarQuads.style.width = `${quadsPct}%`;
        if (sideBarTris) sideBarTris.style.width = `${trisPct}%`;
        if (sideBarNgons) sideBarNgons.style.width = `${ngonsPct}%`;

        const origWtEl = document.getElementById("orig-watertight-val");
        const origMfEl = document.getElementById("orig-manifold-val");
        const origBdEl = document.getElementById("orig-boundary-val");
        if (origWtEl) origWtEl.innerHTML = topo.is_watertight ? `<span style="color:#34d399;">Sim</span>` : `<span style="color:#f87171;">Não</span>`;
        if (origMfEl) origMfEl.innerHTML = topo.is_manifold ? `<span style="color:#34d399;">Sim</span>` : `<span style="color:#f87171;">Não</span>`;
        if (origBdEl) origBdEl.textContent = (topo.boundary_edges || 0).toLocaleString();

        // Ângulos
        if (angles) {
            const minA = document.getElementById("qa-angle-min");
            const meanA = document.getElementById("qa-angle-mean");
            const maxA = document.getElementById("qa-angle-max");
            if (minA) minA.textContent = `${(angles.min || 0).toFixed(1)}°`;
            if (meanA) meanA.textContent = `${(angles.mean || 0).toFixed(1)}°`;
            if (maxA) maxA.textContent = `${(angles.max || 0).toFixed(1)}°`;
        }

        // Histograma de Valência
        const histContainer = document.getElementById("qa-valence-histogram");
        if (histContainer && valenceHist) {
            histContainer.innerHTML = "";
            let maxCount = 1;
            for (const val of Object.values(valenceHist)) {
                if (val > maxCount) maxCount = val;
            }

            for (const [valenceKey, count] of Object.entries(valenceHist)) {
                const heightPct = Math.max(12, Math.round((count / maxCount) * 100));
                const col = document.createElement("div");
                col.className = "qa-hist-col";
                col.innerHTML = `
                    <div class="qa-hist-val-label">${count}</div>
                    <div class="qa-hist-bar-wrap">
                        <div class="qa-hist-bar" style="height: ${heightPct}%;"></div>
                    </div>
                    <div class="qa-hist-key-label">Val ${valenceKey}</div>
                `;
                histContainer.appendChild(col);
            }
        }
    }

    function renderChecksList(summaryChecks, resultChecks) {
        const container = document.getElementById("qa-checks-list");
        if (!container || !summaryChecks) return;
        container.innerHTML = "";

        const hasCollinear = summaryChecks.collinear_vertices && summaryChecks.collinear_vertices.count > 0;
        const hasTJunction = summaryChecks.t_junction && summaryChecks.t_junction.count > 0;

        for (const [checkKey, checkData] of Object.entries(summaryChecks)) {
            const info = getCheckInfo(checkKey);
            const count = checkData.count || 0;
            const ratio = checkData.ratio !== undefined ? (checkData.ratio * 100).toFixed(1) : null;
            const basis = checkData.ratio_basis || "faces";

            let severity = count === 0 ? "ok" : info.severity;

            const item = document.createElement("div");
            item.className = `qa-check-item severity-${severity}`;
            item.dataset.check = checkKey;

            const isChecked = QAState.enabledChecks[checkKey] !== false;

            const resData = resultChecks?.[checkKey];
            const affectedFaces = resData && Array.isArray(resData.faces) ? resData.faces : [];

            item.innerHTML = `
                <div class="qa-check-header">
                    <div class="qa-check-title-group">
                        <input type="checkbox" class="qa-check-toggle" data-check="${checkKey}" ${isChecked ? "checked" : ""}>
                        <div>
                            <span class="qa-check-name">${info.title}</span>
                            <span class="qa-check-counts">${count} ${basis} ${ratio !== null ? `(${ratio}%)` : ""}</span>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                        <span class="qa-badge ${severity === 'ok' ? 'ok' : (severity === 'critical' ? 'critical' : 'warning')}">
                            ${count === 0 ? "0 erros" : `${count} prob.`}
                        </span>
                        <span class="qa-chevron" style="color:#64748b;font-size:0.7rem;">▼</span>
                    </div>
                </div>
                <div class="qa-check-exp" style="display: none;">
                    <h6>O que é?</h6>
                    <p>${info.what}</p>
                    <h6>Porque importa?</h6>
                    <p>${typeof info.why === 'function' ? info.why(null, checkKey === 'ngons' ? hasCollinear : hasTJunction) : info.why}</p>
                    <h6>Como corrigir?</h6>
                    <p>${info.how}</p>
                    ${affectedFaces.length > 0 ? `
                        <div style="margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed rgba(255,255,255,0.12);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size: 0.72rem; color: #38bdf8; font-weight: 600;">Faces Afetadas (${affectedFaces.length}):</span>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Clica para focar no 3D</span>
                            </div>
                            <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.4rem;">
                                ${affectedFaces.slice(0, 14).map(f => `<button type="button" class="qa-face-pill" data-face="${f}" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); color:#7dd3fc; border-radius:4px; padding:0.18rem 0.45rem; font-size:0.7rem; cursor:pointer; font-family:'JetBrains Mono',monospace; transition:all 0.15s ease;">#${f}</button>`).join('')}
                                ${affectedFaces.length > 14 ? `<span style="font-size:0.68rem; color:#94a3b8; align-self:center;">+${affectedFaces.length - 14} mais</span>` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;

            // Toggle do acordeão explicativo
            const header = item.querySelector(".qa-check-header");
            const exp = item.querySelector(".qa-check-exp");
            const chevron = item.querySelector(".qa-chevron");

            header.addEventListener("click", (e) => {
                if (e.target.classList.contains("qa-check-toggle")) return;
                const isShown = exp.style.display === "block";
                exp.style.display = isShown ? "none" : "block";
                chevron.textContent = isShown ? "▼" : "▲";

                // Focar faces afetadas no 3D
                if (affectedFaces.length > 0) {
                    focusFaces(affectedFaces);
                }
            });

            // Cliques individuais nos botões das faces
            const facePills = exp.querySelectorAll(".qa-face-pill");
            facePills.forEach(pill => {
                pill.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const fIdx = parseInt(pill.dataset.face, 10);
                    if (!isNaN(fIdx)) {
                        focusFaces([fIdx]);
                    }
                });
            });

            // Toggle de visibilidade do check nos overlays
            const toggle = item.querySelector(".qa-check-toggle");
            toggle.addEventListener("change", (e) => {
                QAState.enabledChecks[checkKey] = e.target.checked;
                updateDSSColors();
            });

            container.appendChild(item);
        }
    }

    function renderLimitations(limitations, warnings) {
        const limListEl = document.getElementById("qa-limitations-list");
        const warnListEl = document.getElementById("qa-warnings-list");

        if (limListEl) {
            limListEl.innerHTML = "";
            if (limitations && limitations.length > 0) {
                limitations.forEach(l => {
                    const li = document.createElement("li");
                    li.textContent = l;
                    limListEl.appendChild(li);
                });
            } else {
                limListEl.innerHTML = `<li style="color:#94a3b8;">Nenhuma limitação adicional reportada.</li>`;
            }
        }

        if (warnListEl) {
            warnListEl.innerHTML = "";
            if (warnings && warnings.length > 0) {
                warnings.forEach(w => {
                    const li = document.createElement("li");
                    li.textContent = w;
                    warnListEl.appendChild(li);
                });
            } else {
                warnListEl.innerHTML = `<li style="color:#10b981;">Nenhum aviso reportado pelo pipeline.</li>`;
            }
        }
    }

    function getFacesCentroid(faceIndices) {
        if (!dssMesh || !dssMesh.geometry) return null;
        const pos = dssMesh.geometry.attributes.position.array;
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;

        for (const fIdx of faceIndices) {
            const triIndices = qaFaceToTrianglesMap[fIdx];
            if (!triIndices) continue;
            for (const tIdx of triIndices) {
                const off = tIdx * 9;
                for (let v = 0; v < 3; v++) {
                    sumX += pos[off + v * 3];
                    sumY += pos[off + v * 3 + 1];
                    sumZ += pos[off + v * 3 + 2];
                    count++;
                }
            }
        }
        if (count === 0) return null;
        return new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
    }

    function getFacesBoundingRadius(faceIndices, centroid) {
        if (!dssMesh || !dssMesh.geometry || !centroid) return 8;
        const pos = dssMesh.geometry.attributes.position.array;
        let maxDistSq = 0;

        for (const fIdx of faceIndices) {
            const triIndices = qaFaceToTrianglesMap[fIdx];
            if (!triIndices) continue;
            for (const tIdx of triIndices) {
                const off = tIdx * 9;
                for (let v = 0; v < 3; v++) {
                    const dx = pos[off + v * 3] - centroid.x;
                    const dy = pos[off + v * 3 + 1] - centroid.y;
                    const dz = pos[off + v * 3 + 2] - centroid.z;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    if (distSq > maxDistSq) maxDistSq = distSq;
                }
            }
        }
        const r = Math.sqrt(maxDistSq);
        return Math.max(4, Math.min(26, r * 3.5 + 4));
    }

    function animateCameraTo(targetCenter, distance = 14, duration = 650) {
        const viewer = getViewer();
        if (!viewer || !viewer.camera || !viewer.controls) return;

        if (cameraTweenId) {
            cancelAnimationFrame(cameraTweenId);
            cameraTweenId = null;
        }

        const startPos = viewer.camera.position.clone();
        const startTarget = viewer.controls.target.clone();

        // Direção atual da câmara para preservar o ângulo de visão do utilizador
        const currentDir = startPos.clone().sub(startTarget);
        if (currentDir.lengthSq() < 0.0001) currentDir.set(0, 0, 1);
        currentDir.normalize();

        const endPos = targetCenter.clone().add(currentDir.multiplyScalar(distance));
        const endTarget = targetCenter.clone();

        const startTime = performance.now();

        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const ease = easeInOutCubic(progress);

            viewer.camera.position.lerpVectors(startPos, endPos, ease);
            viewer.controls.target.lerpVectors(startTarget, endTarget, ease);
            viewer.controls.update();

            if (progress < 1) {
                cameraTweenId = requestAnimationFrame(step);
            } else {
                cameraTweenId = null;
            }
        }

        cameraTweenId = requestAnimationFrame(step);
    }

    function focusFaces(faceIndices) {
        if (!faceIndices || faceIndices.length === 0) return;

        // Se o modo de erros do DSS não estiver ativo no 3D, ativa-o automaticamente
        if (typeof setViewMode === "function" && QAState.activeViewMode !== "errors") {
            setViewMode("errors");
        }

        // Seleciona e desenha contorno dourado na primeira face
        selectFaceInQA(faceIndices[0]);

        // Calcula o centro e voa a câmara suavemente até às faces
        const centroid = getFacesCentroid(faceIndices);
        if (centroid) {
            const dist = getFacesBoundingRadius(faceIndices, centroid);
            animateCameraTo(centroid, dist, 650);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  9. EXECUÇÃO DA ANÁLISE (LIVE API & FIXTURES FALLBACK)
    // ═══════════════════════════════════════════════════════════════════
    async function loadDSSData(statusJson, resultJson, rawObjText) {
        QAState.statusData = statusJson;
        QAState.resultData = resultJson;
        QAState.rawObjText = rawObjText;

        const { vertices, faces } = extractPolygonsAndVertices(rawObjText, resultJson?.geometry);
        buildDSSGeometry(vertices, faces);
        renderDSSUI();
        if (QAState.activeViewMode && QAState.activeViewMode !== "none") {
            updateDSSColors();
        }
    }

    function resetAllDSSState() {
        const viewer = getViewer();
        if (viewer && viewer.scene) {
            if (dssMesh) { viewer.scene.remove(dssMesh); dssMesh.geometry.dispose(); dssMesh = null; }
            if (dssEdgesMesh) { viewer.scene.remove(dssEdgesMesh); dssEdgesMesh.geometry.dispose(); dssEdgesMesh = null; }
            if (dssPolesPoints) { viewer.scene.remove(dssPolesPoints); dssPolesPoints.geometry.dispose(); dssPolesPoints = null; }
            if (dssSelectionLine) { viewer.scene.remove(dssSelectionLine); dssSelectionLine.geometry.dispose(); dssSelectionLine = null; }
        }

        if (cameraTweenId) {
            cancelAnimationFrame(cameraTweenId);
            cameraTweenId = null;
        }

        qaParsedVertices = [];
        qaPolygonFaces = [];
        qaTriangleToFaceMap = [];
        qaFaceToTrianglesMap = [];
        qaTriangleVertexIndices = [];

        QAState.statusData = null;
        QAState.resultData = null;
        QAState.rawObjText = null;
        QAState.selectedFaceIdx = null;
        QAState.activeMeshId = null;
        QAState.activeSnapshot = null;
        QAState.activeViewMode = "none";
        dssAnalysisCache.clear();

        // Fechar gaveta DSS e painel de detalhes se abertos
        if (typeof closeDSSWindow === "function") closeDSSWindow();
        closeQADetailPanel();

        // Esconder legenda do heatmap
        const legendEl = document.getElementById("qa-heatmap-legend");
        if (legendEl) legendEl.style.display = "none";

        // Desativar botões de mapas DSS
        updateDSSMapUI();
        if (viewer && typeof viewer.setDSSHeatmapActive === "function") {
            viewer.setDSSHeatmapActive(false);
        }

        // Reset de cabeçalho e estatísticas no Sidebar e Drawer
        const titleEl = document.getElementById("qa-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const durationEl = document.getElementById("qa-header-duration");
        const verdictEl = document.getElementById("qa-header-verdict");
        const badge = document.getElementById("side-dss-badge");

        if (titleEl) titleEl.textContent = "Aguardando Análise";
        if (statusEl) {
            statusEl.className = "status-badge working";
            statusEl.textContent = "Aguardando";
        }
        if (durationEl) durationEl.textContent = "--";
        if (verdictEl) verdictEl.innerHTML = `<span style="color:#94a3b8;">Aguardando início da análise DSS...</span>`;
        if (badge) {
            badge.style.display = "none";
            badge.textContent = "--";
        }

        // Reset dos Cards de Topologia
        const totalEl = document.getElementById("qa-stat-faces"); if (totalEl) totalEl.textContent = "--";
        const quadsEl = document.getElementById("qa-stat-quads"); if (quadsEl) quadsEl.textContent = "--";
        const trisEl = document.getElementById("qa-stat-tris"); if (trisEl) trisEl.textContent = "--";
        const ngonsEl = document.getElementById("qa-stat-ngons"); if (ngonsEl) ngonsEl.textContent = "--";
        const facesSummaryEl = document.getElementById("qa-faces-summary"); if (facesSummaryEl) facesSummaryEl.textContent = "--";

        // Reset da barra de distribuição
        const barQuads = document.getElementById("qa-dist-quads"); if (barQuads) barQuads.style.width = "0%";
        const barTris = document.getElementById("qa-dist-tris"); if (barTris) barTris.style.width = "0%";
        const barNgons = document.getElementById("qa-dist-ngons"); if (barNgons) barNgons.style.width = "0%";

        // Reset de listas
        const checksListEl = document.getElementById("qa-checks-list");
        if (checksListEl) checksListEl.innerHTML = `<div style="padding:1rem;color:#94a3b8;text-align:center;font-size:0.8rem;">A aguardar análise DSS...</div>`;
        const histEl = document.getElementById("qa-valence-histogram");
        if (histEl) histEl.innerHTML = "";
        const limListEl = document.getElementById("qa-limitations-list");
        if (limListEl) limListEl.innerHTML = "";
        const warnListEl = document.getElementById("qa-warnings-list");
        if (warnListEl) warnListEl.innerHTML = "";

    }

    function setWaitingRLState() {
        const titleEl = document.getElementById("qa-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const verdictEl = document.getElementById("qa-header-verdict");
        const drawerTitle = document.getElementById("dss-drawer-target-title");
        const drawerStatus = document.getElementById("dss-drawer-status");
        const drawerVerdict = document.getElementById("dss-drawer-verdict");

        if (titleEl) titleEl.textContent = "Aguardando Decimação RL";
        if (drawerTitle) drawerTitle.textContent = "Aguardando Decimação RL";
        if (statusEl) {
            statusEl.className = "status-badge working";
            statusEl.textContent = "A aguardar RL";
        }
        if (drawerStatus) {
            drawerStatus.className = "status-badge working";
            drawerStatus.textContent = "A aguardar RL";
        }
        const waitMsg = `<span style="color:#94a3b8;">A auditoria DSS inicia automaticamente assim que o agente RL gerar a malha otimizada ou ao inspecionar um snapshot.</span>`;
        if (verdictEl) {
            verdictEl.innerHTML = waitMsg;
        }
        if (drawerVerdict) {
            drawerVerdict.innerHTML = waitMsg;
        }
    }

    async function runDSSAnalysis(meshId, snapshot = null) {
        const idToRun = meshId || QAState.activeMeshId || window.currentActiveModelId;
        if (!idToRun) {
            setWaitingRLState();
            return;
        }
        QAState.activeMeshId = idToRun;
        QAState.activeSnapshot = snapshot;

        if (snapshot === 0) {
            QAState.activeMeshName = "Malha Original (Upload)";
        } else if (snapshot !== null && snapshot !== undefined) {
            QAState.activeMeshName = `Snapshot #${snapshot} (${snapshot} Dissolves)`;
        } else {
            QAState.activeMeshName = "Malha Otimizada Final";
        }

        const cacheKey = `${idToRun}_${snapshot ?? 'final'}`;
        if (dssAnalysisCache.has(cacheKey)) {
            const cached = dssAnalysisCache.get(cacheKey);
            await loadDSSData(cached.statusData, cached.resultData, cached.rawObjText);
            return;
        }

        if (dssInFlight.has(cacheKey)) {
            return dssInFlight.get(cacheKey);
        }

        const fetchPromise = (async () => {
            const statusEl = document.getElementById("qa-header-status");
            const drawerStatusEl = document.getElementById("dss-drawer-status");
            const drawerVerdictEl = document.getElementById("dss-drawer-verdict");

            if (statusEl) {
                statusEl.className = "status-badge working";
                statusEl.textContent = "A Analisar...";
            }
            if (drawerStatusEl) {
                drawerStatusEl.className = "status-badge working";
                drawerStatusEl.textContent = "A Extrair Análise...";
            }
            if (drawerVerdictEl) {
                drawerVerdictEl.innerHTML = `<span class="loading-spin" style="display:inline-block;margin-right:0.35rem;">🔄</span> A extrair conformidade topológica e auditoria DSS da malha...`;
                drawerVerdictEl.style.color = "#38bdf8";
            }

            try {
                // Polling até terminar (suportando query param ?snapshot=N)
                const statusResult = await window.MeshQAAPI.runFullAnalysis(
                    idToRun,
                    QAState.params,
                    snapshot,
                    (statusUpdate) => {
                        if (statusEl) {
                            statusEl.className = "status-badge working";
                            statusEl.textContent = statusUpdate.status === "queued" ? "Em Fila..." : "A Processar...";
                        }
                    }
                );

                if (statusResult && statusResult.status === "failed") {
                    renderDSSFailed(statusResult);
                    return;
                }

                // Descarregar resultado detalhado com geometria incluída
                const resultData = await window.MeshQAAPI.downloadAnalysisResult(idToRun, true, snapshot);

                let objText = null;
                if (snapshot === 0) {
                    objText = window.currentUploadedObjText || QAState.rawObjText;
                } else if (snapshot === null) {
                    objText = window.cachedSimplifiedObjText;
                } else {
                    if (typeof window.getCurrentSnapObjText === "function") {
                        objText = window.getCurrentSnapObjText();
                    }
                }
                if (!objText && !resultData?.geometry) {
                    try {
                        objText = await window.RetopoAPI.downloadSimplifiedMesh(idToRun);
                    } catch (_) {}
                }

                dssAnalysisCache.set(cacheKey, { statusData: statusResult, resultData, rawObjText: objText });
                await loadDSSData(statusResult, resultData, objText);

            } catch (err) {
                console.warn("[DSS] Falha na API ao auditar:", err.message);
                const verdictEl = document.getElementById("qa-header-verdict");
                if (statusEl) {
                    statusEl.className = "status-badge offline";
                    statusEl.textContent = "Falhou";
                }
                if (verdictEl) {
                    verdictEl.innerHTML = `<span style="color:#ef4444;font-weight:600;">❌ Aviso da API:</span> <span style="color:#fca5a5;">${err.message}</span>`;
                }
            } finally {
                dssInFlight.delete(cacheKey);
            }
        })();

        dssInFlight.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    function syncTargetMesh(snapshotId) {
        QAState.activeSnapshot = snapshotId;
        const isSnap = (snapshotId !== null && snapshotId !== undefined && snapshotId !== 0);
        QAState.activeMeshName = isSnap
            ? `Snapshot #${snapshotId} (${snapshotId} Dissolves)`
            : (snapshotId === 0 ? "Malha Original (Upload)" : "Malha Otimizada Final");

        const titleEl = document.getElementById("qa-target-title");
        const topChip = document.getElementById("top-active-mesh-chip");
        const drawerTitle = document.getElementById("dss-drawer-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const verdictEl = document.getElementById("qa-header-verdict");

        if (titleEl) {
            titleEl.textContent = isSnap ? `Snapshot #${snapshotId}` : "Malha Otimizada";
            titleEl.style.color = isSnap ? "#c084fc" : "#38bdf8";
        }
        if (topChip) topChip.textContent = QAState.activeMeshName;
        if (drawerTitle) drawerTitle.textContent = QAState.activeMeshName;

        const idToRun = QAState.activeMeshId || window.currentActiveModelId;
        const cacheKey = `${idToRun}_${snapshotId ?? 'final'}`;

        if (dssAnalysisCache.has(cacheKey)) {
            const cached = dssAnalysisCache.get(cacheKey);
            QAState.statusData = cached.statusData;
            QAState.resultData = cached.resultData;
            QAState.rawObjText = cached.rawObjText;
            renderDSSUI();
            if (QAState.activeViewMode && QAState.activeViewMode !== "none") {
                updateDSSColors();
            }
        } else {
            QAState.statusData = null;
            QAState.resultData = null;
            QAState.rawObjText = null;
            if (statusEl) {
                statusEl.className = "status-badge working";
                statusEl.textContent = "A Analisar...";
            }
            if (verdictEl) {
                verdictEl.innerHTML = `<span class="loading-spin" style="display:inline-block;margin-right:0.35rem;">🔄</span> <span style="color:#94a3b8;">A calcular auditoria DSS ${isSnap ? `para Snapshot #${snapshotId}` : 'da malha otimizada'}...</span>`;
            }
            const sideQuadsEl = document.getElementById("side-dss-quads");
            const sideTrisEl = document.getElementById("side-dss-tris");
            const sideNgonsEl = document.getElementById("side-dss-ngons");
            const sideBarQuads = document.getElementById("side-bar-quads");
            const sideBarTris = document.getElementById("side-bar-tris");
            const sideBarNgons = document.getElementById("side-bar-ngons");
            if (sideQuadsEl) sideQuadsEl.textContent = "...";
            if (sideTrisEl) sideTrisEl.textContent = "...";
            if (sideNgonsEl) sideNgonsEl.textContent = "...";
            if (sideBarQuads) sideBarQuads.style.width = "0%";
            if (sideBarTris) sideBarTris.style.width = "0%";
            if (sideBarNgons) sideBarNgons.style.width = "0%";

            // Disparar automaticamente a auditoria DSS em background assim que a malha entra no visualizador!
            if (idToRun) {
                runDSSAnalysis(idToRun, snapshotId).catch(err => {
                    console.warn("[DSS] Auditoria automática de fundo falhou:", err);
                });
            }
        }
        updateDSSMapUI();
    }

    function renderDSSFailed(statusData) {
        const titleEl = document.getElementById("qa-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const verdictEl = document.getElementById("qa-header-verdict");

        if (titleEl) titleEl.textContent = QAState.activeMeshName || statusData?.mesh_id || "Malha Analisada";
        if (statusEl) {
            statusEl.className = "status-badge offline";
            statusEl.textContent = "Falhou";
        }
        if (verdictEl) {
            verdictEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">❌ Falha na Análise:</span> <span style="color:#fca5a5;">${statusData?.error || "Erro no pipeline"}</span>`;
        }
    }

    async function loadDSSFromFixtures() {
        try {
            const { status, result, objText } = await window.MeshQAAPI.loadLocalFixtures();
            QAState.activeMeshId = status.mesh_id || "53296970-b86b-4c00-97be-778bbbb39cf8";
            QAState.activeMeshName = "Fixture de Teste (16 faces / 10 ngons)";
            await loadDSSData(status, result, objText);
        } catch (err) {
            console.error("[Mesh QA Fixtures] Erro ao carregar fixtures locais:", err);
            alert(`Erro ao carregar fixtures: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  10. LIGAÇÃO DE CONTROLOS & EVENT LISTENERS UNIFICADOS
    // ═══════════════════════════════════════════════════════════════════
    function setupStudioEventListeners() {
        // Sub-abas do DSS: Verificações | Topologia | Limitações
        const subChecks = document.getElementById("qa-tab-btn-checks");
        const subTopo = document.getElementById("qa-tab-btn-topology");
        const subLim = document.getElementById("qa-tab-btn-limitations");

        const paneChecks = document.getElementById("qa-pane-checks");
        const paneTopo = document.getElementById("qa-pane-topology");
        const paneLim = document.getElementById("qa-pane-limitations");

        function setDSSSubtab(sub) {
            [subChecks, subTopo, subLim].forEach(b => b?.classList.remove("active"));
            [paneChecks, paneTopo, paneLim].forEach(p => { if (p) p.style.display = "none"; });

            if (sub === "checks") {
                if (subChecks) subChecks.classList.add("active");
                if (paneChecks) paneChecks.style.display = "block";
            } else if (sub === "topology") {
                if (subTopo) subTopo.classList.add("active");
                if (paneTopo) paneTopo.style.display = "block";
            } else if (sub === "limitations") {
                if (subLim) subLim.classList.add("active");
                if (paneLim) paneLim.style.display = "block";
            }
        }

        if (subChecks) subChecks.addEventListener("click", () => setDSSSubtab("checks"));
        if (subTopo) subTopo.addEventListener("click", () => setDSSSubtab("topology"));
        if (subLim) subLim.addEventListener("click", () => setDSSSubtab("limitations"));

        const btnFixture = document.getElementById("btn-qa-fixture");
        if (btnFixture) btnFixture.addEventListener("click", () => loadDSSFromFixtures());

        // Controlo da Vista DSS no Menu Lateral Direito
        const btnOpenModal = document.getElementById("btn-open-dss-modal");
        const btnOpenWin = document.getElementById("btn-open-dss-window");
        const btnCloseWin = document.getElementById("btn-close-dss-window");
        const btnDssBack = document.getElementById("btn-dss-back");

        openDSSWindow = function() {
            if (window.updateSidebarContext) {
                window.updateSidebarContext("dss");
            }
            const isSnap = (typeof window.getActiveView === "function" && window.getActiveView() === "snapshot");
            const snapToAudit = isSnap && typeof window.getCurrentSnapDissolves === "function" ? window.getCurrentSnapDissolves() : null;
            if (!QAState.resultData || QAState.activeSnapshot !== snapToAudit) {
                runDSSAnalysis(QAState.activeMeshId || window.currentActiveModelId, snapToAudit);
            }
        };

        closeDSSWindow = function() {
            if (window.updateSidebarContext) {
                const prev = window.getPreviousSidebarContext ? window.getPreviousSidebarContext() : "low";
                window.updateSidebarContext(prev);
            }
        };

        if (btnOpenModal) btnOpenModal.addEventListener("click", openDSSWindow);
        if (btnOpenWin) btnOpenWin.addEventListener("click", openDSSWindow);
        if (btnCloseWin) btnCloseWin.addEventListener("click", closeDSSWindow);
        if (btnDssBack) btnDssBack.addEventListener("click", closeDSSWindow);

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && QAState.activeViewMode !== "none") {
                setViewMode("none");
            }
        });

        setViewMode = function(mode) {
            // Se estiver em High Poly e for ativar um modo DSS, muda automaticamente para Low Poly (onde incide a auditoria DSS)
            if (mode !== "none" && typeof window.getActiveView === "function" && window.getActiveView() === "high") {
                const btnLow = document.getElementById("btn-low-poly");
                if (btnLow && !btnLow.disabled) {
                    btnLow.click();
                }
            }

            const isSame = QAState.activeViewMode === mode;
            if (isSame || mode === "none") {
                QAState.activeViewMode = "none";
                updateDSSMapUI();
                updateDSSColors();
                closeQADetailPanel();
                if (dssSelectionLine && getViewer()?.scene) {
                    getViewer().scene.remove(dssSelectionLine);
                    dssSelectionLine.geometry.dispose();
                    dssSelectionLine = null;
                }
                return;
            }

            lastSelectedDSSMode = mode;
            QAState.activeViewMode = mode;
            updateDSSMapUI();

            // Se não houver dados DSS ainda ou for de snapshot diferente, disparar auditoria da malha/snapshot ativo
            const isSnap = (typeof window.getActiveView === "function" && window.getActiveView() === "snapshot");
            const snapToAudit = isSnap && typeof window.getCurrentSnapDissolves === "function" ? window.getCurrentSnapDissolves() : null;

            if ((!QAState.resultData || QAState.activeSnapshot !== snapToAudit) && (QAState.activeMeshId || window.currentActiveModelId)) {
                runDSSAnalysis(QAState.activeMeshId || window.currentActiveModelId, snapToAudit).then(() => {
                    updateDSSColors();
                });
                return;
            }

            updateDSSColors();
        };

        // Função de alternância do Mapa de Cores DSS (Toggle)
        function toggleDSSColorMap() {
            if (QAState.activeViewMode && QAState.activeViewMode !== "none") {
                setViewMode("none");
            } else {
                setViewMode(lastSelectedDSSMode || "errors");
            }
        }

        const sideBtnToggle = document.getElementById("side-btn-dss-toggle");
        if (sideBtnToggle) sideBtnToggle.addEventListener("click", toggleDSSColorMap);

        const drawerBtnToggle = document.getElementById("dss-drawer-btn-toggle");
        if (drawerBtnToggle) drawerBtnToggle.addEventListener("click", toggleDSSColorMap);

        // Botões de Modo Específico no Sidebar Contextual
        const sideBtnAngle = document.getElementById("side-btn-dss-angle");
        const sideBtnValence = document.getElementById("side-btn-dss-valence");
        const sideBtnErrors = document.getElementById("side-btn-dss-errors");

        if (sideBtnAngle) sideBtnAngle.addEventListener("click", () => setViewMode("min_angle"));
        if (sideBtnValence) sideBtnValence.addEventListener("click", () => setViewMode("valence"));
        if (sideBtnErrors) sideBtnErrors.addEventListener("click", () => setViewMode("errors"));

        // Botões de Modo Específico na Janela / Drawer Dedicado
        const drawerBtnAngle = document.getElementById("dss-drawer-btn-angle");
        const drawerBtnValence = document.getElementById("dss-drawer-btn-valence");
        const drawerBtnErrors = document.getElementById("dss-drawer-btn-errors");

        if (drawerBtnAngle) drawerBtnAngle.addEventListener("click", () => setViewMode("min_angle"));
        if (drawerBtnValence) drawerBtnValence.addEventListener("click", () => setViewMode("valence"));
        if (drawerBtnErrors) drawerBtnErrors.addEventListener("click", () => setViewMode("errors"));

        // Botão Fechar Painel Raycaster
        const btnCloseDetail = document.getElementById("qa-detail-close");
        if (btnCloseDetail) btnCloseDetail.addEventListener("click", closeQADetailPanel);

        // Estado inicial da interface de mapas DSS (desativado por defeito)
        updateDSSMapUI();
    }

    function resetDSSViewMode() {
        QAState.activeViewMode = "none";
        try {
            if (typeof updateDSSMapUI === "function") {
                updateDSSMapUI();
            }
            updateDSSColors();
            closeQADetailPanel();
            if (dssSelectionLine && getViewer()?.scene) {
                getViewer().scene.remove(dssSelectionLine);
                dssSelectionLine.geometry.dispose();
                dssSelectionLine = null;
            }
        } catch (e) {
            console.warn("[DSS] resetDSSViewMode:", e);
        }
    }

    // Inicialização ao carregar
    window.addEventListener("DOMContentLoaded", () => {
        setupStudioEventListeners();
    });

    // API Global
    window.MeshQA = {
        loadData: loadDSSData,
        runAnalysis: runDSSAnalysis,
        setWaitingRL: setWaitingRLState,
        loadFixtures: loadDSSFromFixtures,
        selectFace: selectFaceInQA,
        focusFaces: focusFaces,
        openWindow: () => (openDSSWindow ? openDSSWindow() : null),
        closeWindow: () => (closeDSSWindow ? closeDSSWindow() : null),
        resetAll: resetAllDSSState,
        syncTargetMesh: syncTargetMesh,
        updateColors: updateDSSColors,
        setViewMode: (mode) => (setViewMode ? setViewMode(mode) : null),
        resetViewMode: resetDSSViewMode,
        state: QAState
    };

})();
