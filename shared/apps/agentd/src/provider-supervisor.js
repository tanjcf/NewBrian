import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertCapabilityPackageManifest, hashCapabilityPackage } from "./capability-package.js";

export class ProviderSupervisor {
  constructor({ installRoot, healthCheck, conformanceTest }) {
    this.installRoot = path.resolve(installRoot);
    this.healthCheck = healthCheck || (async () => ({ ok: true }));
    this.conformanceTest = conformanceTest || (async () => ({ ok: true }));
  }

  async install({ sourcePath, manifest, expectedIntegrity }) {
    const descriptor = assertCapabilityPackageManifest(manifest);
    const integrity = await hashCapabilityPackage(sourcePath);
    if (!expectedIntegrity || integrity !== expectedIntegrity) throw new Error("capability package integrity verification failed");
    const packageRoot = path.join(this.installRoot, descriptor.id);
    const stagingPath = path.join(packageRoot, `.staging-${randomUUID()}`);
    const versionPath = path.join(packageRoot, descriptor.version);
    await fs.mkdir(packageRoot, { recursive: true });
    const previous = await this.getActive(descriptor.id);
    try {
      await fs.cp(sourcePath, stagingPath, { recursive: true, force: false });
      const health = await this.healthCheck({ manifest: descriptor, packagePath: stagingPath });
      if (!health?.ok) throw new Error(health?.reason || "provider health check failed");
      const conformance = await this.conformanceTest({ manifest: descriptor, packagePath: stagingPath });
      if (!conformance?.ok) throw new Error(conformance?.reason || "provider conformance test failed");
      await fs.rm(versionPath, { recursive: true, force: true });
      await fs.rename(stagingPath, versionPath);
      await this.#writeActive(descriptor.id, { version: descriptor.version, integrity, previousVersion: previous?.version || null });
      return { status: "active", packageId: descriptor.id, version: descriptor.version, integrity, previousVersion: previous?.version || null, packagePath: versionPath, manifest: descriptor };
    } catch (error) {
      await fs.rm(stagingPath, { recursive: true, force: true });
      throw error;
    }
  }

  async getActive(packageId) {
    try { return JSON.parse(await fs.readFile(path.join(this.installRoot, packageId, "active.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async rollback(packageId) {
    const active = await this.getActive(packageId);
    if (!active?.previousVersion) throw new Error("no last-known-good version available");
    await fs.access(path.join(this.installRoot, packageId, active.previousVersion));
    await this.#writeActive(packageId, { version: active.previousVersion, integrity: null, previousVersion: active.version });
    return this.getActive(packageId);
  }

  async rollbackFailedActivation(installation) {
    if (!installation?.packageId || installation.bundled) return null;
    if (installation.previousVersion) return this.rollback(installation.packageId);
    const root = path.join(this.installRoot, installation.packageId);
    const active = await this.getActive(installation.packageId);
    if (active?.version === installation.version) await fs.rm(path.join(root, "active.json"), { force: true });
    if (installation.packagePath) await fs.rm(installation.packagePath, { recursive: true, force: true });
    return null;
  }

  async listActive() {
    try {
      const entries = await fs.readdir(this.installRoot, { withFileTypes: true });
      const active = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const state = await this.getActive(entry.name);
        if (state) active.push({ packageId: entry.name, ...state, packagePath: path.join(this.installRoot, entry.name, state.version) });
      }
      return active;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async #writeActive(packageId, state) {
    const root = path.join(this.installRoot, packageId);
    const temporary = path.join(root, `.active-${randomUUID()}.json`);
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, path.join(root, "active.json"));
  }
}
