export const appleMobile = (ua: string, touch = 0) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
export const catalogDesktop = (ua: string) => ua.includes('Electron/') && !ua.includes('CatalogTV/');
export const videoFromShare = (key?: string) => /^channel:([A-Za-z0-9_-]{11})$/.exec(key ?? '')?.[1];
export const youtubePage = (id: string) => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
