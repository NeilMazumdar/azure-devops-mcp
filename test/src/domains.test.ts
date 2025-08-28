// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainsManager } from "../../src/shared/domains";

describe("DomainsManager: simplified repositories-only configuration", () => {
  describe("constructor", () => {
    it("enables only repositories domain regardless of input", () => {
      const manager = new DomainsManager();
      const enabledDomains = manager.getEnabledDomains();

      expect(enabledDomains.size).toBe(1);
      expect(enabledDomains.has("repositories")).toBe(true);
    });

    it("enables only repositories domain with undefined", () => {
      const manager = new DomainsManager(undefined);
      const enabledDomains = manager.getEnabledDomains();

      expect(enabledDomains.size).toBe(1);
      expect(Array.from(enabledDomains).sort()).toEqual(["repositories"]);
    });

    it("enables only repositories domain with 'all'", () => {
      const manager = new DomainsManager("all");
      const enabledDomains = manager.getEnabledDomains();

      expect(enabledDomains.size).toBe(1);
      expect(enabledDomains.has("repositories")).toBe(true);
    });

    it("enables only repositories domain with specific domain", () => {
      const manager = new DomainsManager("repositories");
      const enabledDomains = manager.getEnabledDomains();

      expect(enabledDomains.size).toBe(1);
      expect(enabledDomains.has("repositories")).toBe(true);
    });

    it("enables only repositories domain with array input", () => {
      const manager = new DomainsManager(["repositories", "builds"]);
      const enabledDomains = manager.getEnabledDomains();

      expect(enabledDomains.size).toBe(1);
      expect(enabledDomains.has("repositories")).toBe(true);
    });
  });

  describe("isDomainEnabled method", () => {
    it("returns true only for repositories domain", () => {
      const manager = new DomainsManager();

      expect(manager.isDomainEnabled("repositories")).toBe(true);
      expect(manager.isDomainEnabled("builds")).toBe(false);
      expect(manager.isDomainEnabled("wiki")).toBe(false);
      expect(manager.isDomainEnabled("core")).toBe(false);
    });
  });

  describe("getAvailableDomains method", () => {
    it("returns only repositories domain", () => {
      const availableDomains = DomainsManager.getAvailableDomains();
      
      expect(availableDomains).toEqual(["repositories"]);
      expect(availableDomains.length).toBe(1);
    });
  });

  describe("parseDomainsInput method", () => {
    it("parses string input correctly", () => {
      const result = DomainsManager.parseDomainsInput("repositories");
      expect(result).toEqual(["repositories"]);
    });

    it("parses array input correctly", () => {
      const result = DomainsManager.parseDomainsInput(["repositories", "builds"]);
      expect(result).toEqual(["repositories", "builds"]);
    });

    it("handles undefined input", () => {
      const result = DomainsManager.parseDomainsInput(undefined);
      expect(result).toEqual([]);
    });
  });
});