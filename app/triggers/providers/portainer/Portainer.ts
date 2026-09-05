import crypto from 'node:crypto';
import path from 'node:path';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import { save as saveStore } from '../../../store/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { buildComposeProjectLockKey } from '../../../updates/update-locks.js';
import Docker, { type DockerTriggerConfiguration } from '../docker/Docker.js';
import type { PostPullHookOptions } from '../docker/UpdateLifecycleExecutor.js';
import { getRequestedOperationId } from '../docker/update-runtime-context.js';
import {
  updateComposeServiceImageInText,
  YAML_MAX_ALIAS_COUNT,
} from '../dockercompose/ComposeFileParser.js';
import { preserveExplicitDockerIoPrefix } from '../dockercompose/Dockercompose.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const DEFAULT_VERSION_VAR_LABEL = 'dd.portainer.version-var';
const DEFAULT_UPDATE_MODE_LABEL = 'dd.portainer.update-mode';
const STACK_ID_LABEL = 'dd.portainer.stack-id';
const ENDPOINT_ID_LABEL = 'dd.portainer.endpoint-id';
const DEFAULT_REDEPLOY_TIMEOUT_MS = 5 * 60 * 1000;
const REDEPLOY_POLL_INTERVAL_MS = 2 * 1000;
const PORTAINER_REQUEST_TIMEOUT_MS = 30 * 1000;
// Portainer stack types: 1 Swarm, 2 standalone Compose, 3 Kubernetes.
const STANDALONE_COMPOSE_STACK_TYPE = 2;

type PortainerUpdateMode = 'auto' | 'env' | 'compose';

interface PortainerTriggerConfiguration extends DockerTriggerConfiguration {
  url: string;
  apikey: string;
  allowHttp: boolean;
  updateMode: PortainerUpdateMode;
  versionVarLabel: string;
  updateModeLabel: string;
  pruneStack: boolean;
  redeployTimeout: number;
  digestPinning: boolean;
}

interface PortainerStackSummary {
  Id: number;
  Type?: number;
  Name?: string;
  EndpointId?: number;
  ProjectPath?: string;
  Env?: PortainerStackEnv[];
  WorkflowID?: number;
  GitConfig?: unknown;
  AutoUpdate?: unknown;
  CurrentDeploymentInfo?: unknown;
}

interface PortainerStackDetails extends PortainerStackSummary {
  Env?: PortainerStackEnv[];
}

interface PortainerStackEnv {
  name: string;
  value: string;
}

interface PortainerStackFileResponse {
  StackFileContent: string;
}

interface ComposeFile {
  services?: Record<string, { image?: string; pull_policy?: unknown; build?: unknown } | unknown>;
}

interface ResolvedPortainerStack {
  stack: PortainerStackDetails;
  stackFileContent: string;
}

interface ResolvedPortainerUpdate {
  mode: 'env' | 'compose';
  stack: PortainerStackDetails;
  stackFileContent: string;
  service: string;
  serviceImage?: string;
  versionVar?: string;
  targetImage: string;
  targetImageId?: string;
  targetTag?: string;
  originalImage: string;
  originalImageId?: string;
  prePutRunningReplicas?: number;
  updatedStackFileContent: string;
  updatedEnv: PortainerStackEnv[];
}

interface PortainerRecoveryDescriptor {
  stackId: number;
  endpointId?: number;
  service: string;
  mode: 'env' | 'compose';
  field: string;
  /**
   * `null` means the env variable was absent at capture time (env mode
   * only; compose mode always captures a concrete image reference). Restore
   * must remove the variable rather than write it back as `""`.
   */
  originalValue: string | null;
  targetValue: string;
  originalImage: string;
  originalImageId: string;
  targetImage: string;
  targetImageId: string;
  runningReplicas: number;
}

interface DockerContainerListItem {
  Id?: string;
  ImageID?: string;
  Image?: string;
  State?: string;
  Status?: string;
  Names?: string[];
  Labels?: Record<string, string>;
}

interface DockerApiWithListContainers {
  listContainers: (options?: { all?: boolean }) => Promise<DockerContainerListItem[]>;
  getImage?: (image: string) => { inspect: () => Promise<{ Id?: string; id?: string }> };
}

interface DockerContainerInspectLike {
  Id?: string;
  Image?: string;
  Config?: { Image?: string };
  State?: { Running?: boolean; Status?: string };
}

interface PortainerDockerApiContext {
  Id?: string;
  Image?: string;
  Config?: { Image?: string };
  State?: { Running?: boolean; Status?: string };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePortainerUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseEndpointId(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined || rawValue.trim() === '') {
    return undefined;
  }
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`Portainer endpoint label ${ENDPOINT_ID_LABEL} must be a positive integer`);
  }
  const endpointId = Number(rawValue);
  if (!Number.isSafeInteger(endpointId) || endpointId <= 0) {
    throw new Error(`Portainer endpoint label ${ENDPOINT_ID_LABEL} must be a positive integer`);
  }
  return endpointId;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.posix.normalize(trimmed) : null;
}

function getComposeConfigFiles(labels?: Record<string, string>): string[] {
  const configFiles = labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL];
  if (!configFiles) {
    return [];
  }

  const workingDir = normalizePath(labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL]);
  return configFiles
    .split(',')
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .map((file) =>
      path.posix.isAbsolute(file) || !workingDir ? file : path.posix.join(workingDir, file),
    )
    .map((file) => path.posix.normalize(file));
}

function getComposeProjectPaths(labels?: Record<string, string>): Set<string> {
  const paths = new Set<string>();
  const workingDir = normalizePath(labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL]);
  if (workingDir) {
    paths.add(workingDir);
  }

  for (const configFile of getComposeConfigFiles(labels)) {
    paths.add(path.posix.dirname(configFile));
  }
  return paths;
}

function normalizeImplicitLatest(image: string | undefined): string | undefined {
  if (!image || image.includes('@')) {
    return image;
  }
  const lastSegment = image.split('/').pop() || image;
  if (lastSegment.includes(':')) {
    return image;
  }
  return `${image}:latest`;
}

function normalizeImageRepository(image: string | undefined): string | undefined {
  if (typeof image !== 'string' || image.trim() === '') {
    return undefined;
  }
  let reference = image.trim().split('@', 1)[0];
  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.indexOf(':', lastSlash + 1);
  if (lastColon > lastSlash) {
    reference = reference.slice(0, lastColon);
  }
  if (reference.includes('$')) {
    return undefined;
  }
  const parts = reference.split('/').filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  const firstPart = parts[0].toLowerCase();
  const hasExplicitRegistry =
    parts.length > 1 &&
    (firstPart.includes('.') || firstPart.includes(':') || firstPart === 'localhost');
  let registry = 'docker.io';
  if (hasExplicitRegistry) {
    registry = parts.shift()!.toLowerCase();
    if (registry === 'index.docker.io' || registry === 'registry-1.docker.io') {
      registry = 'docker.io';
    }
  }
  if (registry === 'docker.io' && parts.length === 1) {
    parts.unshift('library');
  }
  return `${registry}/${parts.join('/')}`.toLowerCase();
}

// Ignores the digest rather than folding it into the returned identity. A
// caller pinning the stack image to `repo:tag@sha256:...` and a runtime tag
// `repo:tag` name the same original image across an update cycle: the digest
// only records which manifest that tag resolved to at pin time, not a
// different identity to compare on. A dangling `@` with nothing after it is
// still rejected as malformed input.
function normalizeImageReference(image: string | undefined): string | undefined {
  if (typeof image !== 'string' || image.trim() === '') {
    return undefined;
  }
  const trimmed = image.trim();
  const [reference, digest] = trimmed.split('@', 2);
  if (digest !== undefined && !digest.trim()) {
    return undefined;
  }
  const repository = normalizeImageRepository(reference);
  if (!repository) {
    return undefined;
  }
  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.indexOf(':', lastSlash + 1);
  const tag = lastColon > lastSlash ? reference.slice(lastColon + 1).trim() : 'latest';
  return tag && !tag.includes('$') ? `${repository}:${tag}` : undefined;
}

