import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  ProjectOwnerBindingV1,
  ProjectRecordV1,
  ProjectStatus,
  ProjectsRegistryV1,
} from "./protocol";

export const PROJECTS_SCHEMA = "muweave.projects.v1" as const;
export const MAX_PROJECTS = 200;
export const MAX_PROJECT_BINDINGS = 100;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export function isValidProjectStatus(value: unknown): value is ProjectStatus {
  return (
    value === "preparing" ||
    value === "in_production" ||
    value === "ready_to_publish" ||
    value === "published" ||
    value === "archived"
  );
}
export function isValidProjectTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 120
  );
}
export function normalizeOwnerBinding(
  raw: unknown,
  now = new Date().toISOString(),
): ProjectOwnerBindingV1 | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Partial<ProjectOwnerBindingV1>;
  if (
    typeof value.workspaceId !== "string" ||
    !SAFE_REF_RE.test(value.workspaceId)
  )
    return undefined;
  if (
    value.owner !== "eikona" &&
    value.owner !== "auctra" &&
    value.owner !== "scaena" &&
    value.owner !== "pi"
  )
    return undefined;
  const refs = Array.isArray(value.refs)
    ? value.refs
        .filter(
          (ref): ref is string =>
            typeof ref === "string" && SAFE_REF_RE.test(ref.trim()),
        )
        .map((ref) => ref.trim())
    : [];
  const state =
    value.bindingState === "bound" ||
    value.bindingState === "uninitialized" ||
    value.bindingState === "unavailable" ||
    value.bindingState === "conflict"
      ? value.bindingState
      : "bound";
  return {
    workspaceId: value.workspaceId,
    owner: value.owner,
    refs: [...new Set(refs)].slice(0, MAX_PROJECT_BINDINGS),
    bindingState: state,
    updatedAt:
      typeof value.updatedAt === "string" &&
      !Number.isNaN(Date.parse(value.updatedAt))
        ? value.updatedAt
        : now,
  };
}

function normalizeProject(raw: unknown): ProjectRecordV1 | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Partial<ProjectRecordV1>;
  if (
    typeof value.id !== "string" ||
    !SAFE_REF_RE.test(value.id) ||
    !isValidProjectTitle(value.title)
  )
    return undefined;
  const status = isValidProjectStatus(value.status)
    ? value.status
    : "preparing";
  const now = new Date().toISOString();
  const createdAt =
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt))
      ? value.createdAt
      : now;
  const updatedAt =
    typeof value.updatedAt === "string" &&
    !Number.isNaN(Date.parse(value.updatedAt))
      ? value.updatedAt
      : createdAt;
  const workspaces = Array.isArray(value.workspaceRefs)
    ? [
        ...new Set(
          value.workspaceRefs
            .filter(
              (ref): ref is string =>
                typeof ref === "string" && SAFE_REF_RE.test(ref.trim()),
            )
            .map((ref) => ref.trim()),
        ),
      ].slice(0, MAX_PROJECT_BINDINGS)
    : [];
  const bindings = Array.isArray(value.ownerBindings)
    ? value.ownerBindings
        .map((binding) => normalizeOwnerBinding(binding, updatedAt))
        .filter((binding): binding is ProjectOwnerBindingV1 => Boolean(binding))
        .slice(0, MAX_PROJECT_BINDINGS)
    : [];
  const revisions =
    typeof value.lastObservedRevisions === "object" &&
    value.lastObservedRevisions !== null &&
    !Array.isArray(value.lastObservedRevisions)
      ? Object.fromEntries(
          Object.entries(value.lastObservedRevisions).filter(
            ([key, revision]) =>
              SAFE_REF_RE.test(key) &&
              typeof revision === "string" &&
              SAFE_REF_RE.test(revision),
          ),
        )
      : undefined;
  return {
    id: value.id,
    title: value.title.trim(),
    status,
    workspaceRefs: workspaces,
    ownerBindings: bindings,
    createdAt,
    updatedAt,
    ...(revisions && Object.keys(revisions).length > 0
      ? { lastObservedRevisions: revisions }
      : {}),
    ...(typeof value.coverRef === "string" && SAFE_REF_RE.test(value.coverRef)
      ? { coverRef: value.coverRef }
      : {}),
    ...(status === "archived" && typeof value.archivedAt === "string"
      ? { archivedAt: value.archivedAt }
      : {}),
    archived: status === "archived",
    ...(typeof value.lastSyncedAt === "string"
      ? { lastSyncedAt: value.lastSyncedAt }
      : {}),
  };
}

