<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { confirmAction } from '$lib/confirm.svelte';
	import { page } from '$app/state';
	import { wording } from '$lib/altText';
	import Profile from './Profile.svelte';

	/** A line in the alternate wording when it's on (Settings → Personalization → Code), else as it is. */
	const t = (text: string) => wording(page.data.altMode, text);

	/**
	 * Settings → Online (src/lib/server/online.ts): this computer joining the meeting point, who the
	 * profile looking at this page is there (and their other computers), what's shared, and, for the
	 * owner, the problem reports Catalogs sent by themselves.
	 */
	type Account = { id: string; name: string; google: boolean; email: string | null; avatar: number };
	type Status = {
		connected: boolean;
		joined: boolean;
		problem: string;
		account: Account | null;
		computers: number;
		google: boolean;
		switches: { reports: boolean; share: boolean; shared: boolean; along: boolean; autoJoin: boolean };
		sync: boolean;
		lastSync: { at: number; sent: number; got: number; error: string } | null;
		library: { on: boolean; last: LibraryRound | null; nameOnly: number };
		removals: boolean;
		computerName: string;
		owner: boolean;
	};
	type LibraryRound = { at: number; sent: number; taken: number; added: number; removed: number; skipped: number; left: number; longNotes: number; error: string };
	type LibraryPreview = { here: number; there: number; add: number; update: number; remove: number; send: number; nameOnly: number };
	type Report = { id: number; houseName: string; kind: string; title: string; body: string; created: number };

	let status = $state<Status | null>(null);
	let joinCode = $state('');
	let joinName = $state('');
	/** The name typed in the "pick a name" box (shown while this person is still called after the computer). */
	let newName = $state('');
	let naming = $state(false);
	let working = $state(false);
	let problem = $state('');
	let linkCode = $state('');
	let otherCode = $state('');
	let linkProblem = $state('');
	let reports = $state<Report[]>([]);
	let reportsProblem = $state('');
	let open = $state<number | null>(null);
	let openBody = $state('');
	let waitingForGoogle = $state(false);
	/** Before the library's first round: what it would do, with Go and Cancel. */
	let libraryAsk = $state<LibraryPreview | null>(null);
	let libraryProblem = $state('');
	let libraryLooking = $state(false);
	let googleTimer: ReturnType<typeof setInterval> | undefined;

	const post = (body: unknown) => fetch('/api/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const cloud = (path: string, method: string, body?: unknown) =>
		fetch(`/api/online/c/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({
			ok: r.ok,
			data: await r.json().catch(() => null)
		}));

	/** What this profile keeps from its friends (on the server; null until known). */
	let privacy = $state<{ hideProfile: boolean; hideFriends: boolean } | null>(null);

	async function load() {
		status = await fetch('/api/online')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (status?.owner) loadReports();
		if (status?.connected && status.account?.id) {
			const mine = await cloud(`people/${status.account.id}/profile`, 'GET');
			privacy = mine.ok ? (mine.data?.privacy ?? { hideProfile: false, hideFriends: false }) : null;
		}
	}

	async function setPrivacy(which: 'hideProfile' | 'hideFriends', on: boolean) {
		if (!privacy) return;
		privacy = { ...privacy, [which]: on };
		await cloud('privacy', 'PUT', privacy);
	}

	onMount(load);
	onDestroy(() => clearInterval(googleTimer));

	async function connect(event: SubmitEvent) {
		event.preventDefault();
		working = true;
		problem = '';
		const answer = await post({ action: 'connect', join: joinCode, name: joinName }).catch(() => null);
		working = false;
		if (!answer?.ok) {
			const said = await answer?.json().catch(() => null);
			problem = said?.message ?? "The server couldn't be reached";
			return;
		}
		joinCode = '';
		await load();
	}

	/** Back from "offline for now": the same computer and people, no join code needed. */
	async function comeBack() {
		working = true;
		problem = '';
		const answer = await post({ action: 'connect', join: '' }).catch(() => null);
		working = false;
		if (!answer?.ok) problem = "Couldn't go back online";
		await load();
	}

	async function leave() {
		const yes = await confirmAction({
			title: 'Go offline?',
			message: 'Friends and syncing stop until you go back online. Nothing is lost.',
			confirmLabel: 'Go offline'
		});
		if (!yes) return;
		await post({ action: 'disconnect' });
		await load();
	}


	async function setSwitch(which: 'reports' | 'share' | 'shared' | 'along' | 'autoJoin', on: boolean) {
		if (!status) return;
		status.switches[which] = on;
		await post({ action: 'switches', ...status.switches });
	}

	async function setSync(on: boolean) {
		if (!status) return;
		status.sync = on;
		await post({ action: 'sync', on });
		setTimeout(load, 4000);
	}

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		naming = true;
		await cloud('me', 'PUT', { name: newName.trim() });
		naming = false;
		newName = '';
		await load();
	}

	async function setRemovals(on: boolean) {
		if (!status) return;
		status.removals = on;
		await post({ action: 'removals', on });
	}

	async function syncNow() {
		working = true;
		await post({ action: 'syncNow' }).catch(() => null);
		working = false;
		await load();
	}

	/** Ticking the library switch first shows what would happen; Go turns it on. */
	async function askLibrary(on: boolean) {
		if (!status) return;
		libraryProblem = '';
		if (!on) {
			libraryAsk = null;
			status.library.on = false;
			await post({ action: 'library', on: false });
			return;
		}
		libraryLooking = true;
		const answer = await post({ action: 'libraryPreview' })
			.then((r) => r.json())
			.catch(() => null);
		libraryLooking = false;
		if (!answer?.preview) {
			libraryProblem = answer?.error || "The server couldn't be reached";
			return;
		}
		libraryAsk = answer.preview;
	}

	async function startLibrary() {
		if (!status) return;
		libraryAsk = null;
		status.library.on = true;
		working = true;
		await post({ action: 'library', on: true }).catch(() => null);
		working = false;
		await load();
	}

	async function libraryNow() {
		working = true;
		await post({ action: 'libraryNow' }).catch(() => null);
		working = false;
		await load();
	}

	async function showLinkCode() {
		const answer = await cloud('link/code', 'POST', {});
		linkCode = answer.data?.code ?? '';
		linkProblem = answer.ok ? '' : (answer.data?.error ?? "Couldn't make a code");
	}

	async function useOtherCode(event: SubmitEvent) {
		event.preventDefault();
		linkProblem = '';
		const answer = await cloud('link/join', 'POST', { code: otherCode });
		if (!answer.ok) {
			linkProblem = answer.data?.error ?? "That code didn't work";
			return;
		}
		otherCode = '';
		await load();
	}

	/** Google's page opens in the computer's own browser; this page looks for the sign-in every few seconds. */
	async function google() {
		const answer = await cloud('google/start', 'POST', {});
		if (!answer.ok || !answer.data?.url) {
			linkProblem = answer.data?.error ?? "Google sign-in couldn't start";
			return;
		}
		window.open(answer.data.url, '_blank', 'noopener');
		waitingForGoogle = true;
		let tries = 0;
		clearInterval(googleTimer);
		googleTimer = setInterval(async () => {
			await load();
			if (status?.account?.google || ++tries > 60) {
				clearInterval(googleTimer);
				waitingForGoogle = false;
			}
		}, 4000);
	}

	async function signOut() {
		const yes = await confirmAction({
			title: 'Sign out?',
			message: 'This profile goes back to having no friends or synced progress here. Your account keeps everything.',
			confirmLabel: 'Sign out'
		});
		if (!yes) return;
		await cloud('signout', 'POST', {});
		await post({ action: 'sync', on: false });
		await post({ action: 'library', on: false });
		await load();
	}

	async function forgetOwnerKey() {
		await post({ action: 'owner', key: '' });
		reports = [];
		await load();
	}

	async function loadReports() {
		const answer = await fetch('/api/online/reports')
			.then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
			.catch(() => null);
		reportsProblem = answer?.ok ? '' : (answer?.data?.error ?? "The reports couldn't be read");
		reports = answer?.ok ? (answer.data.reports ?? []) : [];
	}

	async function openReport(report: Report) {
		if (open === report.id) {
			open = null;
			return;
		}
		open = report.id;
		openBody = 'Loading…';
		const full = await fetch(`/api/online/reports?id=${report.id}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		let text = full?.body ?? report.body;
		try {
			text = JSON.stringify(JSON.parse(text), null, 2);
		} catch {}
		openBody = text;
	}

	async function deleteReport(report: Report) {
		await fetch(`/api/online/reports?id=${report.id}`, { method: 'DELETE' }).catch(() => null);
		reports = reports.filter((r) => r.id !== report.id);
	}

	const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const kindName: Record<string, string> = { stop: 'Stopped to load', subtitles: "Subtitles didn't match" };
</script>

<svelte:head><title>Online · Catalog</title></svelte:head>

{#if !status}
	<p class="muted">Loading…</p>
{:else if !status.connected && status.joined}
	<section>
		<h2>Offline for now</h2>
		<p class="muted">Nothing is sent while offline. Your friends are kept.</p>
		<div><button type="button" class="btn btn-primary" onclick={comeBack} disabled={working}>{working ? 'Connecting…' : 'Go back online'}</button></div>
		{#if problem}<p class="msg bad">{problem}</p>{/if}
	</section>
{:else if !status.connected}
	<section>
		<h2>Catalog online</h2>
		<p class="muted">Friends, watching together, and your progress on every computer. No video or settings go online.</p>
		<form onsubmit={connect}>
			<label for="joinName">{t('Your name')}</label>
			<input id="joinName" type="text" bind:value={joinName} maxlength="30" autocomplete="off" placeholder={t('What friends will call you')} />
			<label for="join">{t('Join code')}</label>
			<div class="row">
				<input id="join" type="text" bind:value={joinCode} placeholder="XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false" />
				<button type="submit" class="btn btn-primary" disabled={working || !joinCode.trim() || !joinName.trim()}>{working ? 'Connecting…' : 'Connect'}</button>
			</div>
		</form>
		{#if problem}<p class="msg bad">{problem}</p>{/if}
	</section>
{:else}
	{#if status.problem}<p class="msg bad">{status.problem}</p>{/if}

	{#if status.account && status.account.name === status.computerName}
		<!-- Still called after the computer (joined before a name was asked for): asked here. -->
		<section class="ask">
			<h2>{t('Pick a name')}</h2>
			<p class="muted">{t('Friends see this profile as')} <strong>{status.account.name}</strong>, {t("the computer's name.")}</p>
			<form onsubmit={saveName} class="row">
				<input type="text" bind:value={newName} maxlength="30" autocomplete="off" placeholder={t('What friends will call you')} aria-label="Name" />
				<button type="submit" class="btn btn-primary" disabled={naming || !newName.trim()}>{t('Save')}</button>
			</form>
		</section>
	{/if}

	<section>
		<h2>You</h2>
		<p class="muted">Online as <strong>{status.account?.name ?? ''}</strong>.</p>
		{#if status.account?.google}
			<p class="muted">Signed in with Google as <strong>{status.account.email}</strong>.</p>
		{/if}
		{#if status.computers > 1}<p class="muted">On {status.computers} computers.</p>{/if}
	</section>

	<!-- Name and picture (was its own page, Profile, until 2026-11-14). -->
	<Profile />

	<section>
		<h2>Your other computers</h2>
		{#if status.google && !status.account?.google}
			<div><button type="button" class="btn btn-primary" onclick={google} disabled={waitingForGoogle}>{waitingForGoogle ? 'Waiting for Google…' : 'Sign in with Google'}</button></div>
		{/if}
		<div class="row">
			<button type="button" class="btn" onclick={showLinkCode}>Show a code for another computer</button>
			{#if linkCode}<strong class="code tabular">{linkCode}</strong><span class="faint">15 minutes</span>{/if}
		</div>
		<form onsubmit={useOtherCode}>
			<label for="other">Code from another computer</label>
			<div class="row">
				<input id="other" type="text" bind:value={otherCode} autocomplete="off" spellcheck="false" maxlength="12" />
				<button type="submit" class="btn" disabled={!otherCode.trim()}>Join</button>
			</div>
		</form>
		{#if linkProblem}<p class="msg bad">{linkProblem}</p>{/if}
		<label class="toggle">
			<input type="checkbox" checked={status.sync} onchange={(e) => setSync(e.currentTarget.checked)} />
			{t('Sync Continue Watching across my computers')}
		</label>
		{#if status.sync}
			<p class="faint small">
				{#if status.lastSync?.error}{status.lastSync.error}
				{:else if status.lastSync}Last at {when(status.lastSync.at)}: {status.lastSync.sent} sent, {status.lastSync.got} taken.
				{:else}Every two minutes.{/if}
				<button type="button" class="link" onclick={syncNow} disabled={working}>Now</button>
			</p>
		{/if}
		<label class="toggle">
			<input type="checkbox" checked={status.library.on || libraryAsk !== null} disabled={libraryLooking} onchange={(e) => askLibrary(e.currentTarget.checked)} />
			{t('Sync my library across my computers')}
		</label>
		{#if status.library.on}
			<label class="toggle">
				<input type="checkbox" checked={status.removals} onchange={(e) => setRemovals(e.currentTarget.checked)} />
				{t('Remove titles here when I remove them on another computer')}
			</label>
		{/if}
		{#if libraryLooking}<p class="faint small">Looking…</p>{/if}
		{#if libraryProblem}<p class="msg bad">{libraryProblem}</p>{/if}
		{#if libraryAsk}
			<div class="ask">
				<p>
					<strong class="tabular">{libraryAsk.here}</strong> titles here, <strong class="tabular">{libraryAsk.there}</strong> on your other computers.
				</p>
				<ul>
					<li><span class="tabular">{libraryAsk.add}</span> added here</li>
					<li><span class="tabular">{libraryAsk.update}</span> updated here (changed there more recently)</li>
					{#if libraryAsk.remove}<li><span class="tabular">{libraryAsk.remove}</span> removed here (removed there)</li>{/if}
					<li><span class="tabular">{libraryAsk.send}</span> sent to your other computers</li>
				</ul>
				{#if libraryAsk.nameOnly}<p class="faint small">{libraryAsk.nameOnly === 1 ? '1 title typed in by name, with no TMDB or AniList match, stays' : `${libraryAsk.nameOnly} titles typed in by name, with no TMDB or AniList match, stay`} on this computer only.</p>{/if}
				<p class="faint small">A copy of this library is saved in its backups folder first.</p>
				<div class="row">
					<button type="button" class="btn btn-primary" onclick={startLibrary}>Go</button>
					<button type="button" class="btn" onclick={() => (libraryAsk = null)}>Cancel</button>
				</div>
			</div>
		{/if}
		{#if status.library.on}
			<p class="faint small">
				{#if status.library.last?.error}{status.library.last.error}
				{:else if status.library.last}Last at {when(status.library.last.at)}: {status.library.last.sent} sent, {status.library.last.taken} updated here, {status.library.last.added} added here{status.library.last.removed ? `, ${status.library.last.removed} removed here` : ''}{status.library.last.left ? `, ${status.library.last.left} still to come` : ''}.
				{:else}Every two minutes.{/if}
				<button type="button" class="link" onclick={libraryNow} disabled={working}>Now</button>
			</p>
			{#if status.library.last?.longNotes}<p class="faint small">{status.library.last.longNotes === 1 ? '1 review is too long to send and stays' : `${status.library.last.longNotes} reviews are too long to send and stay`} on this computer.</p>{/if}
			{#if status.library.nameOnly}<p class="faint small">{status.library.nameOnly === 1 ? '1 title typed in by name stays' : `${status.library.nameOnly} titles typed in by name stay`} on this computer only.</p>{/if}
		{/if}
		<div><button type="button" class="btn" onclick={signOut}>Sign out</button></div>
	</section>

	<section>
		<h2>Sharing</h2>
		<label class="toggle">
			<input type="checkbox" checked={status.switches.reports} onchange={(e) => setSwitch('reports', e.currentTarget.checked)} />
			Send problem reports
		</label>
		<label class="toggle">
			<input type="checkbox" checked={status.switches.share} onchange={(e) => setSwitch('share', e.currentTarget.checked)} />
			Show friends what I'm watching
		</label>
		<label class="toggle">
			<input type="checkbox" checked={status.switches.along} onchange={(e) => setSwitch('along', e.currentTarget.checked)} />
			Let friends watch along
		</label>
		<label class="toggle">
			<input type="checkbox" checked={status.switches.autoJoin} onchange={(e) => setSwitch('autoJoin', e.currentTarget.checked)} />
			{t('Play what others start in a watch-together room')}
		</label>
		<label class="toggle">
			<input type="checkbox" checked={status.switches.shared} onchange={(e) => setSwitch('shared', e.currentTarget.checked)} />
			Share Skip Intro and credits times
		</label>
		{#if privacy}
			<label class="toggle">
				<input type="checkbox" checked={privacy.hideProfile} onchange={(e) => setPrivacy('hideProfile', e.currentTarget.checked)} />
				{t('Keep my profile private')}
			</label>
			<label class="toggle">
				<input type="checkbox" checked={privacy.hideFriends} onchange={(e) => setPrivacy('hideFriends', e.currentTarget.checked)} />
				{t('Keep my friends list private')}
			</label>
		{/if}
	</section>

	<!-- Only where the owner's key is kept. It's typed in the Friends panel's friend's-code box: no box here, so nobody else sees there's a key. -->
	{#if status.owner}
		<section>
			<h2>Problem reports</h2>
			{#if reportsProblem}<p class="msg bad">{reportsProblem}</p>{/if}
			{#if !reports.length && !reportsProblem}<p class="muted">None.</p>{/if}
			<ul class="reports">
				{#each reports as report (report.id)}
					<li>
						<button type="button" class="report" onclick={() => openReport(report)}>
							<strong>{report.title || 'A video'}</strong>
							<span class="faint">{kindName[report.kind] ?? report.kind} · {report.houseName || 'a computer'} · {when(report.created)}</span>
						</button>
						<button type="button" class="link" onclick={() => deleteReport(report)}>Delete</button>
						{#if open === report.id}<pre>{openBody}</pre>{/if}
					</li>
				{/each}
			</ul>
			<div class="row">
				<button type="button" class="btn" onclick={loadReports}>Look again</button>
				<button type="button" class="btn" onclick={forgetOwnerKey}>Forget the owner's key</button>
			</div>
		</section>
	{/if}

	<section>
		<div><button type="button" class="btn" onclick={leave}>Go offline</button></div>
	</section>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 28px;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	p {
		margin: 0;
		max-width: 62ch;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label {
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.row input {
		width: min(100%, 20rem);
	}

	.code {
		font-size: 1.4rem;
		letter-spacing: 0.08em;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.toggle input {
		width: auto;
	}

	.small {
		font-size: 0.85rem;
		margin-top: -6px;
	}

	.ask {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		max-width: 62ch;
	}

	.ask ul {
		margin: 0;
		padding-left: 1.2rem;
		font-size: 0.92rem;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.reports {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.reports li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.report {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.report span {
		font-size: 0.85rem;
	}

	pre {
		flex-basis: 100%;
		margin: 0;
		max-height: 24rem;
		overflow: auto;
		padding: 10px;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 0.78rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
