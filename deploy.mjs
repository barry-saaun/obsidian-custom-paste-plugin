import { resolve } from "path";
import { readFileSync, cpSync, mkdirSync } from "fs";
import { homedir } from "os";

const config = JSON.parse(readFileSync("vault-path.json", "utf8"));
let vaultPath = config.vaultPath;

if (!vaultPath) {
	console.error("❌No vaultPath found at vault-path.json");
	process.exit(1);
}

if (vaultPath.startsWith("~")) {
	vaultPath = resolve(homedir(), vaultPath.slice(1));
}

const pluginPath = resolve(
	vaultPath,
	".obsidian/plugins/barrys-custom-paste-image-plugin",
);

mkdirSync(pluginPath, { recursive: true });
cpSync("dist", pluginPath, { recursive: true });

console.log("✅ Successfully deployed to: ", pluginPath);