export class ProjectInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ProjectStore {
  private projects: ProjectRecordV1[] = [];
  private activeProjectId?: string;
  private registryUpdatedAt = "";
  corruptFile?: string;
  constructor(private readonly file: string) {
    this.load();
  }
  list(
    includeArchived = false,
    query?: string,
    workspaceId?: string,
  ): ProjectsRegistryV1 {
    const needle = query?.trim().toLowerCase();
    const projects = this.projects
      .filter(
        (project) =>
          (includeArchived || !project.archived) &&
          (!needle ||
            project.title.toLowerCase().includes(needle) ||
            project.id.toLowerCase().includes(needle)) &&
          (!workspaceId || project.workspaceRefs.includes(workspaceId)),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.title.localeCompare(b.title),
      );
    return {
      schema: PROJECTS_SCHEMA,
      projects,
      ...(this.activeProjectId
        ? { activeProjectId: this.activeProjectId }
        : {}),
      updatedAt: this.registryUpdatedAt,
    };
  }
  get(projectId: string): ProjectRecordV1 | undefined {
    return this.projects.find((project) => project.id === projectId);
  }
  create(input: {
    title: string;
    status?: ProjectStatus;
    workspaceId?: string;
    workspaceIds?: string[];
    coverRef?: string;
    id?: string;
  }): ProjectRecordV1 {
    if (!isValidProjectTitle(input.title))
      throw new ProjectInputError(
        "muweave/invalid_project_title",
        "Project title must be 1-120 characters",
      );
    const status = input.status ?? "preparing";
    if (!isValidProjectStatus(status))
      throw new ProjectInputError(
        "muweave/invalid_project_status",
        "Invalid project status",
      );
    if (this.projects.length >= MAX_PROJECTS)
      throw new ProjectInputError(
        "muweave/project_limit_reached",
        "Project limit reached",
      );
    const id =
      input.id?.trim() ||
      "proj_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10);
    if (!SAFE_REF_RE.test(id) || this.get(id))
      throw new ProjectInputError(
        "muweave/project_exists",
        "Project id already exists",
      );
    const workspaceRefs = [
      ...new Set([
        ...(input.workspaceIds ?? []),
        ...(input.workspaceId ? [input.workspaceId] : []),
      ]),
    ];
    const now = new Date().toISOString();
    const project: ProjectRecordV1 = {
      id,
      title: input.title.trim(),
      status,
      workspaceRefs,
      ownerBindings: [],
      createdAt: now,
      updatedAt: now,
      ...(input.coverRef ? { coverRef: input.coverRef } : {}),
      archived: status === "archived",
      ...(status === "archived" ? { archivedAt: now } : {}),
    };
    this.projects.push(project);
    this.activeProjectId = id;
    this.persist();
    return project;
  }
  /**
   * Copies project *metadata only* (title hint + status). Owner bindings, cover, elements and the
   * schedule board are deliberately not copied — see docs/design/project-management-arch.md.
   */
  clone(input: {
    sourceProjectId: string;
    title: string;
    workspaceIds?: string[];
  }): {
    project: ProjectRecordV1;
    copied: { title: true; status: true; bindings: false; elements: false; schedule: false };
  } {
    const source = this.require(input.sourceProjectId);
    const project = this.create({
      title: input.title,
      // An archived source clones as `preparing`: a fresh project is never born archived.
      status: source.status === "archived" ? "preparing" : source.status,
      workspaceIds: input.workspaceIds?.length ? input.workspaceIds : source.workspaceRefs,
    });
    return {
      project,
      copied: { title: true, status: true, bindings: false, elements: false, schedule: false },
    };
  }

