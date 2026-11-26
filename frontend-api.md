# Expai API: guia para o frontend

## Base

- URL local: `http://localhost:8001`. Em produção: `https://<domínio-da-api>`.
- Todos os pedidos `/v1/...` levam o cabeçalho `X-API-Key: <chave>`. O `GET /health` é público.
- A origem do frontend tem de estar em `CORS_ALLOWED_ORIGINS` na API (ex.: `http://localhost:5500`).
- `{id}` é o `mesh_id` devolvido pelo upload.

## Fluxo

```text
upload → (GNN opcional) → RL → quad final (automático) → imagem → DSS
                              └→ quad de um snapshot (a pedido) → DSS do snapshot
```

RL, quad e DSS são **jobs**: o `POST` responde logo `202` e o frontend consulta o estado
de 2 em 2 segundos até `status` ser `done` ou `failed`.
Estados possíveis: `queued` → `running` → `done` | `failed` (com `error`).

## 1. Upload

```js
const form = new FormData();
form.append("file", file);                       // .obj, .ply ou .glb
const r = await fetch(`${API}/v1/mesh/upload`, {
  method: "POST",
  headers: { "X-API-Key": KEY, "X-Upload-Size": String(file.size) },
  body: form,
});
const { mesh_id } = await r.json();              // 201
```

- `X-Upload-Size` é o tamanho do **ficheiro** em bytes e é obrigatório.
- Barra de progresso: usar `XMLHttpRequest` (`xhr.upload.onprogress`); o `fetch` não dá progresso do envio.
- `GET /v1/mesh/download/{id}` devolve a malha limpa (é a que a GNN e o RL usam).

## 2. GNN (opcional, só sobre a malha enviada)

| Pedido | Resposta |
|---|---|
| `POST /v1/gnn/predict/{id}` | `200` `{ num_vertices, scores_url }` (espera pelo fim) |
| `GET /v1/gnn/predict/{id}/scores` | CSV: a linha *i* é o *i*-ésimo vértice da malha descarregada |
| `POST` e depois `GET /v1/gnn/predict/{id}/heatmap` | PLY com cores (azul = pouco importante, vermelho = importante) |

## 3. RL (simplificação + quad final)

```js
await fetch(`${API}/v1/rl/simplify/${id}`, { method: "POST", headers }); // 202
// polling
const s = await (await fetch(`${API}/v1/rl/simplify/${id}/status`, { headers })).json();
```

Enquanto corre, `s.progress = { stage, current, total, percent }`:

- `stage: "simplifying"`: passos do RL;
- `stage: "quad"`: conversão do resultado final em quads (`0/1` → `1/1`).

Quando `s.status === "done"`, `s.links` traz os caminhos prontos a usar:

| Link | Conteúdo |
|---|---|
| `image` | PNG da malha final **em quads** (é esta que se mostra ao utilizador) |
| `quad` | estado do quad final; `.../download` dá o OBJ em quads |
| `download` | OBJ do RL (triângulos, antes do quad) |
| `results`, `actions` | resumo e registo de ações do RL |
| `snapshots` | lista de snapshots intermédios |

Se o quad final falhar, o RL fica `done` na mesma e o erro aparece em `s.summary.quad.error`.

O número de passos do RL não é um parâmetro do pedido: é o do modelo (50 000) ou,
em testes, o `RL_MAX_STEPS` do servidor. O progresso (`total`) mostra o valor em uso.
O `POST` não leva parâmetros: os do quad (tolerância, método) também são definidos no servidor.

## 4. Snapshots (a pedido)

`GET /v1/rl/simplify/{id}/snapshots` devolve uma lista; cada item tem `accepted_dissolves`,
`quad_url` e `image_url`. Para ver um snapshot em quads:

1. `POST /v1/quad/{id}?snapshot=N` → `202` (cerca de 1 minuto ou mais);
2. polling em `GET /v1/quad/{id}?snapshot=N` até `done`;
3. mostrar `GET /v1/quad/{id}/image?snapshot=N` (ou `.../download?snapshot=N` para o OBJ).

Antes de o quad estar pronto, a imagem responde `404` (nunca pedido) ou `409` (a correr ou falhou).

## 5. DSS (análise de qualidade dos quads)

| Pedido | Malha analisada |
|---|---|
| `POST /v1/analyses/{id}` | quads do resultado final |
| `POST /v1/analyses/{id}?snapshot=N` | quads do snapshot N (fazer o quad primeiro) |
| `POST /v1/analyses/{id}?snapshot=0` | malha limpa original (para comparar antes/depois) |

Depois: polling em `GET /v1/analyses/{id}[?snapshot=N]` e, quando `done`,
`GET /v1/analyses/{id}/download[?snapshot=N]` devolve o JSON com os resultados
(`&geometry=true` inclui também vértices e faces).
Se o quad ainda não existir ou estiver a correr, o `POST` responde `409` com o que falta.

## Erros

Todas as respostas de erro têm o mesmo formato:

```json
{ "error": "Conflict", "message": "The quad job is still running." }
```

Mostrar `message` ao utilizador. Códigos mais comuns:

| Código | Significado / o que fazer |
|---|---|
| `401` | Falta a chave ou está errada |
| `404` | Malha ou resultado não existe (ou pertence a outro cliente) |
| `409` | Já há um job a correr para esta malha, ou falta um passo anterior. Esperar ou fazer o passo em falta |
| `413` / `415` | Ficheiro grande demais / formato não suportado |
| `422` | Parâmetro inválido; a `message` diz qual e porquê |
| `429` | Demasiadas tentativas de login no `/docs`; esperar `Retry-After` segundos |
| `503` | Serviço ocupado; tentar de novo daqui a pouco |
| `507` | Sem espaço no servidor |

## Notas

- Um novo RL apaga os quads e as análises anteriores dessa malha.
- As malhas são apagadas ao fim de 48 h sem alterações.
- Não colocar chaves de produção no código público do frontend.
