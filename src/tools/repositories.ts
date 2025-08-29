// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AccessToken } from "@azure/identity";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebApi } from "azure-devops-node-api";
import {
  GitRef,
  PullRequestStatus,
  GitQueryCommitsCriteria,
  GitVersionType,
  GitVersionDescriptor,
  GitPullRequestQuery,
  GitPullRequestQueryInput,
  GitPullRequestQueryType,
  Comment,
  CommentType,
  CommentThread,
  CommentThreadStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { z } from "zod";
import { getCurrentUserDetails, getUserIdFromEmail } from "./auth.js";
import { GitRepository } from "azure-devops-node-api/interfaces/TfvcInterfaces.js";
import { getEnumKeys } from "../utils.js";

const REPO_TOOLS = {
  list_repos_by_project: "repo_list_repos_by_project",
  list_pull_requests_by_repo: "repo_list_pull_requests_by_repo",
  list_pull_requests_by_project: "repo_list_pull_requests_by_project",
  list_branches_by_repo: "repo_list_branches_by_repo",
  list_my_branches_by_repo: "repo_list_my_branches_by_repo",
  list_pull_request_threads: "repo_list_pull_request_threads",
  list_pull_request_thread_comments: "repo_list_pull_request_thread_comments",
  get_repo_by_name_or_id: "repo_get_repo_by_name_or_id",
  get_branch_by_name: "repo_get_branch_by_name",
  get_pull_request_by_id: "repo_get_pull_request_by_id",
  search_commits: "repo_search_commits",
  list_pull_requests_by_commits: "repo_list_pull_requests_by_commits",
  create_pull_request_comment: "repo_create_pull_request_comment",
};

function branchesFilterOutIrrelevantProperties(branches: GitRef[], top: number) {
  return branches
    ?.flatMap((branch) => (branch.name ? [branch.name] : []))
    ?.filter((branch) => branch.startsWith("refs/heads/"))
    .map((branch) => branch.replace("refs/heads/", ""))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, top);
}

/**
 * Trims comment data to essential properties, filtering out deleted comments
 * @param comments Array of comments to trim (can be undefined/null)
 * @returns Array of trimmed comment objects with essential properties only
 */
function trimComments(comments: any[] | undefined | null) {
  return comments
    ?.filter((comment) => !comment.isDeleted) // Exclude deleted comments
    ?.map((comment) => ({
      id: comment.id,
      author: {
        displayName: comment.author?.displayName,
        uniqueName: comment.author?.uniqueName,
      },
      content: comment.content,
      publishedDate: comment.publishedDate,
      lastUpdatedDate: comment.lastUpdatedDate,
      lastContentUpdatedDate: comment.lastContentUpdatedDate,
    }));
}

function pullRequestStatusStringToInt(status: string): number {
  switch (status) {
    case "Abandoned":
      return PullRequestStatus.Abandoned.valueOf();
    case "Active":
      return PullRequestStatus.Active.valueOf();
    case "All":
      return PullRequestStatus.All.valueOf();
    case "Completed":
      return PullRequestStatus.Completed.valueOf();
    case "NotSet":
      return PullRequestStatus.NotSet.valueOf();
    default:
      throw new Error(`Unknown pull request status: ${status}`);
  }
}

function filterReposByName(repositories: GitRepository[], repoNameFilter: string): GitRepository[] {
  const lowerCaseFilter = repoNameFilter.toLowerCase();
  const filteredByName = repositories?.filter((repo) => repo.name?.toLowerCase().includes(lowerCaseFilter));

  return filteredByName;
}