function validateComposeImageExpression(image: string): void {
  if (!image.includes('$')) {
    return;
  }
  const tagVariable = extractTagVariable(image);
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.indexOf(':', lastSlash + 1);
  const repository = image.slice(0, lastColon > lastSlash ? lastColon : image.length);
  if (!tagVariable || repository.includes('$')) {
    throw new Error('Portainer service image contains unsupported Compose interpolation');
  }
}

function getServiceKey(compose: ComposeFile, container): string | undefined {
  const composeServiceName = container.labels?.[COMPOSE_SERVICE_LABEL];
  const composeProjectName = container.labels?.[COMPOSE_PROJECT_LABEL];
  if (
    composeProjectName?.trim() &&
    composeServiceName?.trim() &&
    compose.services?.[composeServiceName]
  ) {
    return composeServiceName;
  }
  return undefined;
}

function getServiceImage(compose: ComposeFile, service: string): string | undefined {
  const serviceDefinition = compose.services?.[service];
  if (!isPlainObject(serviceDefinition)) {
    return undefined;
  }
  return typeof serviceDefinition.image === 'string' ? serviceDefinition.image : undefined;
}

function validateComposePullPolicy(
  compose: ComposeFile,
  service: string,
  serviceImage: string,
): void {
  const serviceDefinition = compose.services?.[service];
  if (!isPlainObject(serviceDefinition)) {
    return;
  }
  const pullPolicy = serviceDefinition.pull_policy;
  if (pullPolicy === undefined || pullPolicy === 'never') {
    return;
  }
  if (pullPolicy === 'missing' || pullPolicy === 'if_not_present') {
    const normalizedImage = normalizeImageReference(serviceImage);
    if (normalizedImage && !normalizedImage.endsWith(':latest')) {
      return;
    }
  }
  throw new Error(
    `Portainer service ${service} has unsafe Compose pull_policy ${String(pullPolicy)}`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTargetServiceContainer(
  item: DockerContainerListItem,
  container,
  resolved: ResolvedPortainerUpdate,
): boolean {
  const labels = item.Labels || {};
  const service = labels[COMPOSE_SERVICE_LABEL];
  const project = labels[COMPOSE_PROJECT_LABEL];
  const expectedProject = container.labels?.[COMPOSE_PROJECT_LABEL];
  if (service !== resolved.service) {
    return false;
  }
  if (expectedProject && project !== expectedProject) {
    return false;
  }
  return (
    item.State?.toLowerCase() === 'running' &&
    normalizeImageReference(item.Image) === normalizeImageReference(resolved.targetImage) &&
    Boolean(resolved.targetImageId) &&
    item.ImageID === resolved.targetImageId
  );
}

function isMatchingServiceContainer(
  item: DockerContainerListItem,
  container,
  resolved: ResolvedPortainerUpdate,
): boolean {
  const labels = item.Labels || {};
  return (
    labels[COMPOSE_SERVICE_LABEL] === resolved.service &&
    labels[COMPOSE_PROJECT_LABEL] === container.labels?.[COMPOSE_PROJECT_LABEL]
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class PortainerRecoveryUnavailableError extends Error {
  recoveryUnresolved = true;
}

function isComposeVariableStart(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z_]$/.test(value);
}

function isComposeVariablePart(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9_]$/.test(value);
}

interface ComposeInterpolationResult {
  variable?: string;
  operator?: string;
  valid: boolean;
  nextIndex: number;
  closed: boolean;
}

function scanComposeInterpolation(
  value: string,
  startIndex: number,
  onVariable: (variable: string) => void,
): ComposeInterpolationResult {
  let index = startIndex;
  if (!isComposeVariableStart(value[index])) {
    return { valid: false, nextIndex: value.length, closed: false };
  }
  index += 1;
  while (isComposeVariablePart(value[index])) {
    index += 1;
  }
  const variable = value.slice(startIndex, index);
  onVariable(variable);

  let operator: string | undefined;
  const firstOperatorPart = value[index];
  const secondOperatorPart = value[index + 1];
  let valid = firstOperatorPart === '}';
  if (
    firstOperatorPart === ':' &&
    (secondOperatorPart === '-' || secondOperatorPart === '+' || secondOperatorPart === '?')
  ) {
    valid = true;
    operator = `:${secondOperatorPart}`;
    index += 2;
  } else if (firstOperatorPart === '-' || firstOperatorPart === '+' || firstOperatorPart === '?') {
    valid = true;
    operator = firstOperatorPart;
    index += 1;
  }

  while (index < value.length) {
    if (value[index] === '}') {
      return { variable, operator, valid, nextIndex: index + 1, closed: true };
    }
    if (value[index] !== '$') {
      index += 1;
      continue;
    }
    if (value[index + 1] === '$') {
      index += 2;
      continue;
    }
    if (value[index + 1] === '{') {
      const nested = scanComposeInterpolation(value, index + 2, onVariable);
      if (!nested.valid || !nested.closed) {
        valid = false;
      }
      index = nested.nextIndex;
      continue;
    }
    if (isComposeVariableStart(value[index + 1])) {
      let end = index + 2;
      while (isComposeVariablePart(value[end])) {
        end += 1;
      }
      onVariable(value.slice(index + 1, end));
      index = end;
      continue;
    }
    index += 1;
  }
  return { variable, operator, valid, nextIndex: value.length, closed: false };
}

function extractTagVariable(image: string | undefined): string | undefined {
  if (!image || image.includes('@')) {
    return undefined;
  }
  const lastSlashIndex = image.lastIndexOf('/');
  const lastColonIndex = image.indexOf(':', lastSlashIndex + 1);
  if (lastColonIndex <= lastSlashIndex) {
    return undefined;
  }

  const tag = image.slice(lastColonIndex + 1).trim();
  if (!tag.startsWith('${')) {
    return undefined;
  }
  const parsed = scanComposeInterpolation(tag, 2, () => undefined);
  const supportedOperator = parsed.operator === undefined || parsed.operator === ':-';
  return parsed.valid && parsed.closed && parsed.nextIndex === tag.length && supportedOperator
    ? parsed.variable
    : undefined;
}

function findComposeVariableReferences(
  value: unknown,
  variable: string,
  currentPath: (string | number)[] = [],
): (string | number)[][] {
  if (typeof value === 'string') {
    const references: (string | number)[][] = [];
    let index = 0;
    while (index < value.length) {
      if (value[index] !== '$') {
        index += 1;
        continue;
      }
      if (value[index + 1] === '$') {
        index += 2;
        continue;
      }
      if (value[index + 1] === '{') {
        const parsed = scanComposeInterpolation(value, index + 2, (nestedVariable) => {
          if (nestedVariable === variable) {
            references.push(currentPath);
          }
        });
        if (!parsed.valid || !parsed.closed) {
          references.push(currentPath);
        }
        index = parsed.nextIndex;
        continue;
      }
      if (isComposeVariableStart(value[index + 1])) {
        let end = index + 2;
        while (isComposeVariablePart(value[end])) {
          end += 1;
        }
        if (value.slice(index + 1, end) === variable) {
          references.push(currentPath);
        }
        index = end;
        continue;
      }
      index += 1;
    }
    return references;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findComposeVariableReferences(entry, variable, [...currentPath, index]),
    );
  }
  if (!isPlainObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    findComposeVariableReferences(entry, variable, [...currentPath, key]),
  );
}

function validatePortainerEnvVariable(
  compose: ComposeFile,
  service: string,
  serviceImage: string,
  versionVar: string,
): void {
  if (extractTagVariable(serviceImage) !== versionVar) {
    throw new Error(
      `Portainer env variable ${versionVar} must be referenced only by the selected service image tag`,
    );
  }
  const references = findComposeVariableReferences(compose, versionVar);
  const selectedImagePath = ['services', service, 'image'];
  if (
    references.length !== 1 ||
    references[0].length !== selectedImagePath.length ||
    references[0].some((part, index) => part !== selectedImagePath[index])
  ) {
    throw new Error(
      `Portainer env variable ${versionVar} must be referenced only by the selected service image tag`,
    );
  }
}

/**
 * Refuse anything that is not a standalone Compose stack. A Swarm stack carries
 * the same Compose labels, but its nodes pull the tag themselves, so Drydock's
 * local pull, gate and convergence check say nothing about what the cluster
 * ends up running.
 */
function assertStandaloneComposeStack(
  stack: { Type?: number },
  stackId: number,
  source: string,
): void {
  if (stack.Type !== STANDALONE_COMPOSE_STACK_TYPE) {
    throw new Error(
      `Portainer stack ${stackId} is not a standalone Compose stack: ${source} reports type ${stack.Type ?? 'unknown'}. Swarm and Kubernetes stacks are not supported because their nodes pull the image themselves.`,
    );
  }
}

function isGitBackedStack(stack: PortainerStackSummary): boolean {
  return (
    (typeof stack.WorkflowID === 'number' && stack.WorkflowID > 0) ||
    (stack.GitConfig !== undefined && stack.GitConfig !== null) ||
    (stack.AutoUpdate !== undefined && stack.AutoUpdate !== null) ||
    (stack.CurrentDeploymentInfo !== undefined && stack.CurrentDeploymentInfo !== null)
  );
}

function isStackBoundToContainer(
  stack: PortainerStackSummary,
  composeProject: string,
  containerProjectPaths: Set<string>,
): boolean {
  const projectPath = normalizePath(stack.ProjectPath);
  return (
    stack.Name === composeProject && Boolean(projectPath && containerProjectPaths.has(projectPath))
  );
}

function getTargetTag(container): string | undefined {
  const remoteValue = container.updateKind?.remoteValue;
  if (typeof remoteValue === 'string' && remoteValue.trim() !== '') {
    return remoteValue;
  }
  const resultTag = container.result?.tag;
  return typeof resultTag === 'string' && resultTag.trim() !== '' ? resultTag : undefined;
}

// The env-mode pin is written into the stack env variable that renders the tag
// half of a `repo:${VAR}` image, so the bound `repo:tag@sha256:...` identity has
// to be reduced to `tag@sha256:...`. An identity carrying no tag of its own
// cannot be expressed that way: the inherited binding falls back to the bare
// `repo@sha256:...` RepoDigest when the pulled reference already carried a
// digest, and dropping that into the variable would render `repo:repo@sha256:...`
// rather than a reference to anything.
function extractPinnedTagValue(imageIdentity: string): string | undefined {
  const separatorIndex = imageIdentity.indexOf('@');
  const reference = separatorIndex > 0 ? imageIdentity.slice(0, separatorIndex) : '';
  const digest = imageIdentity.slice(separatorIndex + 1).trim();
  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.indexOf(':', lastSlash + 1);
  const tag = lastColon > lastSlash ? reference.slice(lastColon + 1).trim() : '';
  return tag && digest ? `${tag}@${digest}` : undefined;
}

function upsertStackEnv(
  env: PortainerStackEnv[] | undefined,
  name: string,
  value: string,
): PortainerStackEnv[] {
  const nextEnv = (env || []).filter((entry) => entry.name !== name);
  nextEnv.push({ name, value });
  return nextEnv;
}

/**
 * Drop a stack env variable entirely rather than writing it back with an
 * empty value. Used to restore an env-mode recovery capture where the
 * variable was absent at capture time: absent-at-capture must mean absent on
 * restore, not `NAME=""` (see `PortainerRecoveryDescriptor.originalValue`).
 */
function removeStackEnv(env: PortainerStackEnv[] | undefined, name: string): PortainerStackEnv[] {
  return (env || []).filter((entry) => entry.name !== name);
}

/**
 * Validate a persisted Portainer recovery descriptor before it is trusted for
 * any remote call. Returns the names of missing/malformed fields so the
 * caller can report exactly what is wrong instead of dereferencing a field
 * that may not exist (e.g. `recovery.field.slice(...)` when `field` is
 * missing).
 */
function describePortainerRecoveryDescriptorProblems(
  recovery: Partial<PortainerRecoveryDescriptor>,
): string[] {
  const problems: string[] = [];
  if (typeof recovery.stackId !== 'number') {
    problems.push('stackId');
  }
  const validMode = recovery.mode === 'compose' || recovery.mode === 'env';
  if (!validMode) {
    problems.push('mode');
  }
  if (typeof recovery.service !== 'string' || recovery.service === '') {
    problems.push('service');
  }
  if (typeof recovery.field !== 'string' || recovery.field === '') {
    problems.push('field');
  } else if (validMode && recovery.mode === 'env' && !recovery.field.startsWith('env:')) {
    problems.push('field');
  } else if (validMode && recovery.mode === 'env' && recovery.field.slice('env:'.length) === '') {
    problems.push('field');
  } else if (validMode && recovery.mode === 'compose' && !recovery.field.startsWith('compose:')) {
    problems.push('field');
  }
  if (recovery.originalValue !== null && typeof recovery.originalValue !== 'string') {
    problems.push('originalValue');
  }
  if (typeof recovery.targetValue !== 'string') {
    problems.push('targetValue');
  }
  if (typeof recovery.originalImage !== 'string' || recovery.originalImage === '') {
    problems.push('originalImage');
  }
  if (typeof recovery.originalImageId !== 'string' || recovery.originalImageId === '') {
    problems.push('originalImageId');
  }
  if (typeof recovery.targetImage !== 'string' || recovery.targetImage === '') {
    problems.push('targetImage');
  }
  if (typeof recovery.targetImageId !== 'string' || recovery.targetImageId === '') {
    problems.push('targetImageId');
  }
  if (
    typeof recovery.runningReplicas !== 'number' ||
    !Number.isInteger(recovery.runningReplicas) ||
    recovery.runningReplicas < 1
  ) {
    problems.push('runningReplicas');
  }
  return problems;
}

/**
 * Update a Portainer-managed compose stack through Portainer's stack redeploy API.
 */
class Portainer extends Docker<PortainerTriggerConfiguration> {
  getConfigurationSchema() {
    return super
      .getConfigurationSchema()
      .append({
        url: this.joi
          .string()
          .uri({
            scheme: ['http', 'https'],
          })
          .custom((value, helpers) => {
            const configuration = helpers.state.ancestors[0] as { allowHttp?: boolean };
            if (value.startsWith('http://') && configuration.allowHttp !== true) {
              return helpers.error('any.invalid');
            }
            return value;
          })
          .required(),
        apikey: this.joi.string().required(),
        allowHttp: this.joi.boolean().default(false),
        updateMode: this.joi.string().valid('auto', 'env', 'compose').default('auto'),
        versionVarLabel: this.joi.string().default(DEFAULT_VERSION_VAR_LABEL),
        updateModeLabel: this.joi.string().default(DEFAULT_UPDATE_MODE_LABEL),
        pruneStack: this.joi.boolean().default(false),
        redeployTimeout: this.joi.number().integer().min(1).default(DEFAULT_REDEPLOY_TIMEOUT_MS),
        digestPinning: this.joi.boolean().default(false),
      })
      .rename('updatemode', 'updateMode', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('versionvarlabel', 'versionVarLabel', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('updatemodelabel', 'updateModeLabel', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('prunestack', 'pruneStack', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('redeploytimeout', 'redeployTimeout', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('digestpinning', 'digestPinning', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('allowhttp', 'allowHttp', {
        ignoreUndefined: true,
        override: true,
      });
  }

  maskConfiguration() {
    return this.maskFields(['apikey']);
  }

  getPortainerUrl() {
    const url = normalizePortainerUrl(this.configuration.url);
    if (url.startsWith('http://') && this.configuration.allowHttp !== true) {
      throw new Error('Portainer HTTP requires allowHttp to be enabled');
    }
    return url;
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.configuration.apikey,
    };
  }

  async portainerFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.getPortainerUrl()}${pathname}`, {
      ...init,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(PORTAINER_REQUEST_TIMEOUT_MS),
      headers: {
        ...this.getHeaders(),
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Portainer API request ${pathname} failed with HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async getPortainerStacks(): Promise<PortainerStackSummary[]> {
    return this.portainerFetch<PortainerStackSummary[]>('/api/stacks');
  }

  async getPortainerStack(id: number): Promise<PortainerStackDetails> {
    return this.portainerFetch<PortainerStackDetails>(`/api/stacks/${id}`);
  }

  async getPortainerStackFile(id: number): Promise<string> {
    const response = await this.portainerFetch<PortainerStackFileResponse>(
      `/api/stacks/${id}/file`,
    );
    return response.StackFileContent;
  }

  async redeployPortainerStack(stack: PortainerStackDetails, stackFileContent: string, env) {
    const endpointId = stack.EndpointId;
    if (!Number.isFinite(endpointId)) {
      throw new Error(`Portainer stack ${stack.Id} has no EndpointId`);
    }

    if (this.configuration.dryrun) {
      this.log.info(
        `Skip Portainer stack ${stack.Name || stack.Id} redeploy because dry-run mode is enabled`,
      );
      return;
    }

    await this.portainerFetch<void>(`/api/stacks/${stack.Id}?endpointId=${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        stackFileContent,
        env,
        prune: this.configuration.pruneStack,
        pullImage: false,
      }),
    });
  }

  async waitForPortainerRedeploy(
    dockerApi: DockerApiWithListContainers | undefined,
    container,
    resolved: ResolvedPortainerUpdate,
    logContainer,
  ) {
    if (!dockerApi || typeof dockerApi.listContainers !== 'function') {
      throw new Error(
        'Unable to verify Portainer redeploy because Docker listContainers is unavailable',
      );
    }

    const timeoutMs = this.configuration.redeployTimeout;
    if (!(timeoutMs > 0)) {
      throw new Error('Portainer redeploy verification requires a positive timeout');
    }

    const expectedReplicas = resolved.prePutRunningReplicas ?? 1;
    const startedAt = Date.now();
    let lastSeen: string | undefined;
    do {
      const containers = await dockerApi.listContainers({ all: true });
      const matching = containers.filter(
        (item) =>
          item.State?.toLowerCase() === 'running' &&
          isMatchingServiceContainer(item, container, resolved),
      );
      if (
        matching.length >= expectedReplicas &&
        matching.every((item) => isTargetServiceContainer(item, container, resolved))
      ) {
        const verified = matching[0];
        logContainer.info(
          `Portainer redeploy verified: ${verified.Names?.[0]?.replace(/^\//, '') || verified.Id?.substring(0, 12) || resolved.service} now uses ${resolved.targetImage}`,
        );
        return;
      }

      const sameService = matching.find((item) => item.Image);
      if (sameService?.Image && sameService.Image !== lastSeen) {
        lastSeen = sameService.Image;
        logContainer.debug(
          `Waiting for Portainer redeploy of ${resolved.service}: current image is ${sameService.Image}, target is ${resolved.targetImage}`,
        );
      }

      await delay(REDEPLOY_POLL_INTERVAL_MS);
    } while (Date.now() - startedAt < timeoutMs);

    throw new Error(
      `Timed out waiting for Portainer stack ${resolved.stack.Name || resolved.stack.Id} service ${resolved.service} to use ${resolved.targetImage}`,
    );
  }

  async capturePulledImageId(
    dockerApi: DockerApiWithListContainers | undefined,
    image: string,
  ): Promise<string> {
    if (!dockerApi || typeof dockerApi.getImage !== 'function') {
      throw new Error('Unable to verify pulled image because Docker getImage is unavailable');
    }
    const inspected = await dockerApi.getImage(image).inspect();
    const imageId = inspected.Id || inspected.id;
    if (typeof imageId !== 'string' || imageId.trim() === '') {
      throw new Error('Unable to verify pulled image because its image ID is unavailable');
    }
    return imageId.trim();
  }

  async verifyPortainerEndpoint(
    endpointId: number | undefined,
    container,
    currentContainerSpec: DockerContainerInspectLike | undefined,
  ): Promise<void> {
    if (!Number.isSafeInteger(endpointId) || (endpointId as number) <= 0) {
      throw new Error('Portainer endpoint identity verification requires a valid endpoint');
    }
    const containerId = typeof container?.id === 'string' ? container.id.trim() : '';
    const localId = currentContainerSpec?.Id?.trim();
    const localImageId = currentContainerSpec?.Image?.trim();
    const localImageReference = normalizeImageReference(currentContainerSpec?.Config?.Image);
    const localRunning = currentContainerSpec?.State?.Running;
    const localStatus = currentContainerSpec?.State?.Status?.trim();
    if (
      !containerId ||
      !localId ||
      !localImageId ||
      !localImageReference ||
      localRunning === undefined ||
      !localStatus
    ) {
      throw new Error('Portainer endpoint identity verification data is unavailable');
    }
    if (localId !== containerId) {
      throw new Error('Portainer endpoint does not match the watched Docker container');
    }

    let remote: PortainerDockerApiContext;
    try {
      remote = await this.portainerFetch<PortainerDockerApiContext>(
        `/api/endpoints/${endpointId}/docker/containers/${encodeURIComponent(containerId)}/json`,
      );
    } catch (error: unknown) {
      throw new Error(`Portainer endpoint verification failed: ${getErrorMessage(error)}`);
    }
    const remoteId = remote?.Id?.trim();
    const remoteImageId = remote?.Image?.trim();
    const remoteImageReference = normalizeImageReference(remote?.Config?.Image);
    if (
      remoteId !== containerId ||
      remoteId !== localId ||
      remoteImageId !== localImageId ||
      remoteImageReference !== localImageReference ||
      remote.State?.Running !== localRunning ||
      remote.State?.Status?.trim() !== localStatus
    ) {
      throw new Error('Portainer endpoint does not match the watched Docker runtime');
    }
  }

  async resolvePortainerStack(container): Promise<ResolvedPortainerStack> {
    const composeProject = container.labels?.[COMPOSE_PROJECT_LABEL]?.trim();
    const composeService = container.labels?.[COMPOSE_SERVICE_LABEL]?.trim();
    if (!composeProject || !composeService) {
      throw new Error(
        `Portainer updates require compose project and service identity labels for container ${container.name}`,
      );
    }

    const endpointId = parseEndpointId(container.labels?.[ENDPOINT_ID_LABEL]);
    const configuredStackId = container.labels?.[STACK_ID_LABEL];
    const stacks = await this.getPortainerStacks();
    const containerProjectPaths = getComposeProjectPaths(container.labels);
    const candidates = stacks.filter(
      (stack) =>
        (endpointId === undefined || stack.EndpointId === endpointId) &&
        isStackBoundToContainer(stack, composeProject, containerProjectPaths),
    );
    const explicitlySelected = configuredStackId
      ? stacks.find((stack) => String(stack.Id) === configuredStackId)
      : undefined;
    if (
      explicitlySelected &&
      endpointId !== undefined &&
      explicitlySelected.EndpointId !== endpointId
    ) {
      throw new Error(
        `Portainer stack ${explicitlySelected.Id} does not belong to endpoint ${endpointId}`,
      );
    }
    const matchedStack =
      (configuredStackId && candidates.find((stack) => String(stack.Id) === configuredStackId)) ||
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!configuredStackId && candidates.length > 1) {
      throw new Error(
        `Unable to resolve an unambiguous Portainer stack for container ${container.name}`,
      );
    }

    if (!matchedStack) {
      throw new Error(`Unable to resolve Portainer stack for container ${container.name}`);
    }

    // Checked on both responses, and on the detail response by itself, so the
    // merge below cannot let a detail payload that omits the type inherit the
    // summary's. Both run before the stack file fetch, the pull and the gate.
    assertStandaloneComposeStack(matchedStack, matchedStack.Id, 'the Portainer stack list');
    const stackDetails = await this.getPortainerStack(matchedStack.Id);
    assertStandaloneComposeStack(
      stackDetails,
      matchedStack.Id,
      'the Portainer stack detail response',
    );
    const stack = {
      ...matchedStack,
      ...stackDetails,
    };
    if (endpointId !== undefined && stack.EndpointId !== endpointId) {
      throw new Error(`Portainer stack ${stack.Id} does not belong to endpoint ${endpointId}`);
    }
    if (!isStackBoundToContainer(stack, composeProject, containerProjectPaths)) {
      throw new Error(`Unable to resolve Portainer stack for container ${container.name}`);
    }
    if (isGitBackedStack(stack)) {
      throw new Error('Git-backed Portainer stacks cannot be updated through the file-stack API');
    }

    const stackFileContent = await this.getPortainerStackFile(stack.Id);
    return { stack, stackFileContent };
  }

  resolveConfiguredUpdateMode(container): PortainerUpdateMode {
    const labelMode = container.labels?.[this.configuration.updateModeLabel];
    if (labelMode === 'auto' || labelMode === 'env' || labelMode === 'compose') {
      return labelMode;
    }
    return this.configuration.updateMode;
  }

  resolvePortainerUpdate(container, targetImage: string): Promise<ResolvedPortainerUpdate> {
    if (container.updateKind?.kind !== 'tag') {
      return Promise.reject(new Error('Portainer provider only supports tag updates'));
    }
    return this.resolvePortainerStack(container).then(({ stack, stackFileContent }) => {
      const compose = yaml.parse(stackFileContent, {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      }) as ComposeFile;
      const registry = getState().registry[container.image.registry.name];
      const currentImage = registry.getImageFullName(container.image, container.image.tag.value);
      const service = getServiceKey(compose, container);
      if (!service) {
        throw new Error(
          `Unable to resolve Portainer stack service for container ${container.name}`,
        );
      }

      const serviceImage = getServiceImage(compose, service);
      if (!serviceImage) {
        throw new Error(`Portainer service ${service} has no image repository`);
      }
      validateComposePullPolicy(compose, service, serviceImage);
      validateComposeImageExpression(serviceImage);
      const runtimeRepository = normalizeImageRepository(currentImage);
      const serviceRepository = normalizeImageRepository(serviceImage);
      if (!runtimeRepository || !serviceRepository || runtimeRepository !== serviceRepository) {
        throw new Error(
          `Portainer service ${service} image repository does not match the runtime image repository`,
        );
      }
      const explicitVersionVar = container.labels?.[this.configuration.versionVarLabel];
      const detectedVersionVar = extractTagVariable(serviceImage);
      const updateMode = this.resolveConfiguredUpdateMode(container);
      const targetTag = getTargetTag(container);
      const shouldUseEnv =
        updateMode === 'env' ||
        (updateMode === 'auto' && Boolean(explicitVersionVar || detectedVersionVar));

      if (shouldUseEnv) {
        const versionVar = explicitVersionVar || detectedVersionVar;
        if (!versionVar) {
          throw new Error(
            `Portainer env update for ${container.name} requires ${this.configuration.versionVarLabel} or a tag variable in the compose image`,
          );
        }
        validatePortainerEnvVariable(compose, service, serviceImage, versionVar);
        if (!targetTag) {
          throw new Error(
            `Portainer env update for ${container.name} requires a tag update target`,
          );
        }
        return {
          mode: 'env',
          stack,
          stackFileContent,
          service,
          serviceImage,
          versionVar,
          originalImage: currentImage,
          targetImage,
          targetTag,
          updatedStackFileContent: stackFileContent,
          updatedEnv: upsertStackEnv(stack.Env, versionVar, targetTag),
        };
      }

      return {
        mode: 'compose',
        stack,
        stackFileContent,
        service,
        serviceImage,
        originalImage: currentImage,
        targetImage,
        targetTag,
        updatedStackFileContent: updateComposeServiceImageInText(
          stackFileContent,
          service,
          targetImage,
        ),
        updatedEnv: stack.Env || [],
      };
    });
  }

  async preview(container) {
    const preview = await super.preview(container);
    if (!preview || typeof preview !== 'object' || 'error' in preview) {
      return preview;
    }

    const resolved = await this.resolvePortainerUpdate(container, preview.newImage);
    return {
      ...preview,
      portainer: {
        stackId: resolved.stack.Id,
        stackName: resolved.stack.Name,
        endpointId: resolved.stack.EndpointId,
        service: resolved.service,
        mode: resolved.mode,
        versionVar: resolved.versionVar,
        mutation: {
          intent:
            resolved.mode === 'env'
              ? 'update-portainer-stack-env'
              : 'update-portainer-stack-compose-service-image',
          dryRun: Boolean(this.configuration.dryrun),
          willWrite: !this.configuration.dryrun,
        },
      },
    };
  }

  async runPreRuntimeUpdateLifecycle(context, container, logContainer, runtimeContext?: unknown) {
    if (container.updateKind?.kind !== 'tag') {
      throw new Error('Portainer provider only supports tag updates');
    }
    if (this.configuration.dryrun) {
      logContainer.info('Skip prune/backup in Portainer dry-run mode');
      return;
    }
    await super.runPreRuntimeUpdateLifecycle(context, container, logContainer, runtimeContext);
  }

  /**
   * Pin what the redeploy resolves to without changing which mutation the mode
   * owns. `compose` mode already writes a literal reference into the stack
   * file, so the pin rewrites that `image:` line to `repo:tag@sha256:...`.
   * `env` mode leaves the stack file alone and updates a Portainer stack env
   * variable that is the whole tag of the service image, so the pin goes into
   * that variable's value as `tag@sha256:...` and Portainer renders the same
   * bound identity while the stack text stays an env template. Rewriting the
   * `image:` line in env mode instead would delete the `${VAR}` reference the
   * stack is built on, leave the env update writing a variable nothing reads,
   * and silently turn the stack into a compose-mode stack on the next `auto`
   * cycle. A pin that cannot be expressed fails closed under `required` and
   * warns under the other policies rather than redeploying a mutable tag
   * while claiming it was pinned.
   */
  applyPortainerDigestPin(
    resolved: ResolvedPortainerUpdate,
    imageIdentity: string | undefined,
    bindingPolicy: 'required' | 'optional' | 'disabled',
    logContainer,
  ): void {
    const stackLabel = `${resolved.stack.Name || resolved.stack.Id} service ${resolved.service}`;
    if (!imageIdentity) {
      this.refusePortainerDigestPin(
        bindingPolicy,
        `Unable to pin Portainer stack ${stackLabel} to the bound image digest: no immutable image identity was captured`,
        logContainer,
      );
      return;
    }

    // The identity binder normalises the repository it binds to, which drops
    // an explicit `docker.io/` prefix the stack file wrote literally. The
    // Docker/Dockercompose path already restores that prefix when it matches
    // what the compose service names; reuse the same helper here so the
    // rewritten stack file still matches what the operator wrote (DR-65).
    const pinnedImageIdentity = preserveExplicitDockerIoPrefix(
      resolved.serviceImage,
      imageIdentity,
    );

    if (resolved.mode === 'env') {
      const { versionVar } = resolved;
      const pinnedTagValue = extractPinnedTagValue(pinnedImageIdentity);
      if (
        !versionVar ||
        extractTagVariable(resolved.serviceImage) !== versionVar ||
        !pinnedTagValue
      ) {
        this.refusePortainerDigestPin(
          bindingPolicy,
          `Unable to pin Portainer stack ${stackLabel} to the bound image digest in env mode: ${imageIdentity} cannot be expressed as the value of a version env variable that renders the whole image tag`,
          logContainer,
        );
        return;
      }
      resolved.updatedEnv = upsertStackEnv(resolved.updatedEnv, versionVar, pinnedTagValue);
      logContainer.info(
        `Pin Portainer stack ${stackLabel} env variable ${versionVar} to ${pinnedTagValue}`,
      );
      return;
    }

    resolved.updatedStackFileContent = updateComposeServiceImageInText(
      resolved.stackFileContent,
      resolved.service,
      pinnedImageIdentity,
    );
    logContainer.info(`Pin Portainer stack ${stackLabel} image to ${pinnedImageIdentity}`);
  }

  refusePortainerDigestPin(
    bindingPolicy: 'required' | 'optional' | 'disabled',
    message: string,
    logContainer,
  ): void {
    if (bindingPolicy === 'required') {
      throw new Error(message);
    }
    logContainer.warn(`${message}; redeploying without a pinned image reference`);
  }

  async runContainerUpdateLifecycle(container, runtimeContext?: unknown) {
    if (container.updateKind?.kind !== 'tag') {
      throw new Error('Portainer provider only supports tag updates');
    }
    if (getRequestedOperationId(container, runtimeContext)) {
      return super.runContainerUpdateLifecycle(container, runtimeContext);
    }

    const existing =
      updateOperationStore.getActiveOperationByContainerId(container.id) ||
      updateOperationStore.getActiveOperationByContainerName(container.name, {
        agent: container.agent,
        watcher: container.watcher,
      });
    const operationId = existing?.id || crypto.randomUUID();
    if (existing) {
      return super.runContainerUpdateLifecycle(container, { operationId });
    }
    updateOperationStore.insertOperation({
      id: operationId,
      containerId: container.id,
      containerName: container.name,
      container,
      triggerName: this.getId(),
      status: 'queued',
      phase: 'queued',
    });
    await saveStore();
    return super.runContainerUpdateLifecycle(container, { operationId });
  }

  async performContainerUpdate(
    context,
    container,
    logContainer,
    runtimeContext?: unknown,
    postPullHook?: (
      operationId: string,
      imageIdentity?: string,
      options?: PostPullHookOptions,
    ) => Promise<void>,
  ) {
    if (container.updateKind?.kind !== 'tag') {
      throw new Error('Portainer provider only supports tag updates');
    }
    const operationId = getRequestedOperationId(container, runtimeContext);
    if (operationId) {
      updateOperationStore.updateOperation(operationId, {
        status: 'in-progress',
        phase: 'pulling',
      });
      await saveStore();
    }
    const resolved = await this.resolvePortainerUpdate(container, context.newImage);
    logContainer.info(
      `Redeploy Portainer stack ${resolved.stack.Name || resolved.stack.Id} service ${resolved.service} using ${resolved.mode} mode`,
    );

    await this.verifyPortainerEndpoint(
      resolved.stack.EndpointId,
      container,
      context.currentContainerSpec,
    );

    await this.pullImage(context.dockerApi, context.auth, context.newImage, logContainer);

    // Pin the mutable repo:tag to the digest the pull actually fetched, exactly
    // as the Docker and Compose paths do, so the gate verifies and scans that
    // image instead of whatever the tag points at by the time it runs. Under
    // binding policy `required` this throws before the hook and nothing is
    // redeployed; under `warn` it records the skipped scan and returns
    // `skipSecurityGate`, which suppresses only the gate half of the hook.
    const binding = await this.bindPulledImageIdentity(
      context.dockerApi,
      context.newImage,
      container,
      logContainer,
    );
    // The identity the redeploy has to converge on comes from the bound digest,
    // not from the mutable tag. Reading it from the tag would anchor the check
    // on whatever the tag happened to point at rather than on the image the
    // gate scanned, so a tag that moves away and back again (A -> B -> A) would
    // satisfy the before/after comparison below while the running container was
    // never the scanned image.
    const scannedImage = binding.imageIdentity ?? context.newImage;
    resolved.targetImageId = await this.capturePulledImageId(context.dockerApi, scannedImage);
    if (postPullHook) {
      await postPullHook(
        getRequestedOperationId(container, runtimeContext) ?? '',
        binding.imageIdentity,
        { skipSecurityGate: binding.skipSecurityGate === true },
      );
    }
    // Portainer redeploys from the reference in the stack file with pullImage
    // disabled, so an unpinned tag has to still resolve to the scanned image at
    // the moment the stack is handed over. This cannot bind the redeploy to
    // that image the way the Docker path's own create does, because Portainer
    // performs the create. A move after this point is only detected after the
    // fact: the redeploy fails to converge on the scanned image ID, so an
    // unscanned container runs until the timeout expires, and the restore below
    // is an attempt whose own failure is reported in the error. Pinning what
    // gets PUT below closes that window instead of only detecting it.
    const verifiedTargetImageId = await this.capturePulledImageId(
      context.dockerApi,
      context.newImage,
    );
    if (verifiedTargetImageId !== resolved.targetImageId) {
      throw new Error('Pulled image identity changed during the post-pull hook');
    }

    if (this.configuration.dryrun) {
      logContainer.info('Skip Portainer stack redeploy and verification in dry-run mode');
      return false;
    }

    // A binding policy of `required` forces what gets PUT to carry the pinned
    // `repo:tag@sha256:...` identity, mirroring what the compose action's own
    // `digestPinning` option does when the operator opts in. With the mutable
    // tag never appearing in what Portainer resolves, a retag after this point
    // cannot reach the container it creates: `pullImage:false` means it has to
    // use the image already tagged locally with that digest, and moving the
    // bare tag elsewhere does not change what that reference resolves to.
    // Optional/disabled policies keep today's unpinned redeploy unless the
    // operator has enabled `digestPinning` themselves.
    const bindingPolicy = this.getPostPullIdentityBindingPolicy(container);
    if (this.configuration.digestPinning === true || bindingPolicy === 'required') {
      this.applyPortainerDigestPin(resolved, binding.imageIdentity, bindingPolicy, logContainer);
    }

    const dockerApi = context.dockerApi as DockerApiWithListContainers | undefined;
    if (!dockerApi || typeof dockerApi.listContainers !== 'function') {
      throw new Error(
        'Unable to update Portainer stack because Docker listContainers is unavailable',
      );
    }
    const currentContainers = await dockerApi.listContainers({ all: true });
    const matchingCurrent = currentContainers.filter((item) =>
      isMatchingServiceContainer(item, container, resolved),
    );
    const runningCurrent = matchingCurrent.filter(
      (item) => item.State?.toLowerCase() === 'running',
    );
    resolved.prePutRunningReplicas = runningCurrent.length;
    if (resolved.prePutRunningReplicas < 1) {
      throw new Error(
        `Unable to update Portainer stack because no running replicas were found for ${resolved.service}`,
      );
    }
    const originalImageIds = runningCurrent.map((item) => item.ImageID?.trim());
    const originalImages = runningCurrent.map((item) => normalizeImageReference(item.Image));
    const expectedOriginalImage = normalizeImageReference(resolved.originalImage);
    if (
      originalImageIds.some((imageId) => !imageId) ||
      originalImages.some((image) => !image) ||
      !expectedOriginalImage ||
      originalImages.some((image) => image !== expectedOriginalImage) ||
      new Set(originalImageIds).size !== 1 ||
      new Set(originalImages).size !== 1
    ) {
      throw new Error(
        `Unable to update Portainer stack because running replicas do not share one original image identity`,
      );
    }
    resolved.originalImageId = originalImageIds[0];

    const recovery: PortainerRecoveryDescriptor = {
      stackId: resolved.stack.Id,
      ...(resolved.stack.EndpointId !== undefined ? { endpointId: resolved.stack.EndpointId } : {}),
      service: resolved.service,
      mode: resolved.mode,
      field:
        resolved.mode === 'env'
          ? `env:${resolved.versionVar || ''}`
          : `compose:${resolved.service}.image`,
      originalValue:
        resolved.mode === 'env'
          ? (resolved.stack.Env?.find((item) => item.name === resolved.versionVar)?.value ?? null)
          : resolved.serviceImage || resolved.originalImage,
      targetValue: resolved.mode === 'env' ? resolved.targetTag || '' : resolved.targetImage,
      originalImage: resolved.originalImage,
      originalImageId: resolved.originalImageId,
      targetImage: resolved.targetImage,
      targetImageId: resolved.targetImageId || '',
      runningReplicas: resolved.prePutRunningReplicas,
    };
    if (operationId) {
      updateOperationStore.updateOperation(operationId, {
        phase: 'portainer-target',
        portainerRecovery: recovery,
      });
      await saveStore();
    }

    let primaryError: unknown;
    try {
      await this.redeployPortainerStack(
        resolved.stack,
        resolved.updatedStackFileContent,
        resolved.updatedEnv,
      );
    } catch (error: unknown) {
      primaryError = error;
    }

    try {
      await this.waitForPortainerRedeploy(context.dockerApi, container, resolved, logContainer);
      primaryError = undefined;
    } catch (waitError: unknown) {
      primaryError ??= waitError;
    }

    if (primaryError) {
      let restorePutError: unknown;
      let restoreWaitError: unknown;
      try {
        if (operationId) {
          updateOperationStore.updateOperation(operationId, {
            phase: 'portainer-restore',
            portainerRecovery: recovery,
          });
          await saveStore();
        }
        await this.redeployPortainerStack(
          resolved.stack,
          resolved.stackFileContent,
          resolved.stack.Env || [],
        );
      } catch (error: unknown) {
        restorePutError = error;
      }
      if (!restorePutError) {
        try {
          await this.waitForPortainerRedeploy(
            context.dockerApi,
            container,
            {
              ...resolved,
              targetImage: resolved.originalImage,
              targetImageId: resolved.originalImageId,
              prePutRunningReplicas: resolved.prePutRunningReplicas,
            },
            logContainer,
          );
        } catch (restoreError: unknown) {
          restoreWaitError = restoreError;
        }
      }
      const restoreError = restorePutError || restoreWaitError;
      if (restoreError) {
        const restoreMessage = getErrorMessage(restoreError);
        logContainer.warn(`Portainer stack restore failed: ${restoreMessage}`);
        throw new Error(
          `${getErrorMessage(primaryError)} (Portainer restore failed: ${restoreMessage})`,
        );
      }
      throw primaryError;
    }

    return true;
  }

  async reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer) {
    const pending =
      updateOperationStore.getInProgressOperationByContainerId(container.id) ||
      updateOperationStore.getInProgressOperationByContainerName(container.name, {
        agent: container.agent,
        watcher: container.watcher,
      });
    if (!pending) {
      return;
    }
    const recovery = pending.portainerRecovery as Partial<PortainerRecoveryDescriptor> | undefined;
    if (!recovery) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer recovery descriptor is missing for operation ${pending.id}`,
      );
    }
    if (container.agent) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer update operation ${pending.id} is agent-owned and cannot be recovered`,
      );
    }
    const descriptorProblems = describePortainerRecoveryDescriptorProblems(recovery);
    if (descriptorProblems.length > 0) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer recovery descriptor is invalid for operation ${pending.id}: missing or malformed ${descriptorProblems.join(', ')}`,
      );
    }
    if (!dockerApi || typeof dockerApi.listContainers !== 'function') {
      throw new PortainerRecoveryUnavailableError(
        `Docker runtime is unavailable for Portainer operation ${pending.id}`,
      );
    }

    // A boot-time failure to even read the Portainer API is not evidence the
    // update failed -- the controller never inspected the stack, so it can't
    // report `update-failed` for it. Surface it the same way an unresolvable
    // operation is surfaced (`PortainerRecoveryUnavailableError` -> `expired`
    // in `recovery.ts`) instead of letting a bare `Error` fall through to a
    // `failed` classification.
    let stack: PortainerStackDetails;
    try {
      stack = await this.getPortainerStack(recovery.stackId);
    } catch (error: unknown) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer API is unavailable for operation ${pending.id}: ${getErrorMessage(error)}`,
      );
    }
    if (recovery.endpointId !== undefined && stack.EndpointId !== recovery.endpointId) {
      throw new Error(
        `Refusing Portainer recovery for operation ${pending.id}: stack endpoint changed`,
      );
    }
    let stackFileContent: string;
    try {
      stackFileContent = await this.getPortainerStackFile(recovery.stackId);
    } catch (error: unknown) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer API is unavailable for operation ${pending.id}: ${getErrorMessage(error)}`,
      );
    }

    const envVariable = recovery.mode === 'env' ? recovery.field.slice('env:'.length) : undefined;
    let definition: 'original' | 'target' | undefined;
    if (recovery.mode === 'env') {
      const value = stack.Env?.find((entry) => entry.name === envVariable)?.value;
      if (
        value === undefined ? recovery.originalValue === null : value === recovery.originalValue
      ) {
        definition = 'original';
      }
      if (value === recovery.targetValue) {
        definition = 'target';
      }
    } else {
      const compose = yaml.parse(stackFileContent, {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      }) as ComposeFile;
      const serviceImage = getServiceImage(compose, recovery.service);
      const normalizedServiceImage = normalizeImageReference(serviceImage);
      if (normalizedServiceImage === undefined) {
        // An unresolvable/interpolated reference must never compare equal to
        // anything (including another unresolvable reference): treat it as
        // "cannot verify" and refuse rather than silently matching whatever
        // the descriptor happens to also fail to normalize to.
        throw new Error(
          `Refusing Portainer recovery for operation ${pending.id}: stack service image cannot be resolved to a concrete reference`,
        );
      }
      if (normalizedServiceImage === normalizeImageReference(recovery.originalValue ?? undefined)) {
        definition = 'original';
      }
      if (normalizedServiceImage === normalizeImageReference(recovery.targetValue)) {
        definition = 'target';
      }
    }
    if (!definition) {
      throw new Error(
        `Refusing Portainer recovery for operation ${pending.id}: stack definition is neither original nor target`,
      );
    }

    const containers = await dockerApi.listContainers({ all: true });
    const matching = containers.filter((item) =>
      isMatchingServiceContainer(item, container, {
        service: recovery.service,
      } as ResolvedPortainerUpdate),
    );
    const running = matching.filter((item) => item.State?.toLowerCase() === 'running');
    if (running.length === 0) {
      throw new PortainerRecoveryUnavailableError(
        `Portainer runtime is unavailable for operation ${pending.id}`,
      );
    }
    const runtime =
      running.length === recovery.runningReplicas &&
      running.every(
        (item) =>
          normalizeImageReference(item.Image) === normalizeImageReference(recovery.targetImage) &&
          item.ImageID === recovery.targetImageId,
      )
        ? 'target'
        : running.length === recovery.runningReplicas &&
            running.every(
              (item) =>
                normalizeImageReference(item.Image) ===
                  normalizeImageReference(recovery.originalImage) &&
                item.ImageID === recovery.originalImageId,
            )
          ? 'original'
          : undefined;
    if (!runtime) {
      throw new Error(
        `Refusing Portainer recovery for operation ${pending.id}: runtime is neither original nor target`,
      );
    }

    if (pending.phase === 'portainer-target' && definition === 'target' && runtime === 'target') {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });
      return;
    }
    if (
      pending.phase === 'portainer-restore' &&
      definition === 'original' &&
      runtime === 'original'
    ) {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'Portainer restore completed during recovery',
      });
      return;
    }

    const restore = pending.phase === 'portainer-restore';
    const desiredValue = restore ? recovery.originalValue : recovery.targetValue;
    const updatedStackFileContent =
      recovery.mode === 'compose'
        ? updateComposeServiceImageInText(
            stackFileContent,
            recovery.service,
            // Compose mode never captures a null originalValue (the service
            // image is always a concrete reference at capture time); the
            // fallback only guards the shared string | null descriptor type.
            desiredValue ?? recovery.originalImage,
          )
        : stackFileContent;
    const updatedEnv =
      recovery.mode === 'env'
        ? desiredValue === null
          ? removeStackEnv(stack.Env, envVariable as string)
          : upsertStackEnv(stack.Env, envVariable as string, desiredValue)
        : stack.Env || [];
    updateOperationStore.updateOperation(pending.id, {
      phase: restore ? 'portainer-restore' : 'portainer-target',
      portainerRecovery: recovery,
    });
    await saveStore();

    // Keep the descriptor available until a terminal state is actually
    // recorded: attempt to restore the pre-reissue stack definition if the
    // reissued redeploy fails, the same way `performContainerUpdate` restores
    // on failure, instead of letting the error propagate straight to the
    // caller's generic `failed` classification with nothing attempted.
    const preReissueImage = definition === 'target' ? recovery.targetImage : recovery.originalImage;
    const preReissueImageId =
      definition === 'target' ? recovery.targetImageId : recovery.originalImageId;
    let reissueError: unknown;
    try {
      await this.redeployPortainerStack(stack, updatedStackFileContent, updatedEnv);
    } catch (error: unknown) {
      reissueError = error;
    }
    if (!reissueError) {
      try {
        await this.waitForPortainerRedeploy(
          dockerApi,
          container,
          {
            mode: recovery.mode,
            stack,
            stackFileContent,
            service: recovery.service,
            targetImage: restore ? recovery.originalImage : recovery.targetImage,
            targetImageId: restore ? recovery.originalImageId : recovery.targetImageId,
            originalImage: recovery.originalImage,
            prePutRunningReplicas: recovery.runningReplicas,
            updatedStackFileContent,
            updatedEnv,
          },
          logContainer,
        );
      } catch (waitError: unknown) {
        reissueError = waitError;
      }
    }

    if (reissueError) {
      let restorePutError: unknown;
      let restoreWaitError: unknown;
      try {
        await this.redeployPortainerStack(stack, stackFileContent, stack.Env || []);
      } catch (error: unknown) {
        restorePutError = error;
      }
      if (!restorePutError) {
        try {
          await this.waitForPortainerRedeploy(
            dockerApi,
            container,
            {
              mode: recovery.mode,
              stack,
              stackFileContent,
              service: recovery.service,
              targetImage: preReissueImage,
              targetImageId: preReissueImageId,
              originalImage: recovery.originalImage,
              prePutRunningReplicas: recovery.runningReplicas,
              updatedStackFileContent: stackFileContent,
              updatedEnv: stack.Env || [],
            },
            logContainer,
          );
        } catch (error: unknown) {
          restoreWaitError = error;
        }
      }
      const restoreError = restorePutError || restoreWaitError;
      if (restoreError) {
        const restoreMessage = getErrorMessage(restoreError);
        logContainer.warn(`Portainer recovery restore failed: ${restoreMessage}`);
        throw new Error(
          `Portainer recovery reissue failed for operation ${pending.id}: ${getErrorMessage(reissueError)} (Portainer recovery restore failed: ${restoreMessage})`,
        );
      }
      throw new Error(
        `Portainer recovery reissue failed for operation ${pending.id}: ${getErrorMessage(reissueError)}`,
      );
    }

    if (restore) {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'Portainer restore completed during recovery',
      });
    } else {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });
    }
    logContainer.info(
      `Reissued Portainer ${restore ? 'restore' : 'target'} redeploy for ${recovery.service} during recovery`,
    );
  }

  getRollbackConfig(container) {
    return { ...super.getRollbackConfig(container), autoRollback: false };
  }

  override getUpdateLockKeys(container: {
    name: string;
    watcher: string;
    labels?: Record<string, string>;
  }): string[] {
    const keys = super.getUpdateLockKeys(container);
    const composeProject = container.labels?.[COMPOSE_PROJECT_LABEL];
    if (composeProject) {
      keys.push(buildComposeProjectLockKey(container, composeProject));
    }
    const endpointId = container.labels?.[ENDPOINT_ID_LABEL] || 'unknown-endpoint';
    const stackId = container.labels?.[STACK_ID_LABEL];
    const scope = stackId
      ? `stack:${stackId}:endpoint:${endpointId}`
      : `project:${composeProject || 'unknown'}:endpoint:${endpointId}`;
    keys.push(`portainer:${normalizePortainerUrl(this.configuration.url)}:${scope}`);
    return keys;
  }
}

export default Portainer;

export {
  extractPinnedTagValue as testable_extractPinnedTagValue,
  extractTagVariable as testable_extractTagVariable,
  getComposeConfigFiles as testable_getComposeConfigFiles,
  getComposeProjectPaths as testable_getComposeProjectPaths,
  getServiceImage as testable_getServiceImage,
  getServiceKey as testable_getServiceKey,
  getTargetTag as testable_getTargetTag,
  isMatchingServiceContainer as testable_isMatchingServiceContainer,
  isTargetServiceContainer as testable_isTargetServiceContainer,
  normalizeImageReference as testable_normalizeImageReference,
  normalizeImageRepository as testable_normalizeImageRepository,
  normalizeImplicitLatest as testable_normalizeImplicitLatest,
  normalizePath as testable_normalizePath,
  upsertStackEnv as testable_upsertStackEnv,
  validateComposePullPolicy as testable_validateComposePullPolicy,
};
