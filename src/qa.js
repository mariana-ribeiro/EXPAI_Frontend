/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MESH QA / DSS CONTROLLER (UNIFIED STUDIO)
 *  Auditoria e Controlo de Qualidade Topológico de Malhas 3D
 *  Integrado no Viewport 3D Único e Barra Lateral do Retopo Tool
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════
    //  1. DICIONÁRIO DE EXPLICAÇÕES EM PORTUGUÊS (RIGOROSO E DIDÁTICO)
    // ═══════════════════════════════════════════════════════════════════
    const QA_EXPLANATIONS = {
        // ── Erros: a malha não serve como está ──────────────────────────
        holes: {
            title: "Buracos",
            category: "Estanquicidade",
            severity: "error",
            color: "#eab308", // Amarelo
            what: "Sítios onde a superfície não está fechada: arestas com uma só face. Inclui as fendas: um vértice pousado numa aresta sem estar ligado a ela. Numa fenda as duas arestas ficam uma sobre a outra e a malha parece fechada.",
            why: () => "Uma malha aberta não tem interior: falha em booleanas, impressão 3D e cálculo de volume, e vê-se através dela.",
            how: "Fechar o buraco (Fill / Grid Fill); numa fenda, fundir os vértices (Merge by Distance)."
        },
        flipped_normals: {
            title: "Normais Invertidas",
            category: "Orientação",
            severity: "error",
            color: "#ec4899", // Rosa
            what: "Faces viradas ao contrário: contra as faces vizinhas, ou uma parte fechada inteira virada para dentro (do avesso).",
            why: () => "A face aparece escura ou invisível (backface culling), o sombreamento suave estraga-se e o volume e as booleanas ficam errados.",
            how: "Recalcular as normais para fora (Recalculate Outside) ou inverter as faces assinaladas (Flip)."
        },
        overlaps: {
            title: "Sobreposições",
            category: "Geometria",
            severity: "error",
            color: "#8b5cf6", // Púrpura
            what: "Faces que atravessam outra face, que se dobram até tocar na mesma parte, ou que repetem outra face (os mesmos vértices).",
            why: () => "A superfície fura-se a si própria ou tem duas faces no mesmo sítio: interior ambíguo, cintilação no render (z-fighting), booleanas e impressão 3D falham.",
            how: "Apagar as faces repetidas; afastar as que se cruzam (Slide / Grab) ou refazer a zona dobrada."
        },
        nonmanifold: {
            title: "Não-Manifold",
            category: "Integridade",
            severity: "error",
            color: "#f97316", // Laranja
            what: "Arestas com 3 ou mais faces, ou vértices onde duas peças se tocam num só ponto. O defeito é a aresta ou o vértice, não as faces à volta.",
            why: () => "A superfície deixa de ter um lado de dentro e um de fora: quebra booleanas, subdivisão e impressão 3D.",
            how: "Separar as peças (Rip / Split) ou apagar as faces a mais (muitas vezes faces internas)."
        },
        broken_faces: {
            title: "Faces Inválidas",
            category: "Geometria",
            severity: "error",
            color: "#ef4444", // Vermelho
            what: "Faces sem área ou com um vértice repetido (degeneradas), ou com o contorno cruzado, como um quad em laço (torcidas). Muitas vezes tapam uma T-junction: um vértice pousado na aresta da face ao lado, que conta em N-gons.",
            why: () => "Normais indefinidas: artefactos de sombreamento, subdivisão imprevisível e instabilidade em simulações.",
            how: "Degeneradas: apagar ou fundir os vértices (Merge by Distance). Numa T-junction, apagar a face sem área e ligar o vértice pousado à face do lado (Knife / Connect). Torcidas: trocar a ordem dos vértices ou refazer a face."
        },
        // ── Avisos: funciona, mas um modelador corrigia ────────────────
        ngons: {
            title: "N-gons",
            category: "Topologia",
            severity: "warning",
            color: "#3b82f6", // Azul
            what: "Faces com 5 ou mais vértices, e faces com um vértice de uma T-junction pousado num lado, escondido por uma face sem área (essa conta em Faces Inválidas): num modelador são n-gons. Um vértice a meio de um lado reto também conta: o painel da face diz quantos cantos ela tem de facto.",
            why: () => "Subdivisão, UVs e game engines esperam quads ou triângulos; um n-gon é triangulado à sorte e pode sombrear mal.",
            how: "Dividir a face em quads (Knife / Connect); um vértice a meio de um lado reto sai com Dissolve Vertices."
        },
        distorted_faces: {
            title: "Faces Deformadas",
            category: "Qualidade",
            severity: "warning",
            color: "#06b6d4", // Ciano
            what: "Quads com ângulos fora dos limites, quads muito mais compridos do que largos (5:1 por defeito), e faces cujos vértices não estão no mesmo plano.",
            why: () => "Esticam texturas, dão sombreamento em faixas ou vincos e deformam mal em animação.",
            how: "Relaxar os vértices (Relax / Smooth), acrescentar loops na direção comprida ou planificar a face (Flatten)."
        }
    };

    /** O tipo de cada defeito, nas verificações que juntam vários. */
    const BREAKDOWN_LABELS = {
        holes: { open_edges: "arestas abertas", cracks: "fendas" },
        ngons: { ngons: "com 5+ vértices", t_junctions: "T-junction tapada" },
        flipped_normals: { against_neighbours: "contra as vizinhas", inside_out: "do avesso", inside_out_parts: null },
        overlaps: { crossing: "a cruzar", duplicates: "repetidas" },
        nonmanifold: { edges: "arestas", vertices: "vértices" },
        broken_faces: { degenerate: "sem área", twisted: "torcidas" },
        distorted_faces: { bad_angles: "ângulos maus", thin: "esguias", nonplanar: "não planas" },
    };
    /** Porque é que esta face conta numa verificação que junta vários tipos, com o valor medido. */
    function faceKindText(key, apiCheck, faceIdx, res) {
        if (key === "ngons") {
            // A face do outro lado de uma T-junction tapada por uma face sem área.
            const covers = Object.entries(res?.checks?.broken_faces?.hosts || {})
                .filter(([, hostFaces]) => hostFaces.includes(faceIdx))
                .map(([cover]) => `#${cover}`);
            const size = qaPolygonFaces?.[faceIdx]?.length;
            const parts = [];
            if (size > 4) parts.push(`${size} vértices`);
            if (covers.length) parts.push(`tem uma T-junction num lado, tapada pela face sem área ${covers.join(", ")}`);
            return parts.join(", ");
        }
        const byKind = apiCheck?.by_kind;
        if (!byKind) return "";
        const labels = BREAKDOWN_LABELS[key] || {};
        const perFace = res?.per_face || {};
        const fmt = (v, digits = 1) => (v === null || v === undefined) ? "--" : Number(v).toFixed(digits);
        const parts = [];
        for (const [kind, items] of Object.entries(byKind)) {
            if (!Array.isArray(items) || !items.includes(faceIdx)) continue;
            if (key === "distorted_faces" && kind === "bad_angles") {
                parts.push(`ângulos ${fmt(perFace.min_angle?.[faceIdx], 0)}°–${fmt(perFace.max_angle?.[faceIdx], 0)}°`);
            } else if (key === "distorted_faces" && kind === "thin") {
                const ar = perFace.aspect_ratio?.[faceIdx];
                parts.push(`esguia (${ar > 999 ? ">999" : fmt(ar)}:1)`);
            } else if (key === "distorted_faces" && kind === "nonplanar") {
                const dev = perFace.plane_deviation?.[faceIdx];
                parts.push(`não plana (${dev === null || dev === undefined ? "--" : (dev * 100).toFixed(1)}% fora do plano)`);
            } else if (key === "broken_faces" && kind === "degenerate") {
                const host = degenerateHost.get(faceIdx);
                parts.push(host === undefined
                    ? "sem área (é uma linha)"
                    : `sem área (é uma linha: mostrada como faixa sobre a face #${host})`);
            } else {
                parts.push(labels[kind] || kind.replace(/_/g, " "));
            }
        }
        const hosts = key === "broken_faces" ? apiCheck?.hosts?.[String(faceIdx)] : null;
        if (hosts?.length) {
            parts.push(`tapa uma T-junction com a face ${hosts.map(h => `#${h}`).join(", ")}`);
        }
        return parts.join(", ");
    }

    // Verificações cujo defeito é uma aresta ou um vértice: desenham-se linhas e
    // pontos, e as faces à volta não são pintadas (não são elas o problema).
    const ELEMENT_CHECKS = new Set(["holes", "nonmanifold"]);
    const isElementCheck = (key) => ELEMENT_CHECKS.has(key);

    /** Numa face, os defeitos que estão nas arestas ou nos vértices dela. */
    function faceElementText(key, apiCheck, faceVerts) {
        if (!faceVerts?.length) return "";
        const inFace = (a, b) => {
            for (let i = 0; i < faceVerts.length; i++) {
                const u = faceVerts[i], v = faceVerts[(i + 1) % faceVerts.length];
                if ((u === a && v === b) || (u === b && v === a)) return true;
            }
            return false;
        };
        const edges = (apiCheck?.edges || []).filter(([a, b]) => inFace(a, b)).length;
        const verts = (apiCheck?.vertices || []).filter(v => faceVerts.includes(v));
        const parts = [];
        if (key === "holes") {
            if (edges) parts.push(`${edges} aresta(s) aberta(s)`);
            if (verts.length) parts.push(`fenda em ${verts.map(v => `V#${v}`).join(", ")}`);
        } else if (key === "nonmanifold") {
            if (edges) parts.push(`${edges} aresta(s) com 3+ faces`);
            if (verts.length) parts.push(`peças tocam-se em ${verts.map(v => `V#${v}`).join(", ")}`);
        }
        return parts.join(", ");
    }

    /** Fluxo de arestas (informação da API, não conta para o veredicto). */
    function edgeFlowKinds(res, vIdx) {
        const flow = res?.edge_flow || {};
        const kinds = [];
        if (flow.smooth_poles?.includes(vIdx)) kinds.push("polo numa zona lisa");
        if (flow.high_valence?.includes(vIdx)) kinds.push("valência alta");
        return kinds;
    }

    function edgeFlowVertices(res) {
        const flow = res?.edge_flow || {};
        return [...new Set([...(flow.smooth_poles || []), ...(flow.high_valence || [])])];
    }

    function breakdownText(key, apiCheck) {
        const breakdown = apiCheck?.breakdown;
        if (!breakdown) return "";
        const labels = BREAKDOWN_LABELS[key] || {};
        return Object.entries(breakdown)
            .filter(([kind, n]) => n > 0 && labels[kind] !== null)
            .map(([kind, n]) => `${n} ${labels[kind] || kind.replace(/_/g, " ")}`)
            .join(" • ");
    }

    /** Como cada verificação aparece no 3D (para a caixa "No 3D" da lista). */
    function mapHowText(key) {
        if (key === "broken_faces") return "uma face sem área é só uma linha, por isso aparece como uma faixa desta cor, alargada de propósito, deitada sobre a face do lado, com o número da face (clica na faixa ou no número para a ver); as torcidas são pintadas desta cor.";
        if (key === "holes") return "as arestas abertas aparecem como linhas grossas desta cor; as faces não são pintadas. Numa fenda as duas arestas ficam uma sobre a outra e parecem fechadas: o vértice pousado leva um ponto com a etiqueta «fenda».";
        if (key === "nonmanifold") return "as arestas com 3 ou mais faces aparecem como linhas grossas desta cor e os vértices onde as peças se tocam como pontos; as faces não são pintadas.";
        return "as faces são pintadas desta cor.";
    }

    /** Textos de um check: os nossos (PT) pelo código; um check novo usa os da API. */
    function getCheckInfo(key, apiCheck) {
        if (QA_EXPLANATIONS[key]) {
            return QA_EXPLANATIONS[key];
        }
        return {
            title: apiCheck?.title || key.replace(/_/g, " ").toUpperCase(),
            category: "Verificação",
            severity: apiCheck?.severity || "warning",
            color: "#64748b",
            what: apiCheck?.description || `Verificação automatizada: ${key}.`,
            why: () => "Potencial anomalia geométrica ou topológica reportada pelo algoritmo.",
            how: "Inspecionar a malha e verificar a integridade dos polígonos afetados."
        };
    }

    /** A gravidade vem da API (igual para todos os frontends); a nossa é o recurso. */
    function getCheckSeverity(key, apiCheck) {
        return apiCheck?.severity || getCheckInfo(key, apiCheck).severity;
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
            planarity_tolerance: 0.01,
            regular_valence: 0,
            skip: []
        },

        focusCheck: null, // verificação aberta na lista: o mapa mostra só essa
        showWarnings: true, // o mapa mostra tudo: erros (cor cheia) e avisos (cor suave)
        showEdgeFlow: false, // pontos dos polos e valências altas (informação)
        activeViewMode: "none", // 'errors' (mapa de topologia) | 'none'
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
    let dssEdgeLines = null; // arestas com defeito e faces sem área, como linhas grossas
    // Face sem área -> face vizinha onde a faixa dela foi desenhada (para o painel).
    const degenerateHost = new Map();
    let dssSelectionLine = null;
    let dssVertexMarker = null;
    let qaCenter = new THREE.Vector3(0, 0, 0);
    let qaScale = 1;

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
        const isMapActive = QAState.activeViewMode === "errors";

        [document.getElementById("side-btn-dss-toggle"), document.getElementById("dss-drawer-btn-toggle")].forEach(btn => {
            if (!btn) return;
            btn.classList.toggle("active", isMapActive);
            btn.classList.toggle("btn-primary", isMapActive);
            btn.classList.toggle("btn-outline", !isMapActive);
            btn.innerHTML = isMapActive
                ? "<span>🎨 Desativar Mapa de Topologia</span>"
                : "<span>🎨 Ativar Mapa de Topologia</span>";
        });

        [document.getElementById("side-dss-map-badge"), document.getElementById("dss-drawer-map-badge")].forEach(badge => {
            if (!badge) return;
            badge.textContent = isMapActive ? "Ativo" : "Desativado";
            badge.classList.toggle("active", isMapActive);
        });
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
        qaCenter = center;
        qaScale = scale;

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
        removeDSSEdgeLines(scene);
        if (dssSelectionLine) { scene.remove(dssSelectionLine); dssSelectionLine.geometry.dispose(); dssSelectionLine = null; }
        if (dssVertexMarker) { scene.remove(dssVertexMarker); dssVertexMarker.geometry.dispose(); dssVertexMarker = null; }

        // Garantir que a malha principal RL e os seus overlays permanecem 100% visíveis e ativos
        if (viewer.mesh) viewer.mesh.visible = true;

        return true;
    }

    // Verificações com vértices a marcar (fendas em holes, vértices onde as
    // peças se tocam em nonmanifold): desenhados como pontos por cima da malha.
    function vertexMarkerChecks(res) {
        const checks = res?.checks || {};
        return Object.keys(checks).filter(key => Array.isArray(checks[key]?.vertices) && checks[key].vertices.length);
    }

    // Sem nenhuma verificação aberta, o mapa mostra os erros e, se o botão
    // estiver ligado, os avisos (cor suave); com uma aberta, mostra só essa.
    function isCheckShown(checkKey, checkData) {
        if (QAState.focusCheck) return checkKey === QAState.focusCheck;
        return checkData?.severity === "error" || (QAState.showWarnings && checkData?.severity === "warning");
    }

    // Os pontos (vértices e faces pequenas) só para os erros ou a verificação
    // aberta: centenas de pontos de avisos tapavam a malha.
    function isMarkerShown(checkKey, checkData) {
        if (QAState.focusCheck) return checkKey === QAState.focusCheck;
        return checkData?.severity === "error";
    }

    // Ao pintar, os defeitos locais ficam por cima dos largos: uma face
    // degenerada dentro de uma zona dobrada vê-se como degenerada.
    const LOCAL_FIRST = ["broken_faces", "nonmanifold", "flipped_normals"];
    function paintOrder(checks) {
        const keys = Object.keys(checks || {});
        return [...LOCAL_FIRST.filter(k => keys.includes(k)), ...keys.filter(k => !LOCAL_FIRST.includes(k))];
    }

    // Uma face assinalada com menos do que esta fração do tamanho da malha não
    // se vê pintada: leva também um ponto.
    const SMALL_FACE_FRACTION = 0.02;

    function markerVertices(checkKey, res) {
        const list = res?.checks?.[checkKey]?.vertices;
        return Array.isArray(list) ? list : [];
    }

    function disposeObject3D(object) {
        object.traverse(child => {
            child.geometry?.dispose?.();
            const material = child.material;
            if (material) {
                material.map?.dispose?.();
                material.dispose?.();
            }
        });
    }

    function removeDSSEdgeLines(scene) {
        if (!dssEdgeLines) return;
        scene.remove(dssEdgeLines);
        disposeObject3D(dssEdgeLines);
        dssEdgeLines = null;
    }

    const HAS_FAT_LINES = () => Boolean(THREE.LineSegments2 && THREE.LineSegmentsGeometry && THREE.LineMaterial);

    /** Linhas com largura em píxeis (LineSegments2); sem o CDN, linhas finas. */
    function makeFatLines(viewer, positions, colors, width, opacity) {
        if (HAS_FAT_LINES()) {
            const geometry = new THREE.LineSegmentsGeometry();
            geometry.setPositions(positions);
            geometry.setColors(colors);
            const size = new THREE.Vector2();
            if (viewer.renderer) viewer.renderer.getSize(size);
            const material = new THREE.LineMaterial({
                linewidth: width,
                vertexColors: true,
                transparent: opacity < 1,
                opacity,
                depthTest: true,
                depthWrite: false,
            });
            material.resolution.set(size.x || window.innerWidth, size.y || window.innerHeight);
            return new THREE.LineSegments2(geometry, material);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity }));
    }

    /** Etiqueta "#5" sempre virada para a câmara, do tamanho certo em qualquer zoom. */
    function makeLabelSprite(text, hex) {
        const canvas = document.createElement("canvas");
        const ratio = 2;
        const ctx = canvas.getContext("2d");
        ctx.font = `700 ${13 * ratio}px "JetBrains Mono", monospace`;
        const width = Math.ceil(ctx.measureText(text).width) + 14 * ratio;
        const height = 22 * ratio;
        canvas.width = width;
        canvas.height = height;
        ctx.font = `700 ${13 * ratio}px "JetBrains Mono", monospace`;
        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.strokeStyle = hex;
        ctx.lineWidth = 2 * ratio;
        const r = 6 * ratio;
        ctx.beginPath();
        ctx.moveTo(r, 1); ctx.lineTo(width - r, 1); ctx.quadraticCurveTo(width - 1, 1, width - 1, r);
        ctx.lineTo(width - 1, height - r); ctx.quadraticCurveTo(width - 1, height - 1, width - r, height - 1);
        ctx.lineTo(r, height - 1); ctx.quadraticCurveTo(1, height - 1, 1, height - r);
        ctx.lineTo(1, r); ctx.quadraticCurveTo(1, 1, r, 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#f8fafc";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 7 * ratio, height / 2 + ratio);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false });
        const sprite = new THREE.Sprite(material);
        // Com sizeAttenuation a false, a escala é uma fração da altura do ecrã.
        const screenHeight = 0.035;
        sprite.scale.set(screenHeight * width / height, screenHeight, 1);
        sprite.center.set(0.5, -0.35); // um pouco acima do ponto
        sprite.renderOrder = 1001;
        return sprite;
    }

    /**
     * Defeitos que são arestas, desenhados como linhas grossas da cor da
     * verificação: arestas abertas (buracos) e não-manifold. As faces sem área
     * (uma face degenerada é uma linha) levam também uma faixa pintada sobre a
     * face vizinha; clicar na faixa abre a face. As faces não levam número no
     * 3D: um número atrás da malha ficava esbatido e outro não, e a mesma face
     * tem de se ver igual em qualquer ângulo.
     */
    function updateDSSEdgeLines(viewer, res, polygonFaces, positionOfVertex, meshId) {
        const segments = []; // [a, b, "#cor"]
        const flatList = []; // [faceIdx, "#cor"]: faces sem área
        const seen = new Set();
        const add = (list, a, b, color) => {
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (a === b || seen.has(key)) return;
            seen.add(key);
            list.push([a, b, color]);
        };
        for (const checkKey of paintOrder(res.checks)) {
            const data = res.checks[checkKey];
            if (!data || !data.count || !isMarkerShown(checkKey, data)) continue;
            const color = getCheckInfo(checkKey, data).color || "#ef4444";
            if (Array.isArray(data.edges)) {
                for (const [a, b] of data.edges) add(segments, a, b, color);
            }
            const flatFaces = checkKey === "broken_faces" ? (data.by_kind?.degenerate || []) : [];
            for (const fIdx of flatFaces) {
                const poly = polygonFaces?.[fIdx] || [];
                for (let i = 0; i < poly.length; i++) {
                    add(segments, poly[i], poly[(i + 1) % poly.length], color);
                }
                flatList.push([fIdx, color]);
            }
        }
        // Fendas: as duas arestas ficam uma sobre a outra e parecem fechadas; o
        // vértice pousado leva uma etiqueta.
        const cracks = isMarkerShown("holes", res.checks.holes) ? (res.checks.holes?.vertices || []) : [];
        const cacheKey = `${meshId}|${segments.length}|${flatList.length}|${cracks.length}|${QAState.focusCheck || "all"}`;
        if (dssEdgeLines && dssEdgeLines.userData?.cacheKey === cacheKey) {
            dssEdgeLines.visible = segments.length > 0;
            return;
        }
        removeDSSEdgeLines(viewer.scene);
        if (!segments.length) return;

        const toArrays = (list) => {
            const positions = [];
            const colors = [];
            for (const [a, b, hex] of list) {
                const pa = positionOfVertex(a);
                const pb = positionOfVertex(b);
                if (!pa || !pb) continue;
                const c = new THREE.Color(hex);
                positions.push(...pa, ...pb);
                colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
            }
            return [positions, colors];
        };

        const group = new THREE.Group();
        const labels = []; // [faceIdx, "#cor", [x, y, z]]
        const strips = flatFaceStrips(polygonFaces, positionOfVertex, flatList, res.checks.broken_faces?.hosts);
        for (const strip of strips) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(strip.corners.flat(), 3));
            geometry.setIndex([0, 1, 2, 0, 2, 3]);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(strip.color),
                transparent: true,
                opacity: 0.85,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.renderOrder = 996;
            mesh.userData.faceIdx = strip.faceIdx; // clicável: abre a face sem área
            group.add(mesh);
            labels.push([`#${strip.faceIdx}`, strip.color, strip.center, { faceIdx: strip.faceIdx }]);
        }
        for (const [fIdx, hex] of flatList) {
            if (strips.some(strip => strip.faceIdx === fIdx)) continue;
            const pts = (polygonFaces?.[fIdx] || []).map(positionOfVertex).filter(Boolean);
            if (!pts.length) continue;
            labels.push([`#${fIdx}`, hex, [0, 1, 2].map(axis => pts.reduce((sum, p) => sum + p[axis], 0) / pts.length), { faceIdx: fIdx }]);
        }
        const crackColor = getCheckInfo("holes", res.checks.holes).color || "#eab308";
        for (const vIdx of cracks) {
            const pos = positionOfVertex(vIdx);
            if (pos) labels.push(["fenda", crackColor, pos, { vertexIdx: vIdx }]);
        }
        const [positions, colors] = toArrays(segments);
        if (positions.length) {
            const core = makeFatLines(viewer, positions, colors, 4, 0.95);
            core.renderOrder = 997;
            group.add(core);
        }
        for (const [text, hex, center, data] of labels) {
            if (data.faceIdx !== undefined) continue; // sem números de face no 3D
            {
                const sprite = makeLabelSprite(text, hex);
                sprite.position.set(...center);
                Object.assign(sprite.userData, data); // clicável: abre a face ou o vértice
                // Uma etiqueta atrás da malha fica quase transparente: senão
                // parecia estar na face da frente.
                const anchor = sprite.position.clone();
                const ray = new THREE.Raycaster();
                const toAnchor = new THREE.Vector3();
                sprite.onBeforeRender = (renderer, scene, camera) => {
                    const mesh = viewer.mesh;
                    if (!mesh) return;
                    toAnchor.subVectors(anchor, camera.position);
                    const distance = toAnchor.length();
                    ray.set(camera.position, toAnchor.normalize());
                    ray.far = distance;
                    const hit = ray.intersectObject(mesh, false)[0];
                    const hidden = hit && hit.distance < distance * 0.995;
                    sprite.material.opacity = hidden ? 0.18 : 1;
                };
                group.add(sprite);
            }
        }
        group.userData = { cacheKey };
        dssEdgeLines = group;
        viewer.scene.add(group);
    }

    /**
     * Uma face sem área é uma linha. Para se ver qual é, desenha-se uma faixa
     * dessa linha para dentro da face vizinha que tem as duas pontas da linha
     * (senão, a que partilha mais vértices), com uma largura que se vê.
     */
    function flatFaceStrips(polygonFaces, positionOfVertex, flatList, apiHosts) {
        degenerateHost.clear();
        if (!flatList.length || !polygonFaces) return [];
        const V = THREE.Vector3;
        const flatSet = new Set(flatList.map(([fIdx]) => fIdx));
        const box = new THREE.Box3();
        const byVertex = new Map();
        polygonFaces.forEach((poly, fIdx) => {
            for (const v of poly || []) {
                const pos = positionOfVertex(v);
                if (pos) box.expandByPoint(new V(...pos));
                if (flatSet.has(fIdx)) continue;
                if (!byVertex.has(v)) byVertex.set(v, []);
                byVertex.get(v).push(fIdx);
            }
        });
        const diagonal = box.isEmpty() ? 1 : box.getSize(new V()).length();
        const strips = [];
        for (const [fIdx, color] of flatList) {
            const poly = polygonFaces[fIdx] || [];
            const pts = poly.map(v => [v, positionOfVertex(v)]).filter(([, pos]) => pos).map(([v, pos]) => [v, new V(...pos)]);
            if (pts.length < 2) continue;
            // As duas pontas da linha: o par de vértices mais afastado.
            let ends = [pts[0], pts[1]];
            let longest = -1;
            for (let i = 0; i < pts.length; i++) {
                for (let j = i + 1; j < pts.length; j++) {
                    const d = pts[i][1].distanceTo(pts[j][1]);
                    if (d > longest) { longest = d; ends = [pts[i], pts[j]]; }
                }
            }
            if (longest <= 0) continue;
            const [[va, p0], [vb, p1]] = ends;
            // A face vizinha.
            const shared = new Map();
            for (const v of new Set(poly)) {
                for (const g of byVertex.get(v) || []) shared.set(g, (shared.get(g) || 0) + 1);
            }
            // A API diz qual é a face do outro lado da T-junction; senão, adivinha-se.
            const apiHost = apiHosts?.[String(fIdx)]?.find(g => polygonFaces[g]);
            let host = apiHost ?? null;
            let best = apiHost !== undefined ? Infinity : -1;
            for (const [g, n] of shared) {
                const both = polygonFaces[g].includes(va) && polygonFaces[g].includes(vb);
                const score = (both ? 1000 : 0) + n;
                if (n >= 2 && score > best) { best = score; host = g; }
            }
            if (host === null) continue;
            const hostPts = polygonFaces[host].map(positionOfVertex).filter(Boolean).map(pos => new V(...pos));
            const hostCenter = hostPts.reduce((sum, q) => sum.add(q), new V()).divideScalar(hostPts.length);
            const dir = new V().subVectors(p1, p0).normalize();
            // Normal da face vizinha (Newell).
            const normal = new V();
            for (let i = 0; i < hostPts.length; i++) {
                const a = hostPts[i];
                const b = hostPts[(i + 1) % hostPts.length];
                normal.x += (a.y - b.y) * (a.z + b.z);
                normal.y += (a.z - b.z) * (a.x + b.x);
                normal.z += (a.x - b.x) * (a.y + b.y);
            }
            if (normal.lengthSq() === 0) continue;
            normal.normalize();
            const across = new V().crossVectors(normal, dir).normalize();
            if (across.dot(new V().subVectors(hostCenter, p0)) < 0) across.negate();
            const room = Math.max(...hostPts.map(q => new V().subVectors(q, p0).dot(across)));
            const width = Math.min(diagonal * 0.03, Math.max(room, 0) * 0.25 || diagonal * 0.03);
            const lift = normal.clone().multiplyScalar(diagonal * 1e-4);
            const offset = across.clone().multiplyScalar(width);
            const corners = [p0.clone(), p1.clone(), p1.clone().add(offset), p0.clone().add(offset)].map(c => c.add(lift));
            const center = corners.reduce((sum, c) => sum.add(c), new V()).divideScalar(4);
            degenerateHost.set(fIdx, host);
            strips.push({ faceIdx: fIdx, color, corners: corners.map(c => [c.x, c.y, c.z]), center: [center.x, center.y, center.z] });
        }
        return strips;
    }

    /** Pontos dos checks de vértices ligados (o nome fica: é chamado noutros sítios). */
    function updateDSSPoles(forceVisible) {
        const viewer = getViewer();
        if (!viewer || !viewer.scene) return;

        const shouldShow = (forceVisible !== undefined) ? forceVisible : QAState.activeViewMode !== "none";
        const res = QAState.resultData;
        const activeMesh = viewer.mesh || dssMesh;
        const geo = activeMesh?.geometry;
        const posAttr = geo?.attributes?.position;
        if (!shouldShow || !res || !posAttr) {
            if (dssPolesPoints) dssPolesPoints.visible = false;
            if (dssEdgeLines) dssEdgeLines.visible = false;
            return;
        }

        // Posição de cada vértice na cena (a malha do viewer está centrada e escalada).
        const rawVerts = geo.userData?.rawVerts || qaParsedVertices;
        const center = geo.userData?.center || qaCenter;
        const scale = geo.userData?.scale || qaScale;
        const vertexIndices = geo.userData?.vertexIndices || qaTriangleVertexIndices;
        const scenePosition = new Map();
        if (vertexIndices) {
            for (let i = 0; i < vertexIndices.length; i++) {
                if (!scenePosition.has(vertexIndices[i])) {
                    scenePosition.set(vertexIndices[i], [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
                }
            }
        }
        const positionOfVertex = (vIdx) => {
            const rv = rawVerts?.[vIdx];
            if (rv && center && scale) {
                return [(rv[0] - center.x) * scale, (rv[1] - center.y) * scale, (rv[2] - center.z) * scale];
            }
            return scenePosition.get(vIdx);
        };

        const markerChecks = vertexMarkerChecks(res);
        const markers = []; // ["vertex" | "face", índice, cor]
        for (const checkKey of markerChecks) {
            if (!isMarkerShown(checkKey, res.checks[checkKey])) continue;
            const color = getCheckInfo(checkKey, res.checks[checkKey]).color || "#c084fc";
            for (const vIdx of markerVertices(checkKey, res)) {
                markers.push(["vertex", vIdx, color]);
            }
        }
        // Fluxo de arestas (polos, valências altas): só com o botão ligado.
        if (QAState.showEdgeFlow) {
            for (const vIdx of edgeFlowVertices(res)) markers.push(["vertex", vIdx, EDGE_FLOW_HEX]);
        }

        // Faces assinaladas pequenas demais para se verem pintadas (uma face
        // degenerada não tem área nenhuma): também levam um ponto no centro,
        // com a cor com que a face foi pintada.
        const polygonFaces = geo.userData?.polygonFaces || qaPolygonFaces;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const minExtent = (geo.boundingSphere?.radius || 1) * 2 * SMALL_FACE_FRACTION;
        const faceExtent = (poly) => {
            const pts = poly.map(positionOfVertex).filter(Boolean);
            if (!pts.length) return Infinity;
            let ext = 0;
            for (let axis = 0; axis < 3; axis++) {
                const values = pts.map(p => p[axis]);
                ext = Math.max(ext, Math.max(...values) - Math.min(...values));
            }
            return ext;
        };
        const markedFaces = new Set();
        for (const checkKey of paintOrder(res.checks)) {
            const checkData = res.checks[checkKey];
            if (!checkData || isElementCheck(checkKey) || !Array.isArray(checkData.faces)) continue;
            if (!isMarkerShown(checkKey, checkData)) continue;
            const color = getCheckInfo(checkKey, checkData).color || "#ef4444";
            for (const fIdx of checkData.faces) {
                if (markedFaces.has(fIdx) || !polygonFaces?.[fIdx]) continue;
                markedFaces.add(fIdx);
                if (faceExtent(polygonFaces[fIdx]) < minExtent) {
                    markers.push(["face", fIdx, color]);
                }
            }
        }

        updateDSSEdgeLines(viewer, res, polygonFaces, positionOfVertex, activeMesh.uuid);

        const cacheKey = `${activeMesh.uuid}|${markers.length}|${QAState.focusCheck || "errors"}|${QAState.showEdgeFlow}|${markerChecks.join()}`;
        if (dssPolesPoints && dssPolesPoints.userData?.cacheKey === cacheKey) {
            dssPolesPoints.visible = markers.length > 0;
            return;
        }
        if (dssPolesPoints) {
            viewer.scene.remove(dssPolesPoints);
            dssPolesPoints.geometry.dispose();
            dssPolesPoints.material.dispose();
            dssPolesPoints = null;
        }
        if (markers.length === 0) return;

        const positionOf = (kind, idx) => {
            if (kind === "vertex") return positionOfVertex(idx);
            const pts = (polygonFaces?.[idx] || []).map(positionOfVertex).filter(Boolean);
            if (!pts.length) return null;
            return [0, 1, 2].map(axis => pts.reduce((sum, p) => sum + p[axis], 0) / pts.length);
        };

        const positions = [];
        const colors = [];
        const pointItems = []; // o que cada ponto é, para o clique
        for (const [kind, idx, hex] of markers) {
            const pt = positionOf(kind, idx);
            if (!pt) continue;
            const c = new THREE.Color(hex);
            positions.push(pt[0], pt[1], pt[2]);
            colors.push(c.r, c.g, c.b);
            pointItems.push([kind, idx]);
        }
        if (positions.length === 0) return;

        const ptsGeo = new THREE.BufferGeometry();
        ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        ptsGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
        const ptsMat = new THREE.PointsMaterial({
            vertexColors: true,
            size: 9,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.95,
            // Os pontos atrás da malha ficam escondidos, como os vértices num modelador.
            depthTest: true,
            depthWrite: false
        });
        dssPolesPoints = new THREE.Points(ptsGeo, ptsMat);
        dssPolesPoints.renderOrder = 998;
        dssPolesPoints.userData = { cacheKey, items: pointItems };
        viewer.scene.add(dssPolesPoints);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. COLORIZAÇÃO E MODOS VISUAIS (OVERLAYS & HEATMAPS)
    // ═══════════════════════════════════════════════════════════════════
    const CLEAN_FACE_HEX = "#4b6b63"; // verde-acinzentado: faces sem problemas no mapa
    const CLEAN_FACE_RGB = (() => { const c = new THREE.Color(CLEAN_FACE_HEX); return [c.r, c.g, c.b]; })();
    const WARNING_SOFTEN = 0.45; // quanto um aviso se aproxima do cinzento (0 = cor cheia)
    const EDGE_FLOW_HEX = "#84cc16"; // pontos do fluxo de arestas (informação)

    /** Cor de uma verificação no mapa: os avisos são mais suaves do que os erros. */
    function mapColorRGB(checkKey, checkData) {
        const c = new THREE.Color(getCheckInfo(checkKey, checkData).color || "#ef4444");
        if (!QAState.focusCheck && checkData?.severity === "warning") {
            c.lerp(new THREE.Color(0x64748b), WARNING_SOFTEN);
        }
        return [c.r, c.g, c.b];
    }

    /** Legenda do mapa: uma etiqueta por verificação mostrada, clicável, e os
     *  botões dos avisos e do fluxo de arestas. */
    function renderMapLegend(res) {
        const chips = document.getElementById("qa-legend-chips");
        const bar = document.querySelector("#qa-heatmap-legend .qa-legend-bar-wrap");
        if (bar) bar.style.display = "none";
        if (!chips) return;
        const checks = res?.checks || {};
        const shown = Object.entries(checks).filter(([key, data]) => data?.count > 0 && isCheckShown(key, data));
        const chip = (key, data) => {
            const info = getCheckInfo(key, data);
            const rgb = mapColorRGB(key, data).map(v => Math.round(v * 255));
            const severity = data.severity === "error" ? "erro" : "aviso";
            const active = QAState.focusCheck === key;
            // Arestas e vértices: a amostra é uma linha (as faces não são pintadas).
            const swatch = isElementCheck(key) ? " line" : "";
            return `<button type="button" class="qa-legend-chip${active ? " active" : ""}" data-check="${key}" title="${active ? "Voltar a ver tudo" : "Ver só esta"} (${severity})">
                <span class="qa-legend-swatch${swatch}" style="background:rgb(${rgb.join(",")});"></span>${info.title}<span class="qa-legend-count">${data.count}</span></button>`;
        };
        const warnings = Object.values(checks).filter(d => d?.severity === "warning" && d?.count > 0).length;
        const flow = edgeFlowVertices(res).length;
        const toggles = [];
        if (!QAState.focusCheck && warnings) {
            toggles.push(`<button type="button" class="qa-legend-chip toggle${QAState.showWarnings ? " active" : ""}" data-toggle="warnings" title="Os avisos não partem a malha: só aparecem se os ligares">${QAState.showWarnings ? "Esconder avisos" : "Mostrar avisos"}<span class="qa-legend-count">${warnings}</span></button>`);
        }
        if (flow) {
            toggles.push(`<button type="button" class="qa-legend-chip toggle${QAState.showEdgeFlow ? " active" : ""}" data-toggle="edge-flow" title="Polos numa zona lisa e valências altas: informação, não conta para o veredicto"><span class="qa-legend-swatch dot" style="background:${EDGE_FLOW_HEX};"></span>Polos<span class="qa-legend-count">${flow}</span></button>`);
        }
        chips.innerHTML = shown.map(([key, data]) => chip(key, data)).join("")
            + `<span class="qa-legend-chip clean"><span class="qa-legend-swatch" style="background:${CLEAN_FACE_HEX};"></span>Sem problemas</span>`
            // Avisos e polos não são erros: ficam numa linha à parte.
            + (toggles.length ? `<span class="qa-legend-extra-title">Mostrar também (não são erros)</span>${toggles.join("")}` : "");
        chips.querySelectorAll("button.qa-legend-chip").forEach(button => {
            button.addEventListener("click", () => {
                const toggle = button.dataset.toggle;
                if (toggle === "warnings") {
                    QAState.showWarnings = !QAState.showWarnings;
                } else if (toggle === "edge-flow") {
                    QAState.showEdgeFlow = !QAState.showEdgeFlow;
                } else {
                    const key = button.dataset.check;
                    QAState.focusCheck = QAState.focusCheck === key ? null : key;
                    const summaryChecks = QAState.statusData?.summary?.checks;
                    if (summaryChecks) renderChecksList(summaryChecks, QAState.resultData?.checks);
                }
                updateDSSColors();
            });
        });
    }

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
            updateDSSPoles(false);
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
            updateDSSPoles(false);
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
        const vertexIndices = geo.userData?.vertexIndices || qaTriangleVertexIndices;
        const polygonFaces = geo.userData?.polygonFaces || qaPolygonFaces;

        const numFaces = polygonFaces ? polygonFaces.length : (qaPolygonFaces ? qaPolygonFaces.length : 1);
        const maxTris = Math.min(triangleToFace ? triangleToFace.length : qaTriangleToFaceMap.length, Math.floor(posAttr.count / 3));

        if (legendEl) legendEl.style.display = "flex";
        if (typeof viewer.setDSSHeatmapActive === "function") {
            viewer.setDSSHeatmapActive(true);
        }

        const legendGradient = document.getElementById("qa-legend-gradient");

        // MODO 1: OVERLAYS DE ERRO E CONFORMIDADE TOPOLÓGICA (QUADS, TRIS, N-GONS)
        if (mode === "errors") {
            if (legendTitle) {
                legendTitle.style.display = "block";
                legendTitle.textContent = QAState.focusCheck
                    ? "Só esta verificação (clica para ver tudo)"
                    : (QAState.showWarnings ? "Erros (cor cheia) e avisos (cor suave)" : "Erros");
            }
            renderMapLegend(res);

            const faceErrorMap = new Array(numFaces).fill(null);
            // A API manda os checks do mais grave para o menos grave: uma face em
            // vários fica com a cor do primeiro. Os checks de vértices são pontos.
            if (res && res.checks) {
                for (const checkKey of paintOrder(res.checks)) {
                    const checkData = res.checks[checkKey];
                    // Buracos e não-manifold: o defeito é a aresta ou o vértice
                    // (linhas e pontos); as faces à volta não são pintadas.
                    if (!checkData || isElementCheck(checkKey)) continue;
                    if (!isCheckShown(checkKey, checkData)) continue;
                    if (Array.isArray(checkData.faces)) {
                        const rgb = mapColorRGB(checkKey, checkData);
                        for (const fIdx of checkData.faces) {
                            if (fIdx < numFaces && faceErrorMap[fIdx] === null) {
                                faceErrorMap[fIdx] = rgb;
                            }
                        }
                    }
                }
            }

            for (let triIdx = 0; triIdx < maxTris; triIdx++) {
                const f = (triangleToFace && triangleToFace[triIdx] !== undefined)
                    ? triangleToFace[triIdx]
                    : ((qaTriangleToFaceMap && qaTriangleToFaceMap[triIdx] !== undefined) ? qaTriangleToFaceMap[triIdx] : 0);
                // Só as faces assinaladas têm cor; as outras ficam num cinzento
                // neutro e as arestas à vista, como um wireframe.
                const col = ((f < faceErrorMap.length) ? faceErrorMap[f] : null) || CLEAN_FACE_RGB;

                const offset = triIdx * 9;
                for (let v = 0; v < 3; v++) {
                    colors[offset + v * 3] = col[0];
                    colors[offset + v * 3 + 1] = col[1];
                    colors[offset + v * 3 + 2] = col[2];
                }
            }
        }

                colorAttr.needsUpdate = true;
        updateDSSPoles();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  7. RAYCASTING UNIFICADO (INSPEÇÃO DE FACE AO CLICAR)
    // ═══════════════════════════════════════════════════════════════════
    let isRaycasterBound = false;

    function setupUnifiedRaycaster() {
        const canvas = document.getElementById("canvas3d");
        if (!canvas || isRaycasterBound) return;
        isRaycasterBound = true;

        if (!qaRaycaster) qaRaycaster = new THREE.Raycaster();
        let isDragging = false;
        let pointerDownPos = { x: 0, y: 0 };

        canvas.addEventListener("pointerdown", (e) => {
            isDragging = false;
            pointerDownPos = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener("pointermove", (e) => {
            const dx = Math.abs(e.clientX - pointerDownPos.x);
            const dy = Math.abs(e.clientY - pointerDownPos.y);
            if (dx > 5 || dy > 5) isDragging = true;
        });

        canvas.addEventListener("pointerup", (e) => {
            if (isDragging) return;
            const viewer = getViewer();
            if (!viewer || !viewer.mesh || !viewer.camera) return;

            const rect = canvas.getBoundingClientRect();
            qaMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            qaMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            qaRaycaster.setFromCamera(qaMouse, viewer.camera);
            const intersects = qaRaycaster.intersectObject(viewer.mesh, false);

            // Primeiro o que está desenhado por cima da malha: etiquetas, faixas
            // das faces sem área e pontos. Uma face sem área não se consegue
            // clicar na malha (não tem área); a faixa e o número dela sim.
            const overlayHit = pickOverlay(viewer, intersects?.[0]?.distance);
            if (overlayHit) {
                if (overlayHit.vertexIdx !== undefined) selectVertexInQA(overlayHit.vertexIdx);
                else selectFaceInQA(overlayHit.faceIdx);
                return;
            }

            if (intersects && intersects.length > 0) {
                const hit = intersects[0];
                const triIdx = hit.faceIndex;
                const geo = viewer.mesh.geometry;
                const triangleToFace = geo?.userData?.triangleToFace || qaTriangleToFaceMap;
                const polygonFaceIdx = (triangleToFace && triangleToFace[triIdx] !== undefined) ? triangleToFace[triIdx] : triIdx;
                if (polygonFaceIdx !== undefined && polygonFaceIdx !== null) {
                    selectFaceInQA(polygonFaceIdx);
                }
            }
        });
    }

    /** O que foi clicado entre as etiquetas, faixas e pontos do DSS (ou null). */
    function pickOverlay(viewer, meshDistance) {
        const visibleBefore = (distance) => meshDistance === undefined || distance <= meshDistance * 1.01;
        if (dssEdgeLines?.visible) {
            const targets = dssEdgeLines.children.filter(child =>
                (child.isSprite || child.isMesh) && (child.userData.faceIdx !== undefined || child.userData.vertexIdx !== undefined));
            const hits = qaRaycaster.intersectObjects(targets, false);
            // As etiquetas veem-se sempre (por cima de tudo); as faixas só se não estiverem tapadas.
            const label = hits.find(hit => hit.object.isSprite && hit.object.material.opacity > 0.5);
            const strip = hits.find(hit => hit.object.isMesh && visibleBefore(hit.distance));
            const chosen = label || strip;
            if (chosen) return chosen.object.userData;
        }
        if (dssPolesPoints?.visible && dssPolesPoints.userData?.items) {
            const geo = viewer.mesh.geometry;
            if (!geo.boundingSphere) geo.computeBoundingSphere();
            qaRaycaster.params.Points.threshold = (geo.boundingSphere?.radius || 1) * 0.012;
            const hit = qaRaycaster.intersectObject(dssPolesPoints, false).find(h => visibleBefore(h.distance));
            const item = hit ? dssPolesPoints.userData.items[hit.index] : null;
            if (item) return item[0] === "vertex" ? { vertexIdx: item[1] } : { faceIdx: item[1] };
        }
        return null;
    }

    /** Posição de um vértice na cena (a malha do viewer está centrada e escalada). */
    function scenePositionOfVertex(geo, vIdx) {
        const rawVerts = geo.userData?.rawVerts || qaParsedVertices;
        const center = geo.userData?.center || qaCenter;
        const scale = geo.userData?.scale || qaScale;
        const rv = rawVerts?.[vIdx];
        if (!rv || !center || !scale) return null;
        return [(rv[0] - center.x) * scale, (rv[1] - center.y) * scale, (rv[2] - center.z) * scale];
    }

    function selectFaceInQA(faceIdx) {
        const viewer = getViewer();
        if (!viewer || !viewer.mesh || !viewer.mesh.geometry) return;

        const geo = viewer.mesh.geometry;
        const polygonFaces = geo.userData?.polygonFaces || qaPolygonFaces;
        const triangleToFace = geo.userData?.triangleToFace || qaTriangleToFaceMap;
        const faceToTriangles = geo.userData?.faceToTriangles || qaFaceToTrianglesMap;

        if (faceIdx === null || faceIdx === undefined || (polygonFaces && polygonFaces.length > 0 && faceIdx >= polygonFaces.length)) return;

        QAState.selectedFaceIdx = faceIdx;
        const fVerts = (polygonFaces && polygonFaces[faceIdx]) ? polygonFaces[faceIdx] : [];
        const res = QAState.resultData;

        // Desenhar contorno de destaque amarelo vivo sobre a face
        if (dssSelectionLine) {
            viewer.scene.remove(dssSelectionLine);
            dssSelectionLine.geometry.dispose();
            dssSelectionLine = null;
        }

        let triIndices = (faceToTriangles && faceToTriangles[faceIdx]) ? faceToTriangles[faceIdx] : (qaFaceToTrianglesMap[faceIdx] || []);
        if (triIndices.length === 0) {
            triIndices = [faceIdx];
        }

        const posAttr = geo.attributes.position;
        if (!posAttr) return;
        const linePositions = [];

        // O contorno da face pelos vértices dela (também numa face sem área,
        // que não tem triângulos na malha do viewer).
        const outline = fVerts.map(v => scenePositionOfVertex(geo, v));
        if (outline.length >= 2 && outline.every(Boolean)) {
            for (let i = 0; i < outline.length; i++) {
                linePositions.push(...outline[i], ...outline[(i + 1) % outline.length]);
            }
            triIndices = [];
        }

        // Sem as posições dos vértices: linha sobre os triângulos da face
        for (const tIdx of triIndices) {
            const off = tIdx * 9;
            if (off + 8 < posAttr.array.length) {
                const x0 = posAttr.array[off], y0 = posAttr.array[off + 1], z0 = posAttr.array[off + 2];
                const x1 = posAttr.array[off + 3], y1 = posAttr.array[off + 4], z1 = posAttr.array[off + 5];
                const x2 = posAttr.array[off + 6], y2 = posAttr.array[off + 7], z2 = posAttr.array[off + 8];
                linePositions.push(x0, y0, z0, x1, y1, z1);
                linePositions.push(x1, y1, z1, x2, y2, z2);
                linePositions.push(x2, y2, z2, x0, y0, z0);
            }
        }

        if (linePositions.length > 0) {
            const cyan = new THREE.Color(0x00f0ff);
            const lineColors = [];
            for (let i = 0; i < linePositions.length / 3; i++) lineColors.push(cyan.r, cyan.g, cyan.b);
            dssSelectionLine = makeFatLines(viewer, linePositions, lineColors, 3, 1);
            dssSelectionLine.material.depthTest = false;
            dssSelectionLine.renderOrder = 999;
            viewer.scene.add(dssSelectionLine);
        }

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
            const eff = res?.per_face?.effective_corners?.[faceIdx];
            const k = fVerts.length || 3;
            const type = k === 3 ? "Triângulo" : (k === 4 ? "Quad" : "N-gon");
            // Um vértice a meio de uma aresta reta não é um canto.
            typeEl.textContent = (eff && eff !== k)
                ? `${type} (${k} vértices, ${eff} cantos)`
                : `${type} (${k} vértices)`;
        }

        const minAngle = res?.per_face?.min_angle?.[faceIdx];
        const maxAngle = res?.per_face?.max_angle?.[faceIdx];
        if (minAEl) minAEl.textContent = (minAngle !== null && minAngle !== undefined) ? `${minAngle.toFixed(1)}°` : "--";
        if (maxAEl) maxAEl.textContent = (maxAngle !== null && maxAngle !== undefined) ? `${maxAngle.toFixed(1)}°` : "--";

        // Problemas desta face, e à parte os que estão nas arestas ou nos
        // vértices dela (buracos, não-manifold): esses não são da face.
        if (errorsBox) {
            errorsBox.innerHTML = "";
            const badge = (key, why) => {
                const exp = getCheckInfo(key, res.checks[key]);
                const color = exp.color || "#ef4444";
                const tag = document.createElement("span");
                tag.className = "qa-badge";
                tag.style.cssText = `border:1px solid ${color};color:${color};background:${color}18;font-weight:600;font-size:0.72rem;padding:0.2rem 0.5rem;border-radius:4px;display:inline-flex;align-items:center;gap:0.3rem;`;
                tag.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span> ${exp.title}${why ? `: ${why}` : ""}`;
                return tag;
            };
            const heading = (text) => {
                const el = document.createElement("div");
                el.style.cssText = "width:100%;font-size:0.68rem;color:#94a3b8;margin-top:0.25rem;";
                el.textContent = text;
                return el;
            };
            const own = [];
            const around = [];
            const covers = [];
            if (res && res.checks) {
                for (const [key, check] of Object.entries(res.checks)) {
                    if (isElementCheck(key)) {
                        const why = Array.isArray(check.faces) && check.faces.includes(faceIdx)
                            ? faceElementText(key, check, fVerts) : "";
                        if (why) around.push(badge(key, why));
                    } else if (Array.isArray(check.faces) && check.faces.includes(faceIdx)) {
                        own.push(badge(key, faceKindText(key, check, faceIdx, res)));
                    }
                }
                // Esta face é o outro lado de uma T-junction tapada por uma face sem área.
                const hosts = res.checks.broken_faces?.hosts || {};
                for (const [cover, hostFaces] of Object.entries(hosts)) {
                    if (hostFaces.includes(faceIdx)) covers.push(Number(cover));
                }
            }
            if (own.length) own.forEach(tag => errorsBox.appendChild(tag));
            if (around.length) {
                errorsBox.appendChild(heading("Nas arestas ou vértices desta face:"));
                around.forEach(tag => errorsBox.appendChild(tag));
            }
            if (!own.length && !around.length && !covers.length) {
                errorsBox.innerHTML = `<span class="qa-badge ok" style="color:#10b981;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);padding:0.2rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:600;">✓ Sem problemas detetados</span>`;
            }
        }

        // Valência dos vértices (os polos do fluxo de arestas a verde)
        if (vertsBox) {
            vertsBox.innerHTML = "";
            const valences = res?.per_vertex?.valence || [];
            if (fVerts && fVerts.length > 0) {
                fVerts.forEach(vIdx => {
                    const val = valences[vIdx] ?? "--";
                    const chip = document.createElement("span");
                    chip.className = "qa-vert-chip";
                    const flow = edgeFlowKinds(res, vIdx);
                    chip.textContent = `V#${vIdx}: Val ${val}${flow.length ? ` (${flow.join(", ")})` : ""}`;
                    if (flow.length) {
                        chip.style.borderColor = EDGE_FLOW_HEX;
                        chip.style.color = EDGE_FLOW_HEX;
                    }
                    vertsBox.appendChild(chip);
                });
            }
        }

        if (panel) panel.style.display = "block";
    }

    function closeQADetailPanel() {
        const panel = document.getElementById("qa-detail-panel");
        if (panel) panel.style.display = "none";
        const viewer = getViewer();
        if (viewer) {
            if (dssSelectionLine) {
                viewer.scene.remove(dssSelectionLine);
                dssSelectionLine.geometry.dispose();
                dssSelectionLine = null;
            }
            if (dssVertexMarker) {
                viewer.scene.remove(dssVertexMarker);
                dssVertexMarker.geometry.dispose();
                dssVertexMarker = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  8. RENDERIZAÇÃO DA BARRA LATERAL (MÉTRICAS & CHECKS)
    // ═══════════════════════════════════════════════════════════════════
    const VERDICT_LABELS = {
        invalid: "❌ Inválida",
        review: "⚠️ A rever",
        ok: "✅ Sem erros nem avisos"
    };

    function deriveQAVerdict(summary) {
        const verdict = summary?.verdict;
        if (!verdict) return "Estado desconhecido (análise antiga: volte a analisar)";
        const parts = [VERDICT_LABELS[verdict.status] || verdict.status];
        if (verdict.error_faces > 0) parts.push(`${verdict.error_faces} face(s) com erros`);
        if (verdict.warning_faces > 0) parts.push(`${verdict.warning_faces} face(s) com avisos`);
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
            const status = summary.verdict?.status;
            const issues = (summary.verdict?.error_faces || 0) + (summary.verdict?.warning_faces || 0);
            const palette = status === "invalid"
                ? ["rgba(239,68,68,0.25)", "#f87171", "rgba(239,68,68,0.4)"]
                : status === "review"
                    ? ["rgba(234,179,8,0.25)", "#facc15", "rgba(234,179,8,0.4)"]
                    : ["rgba(16,185,129,0.25)", "#34d399", "rgba(16,185,129,0.4)"];
            badge.style.display = "inline-flex";
            badge.textContent = status === "ok" ? "OK" : (issues || "!");
            [badge.style.background, badge.style.color, badge.style.borderColor] = palette;
        }

        // Métricas e Topologia. Os ângulos, a proporção e os polos vêm dos dados
        // do 3D (/viewer), que só o resultado tem.
        const topo = { ...summary.metrics, ...(QAState.resultData?.metrics || {}) };
        renderTopologyInfo(topo, summary.checks);
        renderSideDSSFacts(topo, summary.checks);

        // Checklist Dinâmica
        renderChecksList(summary.checks, res?.checks);

        // Limitações e Avisos
        renderLimitations(summary.limitations, summary.warnings);
    }

    const SHAPE_LABELS = { flat: "Plana (hard-surface)", curved: "Curva (orgânica)", mixed: "Mista" };

    function shapeText(shape) {
        if (!shape?.type) return "--";
        return SHAPE_LABELS[shape.type] || shape.type;
    }

    function shapeTitle(shape) {
        if (!shape?.type) return "";
        const pct = (v) => `${Math.round((v || 0) * 100)}%`;
        return `Arestas planas ${pct(shape.flat_edges)} • curvas ${pct(shape.curved_edges)} • vivas ${pct(shape.sharp_edges)} (pelo comprimento)`;
    }

    /** O cartão lateral do DSS: estanque, forma e as verificações que encontraram algo. */
    function renderSideDSSFacts(topo, checks) {
        const wtEl = document.getElementById("side-dss-watertight");
        if (wtEl) {
            wtEl.textContent = topo?.is_closed === undefined ? "--" : (topo.is_closed ? "Sim" : "Não");
            wtEl.style.color = topo?.is_closed === undefined ? "" : (topo.is_closed ? "#34d399" : "#f87171");
        }
        const shapeEl = document.getElementById("side-dss-shape");
        if (shapeEl) {
            shapeEl.textContent = shapeText(topo?.shape);
            shapeEl.title = shapeTitle(topo?.shape);
        }
        const foundEl = document.getElementById("side-dss-found");
        if (!foundEl) return;
        foundEl.innerHTML = "";
        for (const [key, check] of Object.entries(checks || {})) {
            if (!check?.evaluated || !check.count) continue;
            const info = getCheckInfo(key, check);
            const isError = check.severity === "error";
            const chip = document.createElement("span");
            chip.textContent = `${isError ? "✖" : "⚠"} ${info.title}: ${check.count}`;
            chip.title = breakdownText(key, check);
            chip.style.cssText = `padding:0.12rem 0.45rem;border-radius:6px;border:1px solid ${isError ? "rgba(239,68,68,0.4)" : "rgba(234,179,8,0.4)"};color:${isError ? "#f87171" : "#facc15"};background:${isError ? "rgba(239,68,68,0.1)" : "rgba(234,179,8,0.1)"};`;
            foundEl.appendChild(chip);
        }
    }

    function renderTopologyInfo(topo, checks) {
        if (!topo) return;
        const angles = topo.angles_deg;
        const valenceHist = topo.valence_histogram;
        const setText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        const fmt = (value, digits = 2) => (typeof value === "number" ? value.toFixed(digits) : "--");

        const wtEl = document.getElementById("qa-topo-watertight");
        if (wtEl) {
            wtEl.innerHTML = topo.is_closed
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

        setText("qa-topo-parts", topo.parts ?? "--");
        setText("qa-topo-area", fmt(topo.surface_area, 3));
        setText("qa-topo-volume", topo.volume === null || topo.volume === undefined ? "—" : fmt(topo.volume, 3));
        // Preservação da silhueta = 100% - Chamfer (distância média à malha
        // original, em % da diagonal). null na própria original (snapshot=0).
        const chamfer = topo.chamfer;
        const preserved = chamfer ? Math.max(0, 100 - chamfer.chamfer_pct) : null;
        setText("qa-topo-chamfer", preserved === null ? "—" : `${fmt(preserved, 3)}%`);
        // Fluxo de arestas: informação, não conta para o veredicto.
        setText("qa-poles-summary", `${topo.smooth_poles ?? 0} em zona lisa • ${topo.high_valence_vertices ?? 0} valência alta (informação, não são erros)`);
        const aspect = topo.quad_aspect_ratio || {};
        setText("qa-aspect-summary", `média ${fmt(aspect.mean, 1)} • máx ${fmt(aspect.max, 1)}`);

        const boundEl = document.getElementById("qa-topo-boundary-edges");
        if (boundEl) boundEl.textContent = (topo.boundary_edges || 0).toLocaleString();

        const nonManEl = document.getElementById("qa-topo-nonman-edges");
        if (nonManEl) nonManEl.textContent = (topo.nonmanifold_edges || 0).toLocaleString();

        // Distribuição de Faces
        // Como o DSS: uma face com uma T-junction tapada num lado é, num modelador,
        // um n-gon (no ficheiro é um quad ou um triângulo). Assim a barra bate com
        // a verificação ngons.
        const totalFaces = topo.faces || 1;
        const tJunctions = checks?.ngons?.evaluated ? (checks.ngons.breakdown?.t_junctions || 0) : 0;
        const fromQuads = Math.min(tJunctions, topo.quads || 0);
        const quads = (topo.quads || 0) - fromQuads;
        const tris = Math.max(0, (topo.tris || 0) - (tJunctions - fromQuads));
        const ngons = (topo.ngons || 0) + tJunctions; // tris + quads + ngons = faces

        const shapeEl = document.getElementById("qa-topo-shape");
        if (shapeEl) {
            shapeEl.textContent = shapeText(topo.shape);
            shapeEl.title = shapeTitle(topo.shape);
        }

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
        const dominanceEl = document.getElementById("side-dss-dominance");
        if (dominanceEl) {
            dominanceEl.textContent = quads === totalFaces ? "Só quads"
                : quads / totalFaces >= 0.5 ? "Quad-Dominant"
                    : tris / totalFaces >= 0.5 ? "Tri-Dominant" : "Mista";
        }

        const isOriginalMesh = (QAState.activeSnapshot === 0 || QAState.activeMeshName?.includes("Original"));
        if (isOriginalMesh) {
            const origWtEl = document.getElementById("orig-watertight-val");
            const origMfEl = document.getElementById("orig-manifold-val");
            const origBdEl = document.getElementById("orig-boundary-val");
            if (origWtEl) origWtEl.innerHTML = topo.is_closed ? `<span style="color:#34d399;">Sim</span>` : `<span style="color:#f87171;">Não</span>`;
            if (origMfEl) origMfEl.innerHTML = topo.is_manifold ? `<span style="color:#34d399;">Sim</span>` : `<span style="color:#f87171;">Não</span>`;
            if (origBdEl) origBdEl.textContent = (topo.boundary_edges || 0).toLocaleString();
        }

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

        const UNIT_LABELS = { faces: "faces", vertices: "vértices", holes: "buracos" };
        const SEVERITY_LABELS = { error: "Erro", warning: "Aviso", info: "Info" };

        // A verificação aberta deixou de existir (outra análise): volta aos erros.
        if (QAState.focusCheck && !(summaryChecks[QAState.focusCheck]?.count > 0)) QAState.focusCheck = null;

        // Primeiro as que encontraram algo (ou não correram); depois de uma
        // barra, as que estão OK.
        const entries = Object.entries(summaryChecks);
        const isClean = ([, data]) => data && data.evaluated !== false && data.count === 0;
        const clean = entries.filter(isClean);
        const ordered = [...entries.filter(entry => !isClean(entry)), null, ...clean];

        for (const entry of ordered) {
            if (entry === null) {
                if (clean.length) {
                    const divider = document.createElement("div");
                    divider.className = "qa-checks-divider";
                    divider.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin:0.6rem 0 0.35rem;font-size:0.7rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#10b981;";
                    divider.innerHTML = `<span style="flex:1;height:1px;background:rgba(16,185,129,0.35);"></span>✓ Sem problemas (${clean.length})<span style="flex:1;height:1px;background:rgba(16,185,129,0.35);"></span>`;
                    container.appendChild(divider);
                }
                continue;
            }
            const [checkKey, checkData] = entry;
            const info = getCheckInfo(checkKey, checkData);
            const isEvaluated = checkData && checkData.count !== null && checkData.count !== undefined && checkData.evaluated !== false;
            const count = isEvaluated ? checkData.count : null;
            const ratio = (isEvaluated && checkData.ratio !== undefined && checkData.ratio !== null) ? (checkData.ratio * 100).toFixed(1) : null;
            const unit = checkData.unit || "faces";
            const basis = UNIT_LABELS[unit] || unit;
            const kinds = count > 0 ? breakdownText(checkKey, checkData) : "";
            const notes = kinds
                ? `<span style="font-size:0.69rem;color:#cbd5e1;display:block;margin-top:2px;">${kinds}</span>`
                : "";

            let severity = !isEvaluated ? "neutral" : (count === 0 ? "ok" : getCheckSeverity(checkKey, checkData));
            const checkColor = info.color || "#64748b";

            const item = document.createElement("div");
            item.className = `qa-check-item severity-${severity}`;
            item.dataset.check = checkKey;

            // A barra lateral esquerda representa SEMPRE a cor correspondente a esta verificação na malha 3D
            item.style.setProperty("border-left", `4px solid ${checkColor}`, "important");
            if (count > 0) {
                item.style.background = `${checkColor}14`;
                item.style.boxShadow = `0 0 8px ${checkColor}22`;
            }


            const resData = resultChecks?.[checkKey];
            // Faces da verificação; nos buracos e não-manifold, primeiro os
            // vértices (fendas, peças que se tocam) e as faces só como vizinhas.
            const affectedIndices = resData && Array.isArray(resData.faces) ? resData.faces : [];
            const affectedVertices = isElementCheck(checkKey) ? markerVertices(checkKey, QAState.resultData) : [];
            const isVertexAnomaly = affectedVertices.length > 0;
            const pills = (list, type) => `${list.slice(0, 16).map(idx => `<button type="button" class="qa-target-pill" data-index="${idx}" data-type="${type}" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); color:#7dd3fc; border-radius:4px; padding:0.18rem 0.45rem; font-size:0.7rem; cursor:pointer; font-family:'JetBrains Mono',monospace; transition:all 0.15s ease;">${type === "vertex" ? 'V#' : '#'}${idx}</button>`).join('')}
                                ${list.length > 16 ? `<span style="font-size:0.68rem; color:#94a3b8; align-self:center;">+${list.length - 16} mais</span>` : ''}`;
            const pillGroup = (label, list, type) => list.length ? `
                        <div style="margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed rgba(255,255,255,0.12);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size: 0.72rem; color: #38bdf8; font-weight: 600;">${label} (${list.length}):</span>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Clica para focar no 3D</span>
                            </div>
                            <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.4rem;">
                                ${pills(list, type)}
                            </div>
                        </div>` : "";
            const vertexLabel = checkKey === "holes" ? "Fendas (vértice pousado)" : "Vértices onde as peças se tocam";
            const faceLabel = isElementCheck(checkKey) ? "Faces junto ao defeito" : "Faces Afetadas";

            item.innerHTML = `
                <div class="qa-check-header">
                    <div class="qa-check-title-group" style="display:flex;align-items:center;gap:0.55rem;">
                        <div>
                            <span class="qa-check-name">${info.title}</span>
                            <span class="qa-check-counts">${isEvaluated ? `${count} ${basis} ${ratio !== null && count > 0 && unit === "faces" ? `(${ratio}%)` : ""}` : "Não avaliado"}</span>
                            ${notes}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                        <span class="qa-badge" style="${count > 0 ? `border: 1px solid ${checkColor}; color: ${checkColor}; background: ${checkColor}18; font-weight:700;` : (count === 0 ? 'border: 1px solid rgba(16,185,129,0.4); color: #10b981; background: rgba(16,185,129,0.1);' : '')}">
                            ${!isEvaluated ? "Não avaliado" : (count === 0 ? "OK" : (SEVERITY_LABELS[checkData.severity] || "Prob."))}
                        </span>
                        <span class="qa-chevron" style="color:#64748b;font-size:0.7rem;">▼</span>
                    </div>
                </div>
                <div class="qa-check-exp" style="display: none;">
                    <div style="display:flex;align-items:center;gap:0.45rem;margin-bottom:0.6rem;padding:0.4rem 0.6rem;background:${checkColor}15;border:1px solid ${checkColor}35;border-radius:6px;font-size:0.73rem;color:${checkColor};font-weight:600;">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${checkColor};box-shadow:0 0 4px ${checkColor};"></span>
                        No 3D: ${mapHowText(checkKey)}
                    </div>
                    <h6>O que é?</h6>
                    <p>${info.what}</p>
                    <h6>Porque importa?</h6>
                    <p>${typeof info.why === 'function' ? info.why(checkData) : info.why}</p>
                    <h6>Como corrigir?</h6>
                    <p>${info.how}</p>
                    ${pillGroup(vertexLabel, affectedVertices, "vertex")}
                    ${pillGroup(faceLabel, affectedIndices, "face")}
                </div>
            `;

            // Toggle do acordeão explicativo
            const header = item.querySelector(".qa-check-header");
            const exp = item.querySelector(".qa-check-exp");
            const chevron = item.querySelector(".qa-chevron");

            if (QAState.focusCheck === checkKey) {
                exp.style.display = "block";
                chevron.textContent = "▲";
                item.classList.add("qa-check-focused");
                item.style.outline = `2px solid ${checkColor}`;
            }

            header.addEventListener("click", () => {
                const isShown = exp.style.display === "block";
                // Abrir uma verificação mostra só essa no 3D; fechá-la volta aos erros.
                if (!(count > 0)) {
                    // Sem nada para mostrar no 3D: só abre a explicação.
                    exp.style.display = isShown ? "none" : "block";
                    chevron.textContent = isShown ? "▼" : "▲";
                    return;
                }
                QAState.focusCheck = isShown ? null : checkKey;
                renderChecksList(summaryChecks, resultChecks);
                if (QAState.activeViewMode === "none" && typeof setViewMode === "function") {
                    setViewMode("errors");
                } else {
                    updateDSSColors();
                }

                // Focar elemento afetado no 3D
                if (!isShown && (affectedIndices.length > 0 || isVertexAnomaly)) {
                    if (isVertexAnomaly) {
                        focusVertex(affectedVertices[0]);
                    } else {
                        focusFaces(affectedIndices);
                    }
                }
            });

            // Cliques individuais nos botões
            const targetPills = exp.querySelectorAll(".qa-target-pill");
            targetPills.forEach(pill => {
                pill.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = parseInt(pill.dataset.index, 10);
                    const type = pill.dataset.type;
                    if (!isNaN(idx)) {
                        if (type === "vertex") {
                            focusVertex(idx);
                        } else {
                            focusFaces([idx]);
                        }
                    }
                });
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
                    // A API manda {verification, message}.
                    li.textContent = (w && typeof w === "object")
                        ? `${getCheckInfo(w.verification || w.check).title}: ${w.message}`
                        : String(w);
                    warnListEl.appendChild(li);
                });
            } else {
                warnListEl.innerHTML = `<li style="color:#10b981;">Nenhum aviso reportado pelo pipeline.</li>`;
            }
        }
    }

    function getFacesCentroid(faceIndices) {
        const viewer = getViewer();
        const activeMesh = viewer?.mesh || dssMesh;
        if (!activeMesh || !activeMesh.geometry || !activeMesh.geometry.attributes.position) return null;

        const geo = activeMesh.geometry;
        const pos = geo.attributes.position.array;
        const faceToTriangles = geo.userData?.faceToTriangles || qaFaceToTrianglesMap;
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;

        for (const fIdx of faceIndices) {
            const triIndices = (faceToTriangles && faceToTriangles[fIdx]) ? faceToTriangles[fIdx] : (qaFaceToTrianglesMap[fIdx] || [fIdx]);
            if (!triIndices) continue;
            for (const tIdx of triIndices) {
                const off = tIdx * 9;
                if (off + 8 < pos.length) {
                    for (let v = 0; v < 3; v++) {
                        sumX += pos[off + v * 3];
                        sumY += pos[off + v * 3 + 1];
                        sumZ += pos[off + v * 3 + 2];
                        count++;
                    }
                }
            }
        }
        if (count === 0) return null;
        return new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
    }

    function getFacesBoundingRadius(faceIndices, centroid) {
        const viewer = getViewer();
        const activeMesh = viewer?.mesh || dssMesh;
        if (!activeMesh || !activeMesh.geometry || !activeMesh.geometry.attributes.position || !centroid) return 8;

        const geo = activeMesh.geometry;
        const pos = geo.attributes.position.array;
        const faceToTriangles = geo.userData?.faceToTriangles || qaFaceToTrianglesMap;
        let maxDistSq = 0;

        for (const fIdx of faceIndices) {
            const triIndices = (faceToTriangles && faceToTriangles[fIdx]) ? faceToTriangles[fIdx] : (qaFaceToTrianglesMap[fIdx] || [fIdx]);
            if (!triIndices) continue;
            for (const tIdx of triIndices) {
                const off = tIdx * 9;
                if (off + 8 < pos.length) {
                    for (let v = 0; v < 3; v++) {
                        const dx = pos[off + v * 3] - centroid.x;
                        const dy = pos[off + v * 3 + 1] - centroid.y;
                        const dz = pos[off + v * 3 + 2] - centroid.z;
                        const distSq = dx * dx + dy * dy + dz * dz;
                        if (distSq > maxDistSq) maxDistSq = distSq;
                    }
                }
            }
        }
        const r = Math.sqrt(maxDistSq);
        return Math.max(3, Math.min(20, r * 3.0 + 3.0));
    }

    function getFaceNormal(faceIdx) {
        const viewer = getViewer();
        const activeMesh = viewer?.mesh || dssMesh;
        if (!activeMesh || !activeMesh.geometry) return new THREE.Vector3(0, 0, 1);

        const geo = activeMesh.geometry;
        const pos = geo.attributes.position?.array;
        if (!pos) return new THREE.Vector3(0, 0, 1);

        const faceToTriangles = geo.userData?.faceToTriangles || qaFaceToTrianglesMap;
        const triIndices = (faceToTriangles && faceToTriangles[faceIdx]) ? faceToTriangles[faceIdx] : (qaFaceToTrianglesMap[faceIdx] || [faceIdx]);
        if (!triIndices || triIndices.length === 0) return new THREE.Vector3(0, 0, 1);

        const tIdx = triIndices[0];
        const off = tIdx * 9;
        if (off + 8 >= pos.length) return new THREE.Vector3(0, 0, 1);

        const p0 = new THREE.Vector3(pos[off], pos[off + 1], pos[off + 2]);
        const p1 = new THREE.Vector3(pos[off + 3], pos[off + 4], pos[off + 5]);
        const p2 = new THREE.Vector3(pos[off + 6], pos[off + 7], pos[off + 8]);

        const e1 = new THREE.Vector3().subVectors(p1, p0);
        const e2 = new THREE.Vector3().subVectors(p2, p0);
        const normal = new THREE.Vector3().crossVectors(e1, e2);
        if (normal.lengthSq() < 0.000001) {
            const triCenter = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
            return triCenter.lengthSq() > 0.0001 ? triCenter.normalize() : new THREE.Vector3(0, 0, 1);
        }
        return normal.normalize();
    }

    function getVertexInfo(vIdx) {
        const viewer = getViewer();
        const activeMesh = viewer?.mesh || dssMesh;
        if (!activeMesh || !activeMesh.geometry) return null;

        const geo = activeMesh.geometry;
        const posAttr = geo.attributes.position;
        const normAttr = geo.attributes.normal;
        if (!posAttr) return null;

        const vertexIndices = geo.userData?.vertexIndices || qaTriangleVertexIndices;
        const rawVerts = geo.userData?.rawVerts || qaParsedVertices;
        const center = geo.userData?.center || qaCenter;
        const scale = geo.userData?.scale || qaScale;

        let pos = null;
        let normal = null;

        if (rawVerts && center && scale && rawVerts[vIdx]) {
            pos = new THREE.Vector3(
                (rawVerts[vIdx][0] - center.x) * scale,
                (rawVerts[vIdx][1] - center.y) * scale,
                (rawVerts[vIdx][2] - center.z) * scale
            );
        }

        if (vertexIndices && normAttr) {
            const normSum = new THREE.Vector3();
            let normCount = 0;
            for (let i = 0; i < vertexIndices.length; i++) {
                if (vertexIndices[i] === vIdx) {
                    if (!pos) {
                        pos = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                    }
                    normSum.x += normAttr.getX(i);
                    normSum.y += normAttr.getY(i);
                    normSum.z += normAttr.getZ(i);
                    normCount++;
                }
            }
            if (normCount > 0 && normSum.lengthSq() > 0.0001) {
                normal = normSum.normalize();
            }
        }

        if (!pos && posAttr.count > 0) {
            pos = new THREE.Vector3(posAttr.getX(0), posAttr.getY(0), posAttr.getZ(0));
        }
        if (!normal) {
            normal = pos ? pos.clone().normalize() : new THREE.Vector3(0, 0, 1);
            if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1);
        }

        return { position: pos, normal: normal };
    }

    function selectVertexInQA(vIdx) {
        const viewer = getViewer();
        if (!viewer || !viewer.scene) return;

        QAState.selectedVertIdx = vIdx;
        const vInfo = getVertexInfo(vIdx);
        if (!vInfo) return;

        if (dssVertexMarker) {
            viewer.scene.remove(dssVertexMarker);
            dssVertexMarker.geometry.dispose();
            dssVertexMarker = null;
        }

        const markerGeo = new THREE.SphereGeometry(0.22, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, depthTest: false });
        dssVertexMarker = new THREE.Mesh(markerGeo, markerMat);
        dssVertexMarker.position.copy(vInfo.position);
        dssVertexMarker.renderOrder = 1000;
        viewer.scene.add(dssVertexMarker);

        const panel = document.getElementById("qa-detail-panel");
        const titleEl = document.getElementById("qa-detail-title");
        const typeEl = document.getElementById("qa-detail-type");
        const minAEl = document.getElementById("qa-detail-min-angle");
        const maxAEl = document.getElementById("qa-detail-max-angle");
        const errorsBox = document.getElementById("qa-detail-errors");
        const vertsBox = document.getElementById("qa-detail-verts");

        const res = QAState.resultData;
        const valences = res?.per_vertex?.valence || [];
        const val = (valences && vIdx < valences.length) ? valences[vIdx] : "--";
        const regular = QAState.statusData?.summary?.metrics?.regular_valence || 4;

        // Checks de vértices em que este vértice aparece.
        const vertexIssues = vertexMarkerChecks(res).filter(key => markerVertices(key, res).includes(vIdx));

        if (titleEl) titleEl.textContent = `Vértice #${vIdx}`;
        if (typeEl) {
            typeEl.textContent = vertexIssues.length
                ? `${getCheckInfo(vertexIssues[0], res?.checks?.[vertexIssues[0]]).title} (Valência ${val})`
                : `Vértice (Valência ${val})`;
            typeEl.style.color = "#c084fc";
            typeEl.style.background = "rgba(192, 132, 252, 0.15)";
        }
        if (minAEl) minAEl.textContent = `Valência: ${val}`;
        if (maxAEl) maxAEl.textContent = `Regular: ${regular}`;
        if (errorsBox) {
            const VERTEX_TEXT = {
                holes: "fenda: está pousado numa aresta aberta sem estar ligado a ela (as duas arestas ficam uma sobre a outra e parecem fechadas)",
                nonmanifold: "as peças da superfície tocam-se só neste vértice",
            };
            const tag = (color, text) => `<span class="qa-badge" style="border: 1px solid ${color}; color: ${color}; background: ${color}18; font-weight:600; font-size:0.72rem; padding:0.2rem 0.5rem; border-radius:4px;">${text}</span>`;
            const issues = vertexIssues.map(key => {
                const info = getCheckInfo(key, res?.checks?.[key]);
                return tag(info.color || "#c084fc", `${info.title}${VERTEX_TEXT[key] ? `: ${VERTEX_TEXT[key]}` : ""}`);
            });
            // Fluxo de arestas: informação, não é um erro.
            const flow = edgeFlowKinds(res, vIdx);
            if (flow.length) issues.push(tag(EDGE_FLOW_HEX, `Fluxo de arestas (informação): ${flow.join(", ")}, valência ${val} (normal ${regular})`));
            errorsBox.innerHTML = issues.length
                ? issues.join(" ")
                : `<span class="qa-badge ok" style="color:#10b981;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);padding:0.2rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:600;">✓ Sem problemas detetados</span>`;
        }
        if (vertsBox) {
            vertsBox.innerHTML = `<span class="qa-vert-chip" style="border-color:#c084fc; color:#c084fc;">X: ${vInfo.position.x.toFixed(2)} Y: ${vInfo.position.y.toFixed(2)} Z: ${vInfo.position.z.toFixed(2)}</span>`;
        }

        if (panel) panel.style.display = "block";
    }

    function animateCameraTo(targetCenter, distance = 14, duration = 650, viewNormal = null) {
        const viewer = getViewer();
        if (!viewer || !viewer.camera || !viewer.controls) return;

        if (cameraTweenId) {
            cancelAnimationFrame(cameraTweenId);
            cameraTweenId = null;
        }

        const startPos = viewer.camera.position.clone();
        const startTarget = viewer.controls.target.clone();
        const endTarget = targetCenter.clone();

        let targetDir = new THREE.Vector3();
        if (viewNormal && viewNormal.lengthSq() > 0.0001) {
            targetDir.copy(viewNormal).normalize();
            if (Math.abs(targetDir.y) > 0.82) {
                const tilt = targetDir.z >= 0 ? 0.38 : -0.38;
                targetDir.z += tilt;
                targetDir.normalize();
            }
        } else {
            targetDir.subVectors(startPos, startTarget);
            if (targetDir.lengthSq() < 0.0001) targetDir.set(0, 0, 1);
            targetDir.normalize();
        }

        const startRelDir = startPos.clone().sub(startTarget);
        const startDist = Math.max(startRelDir.length(), 1);
        startRelDir.normalize();

        const endRelDir = targetDir.clone();
        const endDist = distance;

        const qRot = new THREE.Quaternion();
        const dot = startRelDir.dot(endRelDir);
        if (dot < -0.999) {
            const axis = Math.abs(startRelDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            const perp = new THREE.Vector3().crossVectors(startRelDir, axis).normalize();
            qRot.setFromAxisAngle(perp, Math.PI);
        } else {
            qRot.setFromUnitVectors(startRelDir, endRelDir);
        }

        const qIdentity = new THREE.Quaternion();
        const startTime = performance.now();

        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const ease = easeInOutCubic(progress);

            const currentTarget = new THREE.Vector3().lerpVectors(startTarget, endTarget, ease);
            viewer.controls.target.copy(currentTarget);

            // three r128: slerpQuaternions não devolve o quaternião; slerp sim.
            const currentQ = qIdentity.clone().slerp(qRot, ease);
            const currentDir = startRelDir.clone().applyQuaternion(currentQ).normalize();
            const currentDist = THREE.MathUtils.lerp(startDist, endDist, ease);

            viewer.camera.position.copy(currentTarget).addScaledVector(currentDir, currentDist);
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
            const normal = getFaceNormal(faceIndices[0]);
            animateCameraTo(centroid, dist, 650, normal);
        }
    }

    function focusVertex(vIdx) {
        if (vIdx === null || vIdx === undefined) return;

        if (typeof setViewMode === "function" && QAState.activeViewMode !== "errors") {
            setViewMode("errors");
        }

        selectVertexInQA(vIdx);

        const vInfo = getVertexInfo(vIdx);
        if (vInfo) {
            animateCameraTo(vInfo.position, 6.5, 650, vInfo.normal);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  9. EXECUÇÃO DA ANÁLISE (LIVE API & FIXTURES FALLBACK)
    // ═══════════════════════════════════════════════════════════════════
    // Verificações que já tinham by_kind (faces de cada tipo) no formato interno.
    const BY_KIND_CHECKS = new Set(["broken_faces", "distorted_faces", "flipped_normals", "overlaps"]);

    /**
     * Schema 6: o general_metrics só tem as métricas gerais. O painel completo
     * ainda mostra buracos, manifold, ângulos e polos: vêm das verificações e,
     * quando há, dos dados do 3D (/viewer), como a API os calculava.
     */
    function derivedMetrics(general, checks, drawing, params) {
        const out = {};
        const holes = checks.holes;
        const nonman = checks.nonmanifold;
        if (holes?.evaluated) {
            out.holes = holes.count;
            out.boundary_edges = holes.breakdown?.open_edges ?? 0;
        }
        if (nonman?.evaluated) {
            out.nonmanifold_edges = nonman.breakdown?.edges ?? 0;
            out.nonmanifold_vertices = nonman.breakdown?.vertices ?? 0;
            out.is_manifold = !nonman.count;
        }
        out.regular_valence = params?.regular_valence
            || (general.faces && general.quads / general.faces >= 0.5 ? 4 : 6);

        const finite = (list) => (list || []).filter(v => typeof v === "number");
        const perFace = drawing.per_face;
        if (perFace) {
            const mins = finite(perFace.min_angle);
            const maxs = finite(perFace.max_angle);
            if (mins.length) {
                out.angles_deg = {
                    min: mins.reduce((a, b) => Math.min(a, b)),
                    max: maxs.length ? maxs.reduce((a, b) => Math.max(a, b)) : null,
                    mean: mins.reduce((a, b) => a + b, 0) / mins.length,
                };
            }
            const aspects = finite(perFace.aspect_ratio);
            if (aspects.length) {
                out.quad_aspect_ratio = {
                    mean: aspects.reduce((a, b) => a + b, 0) / aspects.length,
                    max: aspects.reduce((a, b) => Math.max(a, b)),
                };
            }
        }
        // Histograma só dos vértices interiores: fora os das arestas abertas e
        // não-manifold (estão nos errors dessas verificações).
        const valence = drawing.per_vertex?.valence;
        if (valence) {
            const border = new Set();
            for (const error of [...(holes?.errors || []), ...(nonman?.errors || [])]) {
                if (error.edge && error.kind !== "cracks") error.edge.forEach(v => border.add(v));
            }
            const histogram = {};
            valence.forEach((count, vertex) => {
                if (count > 0 && !border.has(vertex)) histogram[count] = (histogram[count] || 0) + 1;
            });
            out.valence_histogram = histogram;
        }
        const flow = drawing.edge_flow;
        if (flow) {
            out.smooth_poles = flow.smooth_poles?.length || 0;
            out.high_valence_vertices = flow.high_valence?.length || 0;
        }
        return out;
    }

    /**
     * A API (schema 6) dá general_metrics e uma lista verifications com errors;
     * o que só serve para desenhar (faces a pintar, per_face, per_vertex,
     * edge_flow) vem à parte, de GET /v1/dss/{id}/viewer. O viewer trabalha com
     * metrics e checks por código (faces, by_kind, hosts). Aceita o estado do job
     * (com summary) ou o download (com os dados do 3D em `viewer`); o que já está
     * convertido passa igual.
     */
    function adaptDSS(json, viewer = null) {
        if (!json) return json;
        const toViewer = (report) => {
            if (!report || report.checks || !Array.isArray(report.verifications)) return report;
            const general = report.general_metrics || {};
            const checks = {};
            for (const item of report.verifications) {
                const check = {
                    title: item.verification_name,
                    severity: item.severity,
                    unit: item.unit,
                    count: item.count,
                    ratio: item.ratio,
                    evaluated: item.result !== "not_evaluated",
                };
                if (item.values) check.breakdown = item.values;
                if (item.warnings) check.warnings = item.warnings;
                if (item.errors) check.errors = item.errors;
                // Faces a pintar: as do /viewer; sem elas, as faces dos erros.
                const paint = viewer?.faces?.[item.code] || item.faces;
                if (paint) check.faces = paint;
                else if (Array.isArray(item.errors)) {
                    check.faces = [...new Set(item.errors.filter(e => e.face !== undefined).map(e => e.face))];
                }
                if (Array.isArray(item.errors)) {
                    // As arestas e os vértices vêm nos errors (edge / vertex): o
                    // viewer desenha-os como linhas e pontos.
                    if (item.code === "holes" || item.code === "nonmanifold") {
                        check.edges = item.errors.filter(e => e.edge && (item.code !== "holes" || e.kind === "open_edges")).map(e => e.edge);
                        check.vertices = [...new Set(item.errors.filter(e => e.vertex !== undefined).map(e => e.vertex))];
                    }
                    if (BY_KIND_CHECKS.has(item.code)) {
                        const byKind = {};
                        for (const kind of Object.keys(item.values || {})) {
                            if (kind !== "inside_out_parts") byKind[kind] = [];
                        }
                        for (const error of item.errors) {
                            if (error.face !== undefined) (byKind[error.kind] ||= []).push(error.face);
                        }
                        check.by_kind = byKind;
                    }
                    const hosts = {};
                    for (const error of item.errors) {
                        if (error.covers?.length) hosts[String(error.face)] = error.covers;
                    }
                    if (Object.keys(hosts).length) check.hosts = hosts;
                }
                checks[item.code] = check;
            }
            const drawing = {};
            for (const key of ["per_face", "per_vertex", "edge_flow"]) {
                const value = viewer?.[key] || report[key];
                if (value) drawing[key] = value;
            }
            const metrics = {
                ...general,
                is_closed: general.is_watertight,
                ...derivedMetrics(general, checks, drawing, report.params),
            };
            return { ...report, ...drawing, metrics, checks };
        };
        return json.summary ? { ...json, summary: toViewer(json.summary) } : toViewer(json);
    }

    async function loadDSSData(statusJson, resultJson, rawObjText, viewerJson = null) {
        statusJson = adaptDSS(statusJson);
        resultJson = adaptDSS(resultJson, viewerJson);
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
            removeDSSEdgeLines(viewer.scene);
            if (dssSelectionLine) { viewer.scene.remove(dssSelectionLine); dssSelectionLine.geometry.dispose(); dssSelectionLine = null; }
            if (dssVertexMarker) { viewer.scene.remove(dssVertexMarker); dssVertexMarker.geometry.dispose(); dssVertexMarker = null; }
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

    /** Um novo RL apaga quads e análises da malha: esquecer o que estava em cache. */
    function invalidateMeshAnalyses(meshId) {
        if (!meshId) return;
        for (const key of [...dssAnalysisCache.keys()]) {
            if (key.startsWith(`${meshId}_`)) dssAnalysisCache.delete(key);
        }
        QAState.statusData = null;
        QAState.resultData = null;
        QAState.rawObjText = null;
    }

    /** Estado "indisponível" (409): falta um passo antes desta análise (ex.: o quad). */
    function renderDSSUnavailable(message) {
        const statusEl = document.getElementById("qa-header-status");
        const verdictEl = document.getElementById("qa-header-verdict");
        const drawerStatus = document.getElementById("dss-drawer-status");
        const drawerVerdict = document.getElementById("dss-drawer-verdict");
        const quadFailed = /failed/i.test(message || "");
        const quadMissing = /run the quad first/i.test(message || "");
        const label = quadFailed ? "Sem Quads" : (quadMissing ? "Sem Quads" : "À Espera do Quad");
        const hint = quadFailed
            ? "A conversão em quads desta malha falhou, por isso não há malha em quads para analisar."
            : quadMissing
                ? "Este snapshot ainda não tem quads. Gere-os no Relatório de Decimação → Snapshots (\u201cGerar quads\u201d); a análise DSS corre quando terminarem."
                : "A análise DSS precisa da malha em quads, que ainda não está pronta. Tente de novo quando a conversão terminar.";
        const html = `<span style="color:#fbbf24;font-weight:600;">⏳ ${hint}</span> <span style="color:#94a3b8;">(${message})</span>`;
        for (const el of [statusEl, drawerStatus]) {
            if (el) {
                el.className = "status-badge working";
                el.textContent = label;
            }
        }
        if (verdictEl) verdictEl.innerHTML = html;
        if (drawerVerdict) {
            drawerVerdict.innerHTML = html;
            drawerVerdict.style.color = "";
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

        // A malha final (quads) só existe quando o RL e o quad final terminam.
        if (snapshot === null && typeof window.isRLRunning === "function" && window.isRLRunning()) {
            setWaitingRLState();
            return;
        }

        if (snapshot === 0) {
            QAState.activeMeshName = "Malha Original (Upload)";
        } else if (snapshot !== null && snapshot !== undefined) {
            QAState.activeMeshName = `Snapshot #${snapshot} (${snapshot} junções)`;
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
                const statusResult = adaptDSS(await window.MeshQAAPI.runFullAnalysis(
                    idToRun,
                    QAState.params,
                    snapshot,
                    (statusUpdate) => {
                        if (statusEl) {
                            statusEl.className = "status-badge working";
                            statusEl.textContent = statusUpdate.status === "queued" ? "Em Fila..." : "A Processar...";
                        }
                    }
                ));

                if (statusResult && statusResult.status === "failed") {
                    renderDSSFailed(statusResult);
                    return;
                }

                // O resultado (só a análise) e o que o 3D precisa para o desenhar.
                const [resultRaw, viewerRaw] = await Promise.all([
                    window.MeshQAAPI.downloadAnalysisResult(idToRun, snapshot),
                    window.MeshQAAPI.getAnalysisViewer(idToRun, snapshot).catch(() => null),
                ]);
                const resultData = adaptDSS(resultRaw, viewerRaw);

                let objText = null;
                if (snapshot === 0) {
                    // snapshot=0 analisa a malha limpa (vértices fundidos, faces degeneradas removidas)
                    objText = (typeof window.getCleanMeshObjText === "function" && window.getCleanMeshObjText())
                        || window.currentUploadedObjText || QAState.rawObjText;
                } else if (snapshot === null) {
                    objText = typeof window.getFinalMeshObjText === "function" ? window.getFinalMeshObjText() : null;
                } else {
                    // O DSS de um snapshot analisa os quads desse snapshot
                    const snapIsQuad = typeof window.getCurrentSnapIsQuad === "function" && window.getCurrentSnapIsQuad();
                    if (snapIsQuad && typeof window.getCurrentSnapObjText === "function") {
                        objText = window.getCurrentSnapObjText();
                    }
                    if (!objText) {
                        try {
                            objText = await window.RetopoAPI.downloadQuadMesh(idToRun, snapshot);
                        } catch (_) { }
                    }
                }
                if (!objText && !resultData?.geometry) {
                    try {
                        // O DSS da malha final analisa os quads do quad final
                        objText = snapshot === null
                            ? await window.RetopoAPI.downloadQuadMesh(idToRun)
                            : await window.RetopoAPI.downloadSimplifiedMesh(idToRun);
                    } catch (_) { }
                }

                dssAnalysisCache.set(cacheKey, { statusData: statusResult, resultData, rawObjText: objText });
                await loadDSSData(statusResult, resultData, objText);

            } catch (err) {
                if (err?.status === 409) {
                    console.info("[DSS] Análise indisponível por agora:", err.message);
                    renderDSSUnavailable(err.message);
                    return;
                }
                console.warn("[DSS] Falha na API ao auditar:", err.message);
                const verdictEl = document.getElementById("qa-header-verdict");
                if (statusEl) {
                    statusEl.className = "status-badge offline";
                    statusEl.textContent = "Falhou";
                }
                if (verdictEl) {
                    const info = window.describeApiError(err);
                    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
                    verdictEl.innerHTML = `<span style="color:#ef4444;font-weight:600;">❌ ${esc(info.title)}:</span> <span style="color:#fca5a5;" title="${esc(info.detail)}">${esc(info.message)}</span>`;
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
            renderSideDSSFacts(null, null);

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

        openDSSWindow = function () {
            if (window.updateSidebarContext) {
                window.updateSidebarContext("dss");
            }
            const isSnap = (typeof window.getActiveView === "function" && window.getActiveView() === "snapshot");
            const snapToAudit = isSnap && typeof window.getCurrentSnapDissolves === "function" ? window.getCurrentSnapDissolves() : null;
            if (!QAState.resultData || QAState.activeSnapshot !== snapToAudit) {
                runDSSAnalysis(QAState.activeMeshId || window.currentActiveModelId, snapToAudit);
            }
        };

        closeDSSWindow = function () {
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

        setViewMode = function (mode) {
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
                // Ligar o mapa mostra o mapa todo, não a última verificação aberta.
                QAState.focusCheck = null;
                QAState.showWarnings = true;
                const summaryChecks = QAState.statusData?.summary?.checks;
                if (summaryChecks) renderChecksList(summaryChecks, QAState.resultData?.checks);
                setViewMode(lastSelectedDSSMode || "errors");
            }
        }

        const sideBtnToggle = document.getElementById("side-btn-dss-toggle");
        if (sideBtnToggle) sideBtnToggle.addEventListener("click", toggleDSSColorMap);

        const drawerBtnToggle = document.getElementById("dss-drawer-btn-toggle");
        if (drawerBtnToggle) drawerBtnToggle.addEventListener("click", toggleDSSColorMap);

        // Botão Fechar Painel Raycaster
        const btnCloseDetail = document.getElementById("qa-detail-close");
        if (btnCloseDetail) btnCloseDetail.addEventListener("click", closeQADetailPanel);

        // Inicializar Raycaster Unificado para inspeção interativa de faces
        setupUnifiedRaycaster();

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
        invalidateMesh: invalidateMeshAnalyses,
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
        setupRaycaster: setupUnifiedRaycaster,
        state: QAState
    };

})();
