/** One writer for both filesystem edits and synchronous canvas mutations. */
export class SessionOperations {
	private active = false;
	private synchronous = false;
	private readonly pending: Array<() => void> = [];

	run<T>(action: () => T | Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const start = (): void => {
				this.active = true;
				let result: T | Promise<T>;
				try {
					result = action();
				} catch (error) {
					reject(error);
					this.next();
					return;
				}
				Promise.resolve(result).then(
					(value) => {
						this.next();
						resolve(value);
					},
					(error: unknown) => {
						this.next();
						reject(error);
					},
				);
			};
			if (this.active) this.pending.push(start);
			else start();
		});
	}

	mutate(action: () => void): void {
		if (this.synchronous) {
			action();
			return;
		}
		const invoke = (): void => {
			this.synchronous = true;
			try {
				action();
			} finally {
				this.synchronous = false;
			}
		};
		if (this.active) void this.run(invoke).catch((error: unknown) => console.error("design edit failed", error));
		else invoke();
	}

	private next(): void {
		const next = this.pending.shift();
		if (next) next();
		else this.active = false;
	}
}
