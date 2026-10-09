/**
 * Hand-made watch orders, for franchises that mix films and series.
 *
 * Only what's in each list is written by hand. The order, dates and posters come from TMDB,
 * so a title only needs its name, the year it started, and whether it's a film or a series.
 * A later season gets its own line (`season: 2`) because it came out between other titles.
 *
 * Film-only series (Harry Potter, John Wick…) don't need a list here: they come straight from
 * TMDB's collections when you search for them.
 *
 * To add a franchise: copy one of these blocks, give it a new `slug`, and list its titles.
 */
export type OrderItem = {
	title: string;
	year: number;
	type: 'movie' | 'tv';
	season?: number;
	/** Shown as "Short" or "Special" rather than "Film". */
	kind?: 'short' | 'special';
	/** Optional viewing: hidden unless "Show extras" is on, and left out of the progress count. */
	extra?: boolean;
};

export type WatchOrder = {
	slug: string;
	name: string;
	/** Other names it's searched by. */
	aliases: string[];
	/** The title whose poster stands for the whole list. */
	cover: OrderItem;
	items: OrderItem[];
};

const film = (title: string, year: number): OrderItem => ({ title, year, type: 'movie' });
const show = (title: string, year: number, season?: number): OrderItem => ({ title, year, type: 'tv', season });
/** A few minutes long. Optional, and never added to the library as a film. */
const short = (title: string, year: number): OrderItem => ({ title, year, type: 'movie', kind: 'short', extra: true });
/** A one-off TV special (Werewolf by Night, the Holiday Special). Optional, like the shorts. */
const special = (title: string, year: number): OrderItem => ({ title, year, type: 'movie', kind: 'special', extra: true });

/** Marvel Studios' own films, series and shorts. */
const MCU: OrderItem[] = [
	film('Iron Man', 2008),
	film('The Incredible Hulk', 2008),
	film('Iron Man 2', 2010),
	film('Thor', 2011),
	film('Captain America: The First Avenger', 2011),
	short('Marvel One-Shot: The Consultant', 2011),
	short("Marvel One-Shot: A Funny Thing Happened on the Way to Thor's Hammer", 2011),
	film('The Avengers', 2012),
	short('Marvel One-Shot: Item 47', 2012),
	film('Iron Man 3', 2013),
	short('Marvel One-Shot: Agent Carter', 2013),
	film('Thor: The Dark World', 2013),
	short('Marvel One-Shot: All Hail the King', 2014),
	film('Captain America: The Winter Soldier', 2014),
	film('Guardians of the Galaxy', 2014),
	film('Avengers: Age of Ultron', 2015),
	film('Ant-Man', 2015),
	film('Captain America: Civil War', 2016),
	film('Doctor Strange', 2016),
	film('Guardians of the Galaxy Vol. 2', 2017),
	film('Spider-Man: Homecoming', 2017),
	film('Thor: Ragnarok', 2017),
	film('Black Panther', 2018),
	film('Avengers: Infinity War', 2018),
	film('Ant-Man and the Wasp', 2018),
	film('Captain Marvel', 2019),
	film('Avengers: Endgame', 2019),
	film('Spider-Man: Far From Home', 2019),
	show('WandaVision', 2021),
	show('The Falcon and the Winter Soldier', 2021),
	show('Loki', 2021),
	film('Black Widow', 2021),
	show('What If...?', 2021),
	film('Shang-Chi and the Legend of the Ten Rings', 2021),
	film('Eternals', 2021),
	show('Hawkeye', 2021),
	film('Spider-Man: No Way Home', 2021),
	show('Moon Knight', 2022),
	film('Doctor Strange in the Multiverse of Madness', 2022),
	show('Ms. Marvel', 2022),
	film('Thor: Love and Thunder', 2022),
	show('I Am Groot', 2022),
	show('She-Hulk: Attorney at Law', 2022),
	special('Werewolf by Night', 2022),
	film('Black Panther: Wakanda Forever', 2022),
	special('The Guardians of the Galaxy Holiday Special', 2022),
	film('Ant-Man and the Wasp: Quantumania', 2023),
	film('Guardians of the Galaxy Vol. 3', 2023),
	show('Secret Invasion', 2023),
	show('I Am Groot', 2022, 2),
	show('Loki', 2021, 2),
	film('The Marvels', 2023),
	show('What If...?', 2021, 2),
	show('Echo', 2024),
	film('Deadpool & Wolverine', 2024),
	show('Agatha All Along', 2024),
	show('What If...?', 2021, 3),
	show('Your Friendly Neighborhood Spider-Man', 2025),
	film('Captain America: Brave New World', 2025),
	show('Daredevil: Born Again', 2025),
	film('Thunderbolts*', 2025),
	show('Ironheart', 2025),
	film('The Fantastic Four: First Steps', 2025),
	show('Eyes of Wakanda', 2025),
	show('Marvel Zombies', 2025),
	show('Wonder Man', 2026),
	show('Daredevil: Born Again', 2025, 2),
	film('Spider-Man: Brand New Day', 2026),
	show('VisionQuest', 2026),
	film('Avengers: Doomsday', 2026),
	film('Avengers: Secret Wars', 2027)
];

