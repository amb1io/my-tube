# Configuração do Astro para Cloudflare Pages com APIs

## Checklist de Configuração

### 1. ✅ Configuração do Astro (`astro.config.mjs`)

```javascript
export default defineConfig({
  output: "server",  // OBRIGATÓRIO para APIs funcionarem
  adapter: cloudflare({
    mode: "advanced", // Para Cloudflare Pages
  }),
  // ...
});
```

**Importante:**
- `output: "server"` é obrigatório para rotas de API
- `mode: "advanced"` gera um único `_worker.js` que processa todas as rotas

### 2. ✅ Configuração do Wrangler (`wrangler.toml`)

```toml
name = "my-tube"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"  # Diretório de saída do build
```

**Importante:**
- `pages_build_output_dir` deve apontar para `dist` (onde o Astro gera o build)
- Não use `main` ou `site.bucket` (isso é para Workers, não Pages

### 3. ✅ Rotas de API (`src/pages/api/`)

Estrutura de arquivos:
```
src/pages/api/
  ├── watch-later.ts          → /api/watch-later
  └── watch-later/
      ├── upload.ts           → /api/watch-later/upload
      └── session.ts          → /api/watch-later/session
```

Exemplo de rota:
```typescript
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  return new Response(JSON.stringify({ message: 'Hello' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
```

### 4. ✅ Arquivo `_routes.json` (`public/_routes.json`)

```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": ["/favicon.svg", "/*.png", "/*.jpg", "/*.gif", "/*.svg", "/*.ico", "/*.webp"]
}
```

**O que faz:**
- `include: ["/api/*"]` - Todas as rotas `/api/*` são processadas pelo Worker
- `exclude` - Arquivos estáticos são servidos diretamente (mais rápido)

### 5. ✅ Build Command no Cloudflare Pages

No dashboard do Cloudflare Pages:
- **Build command:** `npm run build`
- **Build output directory:** `dist` (ou deixe vazio para usar do wrangler.toml)
- **Deploy command:** Deixe vazio (não use `wrangler pages deploy`)

### 6. ✅ Variáveis de Ambiente

Configure no dashboard do Cloudflare Pages (Settings → Environment Variables):

**Build environment variables:**
- `ASTRO_DB_REMOTE_URL` - URL do D1 database
- `ASTRO_DB_APP_TOKEN` - Token do LibSQL

**Production environment variables:**
- Todas as variáveis do `[vars]` no `wrangler.toml` são automaticamente disponíveis em runtime

### 7. ✅ Verificação do Build

Após o build, verifique que existe:
- `dist/_worker.js` - Worker principal (gerado pelo adapter)
- `dist/_routes.json` - Copiado de `public/_routes.json`
- Arquivos estáticos em `dist/`

## Troubleshooting

### APIs retornam 404

1. **Verifique `output: "server"`** no `astro.config.mjs`
2. **Verifique `_routes.json`** existe e inclui `/api/*`
3. **Verifique o build output** - deve ter `_worker.js` em `dist/`
4. **Verifique o adapter** - deve ser `@astrojs/cloudflare` com `mode: "advanced"`

### Erro de CORS

Adicione headers CORS nas rotas:
```typescript
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

### Bindings não funcionam (D1, KV)

1. Verifique que os bindings estão no `wrangler.toml`
2. No dashboard do Cloudflare Pages, vá em Settings → Functions
3. Configure os bindings (D1 databases, KV namespaces) lá também

## Estrutura Final

```
website/
├── astro.config.mjs          ✅ output: "server", adapter: cloudflare()
├── wrangler.toml              ✅ pages_build_output_dir = "dist"
├── public/
│   └── _routes.json           ✅ include: ["/api/*"]
└── src/
    └── pages/
        └── api/               ✅ Rotas da API aqui
```

## Testando Localmente

```bash
# Build local
npm run build

# Preview com Wrangler
npx wrangler pages dev dist
```

Isso simula o ambiente do Cloudflare Pages localmente.
