// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Available Azure DevOps MCP domains
 */
export enum Domain {
  REPOSITORIES = "repositories",
}

export const ALL_DOMAINS = "all";

/**
 * Manages domain parsing and validation for Azure DevOps MCP server tools
 * Simplified for repositories-only configuration
 */
export class DomainsManager {
  private readonly enabledDomains: Set<string>;

  constructor(domainsInput?: string | string[]) {
    // Since we only have repositories domain, always enable it
    this.enabledDomains = new Set([Domain.REPOSITORIES]);
  }

  /**
   * Check if a specific domain is enabled
   * @param domain - Domain name to check
   * @returns true if domain is enabled
   */
  public isDomainEnabled(domain: string): boolean {
    return this.enabledDomains.has(domain);
  }

  /**
   * Get all enabled domains
   * @returns Set of enabled domain names
   */
  public getEnabledDomains(): Set<string> {
    return new Set(this.enabledDomains);
  }

  /**
   * Get list of all available domains
   * @returns Array of available domain names
   */
  public static getAvailableDomains(): string[] {
    return Object.values(Domain);
  }

  /**
   * Parse domains input from string or array to a normalized array of strings
   * @param domainsInput - Domains input to parse
   * @returns Normalized array of domain strings
   */
  public static parseDomainsInput(domainsInput?: string | string[]): string[] {
    if (!domainsInput) {
      return [];
    }

    if (typeof domainsInput === "string") {
      return domainsInput.split(",").map((d) => d.trim().toLowerCase());
    }

    return domainsInput.map((d) => d.trim().toLowerCase());
  }
}