/**
 * Everything Marvel on screen since 2000: the MCU plus Fox's X-Men and Fantastic Four, the
 * Raimi and Webb Spider-Man films, the Spider-Verse, Sony's Spider-Man universe, and the
 * Marvel TV shows (Netflix, ABC, Hulu, Freeform).
 */
const ULTIMATE_MARVEL: OrderItem[] = [
	...MCU,
	film('X-Men', 2000),
	film('Spider-Man', 2002),
	film('X2', 2003),
	film('Spider-Man 2', 2004),
	film('Fantastic Four', 2005),
	film('X-Men: The Last Stand', 2006),
	film('Spider-Man 3', 2007),
	film('Fantastic Four: Rise of the Silver Surfer', 2007),
	film('X-Men Origins: Wolverine', 2009),
	film('X-Men: First Class', 2011),
	film('The Amazing Spider-Man', 2012),
	film('The Wolverine', 2013),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013),
	film('The Amazing Spider-Man 2', 2014),
	film('X-Men: Days of Future Past', 2014),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 2),
	show("Marvel's Agent Carter", 2015),
	show("Marvel's Daredevil", 2015),
	show("Marvel's Jessica Jones", 2015),
	film('Fantastic Four', 2015),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 3),
	film('Deadpool', 2016),
	show("Marvel's Agent Carter", 2015, 2),
	show("Marvel's Daredevil", 2015, 2),
	film('X-Men: Apocalypse', 2016),
	show("Marvel's Luke Cage", 2016),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 4),
	show("Marvel's Iron Fist", 2017),
	film('Logan', 2017),
	show("Marvel's Inhumans", 2017),
	show("Marvel's The Defenders", 2017),
	show("Marvel's The Punisher", 2017),
	show("Marvel's Runaways", 2017),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 5),
	show("Marvel's Jessica Jones", 2015, 2),
	show("Marvel's Cloak & Dagger", 2018),
	film('Deadpool 2', 2018),
	show("Marvel's Luke Cage", 2016, 2),
	show("Marvel's Iron Fist", 2017, 2),
	show("Marvel's Daredevil", 2015, 3),
	film('Venom', 2018),
	show("Marvel's Runaways", 2017, 2),
	film('Spider-Man: Into the Spider-Verse', 2018),
	show("Marvel's The Punisher", 2017, 2),
	show("Marvel's Cloak & Dagger", 2018, 2),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 6),
	film('Dark Phoenix', 2019),
	show("Marvel's Jessica Jones", 2015, 3),
	show("Marvel's Agents of S.H.I.E.L.D.", 2013, 7),
	show("Marvel's Runaways", 2017, 3),
	show('Helstrom', 2020),
	film('The New Mutants', 2020),
	film('Venom: Let There Be Carnage', 2021),
	film('Morbius', 2022),
	film('Spider-Man: Across the Spider-Verse', 2023),
	film('Madame Web', 2024),
	show("X-Men '97", 2024),
	film('Venom: The Last Dance', 2024),
	film('Kraven the Hunter', 2024)
];

const STAR_WARS: OrderItem[] = [
	film('Star Wars', 1977),
	film('The Empire Strikes Back', 1980),
	film('Return of the Jedi', 1983),
	film('Star Wars: Episode I - The Phantom Menace', 1999),
	film('Star Wars: Episode II - Attack of the Clones', 2002),
	film('Star Wars: Episode III - Revenge of the Sith', 2005),
	film('Star Wars: The Clone Wars', 2008),
	show('Star Wars: The Clone Wars', 2008),
	show('Star Wars Rebels', 2014),
	film('Star Wars: The Force Awakens', 2015),
	film('Rogue One: A Star Wars Story', 2016),
	film('Star Wars: The Last Jedi', 2017),
	film('Solo: A Star Wars Story', 2018),
	show('Star Wars Resistance', 2018),
	show('The Mandalorian', 2019),
	film('Star Wars: The Rise of Skywalker', 2019),
	show('The Mandalorian', 2019, 2),
	show('Star Wars: The Bad Batch', 2021),
	show('The Book of Boba Fett', 2021),
	show('Obi-Wan Kenobi', 2022),
	show('Andor', 2022),
	show('Star Wars: Tales of the Jedi', 2022),
	show('Star Wars: The Bad Batch', 2021, 2),
	show('The Mandalorian', 2019, 3),
	show('Star Wars: Young Jedi Adventures', 2023),
	show('Ahsoka', 2023),
	show('Star Wars: The Bad Batch', 2021, 3),
	show('Star Wars: Tales of the Empire', 2024),
	show('The Acolyte', 2024),
	show('Star Wars: Skeleton Crew', 2024),
	show('Star Wars: Tales of the Underworld', 2025),
	show('Andor', 2022, 2),
	film('The Mandalorian and Grogu', 2026),
	show('Star Wars: Maul - Shadow Lord', 2026)
];

