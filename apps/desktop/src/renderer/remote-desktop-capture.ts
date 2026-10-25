/** One OS capture grant, with separate tracks for each transport route. */
export class RemoteDesktopCapture {
	private stream?: MediaStream;
	private pending?: Promise<MediaStream>;
	private leases = new Set<MediaStream>();
	private closed = false;
	private retain = false;

	constructor(private readonly request: () => Promise<MediaStream>) {}

	setRetained(retain: boolean): void {
		this.retain = retain;
		this.releaseIdle();
	}

	async acquire(): Promise<MediaStream> {
		if (this.closed) throw new Error("Screen capture was revoked");
		if (!this.stream?.getVideoTracks().some((track) => track.readyState === "live")) {
			this.pending ??= this.request();
			const pending = this.pending;
			try {
				const stream = await pending;
				if (this.closed) {
					stream.getTracks().forEach((track) => {
						track.stop();
					});
					throw new Error("Screen capture was revoked");
				}
				this.stream = stream;
			} finally {
				if (this.pending === pending) this.pending = undefined;
			}
		}
		const lease = this.stream.clone();
		this.leases.add(lease);
		return lease;
	}

	release(lease: MediaStream): void {
		lease.getTracks().forEach((track) => {
			track.stop();
		});
		this.leases.delete(lease);
		this.releaseIdle();
	}

	close(): void {
		this.closed = true;
		for (const lease of this.leases)
			lease.getTracks().forEach((track) => {
				track.stop();
			});
		this.leases.clear();
		this.stream?.getTracks().forEach((track) => {
			track.stop();
		});
		this.stream = undefined;
	}

	private releaseIdle(): void {
		if (this.retain || this.leases.size > 0) return;
		this.stream?.getTracks().forEach((track) => {
			track.stop();
		});
		this.stream = undefined;
	}
}
