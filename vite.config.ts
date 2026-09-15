import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Use Svelte 5 runes everywhere in our own code.
				runes: ({ filename }) => (filename.includes('node_modules') ? undefined : true)
			},
			// adapter-node: we host this ourselves, on your PC.
			adapter: adapter(),

			// SvelteKit guesses its own address as https://… when it can't tell,
			// which never matches the plain http:// the app actually runs on, so
			// every form submission got rejected. We do the real check ourselves
			// in src/hooks.server.ts instead — see checkSameOrigin there.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
