import type { APIRoute } from 'astro';

const PLAYLIST_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SELECT_TOKEN_SQL = 'SELECT * FROM youtube_tokens WHERE id = ?';
const UPSERT_TOKEN_SQL = `
	INSERT OR REPLACE INTO youtube_tokens (id, access_token, refresh_token, scope, expires_at, created_at)
	VALUES (?, ?, ?, ?, ?, ?);
`;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const formatDuration = (iso?: string) => {
	if (!iso) return '00:00';
	const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
	if (!match) return '00:00';
	const [, hours, minutes, seconds] = match;
	const totalSeconds =
		(Number(hours ?? 0) * 3600) + (Number(minutes ?? 0) * 60) + Number(seconds ?? 0);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatViews = (views?: string) => {
	if (!views) return '0 visualizações';
	const num = Number(views);
	if (Number.isNaN(num)) return `${views} visualizações`;
	if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M visualizações`;
	if (num >= 1_000) return `${Math.round(num / 1_000)}K visualizações`;
	return `${num} visualizações`;
};

const formatRelativeDate = (date?: string) => {
	if (!date) return 'há pouco';
	const diff = Date.now() - new Date(date).getTime();
	const day = 24 * 60 * 60 * 1_000;
	if (diff < day) return 'hoje';
	if (diff < day * 7) return `${Math.floor(diff / day)} dias atrás`;
	if (diff < day * 30) return `${Math.floor(diff / (day * 7))} semanas atrás`;
	return `${Math.floor(diff / (day * 30))} meses atrás`;
};

const WATCH_LATER_PLAYLIST_ID = 'WL';
const PLAYLIST_PAGE_SIZE = 50;
const VIDEO_CHUNK_SIZE = 50;

const chunkArray = <T>(items: T[], size: number): T[][] => {
	if (!size) {
		return [items];
	}
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
};

const refreshAccessToken = async (refreshToken: string) => {
	if (!refreshToken) return null;
	const response = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID ?? '',
			client_secret: import.meta.env.YOUTUBE_CLIENT_SECRET ?? '',
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});
	if (!response.ok) return null;
	return response.json();
};

export const GET: APIRoute = async ({ locals }) => {
	const db = getDatabase(locals);
	if (!db) {
		return new Response('D1 binding `DB` indisponível.', { status: 503 });
	}

	const tokenRow = await db.prepare(SELECT_TOKEN_SQL).bind('youtube').first();
	if (!tokenRow) {
		return new Response('<div class="text-white">Conecte sua conta para carregar Watch Later.</div>', {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
			status: 400
		});
	}

	let { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = tokenRow;
	const needsRefresh = !expiresAt || new Date(expiresAt).getTime() < Date.now() - 10_000;
	if (needsRefresh && refreshToken) {
		const payload = await refreshAccessToken(refreshToken);
		if (payload?.access_token) {
			accessToken = payload.access_token;
			expiresAt = payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : expiresAt;
			await db
				.prepare(UPSERT_TOKEN_SQL)
				.bind(
					'youtube',
					accessToken,
					payload.refresh_token ?? refreshToken,
					payload.scope ?? tokenRow.scope,
					expiresAt,
					new Date().toISOString()
				)
				.run();
		}
	}

	if (!accessToken) {
		return new Response('<div class="text-white">Não foi possível recuperar o token de acesso.</div>', {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
			status: 400
		});
	}

	const playlistItems: any[] = [];
	let nextPageToken: string | undefined;

	do {
		const playlistUrl = new URL(PLAYLIST_URL);
		playlistUrl.searchParams.set('part', 'snippet,contentDetails');
		playlistUrl.searchParams.set('maxResults', String(PLAYLIST_PAGE_SIZE));
		playlistUrl.searchParams.set('playlistId', WATCH_LATER_PLAYLIST_ID);
		if (nextPageToken) {
			playlistUrl.searchParams.set('pageToken', nextPageToken);
		}

		const playlistResponse = await fetch(playlistUrl.toString(), {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		if (!playlistResponse.ok) {
			return new Response('<div class="text-white">Não foi possível acessar o YouTube.</div>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
				status: playlistResponse.status
			});
		}

		const playlistJson = await playlistResponse.json();
		playlistItems.push(...(playlistJson.items ?? []));
		nextPageToken = playlistJson.nextPageToken;
	} while (nextPageToken);

	const ids = Array.from(
		new Set(
			playlistItems.map((item: any) => item.contentDetails?.videoId).filter(Boolean)
		)
	);

	let detailsMap: Record<string, any> = {};
	if (ids.length) {
		for (const idChunk of chunkArray(ids, VIDEO_CHUNK_SIZE)) {
			const videosUrl = new URL(VIDEOS_URL);
			videosUrl.searchParams.set('part', 'contentDetails,statistics');
			videosUrl.searchParams.set('id', idChunk.join(','));

			const videosResponse = await fetch(videosUrl.toString(), {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			if (!videosResponse.ok) {
				continue;
			}
			const videosJson = await videosResponse.json();
			for (const video of videosJson.items ?? []) {
				detailsMap[video.id] = video;
			}
		}
	}

	const cards = playlistItems
		.filter((item: any) => item.snippet)
		.map((item: any) => {
			const snippet = item.snippet;
			const details = detailsMap[snippet.resourceId?.videoId] ?? {};
			const duration = formatDuration(details.contentDetails?.duration);
			const views = formatViews(details.statistics?.viewCount);
			const relative = formatRelativeDate(details.snippet?.publishedAt ?? snippet.publishedAt);
			return `
				<article class="flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 shadow-[0_30px_60px_rgba(0,0,0,0.5)] transition hover:border-white/40">
					<div class="relative h-48 overflow-hidden">
						<img class="h-full w-full object-cover" src="${escapeHtml(snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? '')}" alt="${escapeHtml(snippet.title)}" />
						<span class="absolute right-3 top-3 rounded-xl bg-black/70 px-2 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
							${duration}
						</span>
					</div>
					<div class="flex flex-1 flex-col justify-between p-5">
						<div>
							<h3 class="text-lg font-semibold text-white">${escapeHtml(snippet.title)}</h3>
							<p class="mt-2 text-sm text-slate-400">${escapeHtml(snippet.channelTitle)}</p>
						</div>
						<div class="mt-4 flex items-center justify-between text-xs text-slate-500">
							<span>${views}</span>
							<span>${relative}</span>
						</div>
					</div>
				</article>
			`;
		})
		.join('');

	if (!cards) {
		return new Response('<div class="text-white">Sem vídeos no Watch Later.</div>', {
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		});
	}

	const grid = `<div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">${cards}</div>`;
	return new Response(grid, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};
