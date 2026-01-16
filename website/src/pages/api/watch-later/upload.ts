import type { APIRoute } from "astro";

const CREATE_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS watch_later_videos (
		video_id TEXT PRIMARY KEY,
		title TEXT,
		channel TEXT,
		thumbnail TEXT,
		duration TEXT,
		position INTEGER,
		synced_at TEXT,
		payload TEXT
	);
`;

const UPSERT_SQL = `
	INSERT OR REPLACE INTO watch_later_videos (
		video_id,
		title,
		channel,
		thumbnail,
		duration,
		position,
		synced_at,
		payload
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

const parseVideos = (body: any) => {
  if (!body || !Array.isArray(body.videos)) {
    return [];
  }
  return body.videos
    .filter((video: any) => typeof video.videoId === "string")
    .map((video: any) => ({
      videoId: video.videoId,
      title: typeof video.title === "string" ? video.title : null,
      channel: typeof video.channel === "string" ? video.channel : null,
      thumbnail: typeof video.thumbnail === "string" ? video.thumbnail : null,
      duration: typeof video.duration === "string" ? video.duration : null,
      position: Number.isFinite(video.position) ? Number(video.position) : null,
      raw: video,
    }));
};

const buildCorsHeaders = (request: Request) => {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Watch-Later-Key",
    "Access-Control-Max-Age": "86400",
  };
};

const respondWithCors = (response: Response | null, request: Request) => {
  const headers = buildCorsHeaders(request);
  if (!response) {
    return new Response(null, { status: 204, headers });
  }
  return new Response(response.body, {
    status: response.status,
    headers: new Headers({
      ...headers,
      ...Object.fromEntries(response.headers),
    }),
  });
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return respondWithCors(null, request);
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!import.meta.env.PUBLIC_WATCH_LATER_UPLOAD_KEY) {
    return respondWithCors(
      new Response("Upload key não configurada", { status: 500 }),
      request
    );
  }

  const headerKey = request.headers.get("x-watch-later-key");
  if (headerKey !== import.meta.env.PUBLIC_WATCH_LATER_UPLOAD_KEY) {
    return respondWithCors(
      new Response("Chave inválida", { status: 401 }),
      request
    );
  }

  const db = getDatabase(locals);
  if (!db) {
    return respondWithCors(
      new Response("Binding D1 `DB` indisponível.", { status: 503 }),
      request
    );
  }

  const payload = await request.json().catch(() => null);
  const videos = parseVideos(payload);
  if (!videos.length) {
    return respondWithCors(
      new Response("Nenhum vídeo enviado", { status: 400 }),
      request
    );
  }

  const syncedAt =
    typeof payload?.syncTime === "string"
      ? payload.syncTime
      : new Date().toISOString();

  await db.prepare(CREATE_TABLE_SQL).run();

  const statement = db.prepare(UPSERT_SQL);
  for (const video of videos) {
    await statement
      .bind(
        video.videoId,
        video.title,
        video.channel,
        video.thumbnail,
        video.duration,
        video.position,
        syncedAt,
        JSON.stringify(video.raw ?? {})
      )
      .run();
  }

  return respondWithCors(
    new Response("Vídeos sincronizados", { status: 201 }),
    request
  );
};
