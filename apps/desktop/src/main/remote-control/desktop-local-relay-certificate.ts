import { X509Certificate } from "node:crypto";
import { generate } from "selfsigned";

export interface DesktopLocalRelayCertificate {
	readonly certificate: string;
	readonly privateKey: string;
	readonly fingerprint: string;
}

export async function createDesktopLocalRelayCertificate(ipAddress: string): Promise<DesktopLocalRelayCertificate> {
	const generated = await generate([{ name: "commonName", value: "567 Agent Local Relay" }], {
		algorithm: "sha256",
		keySize: 2048,
		notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
		extensions: [
			{ name: "basicConstraints", cA: false },
			{ name: "keyUsage", digitalSignature: true, keyEncipherment: true },
			{ name: "extKeyUsage", serverAuth: true },
			{
				name: "subjectAltName",
				altNames: [
					{ type: 2, value: "localhost" },
					{ type: 7, ip: ipAddress },
				],
			},
		],
	});
	const certificate = new X509Certificate(generated.cert);
	return {
		certificate: generated.cert,
		privateKey: generated.private,
		fingerprint: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
	};
}
