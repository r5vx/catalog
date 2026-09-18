let _up = $state(true);
let _checked = false;

export const showbox = {
	get up() {
		return _up;
	},
	check() {
		if (_checked) return;
		_checked = true;
		fetch('/api/watch/health')
			.then((r) => (r.ok ? r.json() : { up: false }))
			.then((data) => {
				_up = data.up ?? false;
			})
			.catch(() => {
				_up = false;
			});
	}
};
