import { getNote, setNoteLocked } from '$lib/server/db/notes';
import { checkPin, pinIsSet, notesToken } from '$lib/server/settings';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

const COOKIE = 'catalog_notes';

/** Whether the PIN has been entered for locked pages this session. */
const unlocked = (value: string | undefined) => Boolean(value) && value === notesToken();

export const load: PageServerLoad = async ({ params, cookies }) => {
	const note = getNote(Number(params.id));
	if (!note) error(404, 'That page does not exist.');

	const open = !note.locked || unlocked(cookies.get(COOKIE));

	// A locked page hands over its title and nothing else. The body never
	// leaves the server until the PIN has been entered.
	if (!open) {
		return {
			note: { id: note.id, title: note.title, body: '', locked: true },
			locked: true,
			pinSet: pinIsSet()
		};
	}

	return { note, locked: false, pinSet: pinIsSet() };
};

export const actions: Actions = {
	unlock: async ({ request, cookies }) => {
		const pin = String((await request.formData()).get('pin') ?? '').trim();

		if (!checkPin(pin)) return fail(400, { pinError: 'That PIN is not right.' });

		// A session cookie: closing the app locks the pages again.
		cookies.set(COOKIE, notesToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false
		});

		return { unlocked: true };
	},

	lock: async ({ params, cookies }) => {
		if (!pinIsSet()) {
			return fail(400, { lockError: 'Set a PIN in Settings first — it is what unlocks a page.' });
		}

		setNoteLocked(Number(params.id), true);

		// Whoever just locked it can still read it, so they aren't shut out of
		// the page they are looking at.
		cookies.set(COOKIE, notesToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false
		});

		return { locked: true };
	},

	unlockPermanently: async ({ params, cookies }) => {
		const note = getNote(Number(params.id));
		if (!note) error(404, 'That page does not exist.');

		// Only someone who has already proved the PIN can take the lock off.
		if (note.locked && !unlocked(cookies.get(COOKIE))) {
			return fail(403, { lockError: 'Enter the PIN first.' });
		}

		setNoteLocked(note.id, false);
		return { unlockedPermanently: true };
	},

	forget: async ({ cookies }) => {
		cookies.delete(COOKIE, { path: '/', secure: false });
		redirect(303, '/notes');
	}
};
