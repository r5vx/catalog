import { PROFILE_COLORS } from '$lib/constants';

/** The color behind someone's letter when they have no picture: the same person always gets the same one. */
export const letterColor = (id: string) => PROFILE_COLORS[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % PROFILE_COLORS.length];
