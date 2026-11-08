/**
 * A profile's audio language (owner, 2026-11-04: family and friends who'd rather hear another
 * language). Films and shows then come with Movy's dubbed copy in it, picked first for that
 * profile, wherever Movy has one (its dub servers: German, French, Hindi, Spanish; sources/movy.ts).
 * '' (the default) = the original audio, as before. Kept per profile in the library.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import { currentProfile } from './profile';
import { MOVY_DUB_NAMES, type MovyDub } from './sources/movy';

export const AUDIO_LANGUAGES = Object.keys(MOVY_DUB_NAMES) as MovyDub[];
const keyOf = (profile: number) => `audio-language|${profile}`;

export function audioLanguage(profile = currentProfile()): MovyDub | '' {
	const kept = getOrderCache(keyOf(profile))?.value;
	return typeof kept === 'string' && (AUDIO_LANGUAGES as string[]).includes(kept) ? (kept as MovyDub) : '';
}

export function setAudioLanguage(language: string, profile = currentProfile()): void {
	saveOrderCache(keyOf(profile), (AUDIO_LANGUAGES as string[]).includes(language) ? language : '', Date.now());
}

/** The language's name as copies are labelled ("Spanish"), or '' for the original audio. */
export const audioLanguageName = (language: MovyDub | '') => (language ? MOVY_DUB_NAMES[language] : '');
