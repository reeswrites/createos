// trust.cjs — the pure provenance decision for native access (ADR 050).
//
// Extracted so the trust rule is unit-testable under vitest (require-shared, like
// osc-codec.cjs) even though it's enforced in main.cjs. No I/O, no Electron.
//
// projectTrust: 'authored' (made/saved here → trusted) | 'imported' (opened from a path)
//   | 'demo' (bundled/remote gallery). nativeConsent: null (unasked) | true | false.
//
// Returns: 'allow' (proceed), 'deny' (reject), 'ask' (prompt the user once, then cache).

function decideAccess(projectTrust, nativeConsent) {
  if (projectTrust === 'authored') return 'allow';
  if (nativeConsent === true) return 'allow';
  if (nativeConsent === false) return 'deny';
  return 'ask';
}

module.exports = { decideAccess };
