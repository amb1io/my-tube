# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## ☁️ Cloudflare deployment

`astro.config.mjs` already uses the Cloudflare adapter plus `@astrojs/db` in `web` mode (needed for Workers and Pages). The `wrangler.toml` file targets Cloudflare Pages: a build command, a `dist` bucket, and all bindings (`SESSION`, `DB`, and the OAuth vars) are declared there. Before deploying:

- Replace the placeholder values (`account_id`, `SESSION` KV ID, `d1` database name, `ASTRO_DB_REMOTE_URL`, and `ASTRO_DB_APP_TOKEN`) with your Cloudflare account values.
- Point `ASTRO_DB_REMOTE_URL` / `ASTRO_DB_APP_TOKEN` at the HTTP endpoint and token for your Cloudflare D1 project so `@astrojs/db` can connect in production.
- Run `npm run build` so `./dist` contains the Pages bundle, then deploy via `wrangler pages deploy dist` (or `wrangler publish` if you prefer Wrangler Routes) after updating the bindings/vars.

## ▶ YouTube OAuth sync

The page exposes a `sincronize aqui` button that builds a Google OAuth URL with `PUBLIC_YOUTUBE_CLIENT_ID` and `PUBLIC_YOUTUBE_REDIRECT_URI` (see `src/pages/index.astro`). The `/auth/youtube/callback` server route (see `src/pages/auth/youtube/callback.ts`) exchanges the authorization `code` for Google tokens and saves them inside the `youtube_tokens` table managed by Astro DB. To wire a real sync:

1. Create a Google Cloud project, enable the YouTube Data API, and configure an OAuth consent screen (request at least `email`, `profile`, and the YouTube scopes you need). Add your local dev hostname and your Cloudflare domain to the authorized domains.
2. Create OAuth 2.0 credentials (`Web application`) and add redirect URIs such as `http://localhost:4173/auth/youtube/callback` and `https://your-production-domain/auth/youtube/callback`.
3. Copy the generated **Client ID** to:
   - `.env` for local dev (see the new keys below),
   - `wrangler.toml` under `[vars]` so the Worker can generate the OAuth link.
   - also add `YOUTUBE_CLIENT_SECRET` to `.env` (and use `wrangler secret put YOUTUBE_CLIENT_SECRET` in production) so the callback route can finish the token exchange.
4. Store the Client Secret privately (via `wrangler secret put YOUTUBE_CLIENT_SECRET` or another secrets store) so your callback handler can exchange Google’s `code` for tokens at `https://oauth2.googleapis.com/token`.
5. Implement the `/auth/youtube/callback` endpoint (an Astro server route or Cloudflare Worker route) to:
   - receive the `code`,
   - POST to the token endpoint with `client_id`, `client_secret`, `code`, `redirect_uri`, and `grant_type=authorization_code`,
   - persist the `access_token`/`refresh_token` securely in Cloudflare D1 (or another storage that you can reach from Workers),
   - redirect the user back to the UI once the exchange completes.

The provided `/auth/youtube/callback` implementation already exchanges the code and upserts the resulting tokens into the `youtube_tokens` table of the `DB` D1 binding (it creates the table if missing). After storing tokens you can query that table from scheduled Workers or other endpoints to call the YouTube Data API (e.g., fetching subscriptions, playlists, or channel info).

- `/api/watch-later` now uses those tokens to call the YouTube Data API (with htmx) and populate the grid with the user’s Watch Later playlist whenever they are synced. You can customize that endpoint if you want other playlists or deeper data.
- `PUBLIC_WATCH_LATER_UPLOAD_KEY` protege o novo endpoint que a extensão Firefox utiliza para enviar os vídeos do Watch Later antes de chamarmos a API oficial.

## Extensão de Watch Later

Veja `extension/README.md` para instruções de como carregar a extensão Firefox/Chrome e ajustar o backend (`BACKEND_URL` + `PUBLIC_WATCH_LATER_UPLOAD_KEY`) antes de permitir que ela grave os vídeos sincronizados em D1. Esses dados podem então alimentar qualquer outro endpoint (como `/api/watch-later`) para buscar metadados adicionais.

Otherwise, feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
