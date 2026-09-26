// Uploaded files live behind one interface: local disk in development, GCS when deployed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage as Gcs } from "@google-cloud/storage";

export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStore implements FileStore {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

class GcsStore implements FileStore {
  private bucket;
  constructor(bucket: string) {
    this.bucket = new Gcs().bucket(bucket);
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.bucket.file(key).save(data, { contentType, resumable: false });
  }
  async get(key: string) {
    const [data] = await this.bucket.file(key).download();
    return data;
  }
}

let store: FileStore | undefined;

export function fileStore(): FileStore {
  if (store) return store;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "gcs") {
    const bucket = process.env.GCS_BUCKET;
    if (!bucket) throw new Error("STORAGE_DRIVER=gcs requires GCS_BUCKET");
    store = new GcsStore(bucket);
  } else {
    store = new LocalStore(process.env.LOCAL_STORAGE_DIR ?? "./uploads");
  }
  return store;
}
