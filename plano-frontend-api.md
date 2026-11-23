# Plano: adaptar o frontend à nova API

Base: [frontend-api.md](frontend-api.md) e o código atual de `C:\DEV\API_EXPAI` (último commit `02dfd6a clean code`).

## O que mudou na API e onde bate no frontend

| # | Mudança na API | Onde o frontend é afetado | Impacto |
|---|---|---|---|
| 1 | **RL passa a job**: `POST /v1/rl/simplify/{id}` responde `202` logo; o progresso é dado por `GET .../status` (`progress.stage/current/total/percent`) | `api.js` `simplifyMesh` / `startRLDecimation`; `main.js` `runRLDecimation` (barra de progresso simulada, ~28 ms por passo) | **Parte** — hoje o frontend espera o resultado no `POST` |
| 2 | **Quad final automático** no fim do RL; a imagem e o OBJ a mostrar são os **quads** (`links.image`, `links.quad` → `/download`) | `main.js` `onComplete` (descarrega `simplified.obj` de triângulos) | Mostra a malha errada |
| 3 | **DSS analisa os quads**. Sem quad pronto o `POST /v1/analyses` dá `409` | `qa.js` `runDSSAnalysis` (dispara logo ao carregar) | DSS falha com 409 |
| 4 | **Snapshots em quads só a pedido**: `POST /v1/quad/{id}?snapshot=N` (≈1 min) → polling → `/image` / `/download` | `main.js` drawer de snapshots, `loadSnapshot`, `downloadSnapshotMesh` | Snapshot DSS falha com 409 |
| 5 | **Imagem de snapshot removida**: `GET .../snapshots/{n}/image` deixou de existir; passa a `GET /v1/quad/{id}/image?snapshot=N` (`image_url` no manifesto) | `api.js` `getSnapshotImageBlobUrl`; `main.js:2695` | 404 silencioso (cai na captura do canvas) |
| 6 | **Erros num só formato** `{ error, message }` (já não há `detail`) | Todos os `throw new Error(...)` de `api.js` | Mensagens genéricas "HTTP 409" em vez do motivo |
| 7 | **Pedidos à mesma malha já não se bloqueiam** (`StorageCleanupLockMiddleware` só marca em uso). Os 409 agora são conflitos de jobs reais | Fila + repetição em `api.js` (alterações por commitar desta sessão) | A repetição automática de 409 deixa de fazer sentido |
| 8 | **Novo RL apaga quads e análises** da malha; RL recusa `409` se houver quad ou DSS a correr | `dssAnalysisCache`, `snapshotImagesMap`, caches de OBJ em `main.js`/`qa.js` | Caches ficam desatualizadas ao repetir o RL |
| 9 | `GET /v1/mesh/download/{id}` devolve a **malha limpa** (a que a GNN usa; os scores seguem a ordem dela) | Heatmap GNN mapeia scores sobre o OBJ carregado localmente | Possível desalinhamento de vértices |
| 10 | Novos parâmetros: `quad_tolerance`, `quad_method`, `quad_use_highpoly`; `max_steps` validado (`422` acima do horizonte) | Input de passos no upload | Opcional |
| 11 | CORS por variável `CORS_ALLOWED_ORIGINS` | Configuração do Docker da API | Só config |

> O contentor `api_expai-api-1` em execução foi criado a 20/11, antes destas alterações. **Reconstruir a imagem da API antes de testar.**

## Estado

- **Fase 0 — feita.** O compose local monta `./app` com `--reload`, por isso a API em Docker já corre o código novo; não foi preciso reconstruir (o `requirements.txt` só perdeu pacotes). O CORS por omissão já inclui `localhost:5500`.
- **Fase 1 — feita** (branch `feat/api-v2-jobs`). Diferenças em relação ao plano:
  - A **fila por malha mantém-se** (sem repetição de 409): a API já não bloqueia pedidos, mas recusa um RL com quad/DSS a correr e um novo RL apaga as análises; a fila garante a ordem GNN → arranque do RL → DSS. Como os jobs respondem `202`, cada pedido ocupa a fila pouco tempo.
  - `getSnapshotImageBlobUrl` ficou como alias (deprecated) de `getQuadImageBlobUrl(id, N)`, para não mexer na UI nesta fase.
  - `startRLDecimation` e `runFullAnalysis` mantêm a assinatura; o `main.js`/`qa.js` continuam a funcionar sem alterações de UI.
  - `pollJob` tolera até 5 falhas seguidas de rede/5xx (ver bug da API abaixo).

### Notas sobre a API (encontradas nos testes)
- **`max_steps` deixou de ser usado** (alterações por commitar em `app/routes/rl.py` e `app/services/rl_jobs.py`): o RL corre sempre o horizon do modelo (50 000 passos) e o parâmetro é ignorado. O `frontend-api.md` ainda o lista. A fase 2 deve deixar de depender do input de passos.
- **500 passageiro no `GET .../status`**: `read_status` verifica `is_file()` e depois lê; se o job reescrever o `status.json` entre os dois, dá `FileNotFoundError` → 500 sem cabeçalhos CORS (o browser vê "Failed to fetch"). Visto com o `./storage` montado do Windows. O frontend já tolera; vale a pena avisar quem mantém a API.
- Logo a seguir a `POST /v1/quad/{id}?snapshot=N` (re-quad), o `GET .../image?snapshot=N` ainda devolveu a imagem antiga em vez de `409`.

## Pipeline

Cada fase acaba com o frontend a funcionar e com um commit próprio.

