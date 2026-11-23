import { json } from '@sveltejs/kit';
import { cloud } from '$lib/server/online';
import { readSettings, updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/** The reports already looked through, by number (kept on this computer: the server isn't told). */
function reviewed(): Set<number> {
	try {
		const list = JSON.parse(readSettings().onlineReportsReviewed ?? '[]');
		return new Set(Array.isArray(list) ? list.map(Number).filter(Number.isInteger) : []);
	} catch {
		return new Set();
	}
}

/** Problem reports Catalogs sent by themselves, read with the owner's key (Settings → Online). ?id= for one in full. */
export const GET: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	const answer = await cloud<{ reports?: { id: number }[] }>(id ? `/v1/reports/${id}` : '/v1/reports', { admin: true });
	if (!answer.ok) return json({ error: answer.error }, { status: answer.status || 502 });
	if (id || !answer.data?.reports) return json(answer.data);
	const seen = reviewed();
	return json({ ...answer.data, reports: answer.data.reports.map((report) => ({ ...report, reviewed: seen.has(report.id) })) });
};

/** { ids, reviewed }: marks reports as looked through, or not. */
export const POST: RequestHandler = async ({ request }) => {
	const sent = (await request.json().catch(() => ({}))) as { ids?: unknown; reviewed?: unknown };
	const ids = Array.isArray(sent.ids) ? sent.ids.map(Number).filter(Number.isInteger) : [];
	const seen = reviewed();
	for (const id of ids) {
		if (sent.reviewed === false) seen.delete(id);
		else seen.add(id);
	}
	// (Reports go after 60 days on the server, so only the newest few hundred numbers matter.)
	updateSettings({ onlineReportsReviewed: JSON.stringify([...seen].sort((a, b) => b - a).slice(0, 500)) });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const answer = await cloud(`/v1/reports/${Number(url.searchParams.get('id'))}`, { method: 'DELETE', admin: true });
	return answer.ok ? json({ ok: true }) : json({ error: answer.error }, { status: answer.status || 502 });
};
