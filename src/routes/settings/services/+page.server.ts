import { readSettings, updateSettings } from '$lib/server/settings';
import { verifyTmdbKey } from '$lib/server/metadata/tmdb';
import { verifyOmdbKey } from '$lib/server/metadata/omdb';
import { watchRegion, detectedRegion } from '$lib/server/metadata/providers';
import { fail } from '@sveltejs/kit';
import { addFebboxAccount, febboxAccounts, removeFebboxAccount } from '$lib/server/febboxAccounts';
import { febboxFlow } from '$lib/server/febboxFlow';
import type { PageServerLoad, Actions } from './$types';

/** Whether the date Febbox wrote into a sign-in says it has run out. */
function expired(token: string): boolean {
	const ui = token.match(/(?:^|;\s*)ui=([^;]+)/)?.[1];
	try {
		const exp = Number(JSON.parse(Buffer.from(ui?.split('.')[1] ?? '', 'base64url').toString('utf8')).exp) * 1000;
		return exp > 0 && exp <= Date.now();
	} catch {
		return false;
	}
}

export const load: PageServerLoad = async () => {
	const settings = readSettings();
	// Every Febbox account, with how much of today's fast video each has used (only read here,
	// kept a few minutes by febboxFlow.ts).
	const accounts = await Promise.all(
		febboxAccounts().map(async (account) => ({
			key: account.key,
			main: account.main,
			expired: expired(account.token),
			flow: await febboxFlow(account.token).catch(() => null)
		}))
	);

	return {
		tmdbKeySaved: Boolean(settings.tmdbApiKey),
		omdbKeySaved: Boolean(settings.omdbApiKey),
		febboxKeySaved: Boolean(settings.febboxToken),
		febboxToken: settings.febboxToken ?? '',
		febboxAccounts: accounts,
		region: settings.watchRegion ?? '',
		regionInUse: watchRegion(),
		detectedRegion: detectedRegion()
	};
};

export const actions: Actions = {
	saveTmdb: async ({ request }) => {
		const key = String((await request.formData()).get('tmdbApiKey') ?? '').trim();

		if (!key) return fail(400, { tmdbError: 'Paste your key first.' });

		const check = await verifyTmdbKey(key);
		if (!check.ok) return fail(400, { tmdbError: check.message });

		updateSettings({ tmdbApiKey: key });
		return { tmdbOk: check.message };
	},

	removeTmdb: async () => {
		updateSettings({ tmdbApiKey: undefined });
		return { tmdbOk: 'Key removed. Anime search still works.' };
	},

	saveOmdb: async ({ request }) => {
		const key = String((await request.formData()).get('omdbApiKey') ?? '').trim();

		if (!key) return fail(400, { omdbError: 'Paste your key first.' });

		const check = await verifyOmdbKey(key);
		if (!check.ok) return fail(400, { omdbError: check.message });

		updateSettings({ omdbApiKey: key });
		return { omdbOk: check.message };
	},

	removeOmdb: async () => {
		updateSettings({ omdbApiKey: undefined });
		return { omdbOk: 'Key removed. TMDB scores still show.' };
	},

	saveRegion: async ({ request }) => {
		const value = String((await request.formData()).get('watchRegion') ?? '')
			.trim()
			.toUpperCase();

		if (value && !/^[A-Z]{2}$/.test(value)) {
			return fail(400, { regionError: 'That is not a country code.' });
		}

		updateSettings({ watchRegion: value || undefined });
		return { regionOk: true };
	},

	saveFebbox: async ({ request }) => {
		const key = String((await request.formData()).get('febboxKey') ?? '').trim();
		if (!key) return fail(400, { febboxError: 'Paste a key first.' });

		updateSettings({ febboxToken: key });
		return { febboxOk: 'Key saved.' };
	},

	removeFebbox: async () => {
		updateSettings({ febboxToken: undefined });
		return { febboxOk: 'Key removed.' };
	},

	saveFebboxMore: async ({ request }) => {
		const key = String((await request.formData()).get('febboxKey') ?? '').trim();
		if (!key) return fail(400, { moreError: 'Paste a key first.' });
		const result = await addFebboxAccount(key);
		if (result === 'refused') return fail(400, { moreError: "That key isn't logged in to Febbox." });
		if (result === null) return fail(400, { moreError: "Febbox couldn't be reached. Try again in a minute." });
		return { moreOk: result === 'same' ? 'That account was already here.' : 'Account added.' };
	},

	removeFebboxMore: async ({ request }) => {
		removeFebboxAccount(String((await request.formData()).get('key') ?? ''));
		return { moreOk: 'Account removed.' };
	}
};
