import { checkPin, sessionToken } from '$lib/server/settings';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const pin = String(form.get('pin') ?? '');

		if (!checkPin(pin)) return fail(400, { error: 'That PIN is not right.' });

		cookies.set('catalog_auth', sessionToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			// Catalog runs over plain http on your own network, so a "Secure"
			// cookie would be thrown away by the browser the moment it arrived —
			// which looks exactly like the PIN being wrong, over and over.
			secure: false,
			// A year: this is your own device, you should not have to keep doing this.
			maxAge: 60 * 60 * 24 * 365
		});

		const next = url.searchParams.get('next');
		redirect(303, next && next.startsWith('/') ? next : '/');
	}
};
