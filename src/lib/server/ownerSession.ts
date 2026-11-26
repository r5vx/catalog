import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { error, type Cookies } from '@sveltejs/kit';
import { currentProfile } from './profile';
import { readSettings, updateSettings } from './settings';

const name = 'catalog_owner_session';
const digest = (token: string) => createHash('sha256').update(`${currentProfile()}:${token}`).digest();

export function isOwner(cookies: Cookies): boolean {
	const { onlineAdminKey, ownerSessionHash } = readSettings();
	const token = cookies.get(name);
	return Boolean(onlineAdminKey && ownerSessionHash && /^[a-f0-9]{64}$/.test(ownerSessionHash) && token && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(digest(token), Buffer.from(ownerSessionHash, 'hex')));
}

export function requireOwner(cookies: Cookies) {
	if (!isOwner(cookies)) error(403, 'Owner access required');
}

export function rememberOwner(cookies: Cookies, https: boolean) {
	const token = randomBytes(32).toString('hex');
	updateSettings({ ownerSessionHash: digest(token).toString('hex') });
	cookies.set(name, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: https, maxAge: 60 * 60 * 24 * 90 });
}

export function forgetOwner(cookies: Cookies) {
	requireOwner(cookies);
	updateSettings({ ownerSessionHash: undefined, onlineAdminKey: undefined });
	cookies.delete(name, { path: '/' });
}