function configureRepoTools(server: McpServer, tokenProvider: () => Promise<AccessToken>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string) {



  server.tool(
    REPO_TOOLS.list_repos_by_project,
    "Retrieve a list of repositories for a given project",
    {
      project: z.string().describe("The name or ID of the Azure DevOps project."),
      top: z.number().default(100).describe("The maximum number of repositories to return."),
      skip: z.number().default(0).describe("The number of repositories to skip. Defaults to 0."),
      repoNameFilter: z.string().optional().describe("Optional filter to search for repositories by name. If provided, only repositories with names containing this string will be returned."),
    },
    async ({ project, top, skip, repoNameFilter }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const repositories = await gitApi.getRepositories(project, false, false, false);

      const filteredRepositories = repoNameFilter ? filterReposByName(repositories, repoNameFilter) : repositories;

      const paginatedRepositories = filteredRepositories?.sort((a, b) => a.name?.localeCompare(b.name ?? "") ?? 0).slice(skip, skip + top);

      // Filter out the irrelevant properties
      const trimmedRepositories = paginatedRepositories?.map((repo) => ({
        id: repo.id,
        name: repo.name,
        isDisabled: repo.isDisabled,
        isFork: repo.isFork,
        isInMaintenance: repo.isInMaintenance,
        webUrl: repo.webUrl,
        size: repo.size,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(trimmedRepositories, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_pull_requests_by_repo,
    "Retrieve a list of pull requests for a given repository.",
    {
      repositoryId: z.string().describe("The ID of the repository where the pull requests are located."),
      top: z.number().default(100).describe("The maximum number of pull requests to return."),
      skip: z.number().default(0).describe("The number of pull requests to skip."),
      created_by_me: z.boolean().default(false).describe("Filter pull requests created by the current user."),
      created_by_user: z.string().optional().describe("Filter pull requests created by a specific user (provide email or unique name). Takes precedence over created_by_me if both are provided."),
      i_am_reviewer: z.boolean().default(false).describe("Filter pull requests where the current user is a reviewer."),
      status: z
        .enum(getEnumKeys(PullRequestStatus) as [string, ...string[]])
        .default("Active")
        .describe("Filter pull requests by status. Defaults to 'Active'."),
    },
    async ({ repositoryId, top, skip, created_by_me, created_by_user, i_am_reviewer, status }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();

      // Build the search criteria
      const searchCriteria: {
        status: number;
        repositoryId: string;
        creatorId?: string;
        reviewerId?: string;
      } = {
        status: pullRequestStatusStringToInt(status),
        repositoryId: repositoryId,
      };

      if (created_by_user) {
        try {
          const userId = await getUserIdFromEmail(created_by_user, tokenProvider, connectionProvider, userAgentProvider);
          searchCriteria.creatorId = userId;
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error finding user with email ${created_by_user}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      } else if (created_by_me || i_am_reviewer) {
        const data = await getCurrentUserDetails(tokenProvider, connectionProvider, userAgentProvider);
        const userId = data.authenticatedUser.id;
        if (created_by_me) {
          searchCriteria.creatorId = userId;
        }
        if (i_am_reviewer) {
          searchCriteria.reviewerId = userId;
        }
      }

      const pullRequests = await gitApi.getPullRequests(
        repositoryId,
        searchCriteria,
        undefined, // project
        undefined, // maxCommentLength
        skip,
        top
      );

      // Filter out the irrelevant properties
      const filteredPullRequests = pullRequests?.map((pr) => ({
        pullRequestId: pr.pullRequestId,
        codeReviewId: pr.codeReviewId,
        status: pr.status,
        createdBy: {
          displayName: pr.createdBy?.displayName,
          uniqueName: pr.createdBy?.uniqueName,
        },
        creationDate: pr.creationDate,
        title: pr.title,
        isDraft: pr.isDraft,
        sourceRefName: pr.sourceRefName,
        targetRefName: pr.targetRefName,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(filteredPullRequests, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_pull_requests_by_project,
    "Retrieve a list of pull requests for a given project Id or Name.",
    {
      project: z.string().describe("The name or ID of the Azure DevOps project."),
      top: z.number().default(100).describe("The maximum number of pull requests to return."),
      skip: z.number().default(0).describe("The number of pull requests to skip."),
      created_by_me: z.boolean().default(false).describe("Filter pull requests created by the current user."),
      created_by_user: z.string().optional().describe("Filter pull requests created by a specific user (provide email or unique name). Takes precedence over created_by_me if both are provided."),
      i_am_reviewer: z.boolean().default(false).describe("Filter pull requests where the current user is a reviewer."),
      status: z
        .enum(getEnumKeys(PullRequestStatus) as [string, ...string[]])
        .default("Active")
        .describe("Filter pull requests by status. Defaults to 'Active'."),
    },
    async ({ project, top, skip, created_by_me, created_by_user, i_am_reviewer, status }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();

      // Build the search criteria
      const gitPullRequestSearchCriteria: {
        status: number;
        creatorId?: string;
        reviewerId?: string;
      } = {
        status: pullRequestStatusStringToInt(status),
      };

      if (created_by_user) {
        try {
          const userId = await getUserIdFromEmail(created_by_user, tokenProvider, connectionProvider, userAgentProvider);
          gitPullRequestSearchCriteria.creatorId = userId;
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error finding user with email ${created_by_user}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      } else if (created_by_me || i_am_reviewer) {
        const data = await getCurrentUserDetails(tokenProvider, connectionProvider, userAgentProvider);
        const userId = data.authenticatedUser.id;
        if (created_by_me) {
          gitPullRequestSearchCriteria.creatorId = userId;
        }
        if (i_am_reviewer) {
          gitPullRequestSearchCriteria.reviewerId = userId;
        }
      }

      const pullRequests = await gitApi.getPullRequestsByProject(
        project,
        gitPullRequestSearchCriteria,
        undefined, // maxCommentLength
        skip,
        top
      );

      // Filter out the irrelevant properties
      const filteredPullRequests = pullRequests?.map((pr) => ({
        pullRequestId: pr.pullRequestId,
        codeReviewId: pr.codeReviewId,
        repository: pr.repository?.name,
        status: pr.status,
        createdBy: {
          displayName: pr.createdBy?.displayName,
          uniqueName: pr.createdBy?.uniqueName,
        },
        creationDate: pr.creationDate,
        title: pr.title,
        isDraft: pr.isDraft,
        sourceRefName: pr.sourceRefName,
        targetRefName: pr.targetRefName,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(filteredPullRequests, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_pull_request_threads,
    "Retrieve a list of comment threads for a pull request.",
    {
      repositoryId: z.string().describe("The ID of the repository where the pull request is located."),
      pullRequestId: z.number().describe("The ID of the pull request for which to retrieve threads."),
      project: z.string().optional().describe("Project ID or project name (optional)"),
      iteration: z.number().optional().describe("The iteration ID for which to retrieve threads. Optional, defaults to the latest iteration."),
      baseIteration: z.number().optional().describe("The base iteration ID for which to retrieve threads. Optional, defaults to the latest base iteration."),
      top: z.number().default(100).describe("The maximum number of threads to return."),
      skip: z.number().default(0).describe("The number of threads to skip."),
      fullResponse: z.boolean().optional().default(false).describe("Return full thread JSON response instead of trimmed data."),
    },
    async ({ repositoryId, pullRequestId, project, iteration, baseIteration, top, skip, fullResponse }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();

      const threads = await gitApi.getThreads(repositoryId, pullRequestId, project, iteration, baseIteration);

      const paginatedThreads = threads?.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).slice(skip, skip + top);

      if (fullResponse) {
        return {
          content: [{ type: "text", text: JSON.stringify(paginatedThreads, null, 2) }],
        };
      }

      // Return trimmed thread data focusing on essential information
      const trimmedThreads = paginatedThreads?.map((thread) => ({
        id: thread.id,
        publishedDate: thread.publishedDate,
        lastUpdatedDate: thread.lastUpdatedDate,
        status: thread.status,
        threadContext: thread.threadContext, // Include file path and line information
        comments: trimComments(thread.comments),
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(trimmedThreads, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_pull_request_thread_comments,
    "Retrieve a list of comments in a pull request thread.",
    {
      repositoryId: z.string().describe("The ID of the repository where the pull request is located."),
      pullRequestId: z.number().describe("The ID of the pull request for which to retrieve thread comments."),
      threadId: z.number().describe("The ID of the thread for which to retrieve comments."),
      project: z.string().optional().describe("Project ID or project name (optional)"),
      top: z.number().default(100).describe("The maximum number of comments to return."),
      skip: z.number().default(0).describe("The number of comments to skip."),
      fullResponse: z.boolean().optional().default(false).describe("Return full comment JSON response instead of trimmed data."),
    },
    async ({ repositoryId, pullRequestId, threadId, project, top, skip, fullResponse }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();

      // Get thread comments - GitApi uses getComments for retrieving comments from a specific thread
      const comments = await gitApi.getComments(repositoryId, pullRequestId, threadId, project);

      const paginatedComments = comments?.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).slice(skip, skip + top);

      if (fullResponse) {
        return {
          content: [{ type: "text", text: JSON.stringify(paginatedComments, null, 2) }],
        };
      }

      // Return trimmed comment data focusing on essential information
      const trimmedComments = trimComments(paginatedComments);

      return {
        content: [{ type: "text", text: JSON.stringify(trimmedComments, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_branches_by_repo,
    "Retrieve a list of branches for a given repository.",
    {
      repositoryId: z.string().describe("The ID of the repository where the branches are located."),
      top: z.number().default(100).describe("The maximum number of branches to return. Defaults to 100."),
      filterContains: z.string().optional().describe("Filter to find branches that contain this string in their name."),
    },
    async ({ repositoryId, top, filterContains }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const branches = await gitApi.getRefs(repositoryId, undefined, "heads/", undefined, undefined, undefined, undefined, undefined, filterContains);

      const filteredBranches = branchesFilterOutIrrelevantProperties(branches, top);

      return {
        content: [{ type: "text", text: JSON.stringify(filteredBranches, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.list_my_branches_by_repo,
    "Retrieve a list of my branches for a given repository Id.",
    {
      repositoryId: z.string().describe("The ID of the repository where the branches are located."),
      top: z.number().default(100).describe("The maximum number of branches to return."),
      filterContains: z.string().optional().describe("Filter to find branches that contain this string in their name."),
    },
    async ({ repositoryId, top, filterContains }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const branches = await gitApi.getRefs(repositoryId, undefined, "heads/", undefined, undefined, true, undefined, undefined, filterContains);

      const filteredBranches = branchesFilterOutIrrelevantProperties(branches, top);

      return {
        content: [{ type: "text", text: JSON.stringify(filteredBranches, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.get_repo_by_name_or_id,
    "Get the repository by project and repository name or ID.",
    {
      project: z.string().describe("Project name or ID where the repository is located."),
      repositoryNameOrId: z.string().describe("Repository name or ID."),
    },
    async ({ project, repositoryNameOrId }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const repositories = await gitApi.getRepositories(project);

      const repository = repositories?.find((repo) => repo.name === repositoryNameOrId || repo.id === repositoryNameOrId);

      if (!repository) {
        throw new Error(`Repository ${repositoryNameOrId} not found in project ${project}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(repository, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.get_branch_by_name,
    "Get a branch by its name.",
    {
      repositoryId: z.string().describe("The ID of the repository where the branch is located."),
      branchName: z.string().describe("The name of the branch to retrieve, e.g., 'main' or 'feature-branch'."),
    },
    async ({ repositoryId, branchName }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const branches = await gitApi.getRefs(repositoryId, undefined, "heads/", false, false, undefined, false, undefined, branchName);
      const branch = branches.find((branch) => branch.name === `refs/heads/${branchName}` || branch.name === branchName);
      if (!branch) {
        return {
          content: [
            {
              type: "text",
              text: `Branch ${branchName} not found in repository ${repositoryId}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(branch, null, 2) }],
      };
    }
  );

  server.tool(
    REPO_TOOLS.get_pull_request_by_id,
    "Get a pull request by its ID.",
    {
      repositoryId: z.string().describe("The ID of the repository where the pull request is located."),
      pullRequestId: z.number().describe("The ID of the pull request to retrieve."),
      includeWorkItemRefs: z.boolean().optional().default(false).describe("Whether to reference work items associated with the pull request."),
    },
    async ({ repositoryId, pullRequestId, includeWorkItemRefs }) => {
      const connection = await connectionProvider();
      const gitApi = await connection.getGitApi();
      const pullRequest = await gitApi.getPullRequest(repositoryId, pullRequestId, undefined, undefined, undefined, undefined, undefined, includeWorkItemRefs);
      return {
        content: [{ type: "text", text: JSON.stringify(pullRequest, null, 2) }],
      };
    }
  );




  const gitVersionTypeStrings = Object.values(GitVersionType).filter((value): value is string => typeof value === "string");

  server.tool(
    REPO_TOOLS.search_commits,
    "Searches for commits in a repository",
    {
      project: z.string().describe("Project name or ID"),
      repository: z.string().describe("Repository name or ID"),
      fromCommit: z.string().optional().describe("Starting commit ID"),
      toCommit: z.string().optional().describe("Ending commit ID"),
      version: z.string().optional().describe("The name of the branch, tag or commit to filter commits by"),
      versionType: z
        .enum(gitVersionTypeStrings as [string, ...string[]])
        .optional()
        .default(GitVersionType[GitVersionType.Branch])
        .describe("The meaning of the version parameter, e.g., branch, tag or commit"),
      skip: z.number().optional().default(0).describe("Number of commits to skip"),
      top: z.number().optional().default(10).describe("Maximum number of commits to return"),
      includeLinks: z.boolean().optional().default(false).describe("Include commit links"),
      includeWorkItems: z.boolean().optional().default(false).describe("Include associated work items"),
    },
    async ({ project, repository, fromCommit, toCommit, version, versionType, skip, top, includeLinks, includeWorkItems }) => {
      try {
        const connection = await connectionProvider();
        const gitApi = await connection.getGitApi();

        const searchCriteria: GitQueryCommitsCriteria = {
          fromCommitId: fromCommit,
          toCommitId: toCommit,
          includeLinks: includeLinks,
          includeWorkItems: includeWorkItems,
        };

        if (version) {
          const itemVersion: GitVersionDescriptor = {
            version: version,
            versionType: GitVersionType[versionType as keyof typeof GitVersionType],
          };
          searchCriteria.itemVersion = itemVersion;
        }

        const commits = await gitApi.getCommits(
          repository,
          searchCriteria,
          project,
          skip, // skip
          top
        );

        return {
          content: [{ type: "text", text: JSON.stringify(commits, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching commits: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  const pullRequestQueryTypesStrings = Object.values(GitPullRequestQueryType).filter((value): value is string => typeof value === "string");

  server.tool(
    REPO_TOOLS.list_pull_requests_by_commits,
    "Lists pull requests by commit IDs to find which pull requests contain specific commits",
    {
      project: z.string().describe("Project name or ID"),
      repository: z.string().describe("Repository name or ID"),
      commits: z.array(z.string()).describe("Array of commit IDs to query for"),
      queryType: z
        .enum(pullRequestQueryTypesStrings as [string, ...string[]])
        .optional()
        .default(GitPullRequestQueryType[GitPullRequestQueryType.LastMergeCommit])
        .describe("Type of query to perform"),
    },
    async ({ project, repository, commits, queryType }) => {
      try {
        const connection = await connectionProvider();
        const gitApi = await connection.getGitApi();

        const query: GitPullRequestQuery = {
          queries: [
            {
              items: commits,
              type: GitPullRequestQueryType[queryType as keyof typeof GitPullRequestQueryType],
            } as GitPullRequestQueryInput,
          ],
        };

        const queryResult = await gitApi.getPullRequestQuery(query, repository, project);

        return {
          content: [{ type: "text", text: JSON.stringify(queryResult, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error querying pull requests by commits: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    REPO_TOOLS.create_pull_request_comment,
    "Create a comment in a pull request thread or create a new thread with a comment.",
    {
      repositoryId: z.string().describe("The ID of the repository where the pull request is located."),
      pullRequestId: z.number().describe("The ID of the pull request to comment on."),
      content: z.string().describe("The comment content (supports markdown)."),
      threadId: z.number().optional().describe("Existing thread ID to add comment to. If not provided, creates new thread."),
      status: z.enum(["active", "byDesign", "closed", "fixed", "pending", "unknown", "wontFix"]).optional().default("active").describe("Thread status (only used when creating new thread)."),
      filePath: z.string().optional().describe("File path for file-specific comments (only for new threads)."),
      lineStart: z.number().optional().describe("Starting line number for file comments (only for new threads)."),
      lineEnd: z.number().optional().describe("Ending line number for file comments (defaults to lineStart)."),
      project: z.string().optional().describe("Project ID or project name (optional)"),
    },
    async ({ repositoryId, pullRequestId, content, threadId, status, filePath, lineStart, lineEnd, project }) => {
      try {
        const connection = await connectionProvider();
        const gitApi = await connection.getGitApi();

        if (threadId) {
          // Add comment to existing thread
          const comment: Comment = {
            content: content,
            commentType: CommentType.Text,
          };
          
          const result = await gitApi.createComment(
            comment,
            repositoryId,
            pullRequestId,
            threadId,
            project
          );

          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                id: result.id,
                author: {
                  displayName: result.author?.displayName,
                  uniqueName: result.author?.uniqueName,
                },
                content: result.content,
                publishedDate: result.publishedDate,
                threadId: threadId,
              }, null, 2) 
            }],
          };
        } else {
          // Create new thread with initial comment
          const threadData: CommentThread = {
            comments: [{
              content: content,
              commentType: CommentType.Text,
            }],
            status: CommentThreadStatus[status === "byDesign" ? "ByDesign" : 
                    status === "wontFix" ? "WontFix" : 
                    status.charAt(0).toUpperCase() + status.slice(1) as keyof typeof CommentThreadStatus],
          };

          // Add file context if provided
          if (filePath && lineStart) {
            threadData.threadContext = {
              filePath: filePath,
              rightFileStart: { line: lineStart, offset: 1 },
              rightFileEnd: { line: lineEnd || lineStart, offset: 1 }
            };
          }

          const result = await gitApi.createThread(
            threadData,
            repositoryId,
            pullRequestId,
            project
          );

          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                id: result.id,
                status: result.status,
                threadContext: result.threadContext,
                comments: trimComments(result.comments),
              }, null, 2) 
            }],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating comment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

export { REPO_TOOLS, configureRepoTools };