/** James Gunn's DC Universe, from Creature Commandos on. */
const DCU: OrderItem[] = [
	show('Creature Commandos', 2024),
	film('Superman', 2025),
	show('Peacemaker', 2022, 2),
	film('Supergirl', 2026),
	show('Lanterns', 2026),
	film('Clayface', 2026),
	film('Man of Tomorrow', 2027)
];

/**
 * Everything DC on screen since 2000, like Ultimate Marvel: the Nolan and Snyder films, the
 * Joker and The Batman, the Arrowverse, Smallville, Gotham, Titans, Doom Patrol, Harley Quinn
 * and the rest, then the DC Universe. Peacemaker season 1 is DCEU but carries into the DCU.
 * Older films (Burton's Batman, Reeve's Superman) and 1960s–90s TV are left out on purpose.
 */
const ULTIMATE_DC: OrderItem[] = [
	film('Catwoman', 2004),
	film('Constantine', 2005),
	film('Batman Begins', 2005),
	film('Superman Returns', 2006),
	film('The Dark Knight', 2008),
	film('Watchmen', 2009),
	film('Jonah Hex', 2010),
	film('Green Lantern', 2011),
	film('The Dark Knight Rises', 2012),
	film('Man of Steel', 2013),
	film('Batman v Superman: Dawn of Justice', 2016),
	film('Suicide Squad', 2016),
	film('Wonder Woman', 2017),
	film('Justice League', 2017),
	film('Aquaman', 2018),
	film('Shazam!', 2019),
	film('Joker', 2019),
	film('Birds of Prey', 2020),
	film('Wonder Woman 1984', 2020),
	film("Zack Snyder's Justice League", 2021),
	film('The Suicide Squad', 2021),
	film('The Batman', 2022),
	film('Black Adam', 2022),
	film('Shazam! Fury of the Gods', 2023),
	film('The Flash', 2023),
	film('Blue Beetle', 2023),
	film('Aquaman and the Lost Kingdom', 2023),
	film('Joker: Folie à Deux', 2024),
	show('Smallville', 2001),
	show('Smallville', 2001, 2),
	show('Smallville', 2001, 3),
	show('Smallville', 2001, 4),
	show('Smallville', 2001, 5),
	show('Smallville', 2001, 6),
	show('Smallville', 2001, 7),
	show('Smallville', 2001, 8),
	show('Smallville', 2001, 9),
	show('Smallville', 2001, 10),
	show('Birds of Prey', 2002),
	show('Arrow', 2012),
	show('Arrow', 2012, 2),
	show('Arrow', 2012, 3),
	show('Arrow', 2012, 4),
	show('Arrow', 2012, 5),
	show('Arrow', 2012, 6),
	show('Arrow', 2012, 7),
	show('Arrow', 2012, 8),
	show('The Flash', 2014),
	show('The Flash', 2014, 2),
	show('The Flash', 2014, 3),
	show('The Flash', 2014, 4),
	show('The Flash', 2014, 5),
	show('The Flash', 2014, 6),
	show('The Flash', 2014, 7),
	show('The Flash', 2014, 8),
	show('The Flash', 2014, 9),
	show('Constantine', 2014),
	show('Gotham', 2014),
	show('Gotham', 2014, 2),
	show('Gotham', 2014, 3),
	show('Gotham', 2014, 4),
	show('Gotham', 2014, 5),
	show('Supergirl', 2015),
	show('Supergirl', 2015, 2),
	show('Supergirl', 2015, 3),
	show('Supergirl', 2015, 4),
	show('Supergirl', 2015, 5),
	show('Supergirl', 2015, 6),
	show("DC's Legends of Tomorrow", 2016),
	show("DC's Legends of Tomorrow", 2016, 2),
	show("DC's Legends of Tomorrow", 2016, 3),
	show("DC's Legends of Tomorrow", 2016, 4),
	show("DC's Legends of Tomorrow", 2016, 5),
	show("DC's Legends of Tomorrow", 2016, 6),
	show("DC's Legends of Tomorrow", 2016, 7),
	show('Lucifer', 2016),
	show('Lucifer', 2016, 2),
	show('Lucifer', 2016, 3),
	show('Lucifer', 2016, 4),
	show('Lucifer', 2016, 5),
	show('Lucifer', 2016, 6),
	show('Black Lightning', 2018),
	show('Black Lightning', 2018, 2),
	show('Black Lightning', 2018, 3),
	show('Black Lightning', 2018, 4),
	show('Titans', 2018),
	show('Titans', 2018, 2),
	show('Titans', 2018, 3),
	show('Titans', 2018, 4),
	show('Krypton', 2018),
	show('Krypton', 2018, 2),
	show('Doom Patrol', 2019),
	show('Doom Patrol', 2019, 2),
	show('Doom Patrol', 2019, 3),
	show('Doom Patrol', 2019, 4),
	show('Swamp Thing', 2019),
	show('Watchmen', 2019),
	show('Pennyworth', 2019),
	show('Pennyworth', 2019, 2),
	show('Pennyworth', 2019, 3),
	show('Batwoman', 2019),
	show('Batwoman', 2019, 2),
	show('Batwoman', 2019, 3),
	show('Harley Quinn', 2019),
	show('Harley Quinn', 2019, 2),
	show('Harley Quinn', 2019, 3),
	show('Harley Quinn', 2019, 4),
	show('Harley Quinn', 2019, 5),
	show('Stargirl', 2020),
	show('Stargirl', 2020, 2),
	show('Stargirl', 2020, 3),
	show('Superman & Lois', 2021),
	show('Superman & Lois', 2021, 2),
	show('Superman & Lois', 2021, 3),
	show('Superman & Lois', 2021, 4),
	show('Naomi', 2022),
	show('Gotham Knights', 2023),
	show('The Penguin', 2024),
	show('Batman: Caped Crusader', 2024),
	show('Peacemaker', 2022),
	...DCU
];

