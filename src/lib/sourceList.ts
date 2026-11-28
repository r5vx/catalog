/**
 * Every site Catalog plays from, for Settings' Sources cards. `name` matches SITES in
 * server/reachable.ts (its Online check); `domain` is where the card's icon comes from.
 */
export type SourceInfo = { name: string; domain: string; about: string };
export type SourceGroup = { title: string; sources: SourceInfo[] };

export const SOURCE_GROUPS: SourceGroup[] = [
	{
		title: 'Movies and TV',
		sources: [
			{ name: 'Showbox', domain: 'showbox.media', about: 'Films and series, played through your Febbox accounts' },
			{ name: '7Movies', domain: 'vidrift.net', about: 'Films and series' },
			{ name: 'Movy', domain: 'movy.sx', about: 'Films and series' },
			{ name: 'Vidfast', domain: 'vidfast.vc', about: 'Films and series' },
			{ name: 'YouTube', domain: 'youtube.com', about: 'Full films and episodes uploaded by their own publishers' }
		]
	},
	{
		title: 'Free with no account',
		sources: [
			{ name: 'Tubi', domain: 'tubitv.com', about: 'Free films and shows, on the computer only' },
			{ name: 'Plex', domain: 'plex.tv', about: 'Free films and shows' },
			{ name: 'Pluto TV', domain: 'pluto.tv', about: 'Free films, shows and live channels' },
			{ name: 'Xumo Play', domain: 'xumo.com', about: 'Free films and shows' }
		]
	},
	{
		title: 'Anime',
		sources: [
			{ name: 'HiAnime', domain: 'hianime.to', about: 'Japanese audio and English dub' },
			{ name: 'Aniwave', domain: 'aniwaves.ru', about: 'Japanese audio and English dub' },
			{ name: 'KickAssAnime', domain: 'kaa.lt', about: 'Japanese audio and English dub' },
			{ name: 'Anime Nexus', domain: 'anime.nexus', about: 'Subtitles for anime' }
		]
	},
	{
		title: 'Torrents, with a debrid account',
		sources: [
			{ name: 'Torrentio', domain: 'strem.io', about: 'Finds torrents for films and series' },
			{ name: 'Nyaa', domain: 'nyaa.si', about: 'Finds anime torrents' },
			{ name: 'Real-Debrid', domain: 'real-debrid.com', about: 'Plays a torrent straight away' },
			{ name: 'TorBox', domain: 'torbox.app', about: 'Plays a torrent straight away' },
			{ name: 'AllDebrid', domain: 'alldebrid.com', about: 'Plays a torrent straight away' },
			{ name: 'Premiumize', domain: 'premiumize.me', about: 'Plays a torrent straight away' }
		]
	},
	{
		title: 'Live and sports',
		sources: [
			{ name: 'DaddyLive', domain: 'thedaddy.li', about: 'Live games and sports channels' },
			{ name: 'Football replays', domain: 'nfl-video.com', about: 'Full NFL game replays' },
			{ name: 'Basketball replays', domain: 'basketball-video.com', about: 'Full NBA game replays' },
			{ name: 'Soccer replays', domain: 'soccerfull.net', about: 'Full soccer match replays' }
		]
	}
];

export const ALL_SOURCES: SourceInfo[] = SOURCE_GROUPS.flatMap((g) => g.sources);
