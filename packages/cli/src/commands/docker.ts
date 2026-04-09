import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import { tmpdir } from "node:os";
import chalk from "chalk";
import type { Command } from "commander";
import {
  ConfigNotFoundError,
  loadConfigWithPath,
  type OrchestratorConfig,
  type ProjectConfig,
} from "@composio/ao-core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { exec } from "../lib/shell.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";
import { appendStringOption, resolveRuntimeOverride } from "../lib/runtime-overrides.js";
import { preflight } from "../lib/preflight.js";

type RawConfig = Record<string, unknown>;
type RawProjectConfig = Record<string, unknown>;

interface DockerPrepareOptions {
  agent?: string;
  image?: string;
  buildLocal?: boolean;
  tag?: string;
  pull?: boolean;
  cpus?: string;
  memory?: string;
  gpus?: string;
  readOnly?: boolean;
  network?: string;
  capDrop?: string[];
  tmpfs?: string[];
}

interface DockerAgentTemplate {
  agent: string;
  officialImage: string;
  localTag: string;
  installCommand: string;
  extraPackages?: string[];
}

const DOCKER_AGENT_TEMPLATES: Record<string, DockerAgentTemplate> = {
  "claude-code": {
    agent: "claude-code",
    officialImage: "ghcr.io/composio/ao-claude-code:latest",
    localTag: "ao-claude-code:local",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
  codex: {
    agent: "codex",
    officialImage: "ghcr.io/composio/ao-codex:latest",
    localTag: "ao-codex:local",
    installCommand: "npm install -g @openai/codex",
  },
  opencode: {
    agent: "opencode",
    officialImage: "ghcr.io/composio/ao-opencode:latest",
    localTag: "ao-opencode:local",
    installCommand: "npm install -g opencode-ai",
  },
  aider: {
    agent: "aider",
    officialImage: "ghcr.io/composio/ao-aider:latest",
    localTag: "ao-aider:local",
    extraPackages: ["python3", "python3-pip"],
    installCommand: "pip3 install --break-system-packages aider-chat",
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRawConfig(path: string): RawConfig {
  const parsed = yamlParse(readFileSync(path, "utf-8"));
  return isPlainObject(parsed) ? parsed : {};
}

function writeRawConfig(path: string, rawConfig: RawConfig): void {
  writeFileSync(path, yamlStringify(rawConfig, { indent: 2 }), "utf-8");
}

function getRawProjects(rawConfig: RawConfig): Record<string, RawProjectConfig> {
  if (!isPlainObject(rawConfig["projects"])) {
    rawConfig["projects"] = {};
  }
  return rawConfig["projects"] as Record<string, RawProjectConfig>;
}

function getProjectOrExit(config: OrchestratorConfig, projectId: string): ProjectConfig {
  const project = config.projects[projectId];
  if (project) return project;

  console.error(
    chalk.red(
      `Project "${projectId}" not found. Available projects: ${Object.keys(config.projects).join(", ")}`,
    ),
  );
  process.exit(1);
}

function resolveProjectId(config: OrchestratorConfig, projectId?: string): string {
  if (projectId) {
    getProjectOrExit(config, projectId);
    return projectId;
  }

  const projectIds = Object.keys(config.projects);
  if (projectIds.length === 0) {
    console.error(chalk.red("No projects configured. Run `ao start` first."));
    process.exit(1);
  }
  if (projectIds.length === 1) {
    return projectIds[0];
  }

  const envProject = process.env["AO_PROJECT_ID"];
  if (envProject && config.projects[envProject]) {
    return envProject;
  }

  const matchedProjectId = findProjectForDirectory(config.projects, resolve(cwd()));
  if (matchedProjectId) {
    return matchedProjectId;
  }

  console.error(
    chalk.red(
      `Multiple projects configured. Specify one: ${projectIds.join(", ")}\nOr run from within a project directory.`,
    ),
  );
  process.exit(1);
}

function resolveWorkerAgent(config: OrchestratorConfig, project: ProjectConfig, override?: string): string {
  return (
    override ??
    project.worker?.agent ??
    project.agent ??
    config.defaults.worker?.agent ??
    config.defaults.agent
  );
}

function getDockerTemplate(agent: string): DockerAgentTemplate {
  const template = DOCKER_AGENT_TEMPLATES[agent];
  if (template) return template;

  console.error(
    chalk.red(
      `No Docker template is available for agent "${agent}". Use --image with a custom image instead.`,
    ),
  );
  process.exit(1);
}

function buildDockerfile(template: DockerAgentTemplate): string {
  const extraPackages = template.extraPackages?.join(" ");
  const aptPackages = ["git", "tmux", "gh", "ca-certificates", extraPackages]
    .filter(Boolean)
    .join(" ");

  return [
    "FROM node:20-bookworm",
    `RUN apt-get update \\`,
    `  && apt-get install -y --no-install-recommends ${aptPackages} \\`,
    "  && rm -rf /var/lib/apt/lists/*",
    `RUN ${template.installCommand}`,
    "WORKDIR /workspace",
    "",
  ].join("\n");
}

async function pullImage(image: string): Promise<void> {
  console.log(chalk.dim(`Pulling ${image}...`));
  try {
    await exec("docker", ["pull", image]);
  } catch (err) {
    throw new Error(
      `Failed to pull Docker image ${image}. If you want AO to build an image locally instead, rerun with --build-local.`,
      { cause: err },
    );
  }
}

async function buildLocalImage(image: string, template: DockerAgentTemplate): Promise<void> {
  const buildDir = mkdtempSync(join(tmpdir(), "ao-docker-prepare-"));
  try {
    const dockerfilePath = join(buildDir, "Dockerfile");
    writeFileSync(dockerfilePath, buildDockerfile(template), "utf-8");
    console.log(chalk.dim(`Building ${image}...`));
    try {
      await exec("docker", ["build", "-t", image, buildDir]);
    } catch (err) {
      throw new Error(`Failed to build Docker image ${image}.`, { cause: err });
    }
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

function toRuntimeOverrideOptions(image: string, opts: DockerPrepareOptions) {
  return {
    runtime: "docker",
    runtimeImage: image,
    runtimeCpus: opts.cpus,
    runtimeMemory: opts.memory,
    runtimeGpus: opts.gpus,
    runtimeReadOnly: opts.readOnly,
    runtimeNetwork: opts.network,
    runtimeCapDrop: opts.capDrop,
    runtimeTmpfs: opts.tmpfs,
  };
}

async function withLoadedConfig<T>(
  handler: (ctx: {
    config: OrchestratorConfig;
    path: string;
    rawConfig: RawConfig;
  }) => Promise<T> | T,
): Promise<T> {
  return Promise.resolve()
    .then(async () => {
      const { config, path } = loadConfigWithPath();
      const rawConfig = readRawConfig(path);
      return handler({ config, path, rawConfig });
    })
    .catch((err) => {
      if (err instanceof ConfigNotFoundError) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
      throw err;
    });
}

export function registerDocker(program: Command): void {
  const docker = program
    .command("docker")
    .description("Prepare first-time-user Docker images and runtime config");

  docker
    .command("prepare")
    .description("Pull an official Docker image or build one locally, then configure a project to use it")
    .argument("[project]", "Optional project ID; auto-detected when possible")
    .option("--agent <name>", "Choose the worker agent (claude-code, codex, opencode, aider)")
    .option("--image <image>", "Use this image reference instead of the official default")
    .option("--build-local", "Build a local image instead of pulling the official one")
    .option("--tag <image>", "Tag to use with --build-local (defaults to an agent-specific local tag)")
    .option("--pull", "Pull the selected image before updating config")
    .option("--no-pull", "Skip pulling the selected image before updating config")
    .option("--cpus <cpus>", "Set project runtimeConfig.limits.cpus")
    .option("--memory <memory>", "Set project runtimeConfig.limits.memory")
    .option("--gpus <gpus>", "Set project runtimeConfig.limits.gpus")
    .option("--read-only", "Set project runtimeConfig.readOnlyRoot=true")
    .option("--network <network>", "Set project runtimeConfig.network")
    .option("--cap-drop <cap>", "Append project runtimeConfig.capDrop entry", appendStringOption)
    .option("--tmpfs <mount>", "Append project runtimeConfig.tmpfs entry", appendStringOption)
    .action(async (projectArg: string | undefined, opts: DockerPrepareOptions) => {
      try {
        await withLoadedConfig(async ({ config, path, rawConfig }) => {
          const projectId = resolveProjectId(config, projectArg);
          const project = getProjectOrExit(config, projectId);
          const agent = resolveWorkerAgent(config, project, opts.agent);
          const template = getDockerTemplate(agent);

          const image = opts.buildLocal
            ? (opts.tag ?? opts.image ?? template.localTag)
            : (opts.image ?? template.officialImage);

          const tmpfs = [...(opts.tmpfs ?? [])];
          if (opts.readOnly && !tmpfs.some((mount) => mount.split(":")[0]?.trim() === "/tmp")) {
            tmpfs.push("/tmp");
          }

          await preflight.checkDocker({
            image,
            readOnlyRoot: opts.readOnly,
            tmpfs,
            ...(opts.cpus || opts.memory || opts.gpus
              ? {
                limits: {
                  ...(opts.cpus ? { cpus: opts.cpus } : {}),
                  ...(opts.memory ? { memory: opts.memory } : {}),
                  ...(opts.gpus ? { gpus: opts.gpus } : {}),
                },
              }
              : {}),
          });

          if (opts.buildLocal) {
            await buildLocalImage(image, template);
          } else if (opts.pull !== false) {
            await pullImage(image);
          }

          const rawProjects = getRawProjects(rawConfig);
          const rawProject = rawProjects[projectId] ?? {};
          rawProjects[projectId] = rawProject;

          const runtimeOverride = resolveRuntimeOverride(
            config,
            project,
            toRuntimeOverrideOptions(image, {
              ...opts,
              tmpfs,
            }),
          );
          const effectiveRuntimeConfig = runtimeOverride.effectiveRuntimeConfig;

          rawProject["runtime"] = "docker";
          if (effectiveRuntimeConfig && Object.keys(effectiveRuntimeConfig).length > 0) {
            rawProject["runtimeConfig"] = effectiveRuntimeConfig;
          }

          writeRawConfig(path, rawConfig);

          console.log(chalk.green(`Prepared Docker runtime for project "${projectId}"`));
          console.log(chalk.dim(`  Agent:   ${agent}`));
          console.log(chalk.dim(`  Image:   ${image}`));
          console.log(chalk.dim(`  Config:  ${path}`));
          console.log(chalk.dim(`  Next:    ao spawn --agent ${agent} "your task here"`));
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
