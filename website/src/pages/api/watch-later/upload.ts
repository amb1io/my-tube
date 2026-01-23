import type { APIRoute } from "astro";

const CREATE_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS watch_later_videos (
		video_id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		title TEXT,
		channel TEXT,
		thumbnail TEXT,
		duration TEXT,
		position INTEGER,
		synced_at TEXT,
		payload TEXT
	);
`;

const CREATE_USUARIO_SESSION_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS usuario_session (
		session_id TEXT PRIMARY KEY,
		usuario_email TEXT,
		playlist_id TEXT,
		ip TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`;

const UPSERT_SQL = `
	INSERT OR REPLACE INTO watch_later_videos (
		video_id,
		session_id,
		title,
		channel,
		thumbnail,
		duration,
		position,
		synced_at,
		payload
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_SESSION_SQL = `SELECT created_at FROM usuario_session WHERE session_id = ?`;

const INSERT_SESSION_SQL = `
	INSERT INTO usuario_session (
		session_id,
		usuario_email,
		playlist_id,
		ip,
		created_at,
		updated_at
	) VALUES (?, ?, ?, ?, ?, ?);
`;

const UPDATE_SESSION_SQL = `
	UPDATE usuario_session SET
		usuario_email = ?,
		playlist_id = ?,
		ip = ?,
		updated_at = ?
	WHERE session_id = ?;
`;

const getDatabase = (locals: any) => locals?.runtime?.env?.DB;

const generateUUID = () => {
  // Usa crypto.randomUUID() se disponível, caso contrário gera manualmente
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback para gerar UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const getClientIP = (request: Request, locals: any): string => {
  // Tenta obter IP de headers comuns do Cloudflare
  const cfConnectingIP = request.headers.get("cf-connecting-ip");
  if (cfConnectingIP) return cfConnectingIP;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    // Pega o primeiro IP da lista
    return xForwardedFor.split(",")[0].trim();
  }

  const xRealIP = request.headers.get("x-real-ip");
  if (xRealIP) return xRealIP;

  // Tenta obter do runtime do Cloudflare
  if (locals?.runtime?.cf?.connectingIp) {
    return locals.runtime.cf.connectingIp;
  }

  return "unknown";
};

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
  // Permite requisições de extensões do navegador (que não têm origin)
  // e também de qualquer origem web
  const allowOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Watch-Later-Key, X-Session-ID, X-Usuario-Email, Authorization",
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

export const POST: APIRoute = async ({ request, locals }) => {
  if (!import.meta.env.PUBLIC_WATCH_LATER_UPLOAD_KEY) {
    return respondWithCors(
      new Response("Upload key não configurada", { status: 500 }),
      request,
    );
  }

  const headerKey = request.headers.get("x-watch-later-key");
  if (headerKey !== import.meta.env.PUBLIC_WATCH_LATER_UPLOAD_KEY) {
    return respondWithCors(
      new Response("Chave inválida", { status: 401 }),
      request,
    );
  }

  const db = getDatabase(locals);
  if (!db) {
    return respondWithCors(
      new Response("Binding D1 `DB` indisponível.", { status: 503 }),
      request,
    );
  }

  const payload = await request.json().catch(() => null);
  const videos = parseVideos(payload);
  if (!videos.length) {
    return respondWithCors(
      new Response("Nenhum vídeo enviado", { status: 400 }),
      request,
    );
  }

  const syncedAt =
    typeof payload?.syncTime === "string"
      ? payload.syncTime
      : new Date().toISOString();

  // Obter ou gerar session_id
  let sessionId = payload?.sessionId || request.headers.get("x-session-id");
  if (!sessionId || typeof sessionId !== "string") {
    sessionId = generateUUID();
  }

  // Obter IP do cliente
  const clientIP = getClientIP(request, locals);

  // Obter email do usuário se disponível (pode vir do header ou do payload)
  const usuarioEmail =
    payload?.usuarioEmail || request.headers.get("x-usuario-email") || null;
  const playlistId = payload?.playlistId || "WL"; // "WL" é o ID padrão do Watch Later

  // Criar tabelas se não existirem
  await db.prepare(CREATE_TABLE_SQL).run();
  await db.prepare(CREATE_USUARIO_SESSION_TABLE_SQL).run();

  // Criar ou atualizar registro de sessão (preservando created_at se já existir)
  const now = new Date().toISOString();
  const existingSession = await db
    .prepare(SELECT_SESSION_SQL)
    .bind(sessionId)
    .first();

  if (existingSession) {
    // Atualizar sessão existente (preserva created_at)
    await db
      .prepare(UPDATE_SESSION_SQL)
      .bind(
        usuarioEmail,
        playlistId,
        clientIP,
        now, // updated_at
        sessionId,
      )
      .run();
  } else {
    // Criar nova sessão
    await db
      .prepare(INSERT_SESSION_SQL)
      .bind(
        sessionId,
        usuarioEmail,
        playlistId,
        clientIP,
        now, // created_at
        now, // updated_at
      )
      .run();
  }

  // Inserir vídeos com session_id
  const statement = db.prepare(UPSERT_SQL);
  for (const video of videos) {
    await statement
      .bind(
        video.videoId,
        sessionId,
        video.title,
        video.channel,
        video.thumbnail,
        video.duration,
        video.position,
        syncedAt,
        JSON.stringify(video.raw ?? {}),
      )
      .run();
  }

  return respondWithCors(
    new Response(
      JSON.stringify({
        message: "Vídeos sincronizados",
        sessionId: sessionId,
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    ),
    request,
  );
};
