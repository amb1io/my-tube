import type { APIRoute } from "astro";

const SELECT_VIDEOS_BY_SESSION_SQL = `
	SELECT 
		video_id,
		session_id,
		title,
		channel,
		thumbnail,
		duration,
		position,
		synced_at,
		payload
	FROM watch_later_videos
	WHERE session_id = ?
	ORDER BY position ASC, synced_at DESC
`;

const SELECT_SESSION_SQL = `
	SELECT 
		session_id,
		usuario_email,
		playlist_id,
		ip,
		created_at,
		updated_at
	FROM usuario_session
	WHERE session_id = ?
`;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

const buildCorsHeaders = (request: Request) => {
  const origin = request.headers.get("origin");
  const allowOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "false",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
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

export const prerender = false;

export const OPTIONS: APIRoute = async ({ request }) => {
  return respondWithCors(null, request);
};

export const GET: APIRoute = async ({ request, url, locals }) => {
  const db = getDatabase(locals);
  if (!db) {
    return respondWithCors(
      new Response(JSON.stringify({ error: "Binding D1 `DB` indisponível." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      request,
    );
  }

  // Obter session_id da query string
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId || typeof sessionId !== "string") {
    return respondWithCors(
      new Response(
        JSON.stringify({ error: "Parâmetro 'session_id' é obrigatório." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
      request,
    );
  }

  try {
    // Buscar informações da sessão
    const session = await db
      .prepare(SELECT_SESSION_SQL)
      .bind(sessionId)
      .first();

    if (!session) {
      return respondWithCors(
        new Response(JSON.stringify({ error: "Sessão não encontrada." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
        request,
      );
    }

    // Buscar vídeos da sessão
    const videosResult = await db
      .prepare(SELECT_VIDEOS_BY_SESSION_SQL)
      .bind(sessionId)
      .all();

    const videos = (videosResult.results || []).map((row: any) => ({
      videoId: row.video_id,
      sessionId: row.session_id,
      title: row.title,
      channel: row.channel,
      thumbnail: row.thumbnail,
      duration: row.duration,
      position: row.position,
      syncedAt: row.synced_at,
      payload: row.payload ? JSON.parse(row.payload) : null,
    }));

    return respondWithCors(
      new Response(
        JSON.stringify({
          session: {
            sessionId: session.session_id,
            usuarioEmail: session.usuario_email,
            playlistId: session.playlist_id,
            ip: session.ip,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
          },
          videos: videos,
          count: videos.length,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
      request,
    );
  } catch (error) {
    console.error("Error fetching session videos:", error);
    return respondWithCors(
      new Response(
        JSON.stringify({
          error: "Erro ao buscar vídeos da sessão.",
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      ),
      request,
    );
  }
};
