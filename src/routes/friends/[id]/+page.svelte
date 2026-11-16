<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import BackBar from '$lib/BackBar.svelte';
	import TitleShelf from '$lib/TitleShelf.svelte';
	import { wording } from '$lib/altText';
	import { openChat } from '$lib/chat.svelte';
	import { together, joinRoom } from '$lib/watchTogether.svelte';
	import { watchHref, monthYear } from '$lib/friendLinks';
	import StyledName from '$lib/StyledName.svelte';
	import { letterColor } from '$lib/avatarColor';
	import { FONTS, GRADIENTS, NO_STYLE, loadFont, readNameStyle, type NameStyle } from '$lib/nameStyle';
	import type { Titled } from './+page.server';

	/**
	 * Someone's profile (owner, 2026-11-15: "view profile ... show when the user joined catalog and
	 * maybe show their highest rated stuff"): their picture and name, when they joined, a line or two
	 * they wrote, their favorites, their best rated, what they watched lately, their friends, and
	 * the way to their whole library. Your own has Edit profile.
	 */
	let { data } = $props();
	const person = $derived(data.profile);
	const t = (text: string) => wording(page.data.altMode, text);

	type Known = { id: string; name: string; avatar: number; me?: boolean; friend?: boolean; requested?: boolean; asked?: boolean };
	let theirFriends = $state<Known[] | null>(null);
	let note = $state('');

	$effect(() => {
		const id = person.id;
		theirFriends = null;
		if (person.me) return;
		fetch(`/api/online/c/friends/${id}/friends`)
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => id === person.id && (theirFriends = answer?.friends ?? []))
			.catch(() => (theirFriends = []));
	});

	async function ask(other: Known) {
		const answer = await fetch('/api/online/c/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: other.id }) })
			.then((r) => r.json())
			.catch(() => null);
		if (theirFriends) theirFriends = theirFriends.map((one) => (one.id === other.id ? { ...one, requested: !answer?.friends, friend: Boolean(answer?.friends) } : one));
	}

	async function watchAlong() {
		const w = person.watching;
		if (!w) return;
		if (w.room && together.code !== w.room) await joinRoom(w.room, person.name);
		await goto(watchHref(w));
	}

	const added = (title: string, ok: boolean) => (note = ok ? `${title}: ${t('added to Want to watch')}` : t("Couldn't add it"));
	const label = (w: { title: string; type: string; season: number; episode: number }) => (w.type === 'tv' && w.season ? `${w.title} S${w.season}E${w.episode}` : w.title);
	/* ---------------------------------------------------------- editing your own */

	let editing = $state(false);
	let bio = $state('');
	let pickedColor = $state('');
	let favorites = $state<Titled[]>([]);
	let search = $state('');
	let found = $state<Titled[]>([]);
	let saving = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** A banner picked and not saved yet (a data: address), or the saved one taken away. */
	let newBanner = $state<string | null>(null);
	let bannerRemoved = $state(false);
	let bannerNote = $state('');
	let bannerBox = $state<HTMLInputElement | null>(null);
	let nameDraft = $state<NameStyle>({ ...NO_STYLE });

	// While editing, the header shows what's being picked, before it's saved.
	const shownColor = $derived(editing ? pickedColor : person.color);
	/**
	 * With no color picked, the picture's own (owner, 2026-11-15: "like discord where it takes the
	 * average color"): the average of its colorful pixels, worked out here from the avatar.
	 */
	let pictureColor = $state('');
	$effect(() => {
		const src = person.avatar ? `/api/online/avatar/${person.id}?v=${person.avatar}` : '';
		// No picture: the color behind their letter (the same as the avatar shows).
		pictureColor = src ? '' : letterColor(person.id);
		if (!src) return;
		const image = new Image();
		image.onload = () => (pictureColor = averageColor(image) || letterColor(person.id));
		image.onerror = () => (pictureColor = letterColor(person.id));
		image.src = src;
	});
	function averageColor(image: HTMLImageElement): string {
		try {
			const size = 32;
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = size;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) return '';
			context.drawImage(image, 0, 0, size, size);
			const pixels = context.getImageData(0, 0, size, size).data;
			let r = 0, g = 0, b = 0, weight = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i + 3] < 128) continue;
				const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
				const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
				// Colorful pixels count more than grey ones, so a face on white isn't averaged to grey.
				const w = 1 + ((max - min) / 255) * 6;
				r += pixels[i] * w;
				g += pixels[i + 1] * w;
				b += pixels[i + 2] * w;
				weight += w;
			}
			if (!weight) return '';
			const hex = (n: number) => Math.round(n / weight).toString(16).padStart(2, '0');
			return `#${hex(r)}${hex(g)}${hex(b)}`;
		} catch {
			return '';
		}
	}
	const color = $derived(/^#[0-9a-f]{6}$/i.test(shownColor) ? shownColor : pictureColor || 'var(--accent)');

	/* ---------------------------------------------------------- a friend: nickname, removing */

	let nicknaming = $state(false);
	let nickname = $state('');
	let removing = $state(false);

	function startNickname() {
		nickname = person.realName ? person.name : '';
		nicknaming = true;
	}
	async function saveNickname(event: SubmitEvent) {
		event.preventDefault();
		await fetch('/api/online/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: person.id, nickname }) }).catch(() => null);
		nicknaming = false;
		await invalidateAll();
	}
	async function removeFriend() {
		const answer = await fetch(`/api/online/c/friends/${person.id}`, { method: 'DELETE' }).catch(() => null);
		if (answer?.ok) await goto('/?cat=friends');
		else note = t("Couldn't remove them");
	}
	const savedBanner = $derived(person.banner ? `/api/online/banner/${person.id}?v=${person.banner}` : '');
	const bannerShown = $derived(editing ? (newBanner ?? (bannerRemoved ? '' : savedBanner)) : savedBanner);
	const look = $derived(editing ? nameDraft : readNameStyle(person.nameStyle));

	function startEditing() {
		bio = person.bio;
		pickedColor = person.color || '';
		favorites = [...person.favorites];
		search = '';
		found = [];
		newBanner = null;
		bannerRemoved = false;
		bannerNote = '';
		nameDraft = readNameStyle(person.nameStyle);
		// (Each font's sample is drawn in that font.)
		for (const font of FONTS) loadFont(font.id);
		editing = true;
	}

	// Settings → Online's "Banner, name style and favorites" opens it ready to edit.
	let editAsked = false;
	$effect(() => {
		if (person.me && !editAsked && page.url.searchParams.get('edit') === '1') {
			editAsked = true;
			startEditing();
		}
	});

	/* The banner: kept at most 1500 px wide and half as tall, as a JPEG, so it stays small. A
	   moving GIF is kept as it is when it's small enough (else its first picture is used). */
	const BANNER_MOST = 700_000;
	const GIF_MOST = 500_000;

	const fileAsData = (file: File) =>
		new Promise<string>((done, failed) => {
			const reader = new FileReader();
			reader.onload = () => done(String(reader.result));
			reader.onerror = () => failed(reader.error);
			reader.readAsDataURL(file);
		});

	async function bannerFrom(file: File): Promise<string> {
		if (file.type === 'image/gif' && file.size <= GIF_MOST) return fileAsData(file);
		if (file.type === 'image/gif') bannerNote = t('That GIF is over 500 KB, so it was kept as a still picture.');
		const image = await createImageBitmap(file);
		// The middle of a tall picture: at most half as tall as it is wide.
		const cropHeight = Math.min(image.height, Math.round(image.width / 2));
		const scale = Math.min(1, 1500 / image.width);
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(image.width * scale);
		canvas.height = Math.round(cropHeight * scale);
		const pen = canvas.getContext('2d')!;
		pen.imageSmoothingQuality = 'high';
		pen.drawImage(image, 0, (image.height - cropHeight) / 2, image.width, cropHeight, 0, 0, canvas.width, canvas.height);
		for (const quality of [0.85, 0.75, 0.6, 0.45]) {
			const data = canvas.toDataURL('image/jpeg', quality);
			if (data.length <= BANNER_MOST) return data;
		}
		throw new Error('too big');
	}

	async function pickBanner(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (bannerBox) bannerBox.value = '';
		if (!file) return;
		bannerNote = '';
		try {
			newBanner = await bannerFrom(file);
			bannerRemoved = false;
		} catch {
			bannerNote = t("That file isn't a picture Catalog can read.");
		}
	}

	function removeBanner() {
		newBanner = null;
		bannerRemoved = true;
		bannerNote = '';
	}

	function setEffect(effect: NameStyle['effect']) {
		const colors = [...nameDraft.colors];
		if (!colors[0]) colors[0] = effect === 'gradient' ? GRADIENTS[0][0] : '#e994c2';
		if (effect === 'gradient' && !colors[1]) colors[1] = GRADIENTS[0][1];
		nameDraft = { ...nameDraft, effect, colors: effect === 'gradient' ? colors.slice(0, 2) : colors.slice(0, 1) };
	}

	function setNameColor(which: 0 | 1, value: string) {
		const colors = [...nameDraft.colors];
		colors[which] = value;
		if (which === 1 && !colors[0]) colors[0] = value;
		nameDraft = { ...nameDraft, colors };
	}

	function lookFor(text: string) {
		search = text;
		clearTimeout(searchTimer);
		if (text.trim().length < 2) {
			found = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const answer = await fetch(`/api/search?q=${encodeURIComponent(text)}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			type Result = { source: string; sourceId: string; title: string; year: number | null; posterUrl: string | null; categorySlug: string };
			found = ((answer?.results ?? []) as Result[]).slice(0, 8).map((r) => ({
				key: `${r.source}:${r.sourceId}`,
				title: r.title,
				year: r.year ? String(r.year) : '',
				type: r.categorySlug === 'movies' ? 'movie' : 'tv',
				poster: r.posterUrl ?? ''
			}));
		}, 300);
	}

	function addFavorite(item: Titled) {
		if (favorites.length >= 8 || favorites.some((one) => one.key === item.key)) return;
		favorites = [...favorites, item];
		search = '';
		found = [];
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		const response = await fetch('/api/online/c/profile', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				bio,
				color: pickedColor,
				favorites,
				nameStyle: nameDraft,
				// (Left out when it didn't change, so the picture isn't sent again.)
				...(newBanner ? { banner: newBanner } : bannerRemoved ? { banner: '' } : {})
			})
		}).catch(() => null);
		saving = false;
		if (response?.ok) {
			await invalidateAll();
			editing = false;
			note = '';
		} else {
			const answer = await response?.json().catch(() => null);
			note = answer?.error ? `${t("Couldn't save it")}: ${answer.error}` : t("Couldn't save it");
		}
	}
</script>

<svelte:head><title>{person.name} · Catalog</title></svelte:head>

<BackBar href="/?cat=friends" label="Friends" />

<article class="profile" style:--profile={color}>
	<header>
		<div class="band" class:picture={Boolean(bannerShown)} style:background-image={bannerShown ? `url('${bannerShown}')` : null} aria-hidden="true"></div>
		<div class="who">
			<Avatar id={person.id} name={person.name} rev={person.avatar} size={112} />
			<div class="names">
				<h1><StyledName name={person.name} {look} /></h1>
				{#if person.realName}<p class="faint real-name">{person.realName}</p>{/if}
				<p class="faint">
					{t('Joined Catalog')} {monthYear(person.joined)}
					{#if person.friendsSince} · {t('Friends since')} {monthYear(person.friendsSince)}{/if}
					{#if person.mutual} · {person.mutual} {person.mutual === 1 ? t('friend in common') : t('friends in common')}{/if}
				</p>
				{#if person.watching}
					<p class="now"><span class="dot" aria-hidden="true"></span>{t('Watching')} <strong>{label(person.watching)}</strong></p>
				{/if}
			</div>
		</div>
		<div class="row">
			{#if person.me}
				<button type="button" class="btn btn-primary" onclick={startEditing}>{t('Edit profile')}</button>
			{:else}
				{#if person.watching?.room}<button type="button" class="btn btn-primary" onclick={watchAlong}>{t('Watch along')}</button>{/if}
				<button type="button" class="btn" onclick={() => openChat({ id: person.id, name: person.name })}>{t('Whisper')}</button>
				<a class="btn" href="/messages?with={person.id}">{t('Messages')}</a>
			{/if}
			{#if !person.hidden}
				<a class="btn" href="/friends/{person.id}/library">{person.me ? t('My library as friends see it') : t('View their library')}</a>
			{/if}
			{#if !person.me}
				<button type="button" class="btn" onclick={startNickname}>{t('Nickname')}</button>
				<button type="button" class="btn btn-danger" onclick={() => (removing = true)}>{t('Remove friend')}</button>
			{/if}
		</div>
		{#if nicknaming}
			<form class="row" onsubmit={saveNickname}>
				<input type="text" bind:value={nickname} maxlength="30" placeholder={person.realName ?? person.name} aria-label="Nickname" autocomplete="off" />
				<button type="submit" class="btn btn-primary">{t('Save')}</button>
				<button type="button" class="btn" onclick={() => (nicknaming = false)}>{t('Cancel')}</button>
				<span class="faint small">{t('Only you see it.')}</span>
			</form>
		{/if}
		{#if removing}
			<div class="row">
				<span>{t('Remove')} {person.name}?</span>
				<button type="button" class="btn btn-danger" onclick={removeFriend}>{t('Remove')}</button>
				<button type="button" class="btn" onclick={() => (removing = false)}>{t('Cancel')}</button>
			</div>
		{/if}
	</header>

	{#if editing}
		<form class="edit" onsubmit={save}>
			<label>
				<span class="label">{t('About you')}</span>
				<textarea bind:value={bio} maxlength="300" rows="3" placeholder={t('A line or two friends see on your profile')}></textarea>
			</label>
			<div>
				<span class="label">{t('Banner')}</span>
				<div class="color">
					<button type="button" class="btn" onclick={() => bannerBox?.click()}>{bannerShown ? t('Change picture') : t('Choose a picture')}</button>
					{#if bannerShown}<button type="button" class="link" onclick={removeBanner}>{t('Use a color instead')}</button>{/if}
					<input bind:this={bannerBox} type="file" accept="image/*" hidden onchange={pickBanner} />
				</div>
				<p class="faint small hint">{t('Any picture, or a GIF up to 500 KB. Wide ones fit best.')}</p>
				{#if bannerNote}<p class="small hint">{bannerNote}</p>{/if}
			</div>
			<label class="color">
				<span class="label">{bannerShown ? t('Color (behind the picture)') : t('Color')}</span>
				<input type="color" value={pickedColor || '#e994c2'} oninput={(e) => (pickedColor = e.currentTarget.value)} />
				{#if pickedColor}<button type="button" class="link" onclick={() => (pickedColor = '')}>{t('Use the accent')}</button>{/if}
			</label>
			<div>
				<span class="label">{t('Name style')}</span>
				<div class="fonts" role="radiogroup" aria-label="Font">
					{#each FONTS as font (font.id)}
						<button
							type="button"
							class="font"
							class:on={nameDraft.font === font.id}
							role="radio"
							aria-checked={nameDraft.font === font.id}
							onclick={() => (nameDraft = { ...nameDraft, font: font.id })}
						>
							<StyledName name={person.name} look={{ ...nameDraft, font: font.id }} />
							<span class="faint font-label">{font.label}</span>
						</button>
					{/each}
				</div>
				<div class="effects" role="radiogroup" aria-label="Look">
					<button type="button" class="btn" class:btn-primary={!nameDraft.colors.length} onclick={() => (nameDraft = { ...nameDraft, effect: 'solid', colors: [] })}>{t('Plain')}</button>
					<button type="button" class="btn" class:btn-primary={nameDraft.colors.length > 0 && nameDraft.effect === 'solid'} onclick={() => setEffect('solid')}>{t('One color')}</button>
					<button type="button" class="btn" class:btn-primary={nameDraft.effect === 'gradient'} onclick={() => setEffect('gradient')}>{t('Gradient')}</button>
					<button type="button" class="btn" class:btn-primary={nameDraft.effect === 'glow'} onclick={() => setEffect('glow')}>{t('Glow')}</button>
				</div>
				{#if nameDraft.colors.length}
					<div class="color">
						<input type="color" aria-label="First color" value={nameDraft.colors[0]} oninput={(e) => setNameColor(0, e.currentTarget.value)} />
						{#if nameDraft.effect === 'gradient'}
							<input type="color" aria-label="Second color" value={nameDraft.colors[1] ?? nameDraft.colors[0]} oninput={(e) => setNameColor(1, e.currentTarget.value)} />
							<span class="swatches">
								{#each GRADIENTS as pair (pair.join())}
									<button
										type="button"
										class="swatch"
										style:background-image="linear-gradient(90deg, {pair[0]}, {pair[1]})"
										aria-label="Gradient {pair[0]} to {pair[1]}"
										onclick={() => (nameDraft = { ...nameDraft, colors: [...pair] })}
									></button>
								{/each}
							</span>
						{/if}
					</div>
				{/if}
			</div>
			<div>
				<span class="label">{t('Favorites')} ({favorites.length}/8)</span>
				<ul class="picked">
					{#each favorites as item (item.key)}
						<li>
							{#if item.poster}<img src={item.poster} alt="" />{/if}
							<span>{item.title} <span class="faint">{item.year}</span></span>
							<button type="button" class="link" onclick={() => (favorites = favorites.filter((one) => one.key !== item.key))}>{t('Remove')}</button>
						</li>
					{/each}
				</ul>
				{#if favorites.length < 8}
					<input type="search" value={search} oninput={(e) => lookFor(e.currentTarget.value)} placeholder={t('Find a film or show to add')} aria-label="Find a favorite" />
					{#if found.length}
						<ul class="found">
							{#each found as item (item.key)}
								<li><button type="button" class="link plain" onclick={() => addFavorite(item)}>{item.title} <span class="faint">{item.year}</span></button></li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
			<div class="row">
				<button type="submit" class="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save')}</button>
				<button type="button" class="btn" onclick={() => (editing = false)}>{t('Cancel')}</button>
			</div>
		</form>
	{:else if person.bio}
		<p class="bio">{person.bio}</p>
	{/if}

	{#if note}<p class="msg">{note}</p>{/if}

	{#if !person.hidden}<p class="counts">
		<span><strong class="tabular">{person.counts.total}</strong> {t('watched')}</span>
		<span><strong class="tabular">{person.counts.films}</strong> {t('films')}</span>
		<span><strong class="tabular">{person.counts.shows}</strong> {t('shows')}</span>
		<span><strong class="tabular">{person.counts.rated}</strong> {t('rated')}</span>
	</p>{/if}

	{#if person.favorites.length}
		<section>
			<h2 class="label">{t('Favorites')}</h2>
			<TitleShelf items={person.favorites} onadded={added} />
		</section>
	{/if}

	{#if person.top.length}
		<section>
			<h2 class="label">{t('Highest rated')}</h2>
			<TitleShelf items={person.top} onadded={added} />
		</section>
	{/if}

	{#if person.recent.length}
		<section>
			<h2 class="label">{t('Watched lately')}</h2>
			<TitleShelf items={person.recent} onadded={added} />
		</section>
	{/if}

	{#if person.watched?.length}
		<section>
			<h2 class="label">{t('Watched')}</h2>
			<TitleShelf items={person.watched} onadded={added} />
		</section>
	{/if}

	{#if person.hidden}
		<p class="faint">{person.name} {t('keeps their profile private.')}</p>
	{:else if !person.top.length && !person.recent.length && !person.favorites.length && !person.watched?.length}
		<p class="faint">{person.me ? t("Rate what you've watched and it shows here.") : t('Nothing to show yet.')}</p>
	{/if}

	{#if !person.me && theirFriends?.filter((one) => !one.me).length}
		<section>
			<h2 class="label">{t('Their friends')}</h2>
			<ul class="people">
				{#each theirFriends.filter((one) => !one.me) as other (other.id)}
					<li>
						<Avatar id={other.id} name={other.name} rev={other.avatar} size={36} />
						{#if other.friend}
							<a href="/friends/{other.id}">{other.name}</a>
						{:else}
							<span>{other.name}</span>
							{#if other.requested}
								<span class="faint small">{t('Asked')}</span>
							{:else}
								<button type="button" class="btn" onclick={() => ask(other)}>{other.asked ? t('Yes, be friends') : t('Ask to be friends')}</button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</article>

<style>
	.profile {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding-bottom: 40px;
	}

	header {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 20px 20px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	/* A strip of their color across the top, or their banner picture (Edit profile → Banner). */
	.band {
		height: 90px;
		margin: 0 -20px -56px;
		background: linear-gradient(120deg, var(--profile), color-mix(in srgb, var(--profile) 35%, var(--surface)));
	}

	.band.picture {
		height: clamp(140px, 22vw, 220px);
		background-color: var(--profile);
		background-size: cover;
		background-position: center;
	}

	.hint {
		margin-top: 6px;
	}

	/* Edit profile → Name style: each font's sample in that font. */
	.fonts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
		margin-bottom: 10px;
	}

	.font {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: 1.05rem;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
	}

	.font:hover {
		border-color: var(--rule-firm);
	}

	.font.on {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.font-label {
		font-size: 0.72rem;
	}

	.effects {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 10px;
	}

	.swatches {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.swatch {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: 50%;
		cursor: pointer;
	}

	.swatch:hover {
		border-color: var(--ink);
	}

	.who {
		display: flex;
		align-items: flex-end;
		gap: 18px;
		flex-wrap: wrap;
	}

	.who :global(.avatar) {
		border: 4px solid var(--surface);
		box-sizing: content-box;
	}

	.names {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding-bottom: 6px;
	}

	h1 {
		margin: 0;
		font-size: 1.9rem;
	}

	p {
		margin: 0;
	}

	.now {
		font-size: 0.95rem;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
		background: var(--good, #3c9);
	}

	.real-name {
		margin: -2px 0 2px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.bio {
		font-size: 1.02rem;
		white-space: pre-line;
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 22px;
		color: var(--ink-soft);
	}

	.counts strong {
		color: var(--ink);
		font-size: 1.15rem;
	}

	.label {
		display: block;
		margin: 0 0 10px;
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 22px;
	}

	.people li {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.edit textarea {
		width: 100%;
		resize: vertical;
	}

	.color {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.color .label {
		margin: 0;
	}

	.color input {
		width: 48px;
		height: 32px;
		padding: 2px;
	}

	.picked,
	.found {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 8px;
	}

	.picked li {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.picked img {
		width: 28px;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 3px;
	}

	.found {
		margin-top: 6px;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.link.plain {
		color: var(--ink);
		font-size: 0.92rem;
		text-decoration: none;
		text-align: left;
	}

	.link.plain:hover {
		color: var(--accent);
	}

	.small {
		font-size: 0.85rem;
	}
</style>
