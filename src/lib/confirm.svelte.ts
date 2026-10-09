/**
 * Catalog's own "are you sure?" box, instead of the browser's plain confirm() popup.
 *
 *   if (await confirmAction({ title: 'Delete "Groceries" for good?', confirmLabel: 'Delete forever' })) …
 *   const name = await askText({ title: 'New tag', placeholder: 'Tag name' });  // null if cancelled
 *
 * The box itself is <ConfirmDialog />, placed once in the root layout.
 */
export type ConfirmOptions = {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
};

export type TextOptions = ConfirmOptions & { value?: string; placeholder?: string };

type Open = ConfirmOptions & {
	/** Present when the box asks for some text. */
	input?: { value: string; placeholder: string };
	answer: (yes: boolean) => void;
};

export const dialog = $state<{ open: Open | null }>({ open: null });

function show(open: Omit<Open, 'answer'>): Promise<Open | null> {
	// A second question replaces the first, which counts as "no".
	dialog.open?.answer(false);
	return new Promise((resolve) => {
		dialog.open = {
			...open,
			answer: (yes) => {
				// The live copy: what's been typed into the box lives there, not in `open`.
				const answered = dialog.open;
				dialog.open = null;
				resolve(yes ? answered : null);
			}
		};
	});
}

export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
	return (await show(options)) !== null;
}

/** The text typed, trimmed, or null if cancelled or left empty. */
export async function askText(options: TextOptions): Promise<string | null> {
	const { value = '', placeholder = '', ...rest } = options;
	const answered = await show({ confirmLabel: 'Save', ...rest, input: { value, placeholder } });
	return answered?.input?.value.trim() || null;
}
