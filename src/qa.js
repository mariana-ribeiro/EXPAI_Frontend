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
        activeViewMode: "errors", // 'errors' | 'min_angle' | 'max_angle' | 'valence' | 'none'
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
    let qaRaycaster = null;
    let qaMouse = new THREE.Vector2();

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
                qaFaceToTrianglesMap[f].push(currentTriIdx);
            }
        }

        // Limpar malhas DSS anteriores da cena
        if (dssMesh) { scene.remove(dssMesh); dssMesh.geometry.dispose(); dssMesh = null; }
        if (dssEdgesMesh) { scene.remove(dssEdgesMesh); dssEdgesMesh.geometry.dispose(); dssEdgesMesh = null; }
        if (dssPolesPoints) { scene.remove(dssPolesPoints); dssPolesPoints.geometry.dispose(); dssPolesPoints = null; }
        if (dssSelectionLine) { scene.remove(dssSelectionLine); dssSelectionLine.geometry.dispose(); dssSelectionLine = null; }

        // 3. Criar Mesh principal DSS com vertexColors
        const triGeo = new THREE.BufferGeometry();
        triGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(triPositions), 3));
        triGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(triColors), 3));
        triGeo.computeVertexNormals();

        const dssMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            side: THREE.DoubleSide
        });

        dssMesh = new THREE.Mesh(triGeo, dssMat);
        scene.add(dssMesh);

        // 4. Criar Arestas dos Polígonos Originais (SEM diagonais de triangulação artificial)
        const edgePositions = [];
        const edgeSet = new Set();

        for (let f = 0; f < polygonFaces.length; f++) {
            const fVerts = polygonFaces[f];
            const count = fVerts.length;
            for (let j = 0; j < count; j++) {
                const a = fVerts[j];
                const b = fVerts[(j + 1) % count];
                const key = a < b ? (a + "_" + b) : (b + "_" + a);
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    const pA = norm(vertices[a]);
                    const pB = norm(vertices[b]);
                    edgePositions.push(...pA, ...pB);
                }
            }
        }

        const edgesGeo = new THREE.BufferGeometry();
        edgesGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgePositions), 3));

        const edgesMat = new THREE.LineBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.85,
            depthTest: true
        });

        dssEdgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
        dssEdgesMesh.visible = QAState.showEdges;
        scene.add(dssEdgesMesh);

        // 5. Criar Nuvem de Poles como Pontos 3D
        buildDSSPolesPoints(norm);

        // Ocultar a malha RL normal para que o DSS seja o visualizador ativo
        if (viewer.mesh) viewer.mesh.visible = false;
        if (viewer.edgesMesh) viewer.edgesMesh.visible = false;
        if (viewer.pointsMesh) viewer.pointsMesh.visible = false;

        // 6. Atualizar cores de acordo com o modo ativo
        updateDSSColors();

        // 7. Configurar Raycaster no canvas principal
        setupUnifiedRaycaster();

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
        if (!dssMesh) return;
        const colorAttr = dssMesh.geometry.attributes.color;
        const colors = colorAttr.array;
        const mode = QAState.activeViewMode;

        const res = QAState.resultData;
        const numFaces = qaPolygonFaces.length;

        // Atualizar visibilidade da legenda
        const legendEl = document.getElementById("qa-heatmap-legend");
        const legendTitle = document.getElementById("qa-legend-title");
        const legendMin = document.getElementById("qa-legend-min");
        const legendMax = document.getElementById("qa-legend-max");

        if (mode === "min_angle" || mode === "max_angle" || mode === "valence") {
            if (legendEl) legendEl.style.display = "block";
        } else {
            if (legendEl) legendEl.style.display = "none";
        }

        // MODO 1: OVERLAYS DE ERRO CATEGÓRICOS
        if (mode === "errors") {
            const faceErrorMap = new Array(numFaces).fill(null);
            const priorityOrder = ["degenerate", "nonmanifold", "flipped", "overlap", "t_junction", "open_edges", "bad_quads", "dup_faces", "ngons"];

            if (res && res.checks) {
                for (const checkKey of priorityOrder) {
                    if (QAState.enabledChecks[checkKey] === false) continue;
                    const checkData = res.checks[checkKey];
                    if (checkData && Array.isArray(checkData.faces)) {
                        const checkColorHex = QA_EXPLANATIONS[checkKey]?.color || "#eab308";
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

            for (let f = 0; f < numFaces; f++) {
                const col = faceErrorMap[f] || [0.22, 0.27, 0.35]; // Azul-ardósia escuro por omissão
                const triIndices = qaFaceToTrianglesMap[f] || [];
                for (const triIdx of triIndices) {
                    const offset = triIdx * 9;
                    for (let v = 0; v < 3; v++) {
                        colors[offset + v * 3] = col[0];
                        colors[offset + v * 3 + 1] = col[1];
                        colors[offset + v * 3 + 2] = col[2];
                    }
                }
            }
        }

        // MODO 2: HEATMAP DE ÂNGULO MÍNIMO
        else if (mode === "min_angle") {
            const angles = res?.per_face?.min_angle || [];
            let minVal = Infinity, maxVal = -Infinity;
            for (let a of angles) {
                if (a !== null && !isNaN(a)) {
                    if (a < minVal) minVal = a;
                    if (a > maxVal) maxVal = a;
                }
            }
            if (minVal === Infinity) { minVal = 0; maxVal = 90; }

            if (legendTitle) legendTitle.textContent = "Ângulo Mínimo por Face";
            if (legendMin) legendMin.textContent = `${minVal.toFixed(1)}°`;
            if (legendMax) legendMax.textContent = `${maxVal.toFixed(1)}°`;

            for (let f = 0; f < numFaces; f++) {
                const val = angles[f];
                const col = getHeatmapColor(val, minVal, maxVal);
                const triIndices = qaFaceToTrianglesMap[f] || [];
                for (const triIdx of triIndices) {
                    const offset = triIdx * 9;
                    for (let v = 0; v < 3; v++) {
                        colors[offset + v * 3] = col[0];
                        colors[offset + v * 3 + 1] = col[1];
                        colors[offset + v * 3 + 2] = col[2];
                    }
                }
            }
        }

        // MODO 3: HEATMAP DE ÂNGULO MÁXIMO
        else if (mode === "max_angle") {
            const angles = res?.per_face?.max_angle || [];
            let minVal = Infinity, maxVal = -Infinity;
            for (let a of angles) {
                if (a !== null && !isNaN(a)) {
                    if (a < minVal) minVal = a;
                    if (a > maxVal) maxVal = a;
                }
            }
            if (minVal === Infinity) { minVal = 90; maxVal = 180; }

            if (legendTitle) legendTitle.textContent = "Ângulo Máximo por Face";
            if (legendMin) legendMin.textContent = `${minVal.toFixed(1)}°`;
            if (legendMax) legendMax.textContent = `${maxVal.toFixed(1)}°`;

            for (let f = 0; f < numFaces; f++) {
                const val = angles[f];
                const col = getHeatmapColor(val, minVal, maxVal);
                const triIndices = qaFaceToTrianglesMap[f] || [];
                for (const triIdx of triIndices) {
                    const offset = triIdx * 9;
                    for (let v = 0; v < 3; v++) {
                        colors[offset + v * 3] = col[0];
                        colors[offset + v * 3 + 1] = col[1];
                        colors[offset + v * 3 + 2] = col[2];
                    }
                }
            }
        }

        // MODO 4: HEATMAP DE VALÊNCIA POR VÉRTICE
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

            if (legendTitle) legendTitle.textContent = "Valência por Vértice";
            if (legendMin) legendMin.textContent = `Val ${minVal}`;
            if (legendMax) legendMax.textContent = `Val ${maxVal}`;

            for (let f = 0; f < numFaces; f++) {
                const fVerts = qaPolygonFaces[f];
                const triIndices = qaFaceToTrianglesMap[f] || [];

                for (let j = 1; j < fVerts.length - 1; j++) {
                    const triIdx = triIndices[j - 1];
                    if (triIdx === undefined) continue;

                    const i0 = fVerts[0];
                    const i1 = fVerts[j];
                    const i2 = fVerts[j + 1];

                    const c0 = getHeatmapColor(valences[i0], minVal, maxVal);
                    const c1 = getHeatmapColor(valences[i1], minVal, maxVal);
                    const c2 = getHeatmapColor(valences[i2], minVal, maxVal);

                    const offset = triIdx * 9;
                    colors[offset + 0] = c0[0]; colors[offset + 1] = c0[1]; colors[offset + 2] = c0[2];
                    colors[offset + 3] = c1[0]; colors[offset + 4] = c1[1]; colors[offset + 5] = c1[2];
                    colors[offset + 6] = c2[0]; colors[offset + 7] = c2[1]; colors[offset + 8] = c2[2];
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
            if (!viewer || !dssMesh || !dssMesh.visible) return;

            const rect = canvas.getBoundingClientRect();
            qaMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            qaMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            qaRaycaster.setFromCamera(qaMouse, viewer.camera);
            const intersects = qaRaycaster.intersectObject(dssMesh, false);

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
        if (!viewer || faceIdx === null || faceIdx >= qaPolygonFaces.length) return;

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
        const posAttr = dssMesh.geometry.attributes.position;
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

        if (titleEl) titleEl.textContent = QAState.activeMeshName || "Malha Analisada";
        if (topChip) topChip.textContent = QAState.activeMeshName || "Malha Analisada";
        
        if (statusEl) {
            statusEl.className = `status-badge ${stat.status === 'done' ? 'online' : (stat.status === 'failed' ? 'error' : 'working')}`;
            statusEl.textContent = stat.status === 'done' ? 'Concluído' : (stat.status === 'failed' ? 'Falhou' : 'A Processar');
        }

        if (durationEl && stat.created_at && stat.finished_at) {
            const start = new Date(stat.created_at).getTime();
            const end = new Date(stat.finished_at).getTime();
            const diffMs = Math.max(0, end - start);
            durationEl.textContent = diffMs > 1000 ? `${(diffMs / 1000).toFixed(2)}s` : `${diffMs}ms`;
        }

        if (verdictEl) {
            verdictEl.textContent = deriveQAVerdict(summary);
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
                const resData = resultChecks?.[checkKey];
                if (resData && Array.isArray(resData.faces) && resData.faces.length > 0) {
                    focusFaces(resData.faces);
                }
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

    function focusFaces(faceIndices) {
        if (!faceIndices || faceIndices.length === 0) return;
        selectFaceInQA(faceIndices[0]);
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
    }

    function setWaitingRLState() {
        const titleEl = document.getElementById("qa-target-title");
        const statusEl = document.getElementById("qa-header-status");
        const verdictEl = document.getElementById("qa-header-verdict");
        const btnRun = document.getElementById("btn-qa-run");
        const btnDownloadJson = document.getElementById("btn-qa-download-result");

        if (titleEl) titleEl.textContent = "Aguardando Decimação RL";
        if (statusEl) {
            statusEl.className = "status-badge working";
            statusEl.textContent = "A aguardar RL";
        }
        if (verdictEl) {
            verdictEl.innerHTML = `<span style="color:#94a3b8;">A auditoria DSS inicia automaticamente assim que o agente RL gerar a malha otimizada ou ao inspecionar um snapshot.</span>`;
        }
        if (btnRun) {
            btnRun.disabled = true;
            btnRun.innerHTML = `<span>🔒 Aguarda RL</span>`;
            btnRun.title = "A análise DSS necessita que a decimação RL gere a malha otimizada.";
        }
        if (btnDownloadJson) {
            btnDownloadJson.disabled = true;
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

        const btnRun = document.getElementById("btn-qa-run");
        const statusEl = document.getElementById("qa-header-status");

        if (btnRun) {
            btnRun.disabled = true;
            btnRun.innerHTML = `<span>⏳ A Auditar ${snapshot === 0 ? 'Original...' : (snapshot ? `#${snapshot}...` : '...')}</span>`;
        }
        if (statusEl) {
            statusEl.className = "status-badge working";
            statusEl.textContent = "A Analisar...";
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
            }
            if (!objText && !resultData?.geometry) {
                try {
                    objText = await window.RetopoAPI.downloadSimplifiedMesh(idToRun);
                } catch (_) {}
            }

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
            if (btnRun) {
                btnRun.disabled = false;
                btnRun.innerHTML = snapshot === 0
                    ? `<span>⚡ Reanalisar Original</span>`
                    : (snapshot !== null && snapshot !== undefined ? `<span>⚡ Reanalisar Snapshot</span>` : `<span>⚡ Reanalisar Malha</span>`);
            }
            const btnDownloadJson = document.getElementById("btn-qa-download-result");
            if (btnDownloadJson && QAState.resultData) {
                btnDownloadJson.disabled = false;
            }
        }
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

        // Botões de Ação Rápida no Card do DSS
        const btnRun = document.getElementById("btn-qa-run");
        if (btnRun) btnRun.addEventListener("click", () => runDSSAnalysis());

        const btnFixture = document.getElementById("btn-qa-fixture");
        if (btnFixture) btnFixture.addEventListener("click", () => loadDSSFromFixtures());

        const btnDownloadJson = document.getElementById("btn-qa-download-result");
        if (btnDownloadJson) {
            btnDownloadJson.addEventListener("click", () => {
                if (!QAState.resultData) return;
                const blob = new Blob([JSON.stringify(QAState.resultData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dss_result_${QAState.activeMeshId || "mesh"}${QAState.activeSnapshot ? `_snap${QAState.activeSnapshot}` : ''}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        // Toggles das Camadas Visuais do Viewport 3D
        const btnDssOverlay = document.getElementById("btn-dss-overlay");
        const btnDssAngle = document.getElementById("btn-dss-heatmap-angle");
        const btnDssValence = document.getElementById("btn-dss-heatmap-valence");

        function setViewMode(mode) {
            const isSame = QAState.activeViewMode === mode && (
                (mode === "errors" && btnDssOverlay?.classList.contains("active")) ||
                (mode.includes("angle") && btnDssAngle?.classList.contains("active")) ||
                (mode === "valence" && btnDssValence?.classList.contains("active"))
            );

            // Toggle on/off se clicou no mesmo
            if (isSame) {
                QAState.activeViewMode = "none";
                [btnDssOverlay, btnDssAngle, btnDssValence].forEach(b => b?.classList.remove("active"));
                const legendEl = document.getElementById("qa-heatmap-legend");
                if (legendEl) legendEl.style.display = "none";
                closeQADetailPanel();

                if (dssMesh) dssMesh.visible = false;
                if (dssEdgesMesh) dssEdgesMesh.visible = false;
                if (dssPolesPoints) dssPolesPoints.visible = false;
                if (dssSelectionLine) dssSelectionLine.visible = false;

                const viewer = getViewer();
                if (viewer && viewer.mesh) {
                    viewer.mesh.visible = true;
                    viewer.syncVisualOverlays();
                }
                return;
            }

            QAState.activeViewMode = mode;
            [btnDssOverlay, btnDssAngle, btnDssValence].forEach(b => b?.classList.remove("active"));

            if (mode === "errors" && btnDssOverlay) btnDssOverlay.classList.add("active");
            if (mode === "min_angle" && btnDssAngle) btnDssAngle.classList.add("active");
            if (mode === "max_angle" && btnDssAngle) btnDssAngle.classList.add("active");
            if (mode === "valence" && btnDssValence) btnDssValence.classList.add("active");

            // Se dssMesh ainda não foi construído para a malha ativa, dispara análise real
            if (!dssMesh) {
                const id = QAState.activeMeshId || window.currentActiveModelId;
                if (id) {
                    runDSSAnalysis(id, QAState.activeSnapshot).then(() => {
                        if (dssMesh) dssMesh.visible = true;
                        if (dssEdgesMesh) dssEdgesMesh.visible = QAState.showEdges;
                        if (dssPolesPoints) dssPolesPoints.visible = QAState.showPoles;
                        const viewer = getViewer();
                        if (viewer && viewer.mesh) viewer.mesh.visible = false;
                        if (viewer && viewer.edgesMesh) viewer.edgesMesh.visible = false;
                        if (viewer && viewer.pointsMesh) viewer.pointsMesh.visible = false;
                        updateDSSColors();
                    });
                }
            } else {
                if (dssMesh) dssMesh.visible = true;
                if (dssEdgesMesh) dssEdgesMesh.visible = QAState.showEdges;
                if (dssPolesPoints) dssPolesPoints.visible = QAState.showPoles;
                const viewer = getViewer();
                if (viewer && viewer.mesh) viewer.mesh.visible = false;
                if (viewer && viewer.edgesMesh) viewer.edgesMesh.visible = false;
                if (viewer && viewer.pointsMesh) viewer.pointsMesh.visible = false;
                updateDSSColors();
            }
        }

        if (btnDssOverlay) btnDssOverlay.addEventListener("click", () => setViewMode("errors"));
        if (btnDssAngle) btnDssAngle.addEventListener("click", () => {
            const nextMode = QAState.activeViewMode === "min_angle" ? "max_angle" : "min_angle";
            btnDssAngle.textContent = nextMode === "min_angle" ? "🌡️ Ângulo Mín" : "🌡️ Ângulo Máx";
            setViewMode(nextMode);
        });
        if (btnDssValence) btnDssValence.addEventListener("click", () => setViewMode("valence"));

        // Botão Fechar Painel Raycaster
        const btnCloseDetail = document.getElementById("qa-detail-close");
        if (btnCloseDetail) btnCloseDetail.addEventListener("click", closeQADetailPanel);
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
        state: QAState
    };

})();
