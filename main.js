(() => {
    const uploadModal = document.getElementById("upload-modal");
    const dropZone = document.getElementById("drop-zone");
    const uploadProgress = document.getElementById("upload-progress");
    const progressBar = document.getElementById("progress-bar");
    const mainApp = document.getElementById("main-app");
    const fileInput = document.getElementById("file-input");
    const loadingStatus = document.getElementById("loading-status");

    function startUploadFlow(fileObj) {
        // Garantir que a UI muda
        dropZone.style.display = "none";
        uploadProgress.style.display = "block";
        
        // Atualizar texto com o nome do ficheiro, se existir
        const name = fileObj ? fileObj.name : "modelo";
        loadingStatus.innerText = `A carregar ficheiro ${name}...`;
        
        // Criar um Local Object URL do ficheiro que foi carregado
        const fileUrl = fileObj ? URL.createObjectURL(fileObj) : null;
        
        // --- Delegação da lógica de upload para a API Mock ---
        PolyOptimaAPI.uploadModel(fileObj, (progress) => {
            progressBar.style.width = `${Math.min(progress, 100)}%`;
            
            if(progress >= 100) {
                loadingStatus.innerText = "Concluído!";
                setTimeout(() => {
                    uploadModal.classList.add("hidden");
                    mainApp.style.filter = "none";
                    mainApp.style.pointerEvents = "all";
                    
                    // Inicia o 3D passando o ID devolvido pela API e o URL do ficheiro
                    initThreeJS("mock_id_do_modelo", fileUrl);
                }, 500);
            }
        });
    }

    // Input via clique nativo no botão (Label -> Input)
    fileInput.addEventListener("change", (e) => {
        if(e.target.files && e.target.files.length > 0) {
            startUploadFlow(e.target.files[0]);
        }
    });

    // Drag and Drop ao nível da JANELA (100% à prova de falhas)
    window.addEventListener("dragenter", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }, false);
    window.addEventListener("dragover", (e) => { e.preventDefault(); }, false);
    window.addEventListener("dragleave", (e) => { 
        e.preventDefault(); 
        if (e.clientX === 0 || e.clientY === 0) dropZone.classList.remove("dragover");
    }, false);
    
    window.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if(e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            startUploadFlow(e.dataTransfer.files[0]);
        }
    }, false);

    // A Label já cuida do clique nativamente. Não precisamos forçar o fileInput.click()

    // --- 1. Three.js Setup ---
    function initThreeJS(modelId, fileUrl) {
        const canvas = document.getElementById("canvas3d");
        const container = canvas.parentElement;

        const scene = new THREE.Scene();
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 40);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Resize Handler
    window.addEventListener('resize', () => {
        if(container.clientWidth === 0) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(10, 20, 20);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x3b82f6, 0.5); // Blue rim light
    dirLight2.position.set(-10, -20, -20);
    scene.add(dirLight2);

    // --- 2. Meshes (Mocking High/Low Poly) ---
    // High Poly (Simulating the original sculpt)
    let highPolyGeo = new THREE.TorusKnotGeometry(8, 2.5, 256, 64);
    // Low Poly (Simulating the RL result at step 100)
    let lowPolyGeo = new THREE.TorusKnotGeometry(8, 2.5, 48, 8);

    // Materials
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.4,
        metalness: 0.1,
        wireframe: false
    });

    // Heatmap Material (Custom Shader to simulate XAI visualization)
    const heatmapMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                // Fake heatmap logic: map curvature/position to color gradient (blue to red)
                float intensity = abs(sin(vPosition.x * 0.5 + vPosition.y * 0.5));
                vec3 coldColor = vec3(0.1, 0.3, 0.8); // Blue (Planar/Easy)
                vec3 hotColor = vec3(0.9, 0.1, 0.1);  // Red (High Detail/Preserved)
                
                // Rim lighting for 3D feel
                float rim = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
                rim = smoothstep(0.6, 1.0, rim);
                
                vec3 finalColor = mix(coldColor, hotColor, intensity) + vec3(rim * 0.3);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
    });

    const mesh = new THREE.Mesh(highPolyGeo, baseMaterial);
    scene.add(mesh);

    if (fileUrl) {
        const loader = new THREE.OBJLoader();
        loader.load(fileUrl, (obj) => {
            let loadedGeo = null;
            obj.traverse((child) => {
                if (child.isMesh && !loadedGeo) {
                    loadedGeo = child.geometry;
                }
            });

            if (loadedGeo) {
                // Centrar e ajustar tamanho da malha carregada
                loadedGeo.computeBoundingBox();
                const boundingBox = loadedGeo.boundingBox;
                const center = new THREE.Vector3();
                boundingBox.getCenter(center);
                loadedGeo.translate(-center.x, -center.y, -center.z);

                const size = new THREE.Vector3();
                boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 15 / maxDim; // Alvo de tamanho 15
                loadedGeo.scale(scale, scale, scale);

                highPolyGeo = loadedGeo;
                lowPolyGeo = loadedGeo; // No protótipo partilhamos a geometria

                mesh.geometry = highPolyGeo;
                
                if(typeof updateStatsEx === "function") {
                    updateStatsEx(highPolyGeo, false);
                }
            }
        });
    }

    // Animation Loop
    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        
        // Auto-rotation
        mesh.rotation.y += 0.005;
        mesh.rotation.x += 0.002;

        // Update shaders
        if(mesh.material === heatmapMaterial) {
            heatmapMaterial.uniforms.time.value = clock.getElapsedTime();
        }

        renderer.render(scene, camera);
    }
    animate();

    // --- 3. UI Interactions & XAI Logic ---

    // View Controls
    const btnHigh = document.getElementById("btn-high-poly");
    const btnLow = document.getElementById("btn-low-poly");
    const btnWire = document.getElementById("btn-wireframe");
    const toggleHeatmap = document.getElementById("toggle-heatmap");

    // --- RL Slider & Rewards Simulation Elements ---
    const rlSlider = document.getElementById("rl-episode-slider");
    const sliderDisplay = document.getElementById("slider-val-display");
    const terminal = document.getElementById("terminal-log");
    
    const barSil = document.getElementById("bar-sil");
    const barTri = document.getElementById("bar-tri");
    const barUv = document.getElementById("bar-uv");

    function updateStats(verts, tris) {
        document.getElementById("val-verts").innerText = verts.toLocaleString();
        document.getElementById("val-tris").innerText = tris.toLocaleString();
    }

    const getTris = (geo) => geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    
    // updateStatsEx finge a redução de polígonos caso a geometria seja a mesma
    function updateStatsEx(geo, isLowPoly = false) {
        if (!geo || !geo.attributes || !geo.attributes.position) return;
        const verts = geo.attributes.position.count;
        const tris = getTris(geo);
        
        if (isLowPoly && highPolyGeo === lowPolyGeo) {
            updateStats(Math.floor(verts * 0.1), Math.floor(tris * 0.1));
        } else {
            updateStats(verts, tris);
        }
    }

    // Set initial stats
    updateStatsEx(highPolyGeo, false);

    // Inicialmente o Low Poly está bloqueado até o RL terminar
    btnLow.disabled = true;
    btnLow.style.opacity = "0.4";
    btnLow.style.cursor = "not-allowed";
    btnLow.innerText = "🔒 A Otimizar...";
    rlSlider.disabled = true;

    btnHigh.addEventListener("click", () => {
        mesh.geometry = highPolyGeo;
        btnHigh.classList.add("active");
        btnLow.classList.remove("active");
        updateStatsEx(highPolyGeo, false);
        
        // Reset slider
        rlSlider.value = 0;
        updateRLSliderUI(0, false);
    });

    btnLow.addEventListener("click", () => {
        if (btnLow.disabled) return;
        mesh.geometry = lowPolyGeo;
        btnLow.classList.add("active");
        btnHigh.classList.remove("active");
        updateStatsEx(lowPolyGeo, true);
        
        // Push slider to end
        rlSlider.value = 100;
        updateRLSliderUI(100, false);
    });

    btnWire.addEventListener("click", () => {
        btnWire.classList.toggle("active");
        baseMaterial.wireframe = btnWire.classList.contains("active");
        heatmapMaterial.wireframe = btnWire.classList.contains("active");
    });

    toggleHeatmap.addEventListener("change", (e) => {
        if (e.target.checked) {
            mesh.material = heatmapMaterial;
        } else {
            mesh.material = baseMaterial;
        }
    });

    // --- Funções Auxiliares RL ---
    function logToTerminal(msg, type = "") {
        const p = document.createElement("p");
        p.innerText = msg;
        if(type) p.classList.add(type);
        terminal.appendChild(p);
        terminal.scrollTop = terminal.scrollHeight; // Auto scroll
    }

    function updateRLSliderUI(val, apiRewards = null) {
        sliderDisplay.innerText = `Step ${val}`;
        
        let sil = 0, tri = 0, uv = 0;

        if (apiRewards) {
            // Usa dados que vieram do JSON
            sil = apiRewards.silhouette;
            tri = apiRewards.triangle_reduction;
            uv = apiRewards.uv_distortion;
        } else {
            // Fallback para interpolação básica quando mexemos no slider à mão
            sil = Math.max(20, 95 - (val * 0.5)); 
            tri = Math.min(80, 10 + (val * 0.7));
            uv = Math.min(30, val * 0.3);
        }

        barSil.style.width = `${sil}%`;
        barSil.parentElement.previousElementSibling.lastElementChild.innerText = `${Math.round(sil)}%`;

        barTri.style.width = `${tri}%`;
        barTri.parentElement.previousElementSibling.lastElementChild.innerText = `${Math.round(tri)}%`;

        barUv.style.width = `${uv}%`;
        barUv.parentElement.previousElementSibling.lastElementChild.innerText = `-${Math.round(uv)}%`;

        // Apenas muda a malha se NÃO for o auto-run inicial de background
        if(!apiRewards) {
            if(val > 50 && mesh.geometry !== lowPolyGeo) {
                mesh.geometry = lowPolyGeo;
                btnLow.classList.add("active");
                btnHigh.classList.remove("active");
                updateStatsEx(lowPolyGeo, true);
            } else if (val <= 50 && mesh.geometry !== highPolyGeo) {
                mesh.geometry = highPolyGeo;
                btnHigh.classList.add("active");
                btnLow.classList.remove("active");
                updateStatsEx(highPolyGeo, false);
            }
        }
    }

    rlSlider.addEventListener("input", (e) => {
        updateRLSliderUI(e.target.value, null);
    });

    // --- Simular o Agente RL a correr em Background ouvindo a API ---
    PolyOptimaAPI.startRLDecimation(modelId, 
        // onRLStep - O que fazer quando recebemos o JSON a cada passo
        (stepData) => {
            rlSlider.value = stepData.step;
            // Atualiza UI com o JSON recebido da API
            updateRLSliderUI(stepData.step, stepData.rewards);
            
            // Logar a mensagem do JSON
            let type = "";
            if (stepData.is_critical) type = "text-red";
            logToTerminal(stepData.log_message, type);
            
            if (stepData.is_critical) {
                logToTerminal(`[Aviso] Threshold alcançado na malha.`, "text-blue");
            }
        }, 
        // onComplete - O que fazer quando atinge 100
        () => {
            logToTerminal("[Step 100] Optimization threshold reached.");
            logToTerminal("[RL Agent] Decimation Complete. Low Poly generated.", "text-green");
            
            // Desbloquear UI
            btnLow.disabled = false;
            btnLow.style.opacity = "1";
            btnLow.style.cursor = "pointer";
            btnLow.innerText = "Otimizado (Low)";
            btnLow.style.boxShadow = "0 0 10px rgba(59, 130, 246, 0.5)";
            
            rlSlider.disabled = false;
            
            // Trocar automaticamente para a vista Low Poly para mostrar ao utilizador o resultado!
            btnLow.click();
        }
    );
    
    // --- Lógica do Botão de Exportação ---
    const btnExport = document.getElementById("btn-export");
    if (btnExport) {
        btnExport.addEventListener("click", () => {
            if (!window.THREE.OBJExporter) {
                console.error("OBJExporter não está carregado!");
                return;
            }
            const exporter = new THREE.OBJExporter();
            // Exporta a mesh atual (esperamos que seja a Low Poly se o utilizador não mudou)
            const result = exporter.parse(mesh);
            
            const blob = new Blob([result], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.style.display = 'none';
            link.href = url;
            link.download = 'polyoptima_lowpoly.obj';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    } // Fim do initThreeJS
})();
