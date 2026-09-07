import { Token } from "webdaemon";

export async function authenticate(encoded, origin, source) {
  if (!encoded || encoded.length > 32768) throw new Error("Owner token required");
  const token = new Token(encoded);
  const payload = token.getPayload();
  // Check the destination and issuer before the SDK performs any network request.
  if (
    token.getAud() !== origin || token.getSub() !== origin ||
    token.getIssuer().origin !== origin ||
    !/^\/device\/[^/?#]+/.test(token.getIssuer().pathname) ||
    token.getSrc() !== source || token.getPre().length ||
    !token.hasCapability(source, "terminal") ||
    !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)
  ) {
    throw new Error("Owner terminal token required");
  }
  token.checkPeriod();
  await token.verifySignatory();
  // Only device signatures accepted; other apps cannot mint shell credentials.
  if (token.getSignatorySrc() !== "party:control") throw new Error("Device token required");
  return `${origin}|${source}`;
}
