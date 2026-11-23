<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import BackBar from '$lib/BackBar.svelte';
	import { wording } from '$lib/altText';
	import { chat, sendMessage, markRead, type Message } from '$lib/chat.svelte';

	/**
	 * Whispers with each friend (owner, 2026-11-15: "a messages page so you can view your whispers
	 * or send a message from there"): friends down the side, newest conversation first with what's
	 * unread, and the conversation with the one picked. New whispers come in by themselves
	 * (src/lib/chat.svelte.ts). The same whispers show in the corner wherever you are.
	 */
	const t = (text: string) => wording(page.data.altMode, text);

	type Thread = { id: string; name: string; avatar: number; unread: number; last: { text: string; at: number; mine: boolean } | null };

	let threads = $state<Thread[]>([]);
	let loaded = $state(false);
	let online = $state(true);
	let messages = $state<Message[]>([]);
	let more = $state(false);
	let typed = $state('');
	/** Each conversation keeps its own unsent text. */
	const drafts: Record<string, string> = {};
	let draftFor = '';
	let problem = $state('');
	let listEl = $state<HTMLUListElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	const withId = $derived(page.url.searchParams.get('with') ?? '');
	const picked = $derived(threads.find((one) => one.id === withId) ?? null);

	async function loadThreads() {
		const response = await fetch('/api/online/c/messages/threads').catch(() => null);
		loaded = true;
		if (!response?.ok) {
			const said = await response?.json().catch(() => null);
			if (/isn't online/.test(said?.error ?? '')) online = false;
			return;
		}
		const answer = await response.json();
		threads = answer.threads ?? [];
		chat.unread = answer.unread ?? chat.unread;
	}

	async function loadConversation(id: string, before = 0) {
		if (!id) return;
		const answer = await fetch(`/api/online/c/messages/with/${id}${before ? `?before=${before}` : ''}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!answer || id !== withId) return;
		messages = before ? [...answer.messages, ...messages] : answer.messages;
		more = answer.more;
		if (!before) {
			await tick();
			if (listEl) listEl.scrollTop = listEl.scrollHeight;
			const newest = [...messages].reverse().find((m) => m.from === id);
			if (newest) {
				await markRead(id, newest.id);
				threads = threads.map((one) => (one.id === id ? { ...one, unread: 0 } : one));
			}
		}
	}

	onMount(() => {
		void loadThreads();
	});

	// The friend picked: their conversation.
	$effect(() => {
		const id = withId;
		untrack(() => {
			if (draftFor) drafts[draftFor] = typed;
			typed = drafts[id] ?? '';
			draftFor = id;
		});
		messages = [];
		void loadConversation(id);
		void tick().then(() => inputEl?.focus());
	});

	// A whisper came in (the corner heard it): the list and, when it's theirs, the conversation.
	$effect(() => {
		if (!chat.heard) return;
		void loadThreads();
		const id = withId;
		if (id) void loadConversation(id);
	});

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!typed.trim() || !withId) return;
		const id = withId;
		const text = typed;
		const sent = await sendMessage(text, { friend: id });
		if (!sent) {
			if (withId === id) problem = t("Couldn't send it");
			return;
		}
		threads = threads
			.map((one) => (one.id === id ? { ...one, last: { text: sent.text, at: sent.at, mine: true } } : one))
			.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
		if (withId !== id) {
			if (drafts[id] === text) delete drafts[id];
			return;
		}
		problem = '';
		if (typed === text) typed = '';
		messages = [...messages, sent];
		await tick();
		if (withId === id && listEl) listEl.scrollTop = listEl.scrollHeight;
	}

	function when(at: number): string {
		const date = new Date(at);
		const today = new Date().toDateString() === date.toDateString();
		return today ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>Messages · Catalog</title></svelte:head>

<BackBar href="/?cat=friends" label="Friends" />

<h1>{t('Messages')}</h1>

{#if !online}
	<p class="faint">{t('Messages need Catalog online:')} <a href="/settings/online">{t('Settings')} → Online</a>.</p>
{:else if loaded && !threads.length}
	<p class="faint">{t('No friends yet. Add one from the Friends page.')}</p>
{:else}
	<div class="messages" class:picked={Boolean(withId)}>
		<ul class="threads">
			{#each threads as thread (thread.id)}
				<li>
					<button type="button" class:on={thread.id === withId} onclick={() => goto(`/messages?with=${thread.id}`, { replaceState: true, noScroll: true, keepFocus: true })}>
						<Avatar id={thread.id} name={thread.name} rev={thread.avatar} size={36} />
						<span class="about">
							<span class="name">{thread.name}</span>
							<span class="last faint">{thread.last ? `${thread.last.mine ? `${t('You')}: ` : ''}${thread.last.text}` : t('Say hello')}</span>
						</span>
						{#if thread.unread}<span class="badge">{thread.unread}</span>{:else if thread.last}<span class="faint small">{when(thread.last.at)}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>

		<section class="talk">
			{#if picked}
				<header>
					<Avatar id={picked.id} name={picked.name} rev={picked.avatar} size={32} />
					<a class="name" href="/friends/{picked.id}">{picked.name}</a>
					<button type="button" class="btn small-btn back" onclick={() => goto('/messages', { replaceState: true })}>{t('All messages')}</button>
				</header>
				<ul class="lines" bind:this={listEl}>
					{#if more}<li class="older"><button type="button" class="link" onclick={() => loadConversation(withId, messages[0]?.id ?? 0)}>{t('Older messages')}</button></li>{/if}
					{#each messages as message (message.id)}
						<li class:mine={message.from !== picked.id}>
							<span class="bubble" data-plain>{message.text}</span>
							<span class="faint small">{when(message.at)}</span>
						</li>
					{:else}
						<li class="faint">{t('Nothing yet. Whispers also show in the corner of their screen, even while they watch.')}</li>
					{/each}
				</ul>
				<form onsubmit={send}>
					<input bind:this={inputEl} bind:value={typed} type="text" maxlength="500" autocomplete="off" placeholder="{t('Message')} {picked.name}" aria-label="Message" />
					<button type="submit" class="btn btn-primary" disabled={!typed.trim()}>{t('Send')}</button>
				</form>
				{#if problem}<p class="msg bad">{problem}</p>{/if}
			{:else}
				<p class="faint pick">{t('Pick a friend to see your messages with them.')}</p>
			{/if}
		</section>
	</div>
{/if}

<style>
	h1 {
		margin: 8px 0 16px;
	}

	.messages {
		display: grid;
		grid-template-columns: minmax(220px, 300px) 1fr;
		gap: 16px;
		min-height: 420px;
		margin-bottom: 40px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.threads {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.threads button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.threads button:hover {
		background: var(--surface);
	}

	.threads button.on {
		border-color: var(--rule);
		background: var(--surface);
	}

	.about {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.name {
		font-weight: 600;
	}

	.last {
		font-size: 0.82rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge {
		min-width: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 20px;
		text-align: center;
	}

	.talk {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		min-width: 0;
	}

	.talk header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.talk header .name {
		color: var(--ink);
		text-decoration: none;
	}

	.back {
		display: none;
		margin-left: auto;
	}

	.lines {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 60vh;
		min-height: 260px;
		overflow-y: auto;
		padding: 6px 2px;
	}

	.lines li {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}

	.lines li.mine {
		align-items: flex-end;
	}

	.bubble {
		max-width: min(520px, 85%);
		padding: 7px 12px;
		border-radius: 14px;
		background: var(--sunk);
		overflow-wrap: anywhere;
	}

	.mine .bubble {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.older {
		align-items: center !important;
	}

	form {
		display: flex;
		gap: 8px;
	}

	form input {
		flex: 1;
		min-width: 0;
	}

	.pick {
		margin: auto;
	}

	.small {
		font-size: 0.78rem;
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

	/* A phone: the list, or one conversation, not both. */
	@media (max-width: 720px) {
		.messages {
			grid-template-columns: 1fr;
		}

		.messages.picked .threads,
		.messages:not(.picked) .talk {
			display: none;
		}

		.back {
			display: inline-flex;
		}
	}
</style>
