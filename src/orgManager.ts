import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface OrgInfo {
  alias: string;
  username: string;
  instanceUrl: string;
  accessToken: string;
  orgId: string;
}

interface AliasFile {
  orgs?: Record<string, string>;
}

interface SfdxAuthFile {
  instanceUrl?: string;
  username?: string;
}

const SFDX_DIR = path.join(os.homedir(), ".sfdx");

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function getAliasMap(): Record<string, string> {
  const data = readJson<AliasFile>(path.join(SFDX_DIR, "alias.json"));
  return data?.orgs ?? {};
}

export function listOrgs(): Array<{ alias: string; username: string; instanceUrl: string }> {
  const aliasMap = getAliasMap();
  const usernameToAlias: Record<string, string> = {};
  for (const [alias, username] of Object.entries(aliasMap)) {
    if (!usernameToAlias[username]) {
      usernameToAlias[username] = alias;
    }
  }

  const orgs: Array<{ alias: string; username: string; instanceUrl: string }> = [];
  let files: string[];
  try {
    files = fs.readdirSync(SFDX_DIR).filter((f) => f.endsWith(".json") && f !== "alias.json");
  } catch {
    return orgs;
  }

  for (const file of files) {
    const auth = readJson<SfdxAuthFile>(path.join(SFDX_DIR, file));
    if (!auth?.instanceUrl) continue;
    const username = auth.username ?? file.replace(/\.json$/, "");
    orgs.push({
      alias: usernameToAlias[username] ?? username,
      username,
      instanceUrl: auth.instanceUrl,
    });
  }
  return orgs;
}

// Use @salesforce/core to decrypt the access token — same mechanism the CLI uses
export async function getOrgAccessInfo(username: string): Promise<OrgInfo> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AuthInfo } = require("@salesforce/core") as {
    AuthInfo: {
      create(opts: { username: string }): Promise<{
        getFields(decrypt: boolean): {
          username?: string;
          accessToken?: string;
          instanceUrl?: string;
          alias?: string;
        };
      }>;
    };
  };

  const authInfo = await AuthInfo.create({ username });
  const fields = authInfo.getFields(true); // true = decrypt

  if (!fields.accessToken || !fields.instanceUrl) {
    throw new Error(`Could not retrieve credentials for ${username}`);
  }

  const aliasMap = getAliasMap();
  const usernameToAlias: Record<string, string> = {};
  for (const [alias, u] of Object.entries(aliasMap)) {
    if (!usernameToAlias[u]) usernameToAlias[u] = alias;
  }

  return {
    alias: usernameToAlias[username] ?? username,
    username,
    instanceUrl: fields.instanceUrl,
    accessToken: fields.accessToken,
    orgId: (fields as Record<string, unknown>)["orgId"] as string ?? "",
  };
}

export function getDefaultOrgAlias(workspacePath: string): string | null {
  const config = readJson<{ defaultusername?: string; defaultTargetOrg?: string }>(
    path.join(workspacePath, ".sfdx", "sfdx-config.json")
  );
  return config?.defaultTargetOrg ?? config?.defaultusername ?? null;
}
