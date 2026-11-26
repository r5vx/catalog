import { json } from "@sveltejs/kit";
import { plutoLiveGuide } from "$lib/server/sources/pluto";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
	const guide = await plutoLiveGuide();
	return json(guide, { headers: { "Cache-Control": "private, max-age=60" } });
};
