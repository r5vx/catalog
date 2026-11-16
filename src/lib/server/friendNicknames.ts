/**
 * Nicknames for friends (owner, 2026-11-15): what this profile calls a friend instead of the name
 * they picked. Kept on this computer only, per profile (settings `friendNicknames`, JSON
 * { "<profile>": { "<account id>": "<nickname>" } }); the friend never sees it.
 *
 * Put on every answer from the meeting point the pages get (routes/api/online/c, the profile
 * page): any { id, name } or message { from, name } of a friend with a nickname gets the
 * nickname as `name`, and their own name as `realName`.
 */
import { readSettings, updateSettings } from './settings';

const ID = /^[A-Z0-9]{16}$/;

function all(): Record<string, Record<string, string>> {
	try {
		const saved = JSON.parse(readSettings().friendNicknames ?? '{}');
		return saved && typeof saved === 'object' ? saved : {};
	} catch {
		return {};
	}
}

export function nicknamesOf(profile: number): Record<string, string> {
	return all()[String(profile)] ?? {};
}

/** Sets a friend's nickname ('' takes it away). */
export function setNickname(profile: number, id: string, nickname: string): void {
	if (!ID.test(id)) return;
	const saved = all();
	const mine = { ...(saved[String(profile)] ?? {}) };
	const name = nickname.trim().slice(0, 30);
	if (name) mine[id] = name;
	else delete mine[id];
	saved[String(profile)] = mine;
	updateSettings({ friendNicknames: JSON.stringify(saved) });
}

/** The answer with this profile's nicknames put in (a copy; the answer itself is left as it was). */
export function withNicknames<T>(profile: number, data: T): T {
	const names = nicknamesOf(profile);
	if (!Object.keys(names).length) return data;
	const walk = (value: unknown, depth: number): unknown => {
		if (depth > 8 || value === null || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
		const object = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(object)) out[k] = walk(v, depth + 1);
		const who = typeof object.id === 'string' && ID.test(object.id) ? object.id : typeof object.from === 'string' && ID.test(object.from) ? object.from : '';
		if (who && names[who] && typeof object.name === 'string') {
			out.realName = object.name;
			out.name = names[who];
		}
		return out;
	};
	return walk(data, 0) as T;
}
