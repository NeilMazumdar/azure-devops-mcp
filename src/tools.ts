// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AccessToken } from "@azure/identity";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebApi } from "azure-devops-node-api";

import { configureRepoTools } from "./tools/repositories.js";

function configureAllTools(server: McpServer, tokenProvider: () => Promise<AccessToken>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string, enabledDomains: Set<string>) {
  // Only configure repository tools - ignore domain configuration since we only have one domain
  configureRepoTools(server, tokenProvider, connectionProvider, userAgentProvider);
}

export { configureAllTools };
