/**
 * Whether a screen's browser keeps what pages remember (localStorage) from one start to the next:
 * each page load says since when its marker has been there (null: just set, so nothing was kept,
 * or it's new). The owner's desktop app kept nothing after 2026-10-10. In /api/diagnostics → storage.
 */
type Report = { at: string; device: string; keptSince: string | null; works: boolean };
const reports: Report[] = [];

export const storageReports = () => reports.map((r) => ({ ...r }));

export function noteStorage(agent: string, since: number, works: boolean): void {
	const device = /CatalogTV/.test(agent) ? 'TV' : /Electron/.test(agent) ? 'computer app' : /iPhone|Android/.test(agent) ? 'phone' : 'browser';
	reports.unshift({ at: new Date().toISOString(), device, keptSince: since > 0 ? new Date(since).toISOString() : null, works });
	reports.splice(20);
}
