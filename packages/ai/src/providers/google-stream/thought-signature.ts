// Gemini transmits thought signatures as protobuf bytes encoded in base64.
const base64Signature = /^[A-Za-z0-9+/]+={0,2}$/u;

export function isValidThoughtSignature(signature: string | undefined): signature is string {
	return Boolean(signature && signature.length % 4 === 0 && base64Signature.test(signature));
}
