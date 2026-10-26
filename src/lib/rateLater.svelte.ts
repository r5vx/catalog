/**
 * "Rate it", after a film (or a series' last episode) is watched: asked once the player is left,
 * on the page that comes next (RatePrompt.svelte, in the app's layout), not over the end of the
 * film — Hurt Locker's came up during its last scenes (the owner, 2026-10-25).
 */
export const ratePrompt = $state<{ offer: { entryId: number; title: string } | null }>({ offer: null });
