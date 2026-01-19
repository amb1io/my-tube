const CONFIG = {
  backendUrl: "https://169.254.20.220:4321",
  uploadKey: "change-me",
  syncDebounceMs: 1_000,
  minVideosToSync: 1,
};

const PREFIX = "[MyTube Watch Later Sync]";

const log = (...args) => {
  console.info(PREFIX, ...args);
};

const error = (...args) => {
  console.error(PREFIX, ...args);
};

const normalizeUrl = (url = "") => {
  try {
    return new URL(url, window.location.origin);
  } catch {
    return null;
  }
};

const getVideoId = (entry) => {
  const candidate = entry.getAttribute("data-video-id");
  if (candidate) {
    return candidate;
  }

  const link =
    entry.querySelector("a#video-title") ||
    entry.querySelector("ytd-thumbnail a");
  if (!link) {
    return null;
  }

  const href =
    typeof link.href === "string" ? link.href : link.getAttribute("href");
  const normalized = normalizeUrl(href);
  return normalized?.searchParams.get("v") ?? null;
};

const scrollToEndOfPage = async () => {
  const scrollContainer =
    document.scrollingElement ?? document.documentElement ?? document.body;
  if (!scrollContainer) {
    return;
  }

  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const currentHeight = scrollContainer.scrollHeight;
    scrollContainer.scrollTo({ top: currentHeight });
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (scrollContainer.scrollHeight === currentHeight) {
      break;
    }
  }
};

const collectVideoCards = async () => {
  await scrollToEndOfPage();
  const nodes = Array.from(
    document.querySelectorAll("ytd-playlist-video-renderer")
  );
  return nodes
    .map((node, index) => {
      const link = node.querySelector("a#video-title");
      const title = link?.textContent?.trim() ?? null;
      const channel =
        node.querySelector("#byline a")?.textContent?.trim() ?? null;
      const thumbnail = node.querySelector("#thumbnail img")?.src ?? null;
      const duration =
        node
          .querySelector(
            "#thumbnail-overlay .ytd-thumbnail-overlay-time-status-renderer span"
          )
          ?.textContent?.trim() ?? null;
      const videoId = getVideoId(node);
      if (!videoId) {
        return null;
      }
      return {
        videoId,
        title,
        channel,
        thumbnail,
        duration,
        position: index + 1,
      };
    })
    .filter(Boolean);
};

const buildPayload = (videos) => ({
  videos,
  playlist:
    document.querySelector("#title h1")?.textContent?.trim() ?? "Watch Later",
  syncTime: new Date().toISOString(),
  sourceUrl: window.location.href,
});

const postSync = async (payload) => {
  if (
    CONFIG.uploadKey === "change-me" ||
    CONFIG.backendUrl === "http://localhost:4321"
  ) {
    log(
      "Atualize `backendUrl` e `uploadKey` em `extension/content-script.js` antes de usar a sincronização automática."
    );
  }

  const target = `${CONFIG.backendUrl.replace(
    /\/+$/,
    ""
  )}/api/watch-later/upload`;
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Watch-Later-Key": CONFIG.uploadKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`sync failed: ${response.status} ${body}`);
  }
  return response.text();
};

let syncTimer = 0;
let lastSignature = "";

const computeSignature = (videos) =>
  videos.map((video) => video.videoId).join(",");

const triggerSync = () => {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(async () => {
    try {
      const videos = await collectVideoCards();
      console.log(videos);
      if (videos.length < CONFIG.minVideosToSync) {
        log("Nenhum vídeo encontrado ou playlist vazia.");
        return;
      }

      const signature = computeSignature(videos);
      if (!signature || signature === lastSignature) {
        return;
      }

      const payload = buildPayload(videos);
      await postSync(payload);
      lastSignature = signature;
      log(`Sincronização concluída (${videos.length} vídeos).`);
    } catch (err) {
      error(err);
    }
  }, CONFIG.syncDebounceMs);
};

const startObserver = () => {
  const playlistContainer = document.querySelector(
    "ytd-playlist-video-list-renderer"
  );
  if (!playlistContainer) {
    return;
  }
  const observer = new MutationObserver(() => triggerSync());
  observer.observe(playlistContainer, { childList: true, subtree: true });
  triggerSync();
};

window.addEventListener("yt-navigate-finish", () => startObserver());

startObserver();
