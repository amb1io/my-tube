import Alpine from 'alpinejs';
import htmx from 'htmx.org';

window.Alpine = Alpine;
window.htmx = htmx;

Alpine.start();

const CLIENT_ID = import.meta.env.PUBLIC_YOUTUBE_CLIENT_ID;
const REDIRECT_URI =
	import.meta.env.PUBLIC_YOUTUBE_REDIRECT_URI ??
	`${window.location.origin}/auth/youtube/callback`;

const openOAuthDialog = () => {
	const statusEl = document.getElementById('youtube-sync-status');
	if (!statusEl) return;

	if (!CLIENT_ID) {
		statusEl.textContent = 'Configure PUBLIC_YOUTUBE_CLIENT_ID em .env para iniciar a sincronização.';
		return;
	}

	const scope = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.email';

	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope,
		access_type: 'offline',
		prompt: 'consent'
	});

	const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
	window.open(url, '_blank', 'popup,width=500,height=700');
	statusEl.textContent = 'A janela do Google OAuth foi aberta. Continue a sincronização por lá.';
};

const handleAuthSuccess = () => {
	const statusEl = document.getElementById('youtube-sync-status');
	if (statusEl) {
		statusEl.textContent = 'Conta sincronizada. Redirecionando...';
	}
	// Salvar flag no localStorage indicando que o login foi realizado
	try {
		localStorage.setItem('youtube_auth_synced', 'true');
		localStorage.setItem('youtube_auth_timestamp', Date.now().toString());
	} catch (e) {
		console.error('Error saving to localStorage:', e);
	}
	
	// Atualizar estado synced se o Alpine estiver disponível
	const mainElement = document.querySelector('main[x-data]');
	if (mainElement && (window as any).Alpine) {
		try {
			const alpineData = (window as any).Alpine.$data(mainElement);
			if (alpineData) {
				alpineData.synced = true;
			}
		} catch (e) {
			console.error('Error updating Alpine state:', e);
		}
	}
	
	window.location.href = '/?synced=1';
};

const handleMessage = (event: MessageEvent) => {
	if (event.origin !== window.location.origin) {
		return;
	}
	if (event.data?.type === 'youtube-auth-complete') {
		handleAuthSuccess();
	}
};

window.addEventListener('message', handleMessage);

const init = () => {
	const syncButton = document.getElementById('youtube-sync');
	syncButton?.addEventListener('click', openOAuthDialog);
};

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
