import { json, error } from '@sveltejs/kit';
import { addProfile, updateProfile, deleteProfile, listProfiles, profileExists } from '$lib/server/db/queries';
import { PROFILE_COLORS } from '$lib/constants';
import { MAIN_PROFILE } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Who's watching, on the TV. Body: { action, ... }
 *   choose { id }              this TV watches as them from now on
 *   add    { name }            a new profile; returns its id
 *   edit   { id, name, color } renamed or recoloured
 *   delete { id }              gone, with what they'd watched (never the owner's)
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const id = Number(body.id);
	const name = String(body.name ?? '').trim().slice(0, 20);

	if (body.action === 'choose') {
		if (!Number.isInteger(id) || !profileExists(id)) error(404, 'No such profile');
		cookies.set('catalog_profile', String(id), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			// Plain http on your own network: a "Secure" cookie would be thrown away.
			secure: false,
			maxAge: 60 * 60 * 24 * 365
		});
		return json({ ok: true });
	}

	if (body.action === 'add') {
		if (!name) error(400, 'A name, please');
		if (listProfiles().length >= 8) error(400, 'Eight is the most');
		return json({ id: addProfile(name) });
	}

	if (body.action === 'edit') {
		const current = listProfiles().find((profile) => profile.id === id);
		if (!current) error(404, 'No such profile');
		const color = PROFILE_COLORS.includes(body.color) ? body.color : current.color;
		updateProfile(id, name || current.name, color);
		return json({ ok: true });
	}

	if (body.action === 'delete') {
		if (id === MAIN_PROFILE || !profileExists(id)) error(400, "That one can't be deleted");
		deleteProfile(id);
		if (cookies.get('catalog_profile') === String(id)) cookies.delete('catalog_profile', { path: '/', secure: false });
		return json({ ok: true });
	}

	error(400, 'Unknown action');
};
