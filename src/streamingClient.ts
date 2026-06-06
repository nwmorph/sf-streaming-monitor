import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { EventEmitter } from "events";
import * as https from "https";
import * as avro from "avsc";

export interface StreamingMessage {
  channel: string;         // topic name e.g. /event/Foo__e
  replayId: string;        // base64-encoded bytes
  schemaId: string;
  eventId: string;         // ProducerEvent id / UUID
  payload: unknown;        // decoded Avro record as plain object
  receivedAt: string;
}

export type ChannelType = "platform-event" | "cdc" | "pushtopic" | "generic";

export interface ChannelConfig {
  raw: string;             // /event/Foo__e  or  /data/Foo__ChangeEvent
  type: ChannelType;
  replayFrom: number;      // -1 = LATEST, -2 = EARLIEST (custom not yet supported)
}

// ── gRPC types ────────────────────────────────────────────────────────────────

interface GrpcMetadata {
  add(key: string, value: string): void;
}

interface FetchRequest {
  topic_name: string;
  replay_preset: number;   // 0 = LATEST, 1 = EARLIEST
  replay_id?: Buffer;
  num_requested: number;
}

interface ConsumerEvent {
  event: {       // field 1 in official proto (ProducerEvent)
    id: string;
    schema_id: string;
    payload: Buffer;
  };
  replay_id: Buffer;  // field 2
}

interface FetchResponse {
  events: ConsumerEvent[];       // field 1
  latest_replay_id: Buffer;      // field 2
  rpc_id: string;                // field 3
  pending_num_requested: number; // field 4
}

interface TopicInfo {
  can_subscribe: boolean;
  can_publish: boolean;
  schema_id: string;  // field 5 in official proto
}

interface PublishRequest {
  topic_name: string;
  events: Array<{ id: string; schema_id: string; payload: Buffer }>;
}

interface PublishResult {
  replay_id?: Buffer;
  error?: { code: number; msg: string };
}

interface PublishResponse {
  results: PublishResult[];
  schema_id: string;
}

interface PubSubClient {
  GetTopic(
    req: { topic_name: string },
    meta: GrpcMetadata,
    cb: (err: Error | null, resp: TopicInfo) => void
  ): void;
  GetSchema(
    req: { schema_id: string },
    meta: GrpcMetadata,
    cb: (err: Error | null, resp: { schema_json: string; schema_id: string }) => void
  ): void;
  Publish(
    req: PublishRequest,
    meta: GrpcMetadata,
    cb: (err: Error | null, resp: PublishResponse) => void
  ): void;
  Subscribe(meta: GrpcMetadata): {
    write(req: FetchRequest): void;
    on(event: "data", cb: (resp: FetchResponse) => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "end", cb: () => void): void;
    cancel(): void;
  };
}

// ── Pub/Sub API endpoint ──────────────────────────────────────────────────────

const PUBSUB_HOST = "api.pubsub.salesforce.com";
const PUBSUB_PORT = 7443;
const BATCH_SIZE = 100;

function loadProto(extensionPath: string): new (
  address: string,
  creds: grpc.ChannelCredentials
) => PubSubClient {
  const protoPath = path.join(extensionPath, "proto", "pubsub_api.proto");
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = grpc.loadPackageDefinition(pkgDef) as any;
  return pkg.eventbus.v1.PubSub as new (
    address: string,
    creds: grpc.ChannelCredentials
  ) => PubSubClient;
}

// ── StreamingMonitorClient ────────────────────────────────────────────────────

export class StreamingMonitorClient extends EventEmitter {
  private streams: Array<{ cancel(): void }> = [];
  private _disconnecting = false;
  private extensionPath: string;
  private instanceUrl: string;
  private accessToken: string;
  private orgId: string;
  private username: string;
  private log: (msg: string) => void;

  constructor(opts: {
    extensionPath: string;
    instanceUrl: string;
    accessToken: string;
    orgId: string;
    username: string;
    log?: (msg: string) => void;
  }) {
    super();
    this.extensionPath = opts.extensionPath;
    this.instanceUrl = opts.instanceUrl.replace(/\/$/, "");
    this.accessToken = opts.accessToken;
    this.orgId = opts.orgId;
    this.username = opts.username;
    this.log = opts.log ?? (() => { /* no-op */ });
  }

