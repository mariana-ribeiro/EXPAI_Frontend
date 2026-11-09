/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MESH QA (AUDITORIA E CONTROLO DE QUALIDADE TOPOLÓGICO DE MALHAS 3D)
 *  PolyOptima XAI - Retopo Tool
 * ═══════════════════════════════════════════════════════════════════════
 */

(function() {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════
    //  1. DICIONÁRIO DE EXPLICAÇÕES EM PORTUGUÊS
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
                let msg = "Importam em pipelines que exigem quads/tris (modificadores de subdivisão, mapeamento de UVs e motores de jogo), podendo causar deformações e artefactos de sombreamento.";
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
                return "Quebra operações booleanas, modificadores de subdivisão e impede a impressão 3D (a malha deixa de ser um sólido volumétrico válido).";
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
            color: "#fbbf24", // Dourado
            priority: 11,
            what: "Vértices interiores com valência diferente da regular (4 em quads, 6 em tris).",
            why: function() {
                return "Controlam o fluxo da topologia. Em malhas low-poly com cantos duros, valência 3 é perfeitamente normal e deve ser relativizada, só sendo problemática se gerar artefactos de sombreamento.";
            },
            how: "Redirecionar o loop de arestas para zonas coplanares ou de menor deformação articular."
        },
        collinear_vertices: {
            title: "Vértices Colineares",
            category: "Otimização",
            severity: "info",
            color: "#14b8a6", // Teal
            priority: 10,
            what: "Vértices de valência 2 situados sobre uma aresta com ângulo próximo de 180°.",
            why: function() {
                return "São vértices redundantes que aumentam a contagem de lados das faces sem contribuir para a curvatura ou silhueta da forma.";
            },
            how: "Dissolver os vértices colineares (Dissolve Vertices) sem alterar a geometria 3D."
        },
        t_junction: {
            title: "T-Junctions",
            category: "Estanquicidade",
            severity: "critical",
            color: "#f59e0b", // Âmbar
            priority: 5,
            what: "Vértice pousado sobre a aresta de uma face vizinha sem pertencer à topologia dessa face.",
            why: function() {
                return "Cria fendas microscópicas (cracks) ao longo da costura e faz com que a malha deixe de ser hermética (watertight).";
            },
            how: "Conectar o vértice à face adjacente através de um corte de aresta (Edge Cut / Knife) ou soldar os pontos."
        }
    };

    /**
     * Devolve a explicação padronizada para qualquer check, mesmo desconhecido
     */
    function getExplanation(checkKey, faceData, hasTJunction) {
        if (QA_EXPLANATIONS[checkKey]) {
            const exp = QA_EXPLANATIONS[checkKey];
            return {
                title: exp.title,
                category: exp.category,
                severity: exp.severity,
                color: exp.color,
                priority: exp.priority,
                what: exp.what,
                why: typeof exp.why === "function" ? exp.why(faceData, hasTJunction) : exp.why,
                how: exp.how
            };
        }
        // Check desconhecido: exibe o nome cru com texto genérico
        return {
            title: checkKey,
            category: "Geral",
            severity: "info",
            color: "#94a3b8",
            priority: 20,
            what: `Verificação de qualidade topológica: ${checkKey}.`,
            why: "Pode influenciar a integridade da malha e a compatibilidade no pipeline 3D.",
            how: "Inspecionar visualmente os elementos afetados no visualizador 3D."
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. ESTADO GLOBAL DO MESH QA
    // ═══════════════════════════════════════════════════════════════════
    const QAState = {
        activeMeshId: null,
        activeMeshName: "Malha Otimizada",
        statusData: null,
        resultData: null,
        rawObjText: null,

        // Configuração de Parâmetros
        params: {
            min_angle: 20.0,
            max_angle: 160.0,
            regular_valence: 0,
            skip: []
        },

        // Visibilidade de checks nos overlays
        enabledChecks: {},

        // Modo visual ativo no 3D: 'checks' | 'min_angle' | 'max_angle' | 'valence'
        activeViewMode: "checks",
        showEdges: true,
        showPoles: true,
        showSurface: true,

        // Elemento atualmente selecionado/focado
        selectedFaceIdx: null,
        selectedVertIdx: null
    };

    // ═══════════════════════════════════════════════════════════════════
    //  3. GESTOR 3D VIEWPORT DO MESH QA (THREE.JS)
    // ═══════════════════════════════════════════════════════════════════
    let qaScene = null;
    let qaCamera = null;
    let qaRenderer = null;
    let qaControls = null;
    let qaCanvas = null;

    let qaMesh = null;
    let qaEdgesMesh = null;
    let qaPolesPoints = null;
    let qaSelectionLine = null;

    // Dados geométricos processados
    let qaParsedVertices = [];   // [[x, y, z], ...]
    let qaPolygonFaces = [];     // [[v0, v1, ...], ...]
    let qaTriangleToFaceMap = [];// triangleIndex -> polygonFaceIndex
    let qaFaceToTrianglesMap = []; // polygonFaceIndex -> [triIdx0, triIdx1, ...]
    let qaModelCenter = new THREE.Vector3();
    let qaModelScale = 1.0;

    function initQA3DViewer() {
        qaCanvas = document.getElementById("qa-canvas3d");
        const container = document.getElementById("qa-viewport-container");
        if (!qaCanvas || !container) return;

        // Limpar caso já exista
        if (qaRenderer) {
            qaRenderer.dispose();
            qaRenderer = null;
        }

        qaScene = new THREE.Scene();
        qaCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        qaCamera.position.set(0, 0, 42);

        qaRenderer = new THREE.WebGLRenderer({
            canvas: qaCanvas,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        qaRenderer.setSize(container.clientWidth, container.clientHeight);
        qaRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Luzes equilibradas para inspeção precisa de superfícies
        qaScene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.85);
        dir1.position.set(15, 25, 20);
        qaScene.add(dir1);

        const dir2 = new THREE.DirectionalLight(0x38bdf8, 0.45);
        dir2.position.set(-15, -20, -15);
        qaScene.add(dir2);

        // OrbitControls
        if (window.THREE && window.THREE.OrbitControls) {
            qaControls = new THREE.OrbitControls(qaCamera, qaRenderer.domElement);
            qaControls.enableDamping = true;
            qaControls.dampingFactor = 0.06;
            qaControls.rotateSpeed = 0.85;
            qaControls.zoomSpeed = 1.0;
            qaControls.panSpeed = 0.8;
            qaControls.enablePan = true;
            qaControls.autoRotate = false;
        }

        // Redimensionamento
        window.addEventListener("resize", onQAResize);

        // Loop de Renderização
        function animateQA() {
            requestAnimationFrame(animateQA);
            if (qaControls) qaControls.update();
            qaRenderer.render(qaScene, qaCamera);
        }
        animateQA();

        // Raycasting interativo (clicar numa face/vértice)
        setupQARaycaster();
    }

    function onQAResize() {
        const container = document.getElementById("qa-viewport-container");
        if (!container || !qaCamera || !qaRenderer) return;
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        qaCamera.aspect = container.clientWidth / container.clientHeight;
        qaCamera.updateProjectionMatrix();
        qaRenderer.setSize(container.clientWidth, container.clientHeight);
    }

    /**
     * Analisa texto OBJ ou geometry { vertices, faces } e extrai polígonos reais
     */
    function extractPolygonsAndVertices(objText, geometryObj) {
        let vertices = [];
        let faces = [];

        if (geometryObj && Array.isArray(geometryObj.vertices) && Array.isArray(geometryObj.faces)) {
            // Formato flat [x0, y0, z0, x1, y1, z1, ...]
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

    /**
     * Constrói a geometria 3D no Three.js preservando os polígonos originais
     */
    function buildQAGeometry(vertices, polygonFaces) {
        if (!vertices || vertices.length === 0 || !polygonFaces || polygonFaces.length === 0) {
            return false;
        }

        qaParsedVertices = vertices;
        qaPolygonFaces = polygonFaces;

        // 1. Calcular centro e normalização de escala
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
            if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
            if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
        }

        qaModelCenter.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        const dimX = maxX - minX, dimY = maxY - minY, dimZ = maxZ - minZ;
        const maxDim = Math.max(dimX, dimY, dimZ);
        qaModelScale = maxDim > 0 ? (18 / maxDim) : 1;

        // Função de normalização
        const norm = (v) => [
            (v[0] - qaModelCenter.x) * qaModelScale,
            (v[1] - qaModelCenter.y) * qaModelScale,
            (v[2] - qaModelCenter.z) * qaModelScale
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

            // Triangulação fan: (0, 1, 2), (0, 2, 3), ...
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

        // Limpar malhas anteriores da cena
        if (qaMesh) { qaScene.remove(qaMesh); qaMesh.geometry.dispose(); qaMesh = null; }
        if (qaEdgesMesh) { qaScene.remove(qaEdgesMesh); qaEdgesMesh.geometry.dispose(); qaEdgesMesh = null; }
        if (qaPolesPoints) { qaScene.remove(qaPolesPoints); qaPolesPoints.geometry.dispose(); qaPolesPoints = null; }
        if (qaSelectionLine) { qaScene.remove(qaSelectionLine); qaSelectionLine.geometry.dispose(); qaSelectionLine = null; }

        // 3. Criar Mesh principal com vertexColors
        const triGeo = new THREE.BufferGeometry();
        triGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(triPositions), 3));
        triGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(triColors), 3));
        triGeo.computeVertexNormals();

        const baseMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            side: THREE.DoubleSide
        });

        qaMesh = new THREE.Mesh(triGeo, baseMat);
        qaScene.add(qaMesh);

        // 4. Criar Arestas dos Polígonos Originais (SEM diagonais de triangulação!)
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
            color: 0x38bdf8, // Ciano vivo
            transparent: true,
            opacity: 0.85,
            depthTest: true
        });

        qaEdgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
        qaEdgesMesh.visible = QAState.showEdges;
        qaScene.add(qaEdgesMesh);

        // 5. Criar Pontos dos Poles
        updateQAPolesLayer();

        // 6. Atualizar sombreamento e overlays
        updateQAVisualLayers();

        return true;
    }

    /**
     * Atualiza a camada de pontos dos Poles e vértices não-regulares
     */
    function updateQAPolesLayer() {
        if (!qaScene || !qaParsedVertices || qaParsedVertices.length === 0) return;

        if (qaPolesPoints) {
            qaScene.remove(qaPolesPoints);
            qaPolesPoints.geometry.dispose();
            qaPolesPoints = null;
        }

        const norm = (v) => [
            (v[0] - qaModelCenter.x) * qaModelScale,
            (v[1] - qaModelCenter.y) * qaModelScale,
            (v[2] - qaModelCenter.z) * qaModelScale
        ];

        const polesData = QAState.resultData?.poles || QAState.statusData?.summary?.poles;
        const poleVerts = QAState.resultData?.poles?.vertices || [];
        const poleValences = QAState.resultData?.poles?.valence || [];

        const ptsPos = [];
        const ptsColors = [];

        if (poleVerts && poleVerts.length > 0) {
            for (let i = 0; i < poleVerts.length; i++) {
                const vIdx = poleVerts[i];
                if (vIdx >= 0 && vIdx < qaParsedVertices.length) {
                    const p = norm(qaParsedVertices[vIdx]);
                    ptsPos.push(...p);

                    const val = poleValences[i] || 3;
                    if (val === 3) ptsColors.push(0.98, 0.75, 0.14); // Dourado
                    else if (val === 5) ptsColors.push(0.95, 0.45, 0.15); // Laranja
                    else if (val === 2) ptsColors.push(0.93, 0.25, 0.25); // Vermelho
                    else ptsColors.push(0.75, 0.35, 0.95); // Púrpura
                }
            }
        }

        if (ptsPos.length > 0) {
            const ptsGeo = new THREE.BufferGeometry();
            ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ptsPos), 3));
            ptsGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ptsColors), 3));

            const ptsMat = new THREE.PointsMaterial({
                size: 7,
                sizeAttenuation: false,
                vertexColors: true,
                transparent: true,
                opacity: 0.95,
                depthTest: true
            });

            qaPolesPoints = new THREE.Points(ptsGeo, ptsMat);
            qaPolesPoints.visible = QAState.showPoles;
            qaScene.add(qaPolesPoints);
        }
    }

    /**
     * Aplica cores na malha de acordo com o modo ativo:
     * - 'checks': overlays categóricos por prioridade de erro
     * - 'min_angle': heatmap contínuo do ângulo mínimo
     * - 'max_angle': heatmap contínuo do ângulo máximo
     * - 'valence': heatmap da valência por vértice
     */
    function updateQAVisualLayers() {
        if (!qaMesh || !qaTriangleToFaceMap) return;

        const colorAttr = qaMesh.geometry.attributes.color;
        if (!colorAttr) return;

        const res = QAState.resultData;
        const summary = QAState.statusData?.summary;
        const totalTris = qaTriangleToFaceMap.length;

        // PRIORIDADE OBRIGATÓRIA: degenerate > nonmanifold > flipped > overlap > resto
        const priorityOrder = [
            "degenerate",
            "nonmanifold",
            "flipped",
            "overlap",
            "t_junction",
            "open_edges",
            "collinear_vertices",
            "bad_quads",
            "ngons",
            "dup_faces"
        ];

        // 1. Mapear cada face ao seu check dominante ativo
        const faceColors = [];
        const hasTJunction = !!(summary?.checks?.t_junction && summary.checks.t_junction.count > 0);

        for (let f = 0; f < qaPolygonFaces.length; f++) {
            let assignedColor = null;

            if (QAState.activeViewMode === "checks") {
                // Verificar checks no result.json ou summary
                const activeChecksForFace = [];
                const checksObj = res?.checks || summary?.checks || {};

                for (const [key, checkData] of Object.entries(checksObj)) {
                    if (QAState.enabledChecks[key] === false) continue; // Desativado pelo utilizador
                    const faceList = checkData.faces || [];
                    if (faceList.includes(f)) {
                        activeChecksForFace.push(key);
                    }
                }

                if (activeChecksForFace.length > 0) {
                    // Ordenar por prioridade
                    activeChecksForFace.sort((a, b) => {
                        const prioA = priorityOrder.indexOf(a) !== -1 ? priorityOrder.indexOf(a) : 99;
                        const prioB = priorityOrder.indexOf(b) !== -1 ? priorityOrder.indexOf(b) : 99;
                        return prioA - prioB;
                    });
                    const dominant = activeChecksForFace[0];
                    const exp = getExplanation(dominant);
                    assignedColor = new THREE.Color(exp.color);
                } else {
                    // Sem erro: cinzento ardósia neutro e elegante
                    assignedColor = new THREE.Color(0x334155);
                }
            } else if (QAState.activeViewMode === "min_angle") {
                const angle = res?.per_face?.min_angle ? res.per_face.min_angle[f] : null;
                if (angle === null || angle === undefined) {
                    assignedColor = new THREE.Color(0x475569);
                } else {
                    // 20° a 90°
                    const t = Math.max(0, Math.min(1, (angle - 20) / 70));
                    assignedColor = angleToColor(t);
                }
            } else if (QAState.activeViewMode === "max_angle") {
                const angle = res?.per_face?.max_angle ? res.per_face.max_angle[f] : null;
                if (angle === null || angle === undefined) {
                    assignedColor = new THREE.Color(0x475569);
                } else {
                    // 90° a 180°
                    const t = Math.max(0, Math.min(1, (angle - 90) / 90));
                    assignedColor = angleToColorMax(t);
                }
            } else if (QAState.activeViewMode === "valence") {
                // Médio da valência dos vértices da face
                const fVerts = qaPolygonFaces[f];
                let sumVal = 0;
                for (let v of fVerts) {
                    sumVal += (res?.per_vertex?.valence ? res.per_vertex.valence[v] : 4);
                }
                const avg = sumVal / (fVerts.length || 1);
                assignedColor = valenceToColor(avg);
            }

            faceColors[f] = assignedColor || new THREE.Color(0x475569);
        }

        // Atribuir cores aos vértices dos triângulos correspondentes
        for (let t = 0; t < totalTris; t++) {
            const f = qaTriangleToFaceMap[t];
            const c = faceColors[f];
            const idx = t * 9;
            colorAttr.array[idx]     = c.r; colorAttr.array[idx + 1] = c.g; colorAttr.array[idx + 2] = c.b;
            colorAttr.array[idx + 3] = c.r; colorAttr.array[idx + 4] = c.g; colorAttr.array[idx + 5] = c.b;
            colorAttr.array[idx + 6] = c.r; colorAttr.array[idx + 7] = c.g; colorAttr.array[idx + 8] = c.b;
        }

        colorAttr.needsUpdate = true;
        qaMesh.material.needsUpdate = true;

        // Atualizar legenda de heatmap
        updateQAHeatmapLegend();
    }

    function angleToColor(t) {
        // Azul (agudo) -> Ciano -> Verde -> Amarelo -> Vermelho
        const c = new THREE.Color();
        if (t < 0.25) {
            c.setRGB(0.1 + t * 0.4, 0.4 + t * 1.5, 0.95);
        } else if (t < 0.5) {
            c.setRGB(0.2, 0.8 + (t - 0.25) * 0.8, 0.8 - (t - 0.25) * 2.5);
        } else if (t < 0.75) {
            c.setRGB(0.3 + (t - 0.5) * 2.5, 0.9, 0.1);
        } else {
            c.setRGB(0.95, 0.9 - (t - 0.75) * 3.0, 0.1);
        }
        return c;
    }

    function angleToColorMax(t) {
        // Verde (90°) -> Amarelo -> Laranja -> Vermelho (~180°)
        const c = new THREE.Color();
        if (t < 0.3) {
            c.setRGB(0.2 + t * 1.5, 0.85, 0.2);
        } else if (t < 0.7) {
            c.setRGB(0.9, 0.85 - (t - 0.3) * 1.2, 0.15);
        } else {
            c.setRGB(0.95, 0.35 - (t - 0.7) * 1.1, 0.2 + (t - 0.7) * 2.0); // Alerta Vermelho/Magenta em 180°
        }
        return c;
    }

    function valenceToColor(val) {
        const c = new THREE.Color();
        if (val < 2.5) return c.setHex(0xef4444); // 2: Vermelho
        if (val < 3.5) return c.setHex(0xfbbf24); // 3: Âmbar
        if (val < 4.5) return c.setHex(0x10b981); // 4: Verde regular
        if (val < 5.5) return c.setHex(0x38bdf8); // 5: Ciano
        if (val < 6.5) return c.setHex(0x10b981); // 6: Verde regular (triângulos)
        return c.setHex(0xa855f7);                // 7+: Púrpura
    }

    /**
     * Atualiza a barra de legenda flutuante no fundo do 3D
     */
    function updateQAHeatmapLegend() {
        const legendBox = document.getElementById("qa-heatmap-legend");
        if (!legendBox) return;

        if (QAState.activeViewMode === "checks") {
            legendBox.style.display = "none";
            return;
        }

        legendBox.style.display = "flex";
        const titleEl = document.getElementById("qa-legend-title");
        const minEl = document.getElementById("qa-legend-min");
        const maxEl = document.getElementById("qa-legend-max");
        const gradEl = document.getElementById("qa-legend-gradient");

        if (QAState.activeViewMode === "min_angle") {
            if (titleEl) titleEl.textContent = "🌡️ Ângulo Mínimo da Face (°)";
            if (minEl) minEl.textContent = "20.0°";
            if (maxEl) maxEl.textContent = "90.0°";
            if (gradEl) gradEl.style.background = "linear-gradient(to right, #38bdf8, #10b981, #f59e0b, #ef4444)";
        } else if (QAState.activeViewMode === "max_angle") {
            if (titleEl) titleEl.textContent = "🌡️ Ângulo Máximo da Face (°)";
            if (minEl) minEl.textContent = "90.0°";
            if (maxEl) maxEl.textContent = "180.0° (Colinear)";
            if (gradEl) gradEl.style.background = "linear-gradient(to right, #10b981, #fbbf24, #f97316, #ef4444)";
        } else if (QAState.activeViewMode === "valence") {
            if (titleEl) titleEl.textContent = "📊 Valência Média";
            if (minEl) minEl.textContent = "2 (Borda)";
            if (maxEl) maxEl.textContent = "7+ (Alto)";
            if (gradEl) gradEl.style.background = "linear-gradient(to right, #ef4444, #fbbf24, #10b981, #38bdf8, #a855f7)";
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. RAYCASTING INTERATIVO: MAPEAR TRIÂNGULO -> FACE ORIGINAL
    // ═══════════════════════════════════════════════════════════════════
    function setupQARaycaster() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        qaCanvas.addEventListener("click", (e) => {
            if (!qaMesh || !qaCamera || !qaTriangleToFaceMap) return;

            const rect = qaCanvas.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, qaCamera);
            const intersects = raycaster.intersectObject(qaMesh);

            if (intersects && intersects.length > 0) {
                const hit = intersects[0];
                const triIdx = hit.faceIndex;
                const origFaceIdx = qaTriangleToFaceMap[triIdx];
                if (origFaceIdx !== undefined) {
                    selectFaceInQA(origFaceIdx);
                }
            } else {
                // Clicar no espaço vazio fecha detalhes se não estiver focado
                // closeQADetailPanel();
            }
        });
    }

    /**
     * Destaca a face selecionada com contorno iluminado e abre os detalhes
     */
    function selectFaceInQA(faceIdx) {
        QAState.selectedFaceIdx = faceIdx;
        if (!qaPolygonFaces[faceIdx]) return;

        // 1. Desenhar linha de seleção sobre o contorno da face
        if (qaSelectionLine) {
            qaScene.remove(qaSelectionLine);
            qaSelectionLine.geometry.dispose();
            qaSelectionLine = null;
        }

        const fVerts = qaPolygonFaces[faceIdx];
        const linePts = [];
        const norm = (v) => [
            (v[0] - qaModelCenter.x) * qaModelScale,
            (v[1] - qaModelCenter.y) * qaModelScale,
            (v[2] - qaModelCenter.z) * qaModelScale
        ];

        for (let i = 0; i < fVerts.length; i++) {
            const a = fVerts[i];
            const b = fVerts[(i + 1) % fVerts.length];
            linePts.push(...norm(qaParsedVertices[a]), ...norm(qaParsedVertices[b]));
        }

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePts), 3));
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            linewidth: 3,
            depthTest: false
        });

        qaSelectionLine = new THREE.LineSegments(lineGeo, lineMat);
        qaScene.add(qaSelectionLine);

        // 2. Preencher e apresentar o painel de detalhes da face
        showQAFaceDetails(faceIdx);
    }

    /**
     * Preenche os dados completos da face no painel de inspeção
     */
    function showQAFaceDetails(faceIdx) {
        const detailPanel = document.getElementById("qa-detail-panel");
        if (!detailPanel) return;

        detailPanel.style.display = "block";
        const fVerts = qaPolygonFaces[faceIdx] || [];
        const res = QAState.resultData;
        const summary = QAState.statusData?.summary;

        // Título e Índice
        const titleEl = document.getElementById("qa-detail-title");
        const typeEl = document.getElementById("qa-detail-type");
        const idxEl = document.getElementById("qa-detail-idx");

        let faceType = "Polígono";
        if (fVerts.length === 3) faceType = "Triângulo (3 vértices)";
        else if (fVerts.length === 4) faceType = "Quad (4 vértices)";
        else faceType = `N-gon (${fVerts.length} vértices)`;

        if (titleEl) titleEl.textContent = `Face #${faceIdx}`;
        if (typeEl) typeEl.textContent = faceType;
        if (idxEl) idxEl.textContent = `#${faceIdx}`;

        // Métricas de Ângulos
        const minAngle = res?.per_face?.min_angle ? res.per_face.min_angle[faceIdx] : null;
        const maxAngle = res?.per_face?.max_angle ? res.per_face.max_angle[faceIdx] : null;

        const minAngleEl = document.getElementById("qa-detail-min-angle");
        const maxAngleEl = document.getElementById("qa-detail-max-angle");

        if (minAngleEl) minAngleEl.textContent = minAngle !== null ? `${minAngle.toFixed(1)}°` : "--";
        if (maxAngleEl) {
            maxAngleEl.textContent = maxAngle !== null ? `${maxAngle.toFixed(1)}°` : "--";
            if (maxAngle && maxAngle >= 175) {
                maxAngleEl.innerHTML += ` <span class="qa-badge warning" title="Vértices colineares detectados">~180° Colinear</span>`;
            }
        }

        // Erros que afetam esta face
        const errorsListEl = document.getElementById("qa-detail-errors");
        if (errorsListEl) {
            errorsListEl.innerHTML = "";
            const matchedErrors = [];
            const checksObj = res?.checks || summary?.checks || {};

            for (const [key, checkData] of Object.entries(checksObj)) {
                const faceList = checkData.faces || [];
                if (faceList.includes(faceIdx)) {
                    matchedErrors.push(key);
                }
            }

            if (matchedErrors.length === 0) {
                errorsListEl.innerHTML = `<span class="qa-tag ok">✅ Sem erros detetados nesta face</span>`;
            } else {
                matchedErrors.forEach(errKey => {
                    const exp = getExplanation(errKey, { max_angle: maxAngle });
                    const tag = document.createElement("div");
                    tag.className = `qa-error-pill ${exp.severity}`;
                    tag.innerHTML = `
                        <div class="qa-pill-header">
                            <span class="qa-dot" style="background:${exp.color};"></span>
                            <strong>${exp.title}</strong>
                        </div>
                        <p class="qa-pill-desc">${exp.why}</p>
                    `;
                    errorsListEl.appendChild(tag);
                });
            }
        }

        // Vértices e respetivas valências
        const vertsListEl = document.getElementById("qa-detail-verts");
        if (vertsListEl) {
            vertsListEl.innerHTML = "";
            fVerts.forEach(vIdx => {
                const val = res?.per_vertex?.valence ? res.per_vertex.valence[vIdx] : "--";
                const isPole = res?.poles?.vertices ? res.poles.vertices.includes(vIdx) : false;
                const chip = document.createElement("span");
                chip.className = `qa-vert-chip ${isPole ? 'pole' : ''}`;
                chip.textContent = `V${vIdx} (Val: ${val})`;
                vertsListEl.appendChild(chip);
            });
        }
    }

    function closeQADetailPanel() {
        const detailPanel = document.getElementById("qa-detail-panel");
        if (detailPanel) detailPanel.style.display = "none";
        if (qaSelectionLine) {
            qaScene.remove(qaSelectionLine);
            qaSelectionLine.geometry.dispose();
            qaSelectionLine = null;
        }
    }

    /**
     * Foca e faz zoom suave sobre as faces afetadas por um check específico
     */
    function focusQAFaces(faceIndices) {
        if (!faceIndices || faceIndices.length === 0 || !qaCamera || !qaControls) return;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        const norm = (v) => [
            (v[0] - qaModelCenter.x) * qaModelScale,
            (v[1] - qaModelCenter.y) * qaModelScale,
            (v[2] - qaModelCenter.z) * qaModelScale
        ];

        faceIndices.forEach(fIdx => {
            const fVerts = qaPolygonFaces[fIdx] || [];
            fVerts.forEach(vIdx => {
                const p = norm(qaParsedVertices[vIdx]);
                if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
                if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
                if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
            });
        });

        if (isFinite(minX) && isFinite(maxX)) {
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const centerZ = (minZ + maxZ) / 2;
            qaControls.target.set(centerX, centerY, centerZ);
            qaControls.update();

            // Seleciona a primeira face para inspecionar
            selectFaceInQA(faceIndices[0]);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. RENDERIZAÇÃO DA UI & PAINÉIS LATERAIS DO MESH QA
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Veredito curto derivado dos dados reais: nunca inventar uma pontuação
     */
    function deriveQAVerdict(summary) {
        if (!summary) return "Estado desconhecido";
        const checks = summary.checks || {};
        let critCount = 0;
        let warnCount = 0;
        let totalIssues = 0;

        const criticalTypes = ["degenerate", "nonmanifold", "flipped", "t_junction"];

        for (const [key, check] of Object.entries(checks)) {
            const c = check.count || 0;
            if (c > 0) {
                totalIssues += c;
                if (criticalTypes.includes(key)) critCount += c;
                else if (key !== "poles" && key !== "collinear_vertices") warnCount += c;
            }
        }

        const watertight = summary.topology?.is_watertight;
        const parts = [];
        if (critCount > 0) parts.push(`⚠️ ${critCount} erro(s) crítico(s)`);
        if (warnCount > 0) parts.push(`${warnCount} aviso(s) topológico(s)`);
        if (watertight === false) parts.push("Não estanque (open edges)");

        if (parts.length === 0) return "✅ Sem erros críticos • Malha aprovada";
        return parts.join(" • ");
    }

    /**
     * Renderiza todo o painel de UI com os dados do status e result
     */
    function renderQAUI() {
        const stat = QAState.statusData;
        const summary = stat?.summary;
        const res = QAState.resultData;

        if (!summary) return;

        // A) Cabeçalho
        const titleEl = document.getElementById("qa-header-title");
        const statusEl = document.getElementById("qa-header-status");
        const durationEl = document.getElementById("qa-header-duration");
        const verdictEl = document.getElementById("qa-header-verdict");

        if (titleEl) titleEl.textContent = QAState.activeMeshName || stat.mesh_id || "Malha Analisada";
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

        // B) Cartões de Métricas e Topologia
        renderQATopology(summary.topology, summary.angles_deg, summary.valence_histogram);

        // C) Lista Dinâmica de Verificações (Checks)
        renderQAChecksList(summary.checks, res?.checks);

        // D) Painel de Limitações e Avisos
        renderQALimitations(summary.limitations, summary.warnings);
    }

    /**
     * Renderiza o estado de falha na análise (com o campo error)
     */
    function renderQAFailed(statusData) {
        const titleEl = document.getElementById("qa-header-title");
        const statusEl = document.getElementById("qa-header-status");
        const durationEl = document.getElementById("qa-header-duration");
        const verdictEl = document.getElementById("qa-header-verdict");

        if (titleEl) titleEl.textContent = QAState.activeMeshName || statusData?.mesh_id || "Malha Analisada";
        if (statusEl) {
            statusEl.className = "status-badge offline";
            statusEl.textContent = "Falhou";
        }
        if (durationEl && statusData?.created_at && statusData?.finished_at) {
            const start = new Date(statusData.created_at).getTime();
            const end = new Date(statusData.finished_at).getTime();
            const diffMs = Math.max(0, end - start);
            durationEl.textContent = diffMs > 1000 ? `${(diffMs / 1000).toFixed(2)}s` : `${diffMs}ms`;
        }
        if (verdictEl) {
            verdictEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">❌ Análise falhou:</span> <span style="color:#fca5a5;">${escapeHTML(statusData?.error || "Erro interno do pipeline")}</span>`;
        }
    }

    function renderQATopology(topo, angles, valenceHist) {
        if (!topo) return;

        // Watertight & Manifold
        const wtEl = document.getElementById("qa-topo-watertight");
        if (wtEl) {
            wtEl.innerHTML = topo.is_watertight
                ? `<span class="qa-badge ok">Sim (Hermética)</span>`
                : `<span class="qa-badge critical">Não (Com Aberturas)</span>`;
        }

        const mfEl = document.getElementById("qa-topo-manifold");
        if (mfEl) {
            mfEl.innerHTML = topo.is_manifold
                ? `<span class="qa-badge ok">Sim (2-Manifold)</span>`
                : `<span class="qa-badge critical">Não (Não-Manifold)</span>`;
        }

        const eulerEl = document.getElementById("qa-topo-euler");
        if (eulerEl) eulerEl.textContent = topo.euler_characteristic ?? "--";

        const shellsEl = document.getElementById("qa-topo-shells");
        if (shellsEl) shellsEl.textContent = topo.shells ?? "--";

        const boundEl = document.getElementById("qa-topo-boundary-edges");
        if (boundEl) boundEl.textContent = (topo.boundary_edges || 0).toLocaleString();

        const nonManEl = document.getElementById("qa-topo-nonman-edges");
        if (nonManEl) nonManEl.textContent = (topo.nonmanifold_edges || 0).toLocaleString();

        // Contagens de Faces
        const totalFaces = topo.faces || 1;
        const tris = topo.tris || 0;
        const quads = topo.quads || 0;
        const ngons = topo.ngons || topo.raw_ngons || 0;

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

        if (barTris) { barTris.style.width = `${trisPct}%`; barTris.title = `Tris: ${tris} (${trisPct}%)`; }
        if (barQuads) { barQuads.style.width = `${quadsPct}%`; barQuads.title = `Quads: ${quads} (${quadsPct}%)`; }
        if (barNgons) { barNgons.style.width = `${ngonsPct}%`; barNgons.title = `N-gons: ${ngons} (${ngonsPct}%)`; }

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

    /**
     * Renderiza a lista dinâmica de checks (itera sobre as chaves sem hardcoding)
     */
    function renderQAChecksList(summaryChecks, resultChecks) {
        const container = document.getElementById("qa-checks-list");
        if (!container || !summaryChecks) return;

        container.innerHTML = "";
        const skippedList = QAState.params.skip || [];
        const hasTJunction = !!(summaryChecks.t_junction && summaryChecks.t_junction.count > 0);

        for (const [key, checkData] of Object.entries(summaryChecks)) {
            // Inicializar toggle se não existir
            if (QAState.enabledChecks[key] === undefined) {
                QAState.enabledChecks[key] = true;
            }

            const count = checkData.count || 0;
            const ratio = checkData.ratio || 0;
            const ratioPct = (ratio * 100).toFixed(1) + "%";
            const isSkipped = skippedList.includes(key);

            const exp = getExplanation(key, null, hasTJunction);
            const facesAffected = (resultChecks && resultChecks[key]?.faces) || checkData.faces || [];

            const card = document.createElement("div");
            card.className = `qa-check-item ${count > 0 ? exp.severity : 'ok'} ${isSkipped ? 'skipped' : ''}`;

            card.innerHTML = `
                <div class="qa-check-header">
                    <label class="qa-checkbox-label" title="Alternar visualização deste erro no modelo 3D">
                        <input type="checkbox" class="qa-check-toggle" data-key="${key}" ${QAState.enabledChecks[key] ? 'checked' : ''}>
                        <span class="qa-custom-checkbox" style="--check-color:${exp.color}"></span>
                    </label>

                    <div class="qa-check-title-group" style="cursor:pointer;" title="Clique para expandir explicação">
                        <div class="qa-check-title-row">
                            <span class="qa-check-dot" style="background:${exp.color}"></span>
                            <span class="qa-check-name">${exp.title}</span>
                            ${isSkipped ? '<span class="qa-tag skipped">Saltado</span>' : (count === 0 ? '<span class="qa-tag ok">0 Erros (OK)</span>' : `<span class="qa-tag ${exp.severity}">${count} faces</span>`)}
                        </div>
                        <div class="qa-check-meta">
                            <span>Ratio: <strong>${ratioPct}</strong></span>
                            ${facesAffected.length > 0 ? `<button class="qa-btn-focus-faces" type="button" data-key="${key}">🎯 Focar no 3D (${facesAffected.length})</button>` : ''}
                        </div>
                    </div>

                    <button class="qa-btn-accordion-toggle" title="Ver explicação detalhada">▼</button>
                </div>

                <div class="qa-check-explanation" style="display:none;">
                    <div class="qa-exp-row">
                        <strong>📌 O que é:</strong>
                        <p>${exp.what}</p>
                    </div>
                    <div class="qa-exp-row">
                        <strong>⚠️ Porque importa:</strong>
                        <p>${exp.why}</p>
                    </div>
                    <div class="qa-exp-row">
                        <strong>🛠️ Como corrigir:</strong>
                        <p>${exp.how}</p>
                    </div>
                </div>
            `;

            // Eventos do Card
            const toggleCb = card.querySelector(".qa-check-toggle");
            toggleCb.addEventListener("change", (e) => {
                QAState.enabledChecks[key] = e.target.checked;
                updateQAVisualLayers();
            });

            const focusBtn = card.querySelector(".qa-btn-focus-faces");
            if (focusBtn && facesAffected.length > 0) {
                focusBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    focusQAFaces(facesAffected);
                });
            }

            const headerGroup = card.querySelector(".qa-check-title-group");
            const expToggleBtn = card.querySelector(".qa-btn-accordion-toggle");
            const expBox = card.querySelector(".qa-check-explanation");

            const toggleAccordion = () => {
                const isOpen = expBox.style.display !== "none";
                expBox.style.display = isOpen ? "none" : "block";
                expToggleBtn.textContent = isOpen ? "▼" : "▲";
                if (!isOpen && facesAffected.length > 0) {
                    focusQAFaces(facesAffected);
                }
            };

            headerGroup.addEventListener("click", toggleAccordion);
            expToggleBtn.addEventListener("click", toggleAccordion);

            container.appendChild(card);
        }
    }

    function renderQALimitations(limitations, warnings) {
        const limListEl = document.getElementById("qa-limitations-list");
        const warnListEl = document.getElementById("qa-warnings-list");

        if (limListEl) {
            limListEl.innerHTML = "";
            if (limitations && limitations.length > 0) {
                limitations.forEach(lim => {
                    const li = document.createElement("li");
                    li.textContent = lim;
                    limListEl.appendChild(li);
                });
            } else {
                limListEl.innerHTML = `<li style="color:#64748b;">Nenhuma limitação reportada.</li>`;
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

    // ═══════════════════════════════════════════════════════════════════
    //  6. EXECUÇÃO DA ANÁLISE (LIVE API & FIXTURES FALLBACK)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Carrega e aplica os dados de análise no sistema
     */
    async function loadQAData(statusJson, resultJson, rawObjText) {
        QAState.statusData = statusJson;
        QAState.resultData = resultJson;
        QAState.rawObjText = rawObjText;

        // Extrair polígonos reais
        const { vertices, faces } = extractPolygonsAndVertices(rawObjText, resultJson?.geometry);
        buildQAGeometry(vertices, faces);

        renderQAUI();

        // Atualizar crachá na barra de topo
        const navBadge = document.getElementById("qa-nav-badge");
        if (navBadge) {
            const issueCount = statusJson?.summary?.issue_faces || (resultJson?.issue_faces ? resultJson.issue_faces.length : 0);
            if (issueCount > 0) {
                navBadge.style.display = "inline-flex";
                navBadge.textContent = `${issueCount} erros`;
                navBadge.className = "nav-badge-pill warning";
            } else {
                navBadge.style.display = "inline-flex";
                navBadge.textContent = "OK";
                navBadge.className = "nav-badge-pill ok";
            }
        }
    }

    /**
     * Executa a análise assíncrona contra a API (ou fixture fallback se falhar)
     */
    async function runQAAnalysis(meshId) {
        const idToRun = meshId || QAState.activeMeshId || "53296970-b86b-4c00-97be-778bbbb39cf8";
        const btnRun = document.getElementById("btn-qa-run");
        const statusEl = document.getElementById("qa-header-status");

        if (btnRun) {
            btnRun.disabled = true;
            btnRun.innerHTML = `<span>⏳ A Auditar...</span>`;
        }
        if (statusEl) {
            statusEl.className = "status-badge working";
            statusEl.textContent = "A Analisar...";
        }

        try {
            // 1. Executar polling até concluir
            const statusResult = await window.MeshQAAPI.runFullAnalysis(
                idToRun,
                QAState.params,
                (statusUpdate) => {
                    if (statusEl) {
                        statusEl.className = "status-badge working";
                        statusEl.textContent = statusUpdate.status === "queued" ? "Em Fila..." : "A Processar...";
                    }
                }
            );

            if (statusResult && statusResult.status === "failed") {
                renderQAFailed(statusResult);
                return;
            }

            // 2. Descarregar resultado detalhado (result.json)
            const resultData = await window.MeshQAAPI.downloadAnalysisResult(idToRun, true);

            // 3. Tentar obter o OBJ original da API ou fixture
            let objText = QAState.rawObjText || window.cachedSimplifiedObjText;
            if (!objText) {
                try {
                    objText = await window.RetopoAPI.downloadSimplifiedMesh(idToRun);
                } catch (_) {
                    // Fallback para geometria incluída no result.json
                }
            }

            await loadQAData(statusResult, resultData, objText);

        } catch (err) {
            console.warn("[Mesh QA] Falha ao comunicar com a API:", err.message);
            // Notificação ao utilizador
            alert(`Aviso ao consultar API (${err.message}). A carregar fixtures locais para validação...`);
            await loadQAFromFixtures();
        } finally {
            if (btnRun) {
                btnRun.disabled = false;
                btnRun.innerHTML = `<span>⚡ Analisar Novamente</span>`;
            }
        }
    }

    /**
     * Carrega as fixtures oficiais fornecidas pelo utilizador
     */
    async function loadQAFromFixtures() {
        try {
            const { status, result, objText } = await window.MeshQAAPI.loadLocalFixtures();
            QAState.activeMeshId = status.mesh_id || "53296970-b86b-4c00-97be-778bbbb39cf8";
            QAState.activeMeshName = "Fixture de Teste (16 faces / 10 ngons)";
            await loadQAData(status, result, objText);
        } catch (err) {
            console.error("[Mesh QA Fixtures] Erro ao carregar fixtures locais:", err);
            alert(`Erro ao carregar fixtures: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  7. LIGAÇÃO DE CONTROLOS & EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════════
    function setupQAEventListeners() {
        // Navegação entre ecrãs (Retopologia vs Mesh QA)
        const navRetopo = document.getElementById("nav-btn-retopo");
        const navQA = document.getElementById("nav-btn-qa");
        const retopoView = document.getElementById("retopo-main-view");
        const qaView = document.getElementById("qa-main-view");

        function showScreen(screen) {
            if (screen === "qa") {
                if (retopoView) retopoView.style.display = "none";
                if (qaView) qaView.style.display = "flex";
                if (navRetopo) navRetopo.classList.remove("active");
                if (navQA) navQA.classList.add("active");

                // Redimensionar e renderizar viewport QA
                setTimeout(() => {
                    onQAResize();
                    if (!qaMesh && !QAState.statusData) {
                        loadQAFromFixtures();
                    }
                }, 50);
            } else {
                if (retopoView) retopoView.style.display = "flex";
                if (qaView) qaView.style.display = "none";
                if (navRetopo) navRetopo.classList.add("active");
                if (navQA) navQA.classList.remove("active");
                window.dispatchEvent(new Event("resize"));
            }
        }

        if (navRetopo) navRetopo.addEventListener("click", () => showScreen("retopo"));
        if (navQA) navQA.addEventListener("click", () => showScreen("qa"));

        // Botão de acesso direto no modal inicial
        const btnModalOpenQA = document.getElementById("btn-modal-open-qa");
        if (btnModalOpenQA) {
            btnModalOpenQA.addEventListener("click", () => {
                const uploadModal = document.getElementById("upload-modal");
                const mainApp = document.getElementById("main-app");
                if (uploadModal) uploadModal.classList.add("hidden");
                if (mainApp) {
                    mainApp.style.filter = "none";
                    mainApp.style.pointerEvents = "all";
                }
                showScreen("qa");
            });
        }

        // Botão de acesso rápido a partir da barra de retopologia
        const btnOpenQAFromRetopo = document.getElementById("btn-open-qa-from-retopo");
        if (btnOpenQAFromRetopo) {
            btnOpenQAFromRetopo.addEventListener("click", () => {
                showScreen("qa");
                // Se já temos um modelo otimizado, executa análise
                if (window.currentActiveModelId) {
                    runQAAnalysis(window.currentActiveModelId);
                }
            });
        }

        // Botões de Ação no Topo do QA
        const btnRun = document.getElementById("btn-qa-run");
        if (btnRun) {
            btnRun.addEventListener("click", () => runQAAnalysis());
        }

        const btnLoadFixture = document.getElementById("btn-qa-fixture");
        if (btnLoadFixture) {
            btnLoadFixture.addEventListener("click", () => loadQAFromFixtures());
        }

        const btnDownloadResult = document.getElementById("btn-qa-download-result");
        if (btnDownloadResult) {
            btnDownloadResult.addEventListener("click", () => {
                if (!QAState.resultData) return;
                const blob = new Blob([JSON.stringify(QAState.resultData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `qa_result_${QAState.activeMeshId || "mesh"}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        // Seletor de Modo no 3D: Checks, Ângulo Mín, Ângulo Máx, Valência
        const btnModeChecks = document.getElementById("qa-mode-checks");
        const btnModeMinAngle = document.getElementById("qa-mode-min-angle");
        const btnModeMaxAngle = document.getElementById("qa-mode-max-angle");
        const btnModeValence = document.getElementById("qa-mode-valence");

        const modeButtons = [btnModeChecks, btnModeMinAngle, btnModeMaxAngle, btnModeValence];

        function setActiveMode(mode, targetBtn) {
            QAState.activeViewMode = mode;
            modeButtons.forEach(b => { if (b) b.classList.remove("active"); });
            if (targetBtn) targetBtn.classList.add("active");
            updateQAVisualLayers();
        }

        if (btnModeChecks) btnModeChecks.addEventListener("click", () => setActiveMode("checks", btnModeChecks));
        if (btnModeMinAngle) btnModeMinAngle.addEventListener("click", () => setActiveMode("min_angle", btnModeMinAngle));
        if (btnModeMaxAngle) btnModeMaxAngle.addEventListener("click", () => setActiveMode("max_angle", btnModeMaxAngle));
        if (btnModeValence) btnModeValence.addEventListener("click", () => setActiveMode("valence", btnModeValence));

        // Toggles no 3D: Arestas, Poles, Superfície, Reset Câmara
        const btnToggleEdges = document.getElementById("qa-toggle-edges");
        if (btnToggleEdges) {
            btnToggleEdges.addEventListener("click", () => {
                QAState.showEdges = !QAState.showEdges;
                btnToggleEdges.classList.toggle("active", QAState.showEdges);
                if (qaEdgesMesh) qaEdgesMesh.visible = QAState.showEdges;
            });
        }

        const btnTogglePoles = document.getElementById("qa-toggle-poles");
        if (btnTogglePoles) {
            btnTogglePoles.addEventListener("click", () => {
                QAState.showPoles = !QAState.showPoles;
                btnTogglePoles.classList.toggle("active", QAState.showPoles);
                if (qaPolesPoints) qaPolesPoints.visible = QAState.showPoles;
            });
        }

        const btnToggleSurface = document.getElementById("qa-toggle-surface");
        if (btnToggleSurface) {
            btnToggleSurface.addEventListener("click", () => {
                QAState.showSurface = !QAState.showSurface;
                btnToggleSurface.classList.toggle("active", QAState.showSurface);
                if (qaMesh) qaMesh.visible = QAState.showSurface;
            });
        }

        const btnResetCam = document.getElementById("qa-reset-camera");
        if (btnResetCam) {
            btnResetCam.addEventListener("click", () => {
                if (qaCamera && qaControls) {
                    qaCamera.position.set(0, 0, 42);
                    qaControls.target.set(0, 0, 0);
                    qaControls.update();
                }
            });
        }

        // Botão Fechar Painel de Detalhes
        const btnCloseDetail = document.getElementById("qa-detail-close");
        if (btnCloseDetail) {
            btnCloseDetail.addEventListener("click", closeQADetailPanel);
        }

        // Abas da Barra Lateral do QA
        const tabBtnChecks = document.getElementById("qa-tab-btn-checks");
        const tabBtnTopology = document.getElementById("qa-tab-btn-topology");
        const tabBtnLimitations = document.getElementById("qa-tab-btn-limitations");

        const paneChecks = document.getElementById("qa-pane-checks");
        const paneTopology = document.getElementById("qa-pane-topology");
        const paneLimitations = document.getElementById("qa-pane-limitations");

        function setQASidebarTab(tab) {
            [tabBtnChecks, tabBtnTopology, tabBtnLimitations].forEach(b => { if (b) b.classList.remove("active"); });
            [paneChecks, paneTopology, paneLimitations].forEach(p => { if (p) p.style.display = "none"; });

            if (tab === "checks") {
                if (tabBtnChecks) tabBtnChecks.classList.add("active");
                if (paneChecks) paneChecks.style.display = "block";
            } else if (tab === "topology") {
                if (tabBtnTopology) tabBtnTopology.classList.add("active");
                if (paneTopology) paneTopology.style.display = "block";
            } else if (tab === "limitations") {
                if (tabBtnLimitations) tabBtnLimitations.classList.add("active");
                if (paneLimitations) paneLimitations.style.display = "block";
            }
        }

        if (tabBtnChecks) tabBtnChecks.addEventListener("click", () => setQASidebarTab("checks"));
        if (tabBtnTopology) tabBtnTopology.addEventListener("click", () => setQASidebarTab("topology"));
        if (tabBtnLimitations) tabBtnLimitations.addEventListener("click", () => setQASidebarTab("limitations"));
    }

    // Inicialização ao carregar a página
    window.addEventListener("DOMContentLoaded", () => {
        initQA3DViewer();
        setupQAEventListeners();
    });

    // Exportar API global para integração externa
    window.MeshQA = {
        loadData: loadQAData,
        runAnalysis: runQAAnalysis,
        loadFixtures: loadQAFromFixtures,
        focusFaces: focusQAFaces,
        selectFace: selectFaceInQA,
        state: QAState
    };

})();