### Fase 0 — Preparação
- Reconstruir e arrancar a API nova (`docker compose up --build` em `C:\DEV\API_EXPAI`), com `CORS_ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500`.
- Decidir sobre as alterações por commitar de `api.js`/`main.js` (fila por malha): **manter a ordem GNN → RL, retirar a repetição de 409** (ver fase 1).
- Teste rápido no browser: upload → `POST rl` devolve `202`.

### Fase 1 — Camada `api.js` (sem tocar na UI)
- Helper único `apiRequest(path, init)` que lê `{ error, message }` e lança `ApiError` com `status`, `error`, `message`.
- Helper `pollJob(statusPath, { intervalMs: 2000, onProgress, timeoutMs })` para RL, quad e DSS (`queued → running → done | failed`).
- Remover a repetição automática em 409 e a lógica de "lock"; manter apenas a ordem de arranque GNN → RL (deixa de precisar da fila).
- Novas funções:
  - `startRL(id, { maxSteps, quadTolerance, quadMethod, quadUseHighpoly })` → `202`
  - `getRLStatus(id)`; `waitForRL(id, onProgress)`
  - `startQuad(id, snapshot)`, `getQuadStatus(id, snapshot)`, `waitForQuad(...)`
  - `downloadQuadMesh(id, snapshot)`, `getQuadImageBlobUrl(id, snapshot)`
  - `downloadCleanMesh(id)` (`/v1/mesh/download/{id}`)
- `runFullAnalysis`: polling de 2 s; tratar `409` do `POST` como "falta o quad" (não como erro de rede).
- Remover `getSnapshotImageBlobUrl` (endpoint já não existe).
- **Pronto quando**: cada função testada na consola do browser contra a API nova.

### Fase 2 — RL com progresso real
- `runRLDecimation`: trocar a barra simulada por `progress` do `/status`:
  - `stage: "simplifying"` → "A simplificar… current/total" (0–90 %);
  - `stage: "quad"` → "A converter em quads…" (90–100 %).
- No fim (`done`): carregar `results` e `actions` pelos `links`; o log de ações deixa de ser "reproduzido" a partir do `POST`.
- `failed` → `ErrorModal` com `error`. Erro do quad final (`summary.quad.error`) → aviso, mas mostrar o resultado do RL.
- Bloquear "voltar a correr RL" enquanto houver quad/DSS a correr (a API dá 409; mostrar a `message`).
- **Pronto quando**: upload → barra avança com valores reais → termina.

### Fase 3 — Malha final em quads
- Depois do RL: viewport carrega `downloadQuadMesh(id)`; `downloadSimplifiedMesh` (triângulos) fica só como alternativa se o quad falhar.
- `realStats.low` (faces/vértices, quads/tris/n-gons) calculado a partir do OBJ em quads.
- Botão de download da malha final → OBJ em quads.
- Miniatura/preview final → `links.image`.
- **Pronto quando**: a malha "Low" no viewport é a de quads e coincide com a imagem da API.

### Fase 4 — DSS encadeado
- DSS da malha final só depois de o RL (e o quad final) ficar `done`; tirar o disparo automático ao carregar.
- `snapshot=0` (original) pode correr logo após o upload.
- `409` no `POST` → estado "À espera do quad" no painel DSS em vez de "Falhou", mostrando a `message`.
- Limpar `dssAnalysisCache` da malha quando se corre um novo RL.
- **Pronto quando**: DSS da original e da final carregam sem 409 no fluxo normal.

### Fase 5 — Snapshots a pedido
- Drawer de snapshots: usar `GET .../snapshots` (`accepted_dissolves`, `quad_url`, `image_url`).
- Ao abrir um snapshot: se o quad não existe (`404`), botão "Gerar quads (≈1 min)" → `startQuad` → polling com indicador → mostrar imagem e carregar OBJ em quads.
- Imagens: `getQuadImageBlobUrl(id, N)`; `404`/`409` → placeholder/captura do canvas (como hoje).
- DSS do snapshot só depois do quad do snapshot `done`.
- Download do snapshot → `downloadQuadMesh(id, N)` (com o OBJ em triângulos como alternativa).
- **Pronto quando**: abrir um snapshot → gerar quads → ver imagem → correr DSS do snapshot.

### Fase 6 — GNN e malha limpa
- Confirmar se o OBJ usado para o heatmap tem a mesma ordem de vértices que a malha limpa; se não, carregar `downloadCleanMesh(id)` como malha "High" antes de aplicar os scores.
- **Pronto quando**: heatmap alinhado num modelo com vértices duplicados / limpeza aplicada.

### Fase 7 — Mensagens de erro e limpeza
- Mapa de códigos → texto PT (401, 404, 409, 413/415, 422, 503, 507) usando sempre a `message` da API.
- Remover código morto (barra simulada, fallbacks para `/snapshots/{n}/image`, `detail`).
- Opcional: expor `quad_tolerance` / `quad_method` nas opções avançadas.
- Atualizar `fixtures/` para o novo formato (`status` do RL com `links`).

### Fase 8 — Verificação ponta a ponta
Checklist no browser contra a API em Docker:
1. Upload `.obj`, `.ply`, `.glb` (com barra de progresso).
2. GNN → heatmap.
3. RL com progresso real → malha final em quads + imagem.
4. DSS original (`snapshot=0`) e final.
5. Snapshot N → quad → imagem → DSS.
6. Repetir RL → caches limpas, DSS antigos desaparecem.
7. Erros: chave errada (401), ficheiro grande (413), RL a meio do quad (409).

## Ordem recomendada
Fase 0 → 1 → 2 → 3 → 4 são o mínimo para o fluxo principal voltar a funcionar. As fases 5–7 podem vir a seguir, em commits separados.