  connect(channels: ChannelConfig[]): void {
    this._disconnecting = false;
    let connectedCount = 0;

    for (const ch of channels) {
      this.openSubscription(ch).then(() => {
        connectedCount++;
        if (connectedCount === channels.length) {
          this.emit("connected");
        }
      }).catch((err: unknown) => {
        if (!this._disconnecting) {
          this.emit("error", `Failed to subscribe to ${ch.raw}: ${String(err)}`);
        }
      });
    }
  }

  private async openSubscription(ch: ChannelConfig): Promise<void> {
    const PubSub = loadProto(this.extensionPath);
    const client = new PubSub(
      `${PUBSUB_HOST}:${PUBSUB_PORT}`,
      grpc.credentials.createSsl()
    );

    // Build per-call metadata with Salesforce auth headers
    const meta = new grpc.Metadata() as unknown as GrpcMetadata;
    meta.add("accesstoken", this.accessToken);
    meta.add("instanceurl", this.instanceUrl);
    meta.add("tenantid", this.orgId);

    this.log(`[${ch.raw}] GetTopic → ${PUBSUB_HOST}:${PUBSUB_PORT} (orgId=${this.orgId})`);

    // Resolve schema before opening the stream
    const topicInfo = await new Promise<TopicInfo>((res, rej) => {
      client.GetTopic({ topic_name: ch.raw }, meta, (err, info) => {
        if (err) { this.log(`[${ch.raw}] GetTopic error: ${err.message}`); rej(err); }
        else if (!info.can_subscribe) { this.log(`[${ch.raw}] GetTopic: can_subscribe=false`); rej(new Error(`Not subscribed to ${ch.raw}`)); }
        else { this.log(`[${ch.raw}] GetTopic OK — schema_id=${info.schema_id}`); res(info); }
      });
    });

    // Cache of schemaId → avro type; pre-warm with the schema_id from GetTopic
    const schemaCache = new Map<string, avro.Type>();

    const getSchema = (schemaId: string): Promise<avro.Type> => {
      const cached = schemaCache.get(schemaId);
      if (cached) return Promise.resolve(cached);
      return new Promise((res, rej) => {
        client.GetSchema({ schema_id: schemaId }, meta, (err, resp) => {
          if (err) return rej(err);
          const type = avro.Type.forSchema(JSON.parse(resp.schema_json));
          schemaCache.set(schemaId, type);
          res(type);
        });
      });
    };

    // Pre-fetch the initial schema so first events decode immediately
    if (topicInfo.schema_id) {
      await getSchema(topicInfo.schema_id).catch(() => { /* non-fatal */ });
    }

    this.log(`[${ch.raw}] Opening Subscribe stream (replay_preset=${replayPreset(ch.replayFrom)})`);
    const stream = client.Subscribe(meta as unknown as grpc.Metadata);
    this.streams.push(stream);

    stream.on("error", (err) => {
      this.log(`[${ch.raw}] Stream ERROR: ${err.message} (code=${(err as NodeJS.ErrnoException).code ?? "?"})`);
      if (!this._disconnecting) {
        this.emit("error", `Stream error on ${ch.raw}: ${err.message}`);
      }
    });

    stream.on("end", () => {
      this.log(`[${ch.raw}] Stream END received`);
      if (!this._disconnecting) {
        this.emit("error", `Stream ended unexpectedly for ${ch.raw}`);
      }
    });

    stream.on("data", (resp: FetchResponse) => {
      if (!resp.events?.length) {
        this.log(`[${ch.raw}] Keep-alive (latest_replay_id=${resp.latest_replay_id?.toString("base64") ?? "none"})`);
        // Keep-alive — request more
        stream.write({
          topic_name: ch.raw,
          replay_preset: replayPreset(ch.replayFrom),
          num_requested: BATCH_SIZE,
        });
        return;
      }
      this.log(`[${ch.raw}] Received ${resp.events.length} event(s)`);

      for (const event of resp.events) {
        const schemaId = event.event.schema_id;
        const replayId = event.replay_id.toString("base64");
        const eventId = event.event.id;
        getSchema(schemaId).then((avroType) => {
          let decoded: unknown;
          try {
            decoded = formatDates(avroType.fromBuffer(event.event.payload) as Record<string, unknown>);
          } catch {
            decoded = { _raw: event.event.payload.toString("base64") };
          }
          const msg: StreamingMessage = {
            channel: ch.raw,
            replayId,
            schemaId,
            eventId,
            payload: decoded,
            receivedAt: new Date().toISOString(),
          };
          this.emit("message", msg);
        }).catch(() => {
          const msg: StreamingMessage = {
            channel: ch.raw,
            replayId,
            schemaId,
            eventId,
            payload: { _raw: event.event.payload.toString("base64") },
            receivedAt: new Date().toISOString(),
          };
          this.emit("message", msg);
        });
      }

      // Request next batch
      stream.write({
        topic_name: ch.raw,
        replay_preset: replayPreset(ch.replayFrom),
        num_requested: BATCH_SIZE,
      });
    });

    // Send the initial fetch request to kick off the stream
    this.log(`[${ch.raw}] Initial FetchRequest sent (num_requested=${BATCH_SIZE})`);
    stream.write({
      topic_name: ch.raw,
      replay_preset: replayPreset(ch.replayFrom),
      num_requested: BATCH_SIZE,
    });
  }