  update(
    projectId: string,
    input: {
      title?: string;
      status?: ProjectStatus;
      coverRef?: string | null;
      expectedUpdatedAt?: string;
    },
  ): ProjectRecordV1 {
    const project = this.require(projectId);
    if (project.archived)
      throw new ProjectInputError(
        "muweave/project_archived",
        "Archived project must be restored first",
      );
    if (
      input.expectedUpdatedAt &&
      input.expectedUpdatedAt !== project.updatedAt
    )
      throw new ProjectInputError(
        "muweave/project_revision_conflict",
        "Project changed since it was loaded",
      );
    if (input.title !== undefined && !isValidProjectTitle(input.title))
      throw new ProjectInputError(
        "muweave/invalid_project_title",
        "Project title must be 1-120 characters",
      );
    if (
      input.status !== undefined &&
      (!isValidProjectStatus(input.status) || input.status === "archived")
    )
      throw new ProjectInputError(
        "muweave/invalid_project_status",
        "Use project.archive for archived status",
      );
    const updated: ProjectRecordV1 = {
      ...project,
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      status: input.status ?? project.status,
      updatedAt: new Date().toISOString(),
    };
    if (input.coverRef === null) delete updated.coverRef;
    else if (input.coverRef !== undefined) updated.coverRef = input.coverRef;
    this.replace(updated);
    this.persist();
    return updated;
  }
  archive(projectId: string, expectedUpdatedAt?: string): ProjectRecordV1 {
    const project = this.require(projectId);
    if (expectedUpdatedAt && expectedUpdatedAt !== project.updatedAt)
      throw new ProjectInputError(
        "muweave/project_revision_conflict",
        "Project changed since it was loaded",
      );
    if (project.archived) return project;
    const now = new Date().toISOString();
    const archived = {
      ...project,
      status: "archived" as const,
      archived: true,
      archivedAt: now,
      updatedAt: now,
    };
    this.replace(archived);
    if (this.activeProjectId === projectId)
      this.activeProjectId = this.projects.find(
        (item) => !item.archived && item.id !== projectId,
      )?.id;
    this.persist();
    return archived;
  }
  restore(
    projectId: string,
    status: Exclude<ProjectStatus, "archived"> = "preparing",
  ): ProjectRecordV1 {
    const project = this.require(projectId);
    const restored: ProjectRecordV1 = {
      ...project,
      status,
      archived: false,
      updatedAt: new Date().toISOString(),
    };
    delete restored.archivedAt;
    this.replace(restored);
    this.persist();
    return restored;
  }
  bind(input: {
    projectId: string;
    workspaceId: string;
    owner: ProjectOwnerBindingV1["owner"];
    refs: string[];
    expectedRevision?: string;
    workspaceRegistered?: boolean;
    bindingState?: ProjectOwnerBindingV1["bindingState"];
  }): { project: ProjectRecordV1; binding: ProjectOwnerBindingV1 } {
    const project = this.require(input.projectId);
    if (project.archived)
      throw new ProjectInputError(
        "muweave/project_archived",
        "Archived project must be restored first",
      );
    if (input.workspaceRegistered === false)
      throw new ProjectInputError(
        "muweave/workspace_unknown",
        "Workspace is not registered",
      );
    if (
      input.owner !== "eikona" &&
      input.owner !== "auctra" &&
      input.owner !== "scaena" &&
      input.owner !== "pi"
    )
      throw new ProjectInputError(
        "muweave/invalid_owner_ref",
        "Owner binding is invalid",
      );
    if (
      !Array.isArray(input.refs) ||
      input.refs.length === 0 ||
      input.refs.some(
        (ref) => typeof ref !== "string" || !SAFE_REF_RE.test(ref.trim()),
      )
    )
      throw new ProjectInputError(
        "muweave/invalid_owner_ref",
        "Owner binding refs are invalid",
      );
    const binding = normalizeOwnerBinding({
      workspaceId: input.workspaceId,
      owner: input.owner,
      refs: input.refs,
      bindingState: input.bindingState ?? "bound",
    });
    if (!binding)
      throw new ProjectInputError(
        "muweave/invalid_owner_ref",
        "Owner binding is invalid",
      );
    const revisionKey = `${input.workspaceId}/${input.owner}`;
    const actual = project.lastObservedRevisions?.[revisionKey];
    if (input.expectedRevision !== undefined && input.expectedRevision !== actual)
      throw new ProjectInputError(
        "muweave/revision_conflict",
        "Workspace owner revision changed since it was loaded",
        { expected: input.expectedRevision, actual: actual ?? null },
      );
    const ownerBindings = project.ownerBindings.filter(
      (item) =>
        !(
          item.workspaceId === binding.workspaceId &&
          item.owner === binding.owner
        ),
    );
    ownerBindings.push(binding);
    const updated: ProjectRecordV1 = {
      ...project,
      ownerBindings,
      workspaceRefs: [
        ...new Set([...project.workspaceRefs, input.workspaceId]),
      ],
      updatedAt: new Date().toISOString(),
      ...(input.expectedRevision === undefined
        ? {}
        : {
            lastObservedRevisions: {
              ...(project.lastObservedRevisions ?? {}),
              [revisionKey]: input.expectedRevision,
            },
          }),
    };
    this.replace(updated);
    this.persist();
    return { project: updated, binding };
  }
  unbind(input: {
    projectId: string;
    workspaceId: string;
    owner: ProjectOwnerBindingV1["owner"];
    refs?: string[];
  }): { project: ProjectRecordV1; removed: boolean } {
    const project = this.require(input.projectId);
    if (!input.workspaceId)
      throw new ProjectInputError(
        "muweave/workspace_unknown",
        "Workspace is required",
      );
    if (
      input.owner !== "eikona" &&
      input.owner !== "auctra" &&
      input.owner !== "scaena" &&
      input.owner !== "pi"
    )
      throw new ProjectInputError(
        "muweave/invalid_owner_ref",
        "Owner binding is invalid",
      );
    // Unbinding only removes the registry binding record. It never touches the bundle or owner originals.
    const ownerBindings = project.ownerBindings.filter(
      (item) =>
        !(
          item.workspaceId === input.workspaceId &&
          item.owner === input.owner
        ),
    );
    if (ownerBindings.length === project.ownerBindings.length)
      return { project, removed: false };
    const updated: ProjectRecordV1 = {
      ...project,
      ownerBindings,
      // workspaceRefs is project scope, not a binding-derived field; never prune it here.
      updatedAt: new Date().toISOString(),
    };
    this.replace(updated);
    this.persist();
    return { project: updated, removed: true };
  }
  activate(projectId: string): ProjectRecordV1 {
    const project = this.require(projectId);
    if (project.archived)
      throw new ProjectInputError(
        "muweave/project_archived",
        "Archived projects cannot be activated",
      );
    this.activeProjectId = projectId;
    this.persist();
    return project;
  }
  private require(projectId: string): ProjectRecordV1 {
    const project = this.get(projectId);
    if (!project)
      throw new ProjectInputError(
        "muweave/project_not_found",
        "Project not found",
      );
    return project;
  }
  private replace(project: ProjectRecordV1): void {
    this.projects = this.projects.map((item) =>
      item.id === project.id ? project : item,
    );
  }
  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(
        readFileSync(this.file, "utf8"),
      ) as Partial<ProjectsRegistryV1>;
      if (parsed.schema !== PROJECTS_SCHEMA || !Array.isArray(parsed.projects))
        throw new Error("invalid registry");
      this.projects = parsed.projects
        .map(normalizeProject)
        .filter((project): project is ProjectRecordV1 => Boolean(project))
        .slice(0, MAX_PROJECTS);
      this.activeProjectId =
        typeof parsed.activeProjectId === "string" &&
        this.projects.some(
          (project) =>
            project.id === parsed.activeProjectId && !project.archived,
        )
          ? parsed.activeProjectId
          : this.projects.find((project) => !project.archived)?.id;
      this.registryUpdatedAt =
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString();
    } catch {
      this.projects = [];
      const aside = path.join(
        path.dirname(this.file),
        "projects.v1.corrupt-" + Date.now() + ".json",
      );
      try {
        renameSync(this.file, aside);
        this.corruptFile = aside;
      } catch {
        this.corruptFile = this.file;
      }
    }
  }
  private persist(): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true });
    this.registryUpdatedAt = new Date().toISOString();
    const tmp = this.file + ".tmp." + process.pid;
    const body: ProjectsRegistryV1 = {
      schema: PROJECTS_SCHEMA,
      projects: this.projects,
      ...(this.activeProjectId
        ? { activeProjectId: this.activeProjectId }
        : {}),
      updatedAt: this.registryUpdatedAt,
    };
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
