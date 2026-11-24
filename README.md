# Retopo Tool — Frontend

Interface web para simplificar malhas 3D com a API EXPAI. O utilizador envia um `.obj` e a aplicação mostra:

- **GNN** — heatmap com a importância de cada vértice;
- **RL** — malha simplificada por um agente de Reinforcement Learning, convertida em quads;
- **Snapshots** — estados intermédios do RL, com quads e imagem a pedido;
- **DSS** — auditoria da qualidade topológica da malha original, da final e de cada snapshot.

É JavaScript simples, sem build: HTML, CSS e Three.js (r128) carregado por CDN.

## Requisitos

- A API EXPAI a correr (por exemplo em `http://localhost:8001`), com a origem do frontend em `CORS_ALLOWED_ORIGINS`.
- Uma chave de API válida.
- Um servidor HTTP estático (Live Server do VS Code, `python -m http.server`, nginx...). Abrir o `index.html` diretamente do disco não funciona.

## Configuração

O frontend lê `API_URL` e `API_KEY` de `env.json` ou de `.env`, na raiz do projeto (ao lado de `src/`). Os dois ficheiros estão no `.gitignore`.

```powershell
Copy-Item .env.example .env
```

```
API_URL=http://localhost:8001
API_KEY=a-sua-chave
```

Se faltar algum dos valores, a aplicação mostra um aviso "Erro de Configuração" ao abrir.

## Correr localmente

Servir a raiz do projeto (não só `src/`, porque a configuração está um nível acima) e abrir `/src/`:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

Depois abrir http://localhost:5500/src/. Com o Live Server do VS Code, o endereço é o mesmo.

## Docker

`compose.yaml` cria uma imagem nginx com o conteúdo de `src/`, exposta em http://localhost:8080. A configuração do nginx fica em `nginx/` e não é versionada; o `Dockerfile` usa `nginx/local.conf` por omissão (`NGINX_CONFIG` muda o ficheiro).

```powershell
docker compose up -d --build
```

## Fluxo na aplicação

1. **Upload** de um `.obj` (até 1500 faces). A API limpa a malha (funde vértices, remove faces duplicadas e degeneradas); a vista "Original (High)" passa a mostrar essa malha limpa.
2. **GNN**: corre primeiro e dá o heatmap de importância dos vértices.
3. **RL**: corre a seguir, com o progresso real do job. A API só corre um RL de cada vez; se estiver ocupada, aparece "Em fila no servidor...".
4. **Quad final**: a API converte o resultado do RL em quads automaticamente; a vista "Otimizado (Low)" mostra essa malha.
5. **DSS**: análise da original (`snapshot=0`), da malha final e, a pedido, de cada snapshot.
6. **Snapshots** (botão "Decimation Report"): para cada snapshot, "Gerar quads" (cerca de 1 min), imagem do quad e carregamento no 3D.

O RL demora 20–40 minutos (50 000 passos, fixados pelo modelo da API). Para testes, a API local aceita `RL_MAX_STEPS` (ex.: `2000`) no seu `.env.local`, o que reduz cada RL a cerca de 1 minuto.

## Estrutura

| Ficheiro | Conteúdo |
|---|---|
| `src/index.html` | Página e layout |
| `src/styles.css` | Estilos |
| `src/config.js` | Leitura de `API_URL` / `API_KEY` |
| `src/api.js` | Pedidos à API: jobs (RL, quad, DSS), polling, fila por malha, erros (`ApiError`, mensagens em PT por código HTTP) |
| `src/main.js` | Viewport 3D, upload, GNN, RL, snapshots, exportação |
| `src/qa.js` | Auditoria DSS e respetiva interface |
| `src/error-modal.js` | Pop-up de erros reutilizável |
| `src/fixtures/` | Resultados DSS de exemplo, para testar a interface sem a API |
| `frontend-api.md` | Guia da API para o frontend |
| `plano-frontend-api.md` | Plano e estado da adaptação à API com jobs, com notas sobre a API |

## Erros da API

Todas as respostas de erro da API têm o formato `{ "error": ..., "message": ... }`. O frontend mostra um título e uma explicação em português por código HTTP (401, 404, 409, 413, 415, 422, 429, 503, 507, 5xx) e a `message` da API como pormenor.

Limitação conhecida da API: o upload recusado por chave errada (401) ou por tamanho acima do limite chega sem cabeçalhos CORS, e o browser só vê um erro de rede. O frontend contorna isto com um pedido a `/health` e outro autenticado, para indicar a causa certa.
