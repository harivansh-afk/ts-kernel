import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { stateDir } from "./config.ts";

type Stored = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string };
type Redirect = (url: URL) => void;

const DEFAULT_LOGIN_PORT = 8976;
const CALLBACK_PATH = "/callback";

const loginPort = (): number => Number(process.env.TS_KERNEL_LOGIN_PORT ?? DEFAULT_LOGIN_PORT);

export class FileAuth implements OAuthClientProvider {
  private readonly path: string;

  constructor(
    private readonly name: string,
    private readonly scope: string | undefined,
    private readonly redirect: Redirect | null,
  ) {
    this.path = join(stateDir(), "auth", `${name}.json`);
  }

  private read(): Stored {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as Stored) : {};
  }

  private write(change: Stored): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify({ ...this.read(), ...change }), { mode: 0o600 });
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${loginPort()}${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "ts-kernel",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: this.scope,
    };
  }

  clientInformation = () => this.read().client;
  saveClientInformation = (client: OAuthClientInformationMixed) => this.write({ client });
  tokens = () => this.read().tokens;
  saveTokens = (tokens: OAuthTokens) => this.write({ tokens });
  saveCodeVerifier = (verifier: string) => this.write({ verifier });

  codeVerifier(): string {
    const { verifier } = this.read();
    if (!verifier) throw new Error(`no sign-in of ${this.name} is in progress`);
    return verifier;
  }

  redirectToAuthorization(url: URL): void {
    if (!this.redirect) throw new Error(`run \`ts-kernel login ${this.name}\` to sign in`);
    this.redirect(url);
  }
}

export function authorizationCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: loginPort(),
      fetch(request) {
        const { pathname, searchParams } = new URL(request.url);
        if (pathname !== CALLBACK_PATH) return new Response("not found", { status: 404 });
        void listener.stop();
        const code = searchParams.get("code");
        if (!code) {
          reject(new Error(searchParams.get("error_description") ?? searchParams.get("error") ?? "the sign-in returned no code"));
          return new Response("Sign-in failed. You can close this tab.");
        }
        resolve(code);
        return new Response("Signed in. You can close this tab.");
      },
    });
  });
}
