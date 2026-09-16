<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	type Section = {
		href: string;
		label: string;
		hint: string;
		/** Which attention flag, if any, belongs to this section. */
		flag?: 'services' | 'updates';
	};

	const SECTIONS: Section[] = [
		{ href: '/settings/personalization', label: 'Personalization', hint: 'Colour and sorting' },
		{ href: '/settings/library', label: 'Library', hint: 'Export, where your files live' },
		{
			href: '/settings/services',
			label: 'Services',
			hint: 'Where titles and scores come from',
			flag: 'services'
		},
		{ href: '/settings/privacy', label: 'Privacy', hint: 'PIN lock' },
		{ href: '/settings/updates', label: 'Updates', hint: 'Keep Catalog current', flag: 'updates' }
	];

	const sections = $derived(
		SECTIONS.filter((one) => one.href !== '/settings/updates' || data.updateMode !== 'none')
	);

	/**
	 * On a phone the two columns don't fit, so it behaves like a phone's own
	 * settings: the index is the list, and a section replaces it. On a wide
	 * screen both are visible at once.
	 */
	const atIndex = $derived(page.url.pathname === '/settings');

	const current = $derived(sections.find((one) => page.url.pathname.startsWith(one.href)));
</script>

<header>
	{#if atIndex}
		<a href="/" class="back faint">&larr; Library</a>
	{:else}
		<a href="/settings" class="back faint">&larr; Settings</a>
	{/if}
	<h1>{atIndex ? 'Settings' : (current?.label ?? 'Settings')}</h1>
</header>

<div class="shell" class:index={atIndex}>
	<nav class="menu">
		<ul>
			{#each sections as section (section.href)}
				<li>
					<a
						href={section.href}
						class:active={page.url.pathname.startsWith(section.href)}
						aria-current={page.url.pathname.startsWith(section.href) ? 'page' : undefined}
					>
						<span class="name">
							{section.label}
							{#if section.flag && data.needs[section.flag]}
								<span
									class="dot"
									title={section.flag === 'services'
										? 'A key is missing'
										: 'An update is waiting'}
									aria-label="Needs attention"
								></span>
							{/if}
						</span>
						<span class="hint faint">{section.hint}</span>
						<span class="chevron" aria-hidden="true"></span>
					</a>
				</li>
			{/each}
		</ul>

		{#if data.appVersion}
			<p class="version faint tabular">Catalog {data.appVersion}</p>
		{/if}
	</nav>

	<div class="panel">
		{@render children()}
	</div>
</div>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 24px;
	}

	.back {
		font-size: 0.85rem;
		width: fit-content;
	}

	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	.shell {
		display: grid;
		grid-template-columns: 232px 1fr;
		gap: 40px;
		align-items: start;
	}

	.menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.menu a {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas: 'name chevron' 'hint chevron';
		align-items: center;
		gap: 0 10px;
		padding: 9px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
	}

	.menu a:hover {
		background: var(--surface);
		border-color: var(--rule);
	}

	.menu a.active {
		background: var(--accent-bg);
		border-color: color-mix(in srgb, var(--accent) 32%, transparent);
	}

	.menu a.active .name {
		color: var(--accent);
	}

	.name {
		grid-area: name;
		font-weight: 600;
		font-size: 0.93rem;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	/* Only where there's something to do about it. */
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		flex: none;
	}

	.hint {
		grid-area: hint;
		font-size: 0.76rem;
		line-height: 1.35;
	}

	/* Points right on the list, drawn rather than imported. */
	.chevron {
		grid-area: chevron;
		width: 6px;
		height: 6px;
		border-top: 2px solid var(--ink-faint);
		border-right: 2px solid var(--ink-faint);
		transform: rotate(45deg);
	}

	.version {
		font-size: 0.74rem;
		margin: 16px 0 0;
		padding-left: 12px;
	}

	.panel {
		min-width: 0;
		max-width: 62ch;
	}

	@media (min-width: 721px) {
		.chevron {
			display: none;
		}
	}

	@media (max-width: 720px) {
		.shell {
			grid-template-columns: 1fr;
			gap: 0;
		}

		/* One at a time: the list, or the section you picked. */
		.shell:not(.index) .menu,
		.shell.index .panel {
			display: none;
		}

		.menu a {
			border-color: var(--rule);
			background: var(--surface);
		}
	}
</style>
