import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

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
  accessToken?: string;
  orgId?: string;
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

export async function getOrgAccessInfo(username: string): Promise<OrgInfo> {
  // Use @salesforce/core from the SF CLI's own installation to decrypt the token.
  // The CLI ships its own copy at /usr/local/lib/sf/node_modules/@salesforce/core.
  const script = `
    const {AuthInfo} = require('/usr/local/lib/sf/node_modules/@salesforce/core');
    AuthInfo.create({username: process.argv[1]})
      .then(a => {
        const f = a.getFields(true);
        process.stdout.write(JSON.stringify({
          accessToken: f.accessToken,
          instanceUrl: f.instanceUrl,
          orgId: f.orgId,
          username: f.username,
          alias: f.alias,
        }));
      })
      .catch(e => { process.stderr.write(e.message); process.exit(1); });
  `;

  let raw: string;
  try {
    raw = execFileSync("node", ["-e", script, username], {
      encoding: "utf-8",
      timeout: 15000,
    });
  } catch (e: unknown) {
    throw new Error(`Could not retrieve credentials for ${username}: ${String(e)}`);
  }

  const fields = JSON.parse(raw) as {
    accessToken?: string;
    instanceUrl?: string;
    orgId?: string;
    username?: string;
    alias?: string;
  };

  if (!fields.accessToken || !fields.instanceUrl) {
    throw new Error(`Could not retrieve credentials for ${username}`);
  }

  const resolvedUsername = fields.username ?? username;
  const aliasMap = getAliasMap();
  const usernameToAlias: Record<string, string> = {};
  for (const [alias, u] of Object.entries(aliasMap)) {
    if (!usernameToAlias[u]) usernameToAlias[u] = alias;
  }

  return {
    alias: fields.alias ?? usernameToAlias[resolvedUsername] ?? resolvedUsername,
    username: resolvedUsername,
    instanceUrl: fields.instanceUrl,
    accessToken: fields.accessToken,
    orgId: fields.orgId ?? "",
  };
}

export function getDefaultOrgAlias(workspacePath: string): string | null {
  const config = readJson<{ defaultusername?: string; defaultTargetOrg?: string }>(
    path.join(workspacePath, ".sfdx", "sfdx-config.json")
  );
  return config?.defaultTargetOrg ?? config?.defaultusername ?? null;
}
