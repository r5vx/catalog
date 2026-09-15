/**
 * Box office runs to ten digits. "$858,373,000" is a number you have to count
 * the commas on; "$858M" is one you read.
 */
export function money(amount: number | null | undefined): string | null {
	if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;

	if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
	if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
	if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;

	return `$${amount}`;
}
