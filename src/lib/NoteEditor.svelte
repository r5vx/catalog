<script lang="ts">
	import { untrack } from 'svelte';

	type Props = {
		initialTitle: string;
		initialBody: string;
		onsave: (title: string, body: string) => Promise<void>;
	};

	let { initialTitle, initialBody, onsave }: Props = $props();

	let title = $state(untrack(() => initialTitle));
	let editor = $state<HTMLDivElement | null>(null);
	let status = $state('');
	let uploading = $state(false);

	let timer: ReturnType<typeof setTimeout>;

	function queueSave() {
		status = 'Unsaved';
		clearTimeout(timer);
		timer = setTimeout(save, 900);
	}

	async function save() {
		clearTimeout(timer);
		status = 'Saving…';
		try {
			await onsave(title, editor?.innerHTML ?? '');
			status = 'Saved';
		} catch {
			status = "Couldn't save";
		}
	}

	/**
	 * execCommand is officially deprecated, but it is still the only thing every
	 * browser implements for rich text in a contenteditable, and it handles
	 * selections and undo correctly. The replacement isn't finished anywhere.
	 */
	function run(command: string, value?: string) {
		editor?.focus();
		document.execCommand(command, false, value);
		queueSave();
	}

	async function upload(file: File) {
		uploading = true;
		status = 'Adding image…';
		try {
			const form = new FormData();
			form.append('file', file);

			const response = await fetch('/api/media', { method: 'POST', body: form });
			if (!response.ok) {
				status = 'Image failed';
				return;
			}

			const { url } = await response.json();
			run('insertHTML', `<img src="${url}" alt="" />`);
		} finally {
			uploading = false;
		}
	}

	function onPaste(event: ClipboardEvent) {
		const image = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));

		if (image) {
			const file = image.getAsFile();
			if (file) {
				event.preventDefault();
				upload(file);
			}
			return;
		}

		// Paste text without dragging along the source page's styling.
		const text = event.clipboardData?.getData('text/plain');
		if (text !== undefined) {
			event.preventDefault();
			document.execCommand('insertText', false, text);
			queueSave();
		}
	}

	function onDrop(event: DragEvent) {
		const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
		if (!file) return;

		event.preventDefault();
		upload(file);
	}

	function onKey(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			save();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
	<input
		class="title"
		bind:value={title}
		oninput={queueSave}
		onblur={save}
		placeholder="Untitled"
		aria-label="Page title"
	/>

	<div class="toolbar" role="toolbar" aria-label="Formatting">
		<button type="button" title="Bold" onclick={() => run('bold')}><b>B</b></button>
		<button type="button" title="Italic" onclick={() => run('italic')}><i>I</i></button>
		<button type="button" title="Underline" onclick={() => run('underline')}><u>U</u></button>
		<button type="button" title="Strikethrough" onclick={() => run('strikeThrough')}>
			<s>S</s>
		</button>

		<span class="sep" aria-hidden="true"></span>

		<button type="button" title="Large heading" onclick={() => run('formatBlock', 'h2')}>H1</button>
		<button type="button" title="Small heading" onclick={() => run('formatBlock', 'h3')}>H2</button>
		<button type="button" title="Normal text" onclick={() => run('formatBlock', 'p')}>¶</button>

		<span class="sep" aria-hidden="true"></span>

		<button type="button" title="Bulleted list" onclick={() => run('insertUnorderedList')}>•</button>
		<button type="button" title="Numbered list" onclick={() => run('insertOrderedList')}>1.</button>
		<button type="button" title="Quote" onclick={() => run('formatBlock', 'blockquote')}>❝</button>
		<button type="button" title="Divider" onclick={() => run('insertHorizontalRule')}>―</button>

		<span class="sep" aria-hidden="true"></span>

		<label class="image-btn" title="Add an image">
			{uploading ? '…' : '🖼'}
			<input
				type="file"
				accept="image/*"
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) upload(file);
					e.currentTarget.value = '';
				}}
			/>
		</label>

		<button type="button" title="Clear formatting" onclick={() => run('removeFormat')}>⌫</button>

		<span class="status faint" aria-live="polite">{status}</span>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="page"
		bind:this={editor}
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		aria-label="Page contents"
		oninput={queueSave}
		onblur={save}
		onpaste={onPaste}
		ondrop={onDrop}
		ondragover={(e) => e.preventDefault()}
	>
		{@html initialBody}
	</div>

	<p class="hint faint">
		Paste or drop images straight in. Saves as you type; Ctrl+S saves now.
	</p>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.title {
		font-family: var(--display);
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 600;
		background: none;
		border: none;
		padding: 0;
		width: 100%;
		color: var(--ink);
	}

	.title:focus {
		outline: none;
		box-shadow: none;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		position: sticky;
		top: 0;
		z-index: 2;
	}

	.toolbar button,
	.image-btn {
		min-width: 30px;
		height: 30px;
		padding: 0 7px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid transparent;
		border-radius: 3px;
		color: var(--ink-soft);
		font-size: 0.86rem;
		cursor: pointer;
	}

	.toolbar button:hover,
	.image-btn:hover {
		background: var(--surface-2);
		border-color: var(--rule-firm);
		color: var(--ink);
	}

	.image-btn input {
		display: none;
	}

	.sep {
		width: 1px;
		height: 18px;
		background: var(--rule);
		margin: 0 4px;
	}

	.status {
		margin-left: auto;
		font-size: 0.75rem;
		padding-right: 4px;
		min-width: 60px;
		text-align: right;
	}

	.page {
		min-height: 55vh;
		padding: 20px 22px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		line-height: 1.7;
		overflow-wrap: anywhere;
	}

	.page:focus {
		outline: none;
		border-color: var(--rule-firm);
	}

	/* The editor writes plain tags, so they're styled here rather than inline. */
	.page :global(h2) {
		font-size: 1.4rem;
		margin: 1.2em 0 0.4em;
	}
	.page :global(h3) {
		font-size: 1.15rem;
		margin: 1.1em 0 0.35em;
	}
	.page :global(p) {
		margin: 0 0 0.7em;
	}
	.page :global(ul),
	.page :global(ol) {
		margin: 0 0 0.7em;
		padding-left: 1.5em;
	}
	.page :global(li) {
		margin-bottom: 0.25em;
	}
	.page :global(blockquote) {
		margin: 0.8em 0;
		padding-left: 14px;
		border-left: 3px solid var(--accent);
		color: var(--ink-soft);
	}
	.page :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
		margin: 0.5em 0;
		display: block;
	}
	.page :global(hr) {
		border: none;
		border-top: 1px solid var(--rule-firm);
		margin: 1.2em 0;
	}
	.page :global(a) {
		color: var(--accent);
		text-decoration: underline;
	}
	.page :global(code) {
		font-family: var(--mono);
		font-size: 0.88em;
		background: var(--sunk);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
	.page :global(table) {
		border-collapse: collapse;
		margin: 0.6em 0;
	}
	.page :global(td),
	.page :global(th) {
		border: 1px solid var(--rule);
		padding: 5px 9px;
	}

	.hint {
		font-size: 0.78rem;
		margin: 0;
	}
</style>
