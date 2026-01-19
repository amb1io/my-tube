import type { APIRoute } from 'astro';

export const prerender = false;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const YOUTUBE_CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';

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

const CREATE_USUARIO_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS usuario (
		email TEXT PRIMARY KEY,
		nome TEXT,
		foto TEXT,
		youtube_channel_id TEXT,
		youtube_channel_title TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`;

const UPSERT_TOKEN_SQL = `
	INSERT OR REPLACE INTO youtube_tokens (id, access_token, refresh_token, scope, expires_at, created_at)
	VALUES (?, ?, ?, ?, ?, ?);
`;

const UPSERT_USUARIO_SQL = `
	INSERT OR REPLACE INTO usuario (email, nome, foto, youtube_channel_id, youtube_channel_title, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?);
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
	const accessToken = payload.access_token;

	const db = getDatabase(locals);
	if (!db) {
		return new Response('Cloudflare D1 binding `DB` is not configured.', { status: 503 });
	}

	// Criar tabelas se não existirem
	await db.prepare(CREATE_TABLE_SQL).run();
	await db.prepare(CREATE_USUARIO_TABLE_SQL).run();

	// Salvar tokens
	await db
		.prepare(UPSERT_TOKEN_SQL)
		.bind(
			'youtube',
			accessToken,
			payload.refresh_token ?? null,
			payload.scope ?? null,
			expiresAt,
			new Date().toISOString()
		)
		.run();

	// Buscar informações do usuário do Google
	let userEmail = '';
	let userName = '';
	let userPhoto = '';
	let channelId = '';
	let channelTitle = '';

	try {
		// Buscar perfil do Google
		const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});

		if (userInfoResponse.ok) {
			const userInfo = await userInfoResponse.json();
			userEmail = userInfo.email || '';
			userName = userInfo.name || '';
			userPhoto = userInfo.picture || '';
		}

		// Buscar informações do canal do YouTube
		const channelsResponse = await fetch(
			`${YOUTUBE_CHANNELS_ENDPOINT}?part=snippet&mine=true`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`
				}
			}
		);

		if (channelsResponse.ok) {
			const channelsData = await channelsResponse.json();
			if (channelsData.items && channelsData.items.length > 0) {
				const channel = channelsData.items[0];
				channelId = channel.id || '';
				channelTitle = channel.snippet?.title || '';
			}
		}
	} catch (error) {
		// Se falhar ao buscar dados do usuário, continua mesmo assim
		console.error('Error fetching user info:', error);
	}

	// Salvar dados do usuário
	if (userEmail) {
		const now = new Date().toISOString();
		await db
			.prepare(UPSERT_USUARIO_SQL)
			.bind(
				userEmail,
				userName || null,
				userPhoto || null,
				channelId || null,
				channelTitle || null,
				now, // created_at
				now  // updated_at
			)
			.run();
	}

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
