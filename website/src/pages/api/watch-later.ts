import type { APIRoute } from "astro";

const PLAYLIST_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SELECT_TOKEN_SQL = "SELECT * FROM youtube_tokens WHERE id = ?";
const UPSERT_TOKEN_SQL = `
	INSERT OR REPLACE INTO youtube_tokens (id, access_token, refresh_token, scope, expires_at, created_at)
	VALUES (?, ?, ?, ?, ?, ?);
`;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const formatDuration = (iso?: string) => {
  if (!iso) return "00:00";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "00:00";
  const [, hours, minutes, seconds] = match;
  const totalSeconds =
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatViews = (views?: string) => {
  if (!views) return "0 visualizações";
  const num = Number(views);
  if (Number.isNaN(num)) return `${views} visualizações`;
  if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M visualizações`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K visualizações`;
  return `${num} visualizações`;
};

const formatRelativeDate = (date?: string) => {
  if (!date) return "há pouco";
  const diff = Date.now() - new Date(date).getTime();
  const day = 24 * 60 * 60 * 1_000;
  if (diff < day) return "hoje";
  if (diff < day * 7) return `${Math.floor(diff / day)} dias atrás`;
  if (diff < day * 30) return `${Math.floor(diff / (day * 7))} semanas atrás`;
  return `${Math.floor(diff / (day * 30))} meses atrás`;
};

const WATCH_LATER_PLAYLIST_ID = "WL";
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
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID ?? "",
      client_secret: import.meta.env.YOUTUBE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return null;
  return response.json();
};

export const prerender = false;
export const GET: APIRoute = async ({ locals }) => {
  const db = getDatabase(locals);
  if (!db) {
    return new Response("D1 binding `DB` indisponível.", { status: 503 });
  }

  const tokenRow = await db.prepare(SELECT_TOKEN_SQL).bind("youtube").first();
  if (!tokenRow) {
    return new Response(
      '<div class="text-white">Conecte sua conta para carregar Watch Later.</div>',
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 400,
      },
    );
  }

  let {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  } = tokenRow;
  const needsRefresh =
    !expiresAt || new Date(expiresAt).getTime() < Date.now() - 10_000;
  if (needsRefresh && refreshToken) {
    const payload = await refreshAccessToken(refreshToken);
    if (payload?.access_token) {
      accessToken = payload.access_token;
      expiresAt = payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : expiresAt;
      await db
        .prepare(UPSERT_TOKEN_SQL)
        .bind(
          "youtube",
          accessToken,
          payload.refresh_token ?? refreshToken,
          payload.scope ?? tokenRow.scope,
          expiresAt,
          new Date().toISOString(),
        )
        .run();
    }
  }

  if (!accessToken) {
    return new Response(
      '<div class="text-white">Não foi possível recuperar o token de acesso.</div>',
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 400,
      },
    );
  }

  const playlistItems: any[] = [];
  let nextPageToken: string | undefined;

  do {
    const playlistUrl = new URL(PLAYLIST_URL);
    playlistUrl.searchParams.set("part", "snippet,contentDetails");
    playlistUrl.searchParams.set("maxResults", String(PLAYLIST_PAGE_SIZE));
    playlistUrl.searchParams.set("playlistId", WATCH_LATER_PLAYLIST_ID);
    if (nextPageToken) {
      playlistUrl.searchParams.set("pageToken", nextPageToken);
    }

    const playlistResponse = await fetch(playlistUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!playlistResponse.ok) {
      return new Response(
        '<div class="text-white">Não foi possível acessar o YouTube.</div>',
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: playlistResponse.status,
        },
      );
    }

    const playlistJson = await playlistResponse.json();
    playlistItems.push(...(playlistJson.items ?? []));
    nextPageToken = playlistJson.nextPageToken;
  } while (nextPageToken);

  const ids = Array.from(
    new Set(
      playlistItems
        .map((item: any) => item.contentDetails?.videoId)
        .filter(Boolean),
    ),
  );

  let detailsMap: Record<string, any> = {};
  if (ids.length) {
    for (const idChunk of chunkArray(ids, VIDEO_CHUNK_SIZE)) {
      const videosUrl = new URL(VIDEOS_URL);
      videosUrl.searchParams.set("part", "contentDetails,statistics");
      videosUrl.searchParams.set("id", idChunk.join(","));

      const videosResponse = await fetch(videosUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
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
      const relative = formatRelativeDate(
        details.snippet?.publishedAt ?? snippet.publishedAt,
      );
      const videoId = snippet.resourceId?.videoId;
      const thumbnail = escapeHtml(
        snippet.thumbnails?.medium?.url ??
        snippet.thumbnails?.high?.url ??
        snippet.thumbnails?.default?.url ??
        "",
      );
      const title = escapeHtml(snippet.title ?? "");
      const channel = escapeHtml(snippet.channelTitle ?? "");

      return `
        <div class="flex flex-col cursor-pointer">
          <div class="relative mb-3 w-full">
            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">
              <img
                class="w-full rounded-lg"
                src="${thumbnail}"
                alt="${title}"
                loading="lazy"
              />
              <div class="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium">
                ${duration}
              </div>
            </a>
          </div>
          <div class="flex gap-3">
            <div class="flex-1 min-w-0">
              <h3 class="mb-1 line-clamp-2 text-sm font-medium text-white">
                <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" class="hover:underline">
                  ${title}
                </a>
              </h3>
              <div class="flex flex-col text-xs text-[#AAAAAA]">
                <a href="#" class="hover:text-white">${channel}</a>
                <div class="flex items-center gap-1">
                  <span>${views}</span>
                  <span>•</span>
                  <span>${relative}</span>
                </div>
              </div>
            </div>
            <button
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[#272727]"
              aria-label="Mais opções"
            >
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (!cards) {
    return new Response(
      '<div class="col-span-full text-center text-[#AAAAAA]">Sem vídeos no Watch Later.</div>',
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  return new Response(cards, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