  disconnect(): void {
    this._disconnecting = true;
    for (const s of this.streams) {
      try { s.cancel(); } catch { /* ignore */ }
    }
    this.streams = [];
    this.emit("disconnected");
  }
}

function replayPreset(replayFrom: number): number {
  return replayFrom === -2 ? 1 : 0; // -2 = EARLIEST(1), default = LATEST(0)
}

function formatDates(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number" && /Date|DateTime/i.test(key) && value > 0) {
      result[key] = new Date(value).toISOString().replace("T", " ").replace(/\.000Z$/, " UTC");
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Channel discovery ─────────────────────────────────────────────────────────

export async function discoverChannels(
  instanceUrl: string,
  accessToken: string
): Promise<Array<{ label: string; channel: string; type: ChannelType }>> {
  const base = instanceUrl.replace(/\/$/, "");
  const results: Array<{ label: string; channel: string; type: ChannelType }> = [];

  const get = (urlPath: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const url = new URL(urlPath, base);
      const req = https.get(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed) && (parsed[0] as Record<string, unknown>)?.errorCode) {
                reject(new Error(`API error: ${(parsed[0] as Record<string, unknown>).errorCode} — ${(parsed[0] as Record<string, unknown>).message}`));
              } else {
                resolve(parsed);
              }
            } catch {
              reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
    });

  const resp = (await get("/services/data/v59.0/sobjects/")) as {
    sobjects?: Array<{ name: string }>;
  };
  for (const s of resp.sobjects ?? []) {
    if (s.name.endsWith("__e")) {
      results.push({ label: s.name, channel: `/event/${s.name}`, type: "platform-event" });
    } else if (s.name.endsWith("ChangeEvent")) {
      results.push({ label: s.name, channel: `/data/${s.name}`, type: "cdc" });
    }
  }

  // PushTopics are not supported by Pub/Sub API — omit them

  return results;
}

// ── Schema template ───────────────────────────────────────────────────────────

export async function getChannelSchemaTemplate(opts: {
  extensionPath: string;
  instanceUrl: string;
  accessToken: string;
  orgId: string;
  channel: string;
}): Promise<{ fields: Array<{ name: string; type: string; default: unknown; system: boolean }> }> {
  const PubSub = loadProto(opts.extensionPath);
  const client = new PubSub(
    `${PUBSUB_HOST}:${PUBSUB_PORT}`,
    grpc.credentials.createSsl()
  );
  const meta = new grpc.Metadata() as unknown as GrpcMetadata;
  meta.add("accesstoken", opts.accessToken);
  meta.add("instanceurl", opts.instanceUrl.replace(/\/$/, ""));
  meta.add("tenantid", opts.orgId);

  const topicInfo = await new Promise<TopicInfo>((res, rej) => {
    client.GetTopic({ topic_name: opts.channel }, meta, (err, info) =>
      err ? rej(err) : res(info)
    );
  });

  const schemaResp = await new Promise<{ schema_json: string; schema_id: string }>((res, rej) => {
    client.GetSchema({ schema_id: topicInfo.schema_id }, meta, (err, resp) =>
      err ? rej(err) : res(resp)
    );
  });

  const schema = JSON.parse(schemaResp.schema_json) as { fields: Array<{ name: string; type: unknown; default?: unknown }> };
  const SYSTEM_FIELDS = new Set(["CreatedDate", "CreatedById", "EventUuid", "ReplayId", "SequenceNumber"]);

  const fields = (schema.fields ?? []).map((f) => {
    const typeName = resolveAvroTypeName(f.type);
    return {
      name: f.name,
      type: typeName,
      default: f.default !== undefined ? f.default : avroDefaultValue(f.name, f.type),
      system: SYSTEM_FIELDS.has(f.name),
    };
  });

  return { fields };
}

function resolveAvroTypeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const nonNull = (type as unknown[]).find((t) => t !== "null");
    return nonNull ? resolveAvroTypeName(nonNull) : "null";
  }
  if (typeof type === "object" && type !== null) {
    return (type as Record<string, string>).type ?? "record";
  }
  return "unknown";
}

function avroDefaultValue(name: string, type: unknown): unknown {
  // Nullable union — null is the natural default
  if (Array.isArray(type) && type[0] === "null") return null;
  const typeName = resolveAvroTypeName(type);
  if (typeName === "long" || typeName === "int") {
    // Date/time fields: use current timestamp so Avro accepts it
    // (Salesforce overwrites CreatedDate server-side anyway)
    return /date|time/i.test(name) ? Date.now() : 0;
  }
  if (typeName === "string" || typeName === "bytes") return "";
  if (typeName === "boolean") return false;
  if (typeName === "double" || typeName === "float") return 0.0;
  return null;
}

// ── Event publishing ──────────────────────────────────────────────────────────

export async function publishEvent(opts: {
  extensionPath: string;
  instanceUrl: string;
  accessToken: string;
  orgId: string;
  channel: string;        // e.g. /event/Foo__e
  payload: Record<string, unknown>;
}): Promise<{ replayId: string }> {
  const PubSub = loadProto(opts.extensionPath);
  const client = new PubSub(
    `${PUBSUB_HOST}:${PUBSUB_PORT}`,
    grpc.credentials.createSsl()
  );

  const meta = new grpc.Metadata() as unknown as GrpcMetadata;
  meta.add("accesstoken", opts.accessToken);
  meta.add("instanceurl", opts.instanceUrl.replace(/\/$/, ""));
  meta.add("tenantid", opts.orgId);

  // Get topic + schema
  const topicInfo = await new Promise<TopicInfo>((res, rej) => {
    client.GetTopic({ topic_name: opts.channel }, meta, (err, info) => {
      if (err) rej(err);
      else if (!info.can_publish) rej(new Error(`Publishing not allowed on ${opts.channel}`));
      else res(info);
    });
  });

  const schemaResp = await new Promise<{ schema_json: string; schema_id: string }>((res, rej) => {
    client.GetSchema({ schema_id: topicInfo.schema_id }, meta, (err, resp) => {
      if (err) rej(err); else res(resp);
    });
  });

  const avroType = avro.Type.forSchema(JSON.parse(schemaResp.schema_json));

  // Build a complete record by filling every schema field with a default,
  // then overlay the caller's payload. This satisfies Avro for required
  // system fields (e.g. CreatedDate as long) that Salesforce ignores anyway.
  const schema = JSON.parse(schemaResp.schema_json) as { fields: Array<{ name: string; type: unknown; default?: unknown }> };
  const fullPayload: Record<string, unknown> = {};
  for (const f of schema.fields ?? []) {
    fullPayload[f.name] = f.default !== undefined ? f.default : avroDefaultValue(f.name, f.type);
  }
  Object.assign(fullPayload, opts.payload);

  const payloadBuf = avroType.toBuffer(fullPayload);

  const eventId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

  const resp = await new Promise<PublishResponse>((res, rej) => {
    (client as unknown as PubSubClient).Publish(
      {
        topic_name: opts.channel,
        events: [{ id: eventId, schema_id: topicInfo.schema_id, payload: payloadBuf }],
      },
      meta,
      (err, r) => { if (err) rej(err); else res(r); }
    );
  });

  const result = resp.results?.[0];
  if (result?.error?.msg) throw new Error(result.error.msg);

  return { replayId: result?.replay_id?.toString("base64") ?? "" };
}
