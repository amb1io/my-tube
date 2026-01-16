import type { APIRoute } from 'astro';

export const prerender = false;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CREATE_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS youtube_tokens (
		id TEXT PRIMARY KEY,
		access_token TEXT NOT NULL,
		refresh_token TEXT,
		scope TEXT,
		expires_at TEXT,
		created_at TEXT NOT NULL
	);
`;
const UPSERT_SQL = `
	INSERT OR REPLACE INTO youtube_tokens (id, access_token, refresh_token, scope, expires_at, created_at)
	VALUES (?, ?, ?, ?, ?, ?);
`;

const buildRedirectUri = (url: URL) =>
	import.meta.env.PUBLIC_YOUTUBE_REDIRECT_URI ??
	new URL('/auth/youtube/callback', url.origin).toString();

const buildClientId = () => import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID;

const buildClientSecret = () => import.meta.env.YOUTUBE_CLIENT_SECRET;

const expireDateFromPayload = (seconds?: number) =>
	seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

export const GET: APIRoute = async ({ url, locals }) => {
	const error = url.searchParams.get('error');
	if (error) {
		return new Response(`Google OAuth error: ${error}`, { status: 400 });
	}

	const code = url.searchParams.get('code');
	if (!code) {
		return new Response('Missing authorization code.', { status: 400 });
	}

	const clientId = buildClientId();
	const clientSecret = buildClientSecret();
	if (!clientId || !clientSecret) {
		return new Response('OAuth configuration missing.', { status: 500 });
	}

	const tokenResponse = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: buildRedirectUri(url),
			grant_type: 'authorization_code'
		})
	});

	if (!tokenResponse.ok) {
		const body = await tokenResponse.text();
		return new Response(`Token exchange failed: ${body}`, {
			status: tokenResponse.status,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}

	const payload = await tokenResponse.json();
	const expiresAt = expireDateFromPayload(payload.expires_in);

	const db = getDatabase(locals);
	if (!db) {
		return new Response('Cloudflare D1 binding `DB` is not configured.', { status: 503 });
	}

	await db.prepare(CREATE_TABLE_SQL).run();
	await db
		.prepare(UPSERT_SQL)
		.bind(
			'youtube',
			payload.access_token,
			payload.refresh_token ?? null,
			payload.scope ?? null,
			expiresAt,
			new Date().toISOString()
		)
		.run();

	const redirectTarget = new URL('/?synced=1', url.origin);
	const successPage = `
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<title>Sincronização concluída</title>
				<meta name="viewport" content="width=device-width,initial-scale=1" />
			</head>
			<body>
				<script>
					(function() {
						const redirectUrl = ${JSON.stringify(redirectTarget.toString())};
						if (window.opener) {
							window.opener.postMessage({ type: 'youtube-auth-complete' }, window.location.origin);
							window.close();
						} else {
							window.location.href = redirectUrl;
						}
					})();
				</script>
			</body>
		</html>
	`;
	return new Response(successPage, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};
