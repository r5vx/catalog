export function calendarWeekStart(now = new Date()): number {
	const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
	return monday.getTime();
}
