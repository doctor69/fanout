import * as AuthSession from 'expo-auth-session';

/**
 * The PKCE dance every no-server-hop platform shares (specs/03-auth-and-oauth.md):
 * open the system browser, come back with a code, exchange it for tokens with
 * the client id alone. Platform-specific bits — endpoints, scopes, profile
 * lookup — stay in the per-platform module.
 */

export interface PkceFlowOptions {
  clientId: string;
  discovery: AuthSession.DiscoveryDocument;
  scopes: string[];
  /** Path appended to the app scheme, e.g. 'oauth/youtube'. */
  redirectPath: string;
  extraParams?: Record<string, string>;
}

export interface PkceFlowResult {
  token: AuthSession.TokenResponse;
  /** What the platform says it granted, when it reports it on the token. */
  grantedScopes?: string[];
}

export function redirectUriFor(path: string): string {
  return AuthSession.makeRedirectUri({ scheme: 'fanout', path });
}

export interface AuthorizationResult {
  code: string;
  codeVerifier?: string;
  redirectUri: string;
}

/**
 * The browser half of the flow, stopping at the authorization code.
 *
 * Platforms whose token exchange needs a client secret stop here and send the
 * code to /functions/token-exchange instead of exchanging it on-device.
 * Resolves null when the user dismissed or cancelled the browser.
 */
export async function runAuthorizationRequest(
  options: PkceFlowOptions,
): Promise<AuthorizationResult | null> {
  const redirectUri = redirectUriFor(options.redirectPath);

  const request = new AuthSession.AuthRequest({
    clientId: options.clientId,
    redirectUri,
    scopes: options.scopes,
    usePKCE: true,
    ...(options.extraParams ? { extraParams: options.extraParams } : {}),
  });

  const result = await request.promptAsync(options.discovery);

  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type === 'error') {
    throw new Error(
      result.params.error_description ?? result.error?.message ?? 'Sign-in failed.',
    );
  }
  if (result.type !== 'success' || !result.params.code) {
    throw new Error('Sign-in did not return an authorization code.');
  }

  return {
    code: result.params.code,
    ...(request.codeVerifier ? { codeVerifier: request.codeVerifier } : {}),
    redirectUri,
  };
}

/** Resolves null when the user dismissed or cancelled the browser. */
export async function runPkceFlow(options: PkceFlowOptions): Promise<PkceFlowResult | null> {
  const authorization = await runAuthorizationRequest(options);
  if (!authorization) return null;

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: options.clientId,
      code: authorization.code,
      redirectUri: authorization.redirectUri,
      extraParams: authorization.codeVerifier
        ? { code_verifier: authorization.codeVerifier }
        : {},
    },
    options.discovery,
  );

  const grantedScopes = token.scope?.split(' ').filter(Boolean);

  return { token, ...(grantedScopes?.length ? { grantedScopes } : {}) };
}
