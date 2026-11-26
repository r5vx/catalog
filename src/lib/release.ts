/** A dated history label keeps remakes apart even on older clients that only sync a title string. */
export function releaseParts(label: string, year = '') {
	const match = /^(.*) \(((?:19|20)\d{2})\)$/.exec(label.trim());
	return match && (!year || year === match[2]) ? { title: match[1], year: match[2] } : { title: label.trim(), year };
}

export type SeriesHit = { id: number; name?: string; original_name?: string; first_air_date?: string };
const plain = (s: string) => s.trim().toLowerCase();
export const sameName = (hit: SeriesHit, title: string) => [hit.name, hit.original_name].some(n => n && plain(n) === plain(title));
export function seriesHit(hits: SeriesHit[], title: string, year: string) {
	const valid = year ? hits.filter(hit => hit.first_air_date?.slice(0, 4) === year) : hits;
	return valid.find(hit => sameName(hit, title)) ?? (year && hits.some(hit => sameName(hit, title)) ? null : valid[0] ?? null);
}
export function filmHit<T extends { title?: string; original_title?: string; release_date?: string }>(hits: T[], title: string, year: string) {
	const same = (h: T) => [h.title, h.original_title].some(n => n && plain(n) === plain(title));
	const valid = year ? hits.filter(h => h.release_date?.slice(0, 4) === year) : hits;
	return valid.find(same) ?? (year && hits.some(same) ? null : valid[0] ?? null);
}
export function progressMatches(label: string, names: string[], year: number | null | undefined, ambiguous: boolean) {
	const parts = releaseParts(label);
	return names.includes(plain(parts.title)) && (parts.year ? parts.year === String(year) : !ambiguous);
}
export function isRemake(hits: SeriesHit[], title: string) {
	return new Set(hits.filter(hit => sameName(hit, title)).map(hit => hit.first_air_date?.slice(0, 4)).filter(Boolean)).size > 1;
}
