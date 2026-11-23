import { currentProfile, MAIN_PROFILE } from './profile';
import { listProfiles } from './db/queries';

/**
 * Which screen a problem report came from, and who was watching on it, so the owner reading
 * Settings → Online can tell the TVs and phones apart. Read from the asking device's user agent
 * (the Fire TV and iPhone apps mark theirs) and the profile the request runs as.
 */
export function reportScreen(request: Request): { screen: string; profile: string } {
	const agent = request.headers.get('user-agent') ?? '';
	const screen = /CatalogTV\//.test(agent)
		? 'Fire TV app'
		: /CatalogPhone\//.test(agent)
			? 'iPhone app'
			: /Roku/i.test(agent)
				? 'Roku'
				: /Electron\//.test(agent)
					? 'Catalog window'
					: /Tizen|SMART-TV|SmartTV|Web0S|AFT/i.test(agent)
						? 'TV browser'
						: /Android|iPhone|iPad|Mobile/i.test(agent)
							? 'phone browser'
							: 'browser';
	const id = currentProfile();
	let profile = id === MAIN_PROFILE ? 'main' : `profile ${id}`;
	try {
		profile = listProfiles().find((one) => one.id === id)?.name ?? profile;
	} catch {}
	return { screen, profile };
}