export const WATCH_ORDERS: WatchOrder[] = [
	{
		slug: 'mcu',
		name: 'Marvel Cinematic Universe',
		aliases: ['mcu', 'marvel', 'avengers'],
		cover: film('Avengers: Endgame', 2019),
		items: MCU
	},
	{
		slug: 'marvel-ultimate',
		name: 'Ultimate Marvel',
		aliases: ['marvel', 'x-men', 'xmen', 'spider-man', 'spiderman', 'netflix marvel', 'defenders', 'fox marvel'],
		cover: film('X-Men: Days of Future Past', 2014),
		items: ULTIMATE_MARVEL
	},
	{
		slug: 'dcu',
		name: 'DC Universe',
		aliases: ['dc', 'dcu', 'superman', 'james gunn', 'peacemaker'],
		cover: film('Superman', 2025),
		items: DCU
	},
	{
		slug: 'dc-ultimate',
		name: 'Ultimate DC',
		aliases: ['dc', 'dceu', 'batman', 'superman', 'arrowverse', 'justice league', 'wonder woman', 'joker', 'flash'],
		cover: film('The Dark Knight', 2008),
		items: ULTIMATE_DC
	},
	{
		slug: 'star-wars',
		name: 'Star Wars',
		aliases: ['star wars', 'mandalorian', 'jedi'],
		cover: film('Star Wars', 1977),
		items: STAR_WARS
	}
];

/**
 * TMDB film collections suggested before you've typed anything, by TMDB id.
 * Find an id by searching for the franchise in the app: it's the number in the address bar.
 */
export const POPULAR_COLLECTIONS = [
	1241, // Harry Potter
	119, // The Lord of the Rings
	121938, // The Hobbit
	435259, // Fantastic Beasts
	645, // James Bond
	9485, // Fast & Furious
	404609, // John Wick
	328, // Jurassic Park
	295, // Pirates of the Caribbean
	263, // The Dark Knight
	87359, // Mission: Impossible
	84, // Indiana Jones
	264, // Back to the Future
	131635, // The Hunger Games
	2344, // The Matrix
	528, // The Terminator
	230, // The Godfather
	87096, // Avatar
	726871, // Dune
	8091, // Alien
	173710, // Planet of the Apes (reboot)
	33514, // Twilight
	448150, // Deadpool
	573436, // Spider-Verse
	8945, // Mad Max
	10194, // Toy Story
	2150, // Shrek
	86066, // Despicable Me
	89137 // How to Train Your Dragon
];

export const orderBySlug = (slug: string) => WATCH_ORDERS.find((o) => o.slug === slug) ?? null;
