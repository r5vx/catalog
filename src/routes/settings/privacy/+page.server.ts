import { setPin, pinIsSet } from '$lib/server/settings';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => ({ pinSet: pinIsSet() });

export const actions: Actions = {
	savePin: async ({ request }) => {
		const pin = String((await request.formData()).get('pin') ?? '').trim();

		if (pin.length < 4) return fail(400, { pinError: 'Use at least 4 characters.' });

		setPin(pin);
		return { pinOk: 'PIN set. You will be asked for it on other devices.' };
	},

	removePin: async ({ cookies }) => {
		setPin(null);
		// Attributes must match the ones the cookie was set with, or it won't clear.
		cookies.delete('catalog_auth', { path: '/', secure: false });
		return { pinOk: 'PIN removed.' };
	}
};
