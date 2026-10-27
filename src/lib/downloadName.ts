/** A download's name, as the Downloads list shows it and as its saved file is called. */
export function downloadName(d: { kind: string; title: string; year: string; season: number; episode: number }): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const name = d.kind === 'episode' ? `${d.title} S${pad(d.season)}E${pad(d.episode)}` : d.kind === 'film' && d.year ? `${d.title} (${d.year})` : d.title;
	// (Without the characters a file name can't have.)
	return name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
}
